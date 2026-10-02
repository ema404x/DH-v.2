-- =====================================================================================
-- DH1 v2 — Fase 11 (tanda 5): control y reportes
--
--   1. Auditoría: quién cambió qué y cuándo, escrita por triggers y de solo lectura (en la v1 cualquiera podía cargar
--      registros falsos y el admin podía editarlos o borrarlos). La lee gerencia
--   2. Alertas: calculadas en la base al momento (vencidos, garantías, stock, préstamos, plazos, patrones de
--      emergencias), con umbrales por sector y "ya lo vi" por persona. Sin proceso programado que pueda fallar ni un
--      encabezado que lo dispare sin login (la v1 tenía las dos cosas)
--   3. Informes: seguimiento de la entrega de informes con fecha límite (y van al calendario)
--   4. Reportes: los indicadores se calculan en la base, con una sola definición de cada uno (en la v1 la "eficiencia"
--      tenía tres fórmulas y los números dependían de qué pantalla se había abierto primero)
--
-- Se corre después de la fase 10. Es aditiva.
-- =====================================================================================

-- Día de Buenos Aires de un instante (las fechas de los reportes son días locales, no UTC).
create or replace function public.dia_ar(p timestamptz) returns date
language sql immutable as $$
  select (p at time zone 'America/Argentina/Buenos_Aires')::date
$$;

-- =====================================================================================
-- 1. AUDITORÍA
-- =====================================================================================
create table public.auditoria (
  id             bigint generated always as identity primary key,
  sector_id      uuid not null references public.sectores(id),
  tabla          text not null,
  registro_id    uuid,
  accion         text not null check (accion in ('alta','cambio','baja')),
  usuario_id     uuid,
  usuario_nombre text,
  usuario_rol    text,
  -- cambio: { campo: { antes, despues } } · alta y baja: el registro completo
  cambios        jsonb not null default '{}'::jsonb,
  etiqueta       text,
  created_at     timestamptz not null default now()
);
create index auditoria_sector_idx on public.auditoria(sector_id, created_at desc);
create index auditoria_registro_idx on public.auditoria(tabla, registro_id, created_at desc);

-- Excepción a la política única de §2.1 (como empleados_reservado): todos escriben su rastro a través de los triggers,
-- pero solo gerencia lo lee. El sector va siempre primero.
alter table public.auditoria enable row level security;
create policy auditoria_escribir on public.auditoria for insert to authenticated
  with check (sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores()));
create policy auditoria_leer on public.auditoria for select to authenticated
  using ((sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores())) and (select public.es_gerencia()));

create or replace function public.proteger_auditoria() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and (public.dh1_flag('dh1.audit_fn') or public.es_servicio()) then
    return new;
  end if;
  if public.es_servicio() then
    return coalesce(new, old);
  end if;
  raise exception 'La auditoría la escribe el sistema y no se modifica.' using errcode = 'P0001';
end $$;
create trigger b_proteger before insert or update or delete on public.auditoria
  for each row execute function public.proteger_auditoria();

-- Trigger genérico. Lo que hace la migración o el SQL Editor (sin usuario) no se audita: es carga, no operación.
-- tg_argv[0]: columna con el nombre visible del registro (para leer la auditoría sin abrir cada uno).
create or replace function public.auditar() returns trigger
language plpgsql set search_path = public as $$
declare
  v_nuevo jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_viejo jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_cambios jsonb := '{}'::jsonb;
  k text;
  v_prev text;
  v_etq text;
begin
  if public.es_servicio() then
    return null;
  end if;
  -- Un registro de otro sector (un admin que cambia su propio sector activo, por ejemplo) no tiene dónde auditarse:
  -- la auditoría vive en el sector desde el que se mira.
  -- En un cambio cuenta el sector que tenía (así queda registrado, por ejemplo, mover a un usuario de sector).
  if (coalesce(v_viejo, v_nuevo) ->> 'sector_id')::uuid is distinct from public.sector_efectivo() and not public.ve_todos_sectores() then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_nuevo) loop
      -- updated_at cambia siempre; el sector activo es la elección de pantalla de un admin, no un cambio de datos
      if k in ('updated_at', 'sector_activo_id', 'ultima_actividad') then continue; end if;
      if v_nuevo -> k is distinct from v_viejo -> k then
        v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_object('antes', v_viejo -> k, 'despues', v_nuevo -> k));
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then return null; end if;
  else
    v_cambios := coalesce(v_nuevo, v_viejo);
  end if;
  v_etq := coalesce(v_nuevo, v_viejo) ->> coalesce(tg_argv[0], 'id');
  v_prev := current_setting('dh1.audit_fn', true);
  perform set_config('dh1.audit_fn', '1', true);
  insert into public.auditoria (sector_id, tabla, registro_id, accion, usuario_id, usuario_nombre, usuario_rol, cambios, etiqueta)
  values ((coalesce(v_viejo, v_nuevo) ->> 'sector_id')::uuid, tg_table_name,
          coalesce(coalesce(v_nuevo, v_viejo) ->> 'id', coalesce(v_nuevo, v_viejo) ->> 'empleado_id')::uuid,
          case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'cambio' else 'baja' end,
          auth.uid(), (select p.nombre from public.perfiles p where p.id = auth.uid()), public.rol_actual()::text, v_cambios, left(v_etq, 200));
  perform set_config('dh1.audit_fn', coalesce(v_prev, ''), true);
  return null;
end $$;

-- Lo que conviene poder reconstruir: dinero, órdenes, personas, permisos, stock y catálogo.
-- (pendientes, cobro de obras, solicitudes y requerimientos ya tienen su propio historial)
do $$
declare
  t record;
begin
  for t in select * from (values
    ('ordenes_trabajo','codigo'), ('certificados','periodo'), ('contratos','contratista'), ('contrato_items','descripcion'),
    ('obras','titulo'), ('perfiles','nombre'), ('empleados','nombre'), ('empleados_reservado','empleado_id'), ('ubicaciones','nombre'),
    ('direcciones','direccion'), ('activos','nombre'), ('emergencias','codigo'), ('proveedores','nombre'), ('presupuestos','nombre'),
    ('materiales','nombre'), ('plantillas_ot','nombre'), ('tablets','nombre'), ('rutinas_catalogo','objeto'), ('informes','titulo')
  ) as x(tabla, etiqueta) loop
    if to_regclass('public.' || t.tabla) is not null then
      execute format('drop trigger if exists zz_auditar on public.%I', t.tabla);
      execute format('create trigger zz_auditar after insert or update or delete on public.%I for each row execute function public.auditar(%L)', t.tabla, t.etiqueta);
    end if;
  end loop;
end $$;

-- =====================================================================================
-- 2. INFORMES (seguimiento de entregas)
-- =====================================================================================
create sequence public.informe_numero_seq;

create table public.informes (
  id                uuid primary key default gen_random_uuid(),
  sector_id         uuid not null references public.sectores(id),
  numero            bigint not null unique default nextval('public.informe_numero_seq'),
  codigo            text not null default '',
  titulo            text not null check (btrim(titulo) <> ''),
  tipo              text not null default 'otro' check (tipo in ('avance_obra','inspeccion','mantenimiento','financiero','seguridad','final','otro')),
  estado            text not null default 'pendiente' check (estado in ('pendiente','en_preparacion','enviado','aprobado','rechazado')),
  prioridad         text not null default 'media' check (prioridad in ('baja','media','alta','urgente')),
  obra_id           uuid,
  ubicacion_id      uuid,
  destinatario      text,
  responsable_id    uuid references public.perfiles(id) on delete set null,
  responsable_texto text,
  fecha_limite      date,
  fecha_envio       date,
  fecha_aprobacion  date,
  descripcion       text,
  observaciones     text,
  requiere_firma    boolean not null default false,
  firma_obtenida    boolean not null default false,
  documentos        jsonb not null default '[]'::jsonb check (jsonb_typeof(documentos) = 'array'),
  id_origen         text unique,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (obra_id, sector_id)      references public.obras(id, sector_id) on delete set null (obra_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id)
);
create index informes_sector_idx on public.informes(sector_id, estado, fecha_limite);
select public.aplicar_rls_sector('public.informes');

-- Los carga gerencia o un jefe de sitio; los actualiza también su responsable; los borra gerencia.
-- Enviado y aprobado sellan su fecha (si no se cargó otra).
create or replace function public.preparar_informe() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() then
    if tg_op = 'INSERT' and coalesce(new.codigo, '') = '' then new.codigo := 'INF-' || lpad(new.numero::text, 6, '0'); end if;
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if not public.es_gerencia() then
      raise exception 'Un informe lo borra gerencia.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if not (public.puede_validar() or (tg_op = 'UPDATE' and old.responsable_id = auth.uid())) then
    raise exception 'Los informes los cargan gerencia y los jefes de sitio; los actualiza también su responsable.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    new.numero := nextval('public.informe_numero_seq');
    new.codigo := 'INF-' || lpad(new.numero::text, 6, '0');
  else
    new.numero := old.numero; new.codigo := old.codigo; new.created_by := old.created_by; new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  -- El responsable sin rol de validación prepara y envía: no aprueba, no firma por otros, no cambia la fecha límite
  -- ni se saca el informe de encima.
  if tg_op = 'UPDATE' and not public.puede_validar() then
    if new.estado in ('aprobado','rechazado') and new.estado is distinct from old.estado then
      raise exception 'Aprobar o rechazar un informe lo hacen gerencia o un jefe de sitio.' using errcode = 'P0001';
    end if;
    if (new.fecha_limite, new.responsable_id, new.responsable_texto, new.firma_obtenida, new.requiere_firma, new.fecha_aprobacion, new.prioridad)
       is distinct from (old.fecha_limite, old.responsable_id, old.responsable_texto, old.firma_obtenida, old.requiere_firma, old.fecha_aprobacion, old.prioridad) then
      raise exception 'La fecha límite, el responsable, la prioridad y la firma los cambian gerencia o un jefe de sitio.' using errcode = 'P0001';
    end if;
  end if;
  if new.responsable_id is not null then
    select p.nombre into new.responsable_texto from public.perfiles p where p.id = new.responsable_id;
  end if;
  if new.estado in ('enviado','aprobado','rechazado') and new.fecha_envio is null then new.fecha_envio := current_date; end if;
  if new.estado = 'aprobado' and new.fecha_aprobacion is null then new.fecha_aprobacion := current_date; end if;
  if new.estado in ('pendiente','en_preparacion') then new.fecha_aprobacion := null; end if;
  return new;
end $$;
create trigger b_preparar before insert or update or delete on public.informes
  for each row execute function public.preparar_informe();

create view public.v_informes with (security_invoker = true) as
select i.*, o.titulo as obra_titulo, u.nombre as ubicacion_nombre,
       (i.fecha_limite is not null and i.fecha_limite < current_date and i.estado in ('pendiente','en_preparacion','rechazado')) as vencido,
       case when i.fecha_limite is null or i.estado in ('enviado','aprobado') then null else i.fecha_limite - current_date end as dias_restantes,
       (i.requiere_firma and not i.firma_obtenida and i.estado in ('enviado','aprobado')) as falta_firma
  from public.informes i
  left join public.obras o       on o.id = i.obra_id
  left join public.ubicaciones u on u.id = i.ubicacion_id;

-- Auditoría del informe (la tabla se crea después del bloque de triggers de arriba)
create trigger zz_auditar after insert or update or delete on public.informes
  for each row execute function public.auditar('titulo');

-- El calendario suma las entregas de informes y las devoluciones de herramientas.
create or replace view public.v_calendario with (security_invoker = true) as
select 'ot'::text as tipo, o.id, o.sector_id, o.fecha_programada as fecha, o.titulo, o.estado::text as estado,
       o.prioridad::text as prioridad, pa.nombre as responsable, u.nombre as ubicacion, o.descripcion,
       (o.estado not in ('completada','cancelada') and o.fecha_programada < current_date) as vencido
  from public.ordenes_trabajo o
  left join public.perfiles pa   on pa.id = o.asignado_a
  left join public.ubicaciones u on u.id = o.ubicacion_id
 where o.fecha_programada is not null
union all
select 'mantenimiento', a.id, a.sector_id, a.proximo_mantenimiento, 'Mantenimiento: ' || a.nombre, 'pendiente',
       case a.criticidad when 'critica' then 'urgente' else a.criticidad::text end,
       pr.nombre, u.nombre, null,
       (a.proximo_mantenimiento < current_date)
  from public.activos a
  left join public.perfiles pr   on pr.id = a.responsable_id
  left join public.ubicaciones u on u.id = a.ubicacion_id
 where a.proximo_mantenimiento is not null and a.estado <> 'baja'
union all
select 'rutina', r.id, r.sector_id, r.fecha_limite, r.rubro_nombre || ': ' || r.objeto, r.estado::text,
       case when r.estado = 'vencida' then 'urgente' else 'media' end,
       r.jefe_sitio_nombre, r.ubicacion_nombre, r.acciones,
       (r.estado = 'vencida' or r.fecha_limite < current_date)
  from public.v_ordenes_rutina r
 where r.estado in ('pendiente','en_proceso','vencida') and r.ot_id is null
union all
select 'informe', i.id, i.sector_id, i.fecha_limite, 'Informe: ' || i.titulo, i.estado, i.prioridad,
       i.responsable_texto, coalesce(o.titulo, u.nombre), i.descripcion,
       (i.fecha_limite < current_date and i.estado in ('pendiente','en_preparacion','rechazado'))
  from public.informes i
  left join public.obras o       on o.id = i.obra_id
  left join public.ubicaciones u on u.id = i.ubicacion_id
 where i.fecha_limite is not null and i.estado in ('pendiente','en_preparacion','rechazado')
union all
select 'prestamo', p.id, p.sector_id, p.devolver_el, 'Devolución: ' || m.nombre, p.estado, 'media',
       e.nombre, null, p.notas, (p.devolver_el < current_date)
  from public.prestamos p
  join public.materiales m on m.id = p.material_id
  join public.empleados e  on e.id = p.empleado_id
 where p.estado = 'prestado' and p.devolver_el is not null;

-- =====================================================================================
-- 3. ALERTAS
-- =====================================================================================
-- Umbrales por sector (en sectores.config.alertas). Los de la v1 por defecto.
update public.sectores
   set config = config || jsonb_build_object('alertas', jsonb_build_object(
         'dias_garantia', 30, 'dias_pendiente', 7, 'dias_ot', 1, 'dias_mantenimiento', 0, 'umbral_stock_pct', 0))
 where not (config ? 'alertas');

create or replace function public.umbral(p_clave text, p_defecto integer) returns integer
language sql stable set search_path = public as $$
  select coalesce(round((s.config -> 'alertas' ->> p_clave)::numeric)::integer, p_defecto)
    from public.sectores s where s.id = public.sector_efectivo()
$$;

-- Todas las alertas vigentes. Cada una tiene una clave estable (tipo:id) para poder marcarla como vista.
-- nivel: critica · aviso · info
create view public.v_alertas with (security_invoker = true) as
-- órdenes vencidas
select 'ot_vencida:' || o.id as clave, 'ot_vencida'::text as tipo, o.sector_id,
       case when current_date - o.fecha_programada >= 7 then 'critica' else 'aviso' end as nivel,
       'Orden vencida: ' || o.codigo || ' ' || o.titulo as titulo,
       'Programada para el ' || to_char(o.fecha_programada, 'DD/MM/YYYY') || ' · ' || (current_date - o.fecha_programada) || ' días de atraso' as detalle,
       '/ot/' || o.id as enlace, o.fecha_programada::timestamptz as fecha, u.zona, u.jefe_sitio_id
  from public.ordenes_trabajo o
  left join public.ubicaciones u on u.id = o.ubicacion_id
 where o.estado in ('pendiente','asignada','en_progreso') and o.fecha_programada is not null
   and current_date - o.fecha_programada >= public.umbral('dias_ot', 1)
union all
-- pendientes SAP vencidos (todos los abiertos, no solo los sin asignar como en la v1)
select 'pendiente_vencido:' || p.id, 'pendiente_vencido', p.sector_id,
       case when current_date - p.fecha_limite >= 2 * public.umbral('dias_pendiente', 7) then 'critica' else 'aviso' end,
       'Pendiente vencido: ' || coalesce(p.numero_sap, '') || ' ' || left(p.descripcion, 80),
       coalesce(p.establecimiento, '') || ' · venció el ' || to_char(p.fecha_limite, 'DD/MM/YYYY'),
       '/gestion/pendientes', p.fecha_limite::timestamptz, p.zona, p.jefe_sitio_id
  from public.pendientes p
 where p.estado in ('pendiente','asignado','en_progreso') and p.fecha_limite is not null
   and current_date - p.fecha_limite >= public.umbral('dias_pendiente', 7)
union all
-- garantías por vencer
select 'garantia:' || a.id, 'garantia', a.sector_id,
       case when a.garantia_hasta - current_date <= 7 then 'critica' else 'aviso' end,
       'Garantía por vencer: ' || a.nombre,
       'Vence el ' || to_char(a.garantia_hasta, 'DD/MM/YYYY'),
       '/gestion/activos/' || a.id, a.garantia_hasta::timestamptz, u.zona, u.jefe_sitio_id
  from public.activos a
  left join public.ubicaciones u on u.id = a.ubicacion_id
 where a.estado <> 'baja' and a.garantia_hasta is not null
   and a.garantia_hasta >= current_date and a.garantia_hasta - current_date <= public.umbral('dias_garantia', 30)
union all
-- mantenimiento vencido
select 'mantenimiento:' || a.id, 'mantenimiento', a.sector_id,
       case when current_date - a.proximo_mantenimiento > 30 or a.criticidad = 'critica' then 'critica' else 'aviso' end,
       'Mantenimiento vencido: ' || a.nombre,
       'Tocaba el ' || to_char(a.proximo_mantenimiento, 'DD/MM/YYYY'),
       '/gestion/activos/' || a.id, a.proximo_mantenimiento::timestamptz, u.zona, u.jefe_sitio_id
  from public.activos a
  left join public.ubicaciones u on u.id = a.ubicacion_id
 where a.estado <> 'baja' and a.proximo_mantenimiento is not null
   and current_date - a.proximo_mantenimiento > public.umbral('dias_mantenimiento', 0)
union all
-- stock bajo
select 'stock:' || m.id, 'stock', m.sector_id,
       case when m.stock = 0 then 'critica' else 'aviso' end,
       case when m.stock = 0 then 'Sin stock: ' else 'Stock bajo: ' end || m.nombre,
       'Hay ' || trim_scale(m.stock) || ' ' || m.unidad || ' · mínimo ' || trim_scale(m.stock_minimo),
       '/gestion/panol', m.updated_at, null::text, null::uuid
  from public.materiales m
 where m.activo and m.stock_minimo > 0
   and m.stock <= m.stock_minimo * (1 + public.umbral('umbral_stock_pct', 0) / 100.0)
union all
-- herramientas sin devolver
select 'prestamo:' || p.id, 'prestamo', p.sector_id,
       case when current_date - p.devolver_el > 7 then 'critica' else 'aviso' end,
       'Herramienta sin devolver: ' || m.nombre,
       e.nombre || ' · tenía que devolverla el ' || to_char(p.devolver_el, 'DD/MM/YYYY'),
       '/gestion/prestamos', p.devolver_el::timestamptz, null, null
  from public.prestamos p
  join public.materiales m on m.id = p.material_id
  join public.empleados e  on e.id = p.empleado_id
 where p.estado = 'prestado' and p.devolver_el < current_date
union all
-- obras con el plazo en riesgo
select 'obra:' || o.id, 'obra_plazo', o.sector_id,
       case when o.alerta_plazo = 'peligro' then 'critica' else 'aviso' end,
       'Obra con el plazo en riesgo: ' || o.titulo,
       'Avance ' || trim_scale(o.avance) || ' % (esperado ' || o.avance_esperado || ' %) · ' ||
         case when o.dias_restantes < 0 then 'venció hace ' || -o.dias_restantes || ' días' else 'faltan ' || o.dias_restantes || ' días' end,
       '/gestion/obras', o.fecha_fin::timestamptz, o.zona, o.jefe_sitio_id
  from public.v_obras o
 where o.alerta_plazo in ('peligro','alerta')
union all
-- emergencias abiertas
select 'emergencia:' || e.id, 'emergencia', e.sector_id, 'critica',
       'Emergencia ' || e.estado::text || ': ' || e.titulo,
       u.nombre || ' · desde el ' || to_char(e.created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'),
       '/gestion/emergencias', e.created_at, u.zona, coalesce(e.jefe_sitio_id, u.jefe_sitio_id)
  from public.emergencias e
  join public.ubicaciones u on u.id = e.ubicacion_id
 where e.estado in ('activa','en_atencion')
union all
-- lugares con emergencias repetidas
select 'patron:' || x.ubicacion_id || ':' || to_char(x.ultima, 'YYYYMMDD'), 'patron_emergencias', x.sector_id, 'aviso',
       x.cantidad || ' emergencias en 30 días: ' || x.ubicacion_nombre,
       'La más frecuente: ' || replace(x.tipo_mas_frecuente::text, '_', ' ') || '. Conviene una inspección preventiva.',
       '/gestion/emergencias', x.ultima, u.zona, u.jefe_sitio_id
  from public.v_patrones_emergencia x
  join public.ubicaciones u on u.id = x.ubicacion_id
union all
-- informes vencidos
select 'informe:' || i.id, 'informe', i.sector_id,
       case when current_date - i.fecha_limite > 7 or i.prioridad = 'urgente' then 'critica' else 'aviso' end,
       'Informe vencido: ' || i.titulo,
       coalesce(i.responsable_texto, 'Sin responsable') || ' · vencía el ' || to_char(i.fecha_limite, 'DD/MM/YYYY'),
       '/gestion/informes', i.fecha_limite::timestamptz, null, null
  from public.informes i
 where i.fecha_limite < current_date and i.estado in ('pendiente','en_preparacion','rechazado')
union all
-- requerimientos de compra atrasados
select 'requerimiento:' || r.id, 'requerimiento', r.sector_id, 'aviso',
       'Compra atrasada: ' || r.codigo || ' ' || r.titulo,
       'Se necesitaba el ' || to_char(r.fecha_necesidad, 'DD/MM/YYYY') || ' · está ' || replace(r.estado, '_', ' '),
       '/gestion/requerimientos', r.fecha_necesidad::timestamptz, null, null
  from public.requerimientos_compra r
 where r.fecha_necesidad < current_date and r.estado in ('enviado','en_revision','aprobado','en_compra');

-- "Ya la vi": por persona y hasta una fecha (vuelve a aparecer si sigue vigente después).
create table public.alertas_vistas (
  id         uuid primary key default gen_random_uuid(),
  sector_id  uuid not null references public.sectores(id),
  perfil_id  uuid not null references public.perfiles(id) on delete cascade default auth.uid(),
  clave      text not null,
  hasta      date not null default (current_date + 7),
  created_at timestamptz not null default now(),
  unique (perfil_id, clave)
);
select public.aplicar_rls_sector('public.alertas_vistas');
create or replace function public.preparar_alerta_vista() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() then return coalesce(new, old); end if;
  if tg_op <> 'INSERT' and old.perfil_id <> auth.uid() then
    raise exception 'Eso lo marcó otra persona.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.perfil_id := auth.uid();
  if new.hasta < current_date then new.hasta := current_date; end if;
  return new;
end $$;
create trigger b_preparar before insert or update or delete on public.alertas_vistas
  for each row execute function public.preparar_alerta_vista();

-- Las alertas de quien mira, sin las que marcó como vistas (mientras dure la marca).
create view public.v_mis_alertas with (security_invoker = true) as
select a.*
  from public.v_alertas a
 where not exists (select 1 from public.alertas_vistas v where v.perfil_id = auth.uid() and v.clave = a.clave and v.hasta >= current_date);

-- Lo que espera una acción de quien mira (no son alertas: son bandejas).
create or replace function public.bandeja() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'ots_por_validar', (select count(*) from public.ordenes_trabajo o where o.estado = 'pendiente_validacion'),
    'certificados_por_aprobar', (select count(*) from public.certificados c where c.estado = 'emitido' and c.emitido_por is distinct from auth.uid()),
    'solicitudes_por_revisar', (select count(*) from public.solicitudes_certificado s where s.estado in ('enviada','en_revision') and s.solicitante_id is distinct from auth.uid()),
    'requerimientos_por_revisar', (select count(*) from public.requerimientos_compra r where r.estado in ('enviado','en_revision') and r.solicitante_id is distinct from auth.uid()),
    'requerimientos_en_compra', (select count(*) from public.requerimientos_compra r where r.estado = 'en_compra'),
    'informes_por_vencer', (select count(*) from public.informes i where i.estado in ('pendiente','en_preparacion') and i.fecha_limite between current_date and current_date + 5),
    'alertas_criticas', (select count(*) from public.v_mis_alertas a where a.nivel = 'critica'),
    'alertas', (select count(*) from public.v_mis_alertas a)
  )
$$;

-- =====================================================================================
-- 4. REPORTES
-- =====================================================================================
-- Un solo cálculo para cada indicador. Filtros: período (días de Buenos Aires), zona y jefe de sitio (el del lugar).
-- Eficiencia = completadas ÷ (todas − canceladas), en todas partes.
create or replace function public.reporte_operacion(p_desde date, p_hasta date, p_zona text default null, p_jefe uuid default null)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_res jsonb;
begin
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Elegí un período válido.' using errcode = 'P0001';
  end if;
  if p_hasta - p_desde > 731 then
    raise exception 'El período puede ser de hasta dos años.' using errcode = 'P0001';
  end if;

  with ots as (
    select o.*, u.zona, u.jefe_sitio_id as jefe_id, u.jefe_sitio_nombre as jefe_nombre, pa.nombre as operario,
           public.dia_ar(o.created_at) as dia, public.dia_ar(coalesce(o.fecha_validacion, o.fecha_fin_real)) as dia_fin
      from public.ordenes_trabajo o
      left join public.ubicaciones u on u.id = o.ubicacion_id
      left join public.perfiles pa   on pa.id = o.asignado_a
     where public.dia_ar(o.created_at) between p_desde and p_hasta
       and (p_zona is null or u.zona = p_zona) and (p_jefe is null or u.jefe_sitio_id = p_jefe)
  ),
  pend as (
    select p.*, public.dia_ar(p.created_at) as dia
      from public.pendientes p
     where public.dia_ar(p.created_at) between p_desde and p_hasta
       and (p_zona is null or p.zona = p_zona) and (p_jefe is null or p.jefe_sitio_id = p_jefe)
  ),
  horas as (
    select h.* from public.ot_horas h
      join public.ordenes_trabajo o on o.id = h.ot_id
      left join public.ubicaciones u on u.id = o.ubicacion_id
     where h.fecha between p_desde and p_hasta
       and (p_zona is null or u.zona = p_zona) and (p_jefe is null or u.jefe_sitio_id = p_jefe)
  ),
  emerg as (
    select e.*, u.zona from public.emergencias e
      join public.ubicaciones u on u.id = e.ubicacion_id
     where public.dia_ar(e.created_at) between p_desde and p_hasta
       and (p_zona is null or u.zona = p_zona) and (p_jefe is null or coalesce(e.jefe_sitio_id, u.jefe_sitio_id) = p_jefe)
  ),
  meses as (
    select to_char(m, 'YYYY-MM') as mes from generate_series(date_trunc('month', p_desde), date_trunc('month', p_hasta), interval '1 month') m
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'zona', p_zona, 'jefe', p_jefe),
    'ots', jsonb_build_object(
      'total', (select count(*) from ots),
      'completadas', (select count(*) from ots where estado = 'completada'),
      'canceladas', (select count(*) from ots where estado = 'cancelada'),
      'abiertas', (select count(*) from ots where estado not in ('completada','cancelada')),
      'vencidas', (select count(*) from ots where estado in ('pendiente','asignada','en_progreso') and fecha_programada < current_date),
      'eficiencia', (select case when count(*) filter (where estado <> 'cancelada') = 0 then null
                                 else round(100.0 * count(*) filter (where estado = 'completada') / count(*) filter (where estado <> 'cancelada'), 1) end from ots),
      'dias_promedio_cierre', (select round(avg(dia_fin - dia), 1) from ots where estado = 'completada' and dia_fin is not null),
      'por_mes', (select coalesce(jsonb_agg(jsonb_build_object('mes', m.mes,
                    'total', (select count(*) from ots where to_char(dia, 'YYYY-MM') = m.mes),
                    'completadas', (select count(*) from ots where to_char(dia, 'YYYY-MM') = m.mes and estado = 'completada'),
                    'abiertas', (select count(*) from ots where to_char(dia, 'YYYY-MM') = m.mes and estado not in ('completada','cancelada'))) order by m.mes), '[]') from meses m),
      'por_tipo', (select coalesce(jsonb_agg(jsonb_build_object('clave', tipo, 'cantidad', n) order by n desc), '[]')
                     from (select tipo::text, count(*) as n from ots group by tipo) x),
      'por_prioridad', (select coalesce(jsonb_agg(jsonb_build_object('clave', prioridad, 'cantidad', n, 'completadas', c) order by n desc), '[]')
                     from (select prioridad::text, count(*) as n, count(*) filter (where estado = 'completada') as c from ots group by prioridad) x),
      'por_operario', (select coalesce(jsonb_agg(jsonb_build_object('nombre', operario, 'total', n, 'completadas', c,
                          'eficiencia', case when n - k = 0 then null else round(100.0 * c / (n - k), 1) end) order by c desc, n desc), '[]')
                     from (select coalesce(operario, 'Sin asignar') as operario, count(*) as n, count(*) filter (where estado = 'completada') as c,
                                  count(*) filter (where estado = 'cancelada') as k
                             from ots group by coalesce(operario, 'Sin asignar')) x),
      'por_zona', (select coalesce(jsonb_agg(jsonb_build_object('zona', z, 'total', n, 'completadas', c, 'vencidas', v) order by z), '[]')
                     from (select coalesce(zona, 'Sin zona') as z, count(*) as n, count(*) filter (where estado = 'completada') as c,
                                  count(*) filter (where estado in ('pendiente','asignada','en_progreso') and fecha_programada < current_date) as v
                             from ots group by coalesce(zona, 'Sin zona')) x)
    ),
    'pendientes', jsonb_build_object(
      'total', (select count(*) from pend),
      'activos', (select count(*) from pend where estado in ('pendiente','asignado','en_progreso')),
      'resueltos', (select count(*) from pend where estado = 'resuelto'),
      'vencidos', (select count(*) from pend where estado in ('pendiente','asignado','en_progreso') and fecha_limite < current_date),
      'sin_asignar', (select count(*) from pend where estado = 'pendiente' and jefe_sitio_id is null and jefe_sitio_nombre is null),
      'tasa_resolucion', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where estado = 'resuelto') / count(*), 1) end from pend),
      'mttr_dias', (select round(avg(fecha_resolucion - fecha_asignacion), 1) from pend
                     where estado = 'resuelto' and fecha_resolucion is not null and fecha_asignacion is not null and fecha_resolucion >= fecha_asignacion),
      'backlog', (select case when count(*) filter (where estado = 'resuelto') = 0 then null
                              else round(count(*) filter (where estado in ('pendiente','asignado','en_progreso'))::numeric / count(*) filter (where estado = 'resuelto'), 2) end from pend),
      'antiguedad', (select jsonb_build_object(
                       'hasta_7', count(*) filter (where current_date - dia <= 7),
                       'de_8_a_30', count(*) filter (where current_date - dia between 8 and 30),
                       'de_31_a_60', count(*) filter (where current_date - dia between 31 and 60),
                       'mas_de_60', count(*) filter (where current_date - dia > 60))
                     from pend where estado in ('pendiente','asignado','en_progreso')),
      'por_estado', (select coalesce(jsonb_agg(jsonb_build_object('clave', estado, 'cantidad', n) order by n desc), '[]')
                     from (select estado::text, count(*) as n from pend group by estado) x),
      'por_zona', (select coalesce(jsonb_agg(jsonb_build_object('zona', z, 'total', n, 'resueltos', r, 'activos', a, 'vencidos', v) order by z), '[]')
                     from (select coalesce(zona, 'Sin zona') as z, count(*) as n, count(*) filter (where estado = 'resuelto') as r,
                                  count(*) filter (where estado in ('pendiente','asignado','en_progreso')) as a,
                                  count(*) filter (where estado in ('pendiente','asignado','en_progreso') and fecha_limite < current_date) as v
                             from pend group by coalesce(zona, 'Sin zona')) x),
      'por_prioridad', (select coalesce(jsonb_agg(jsonb_build_object('clave', prioridad, 'total', n, 'resueltos', r) order by n desc), '[]')
                     from (select prioridad::text, count(*) as n, count(*) filter (where estado = 'resuelto') as r from pend group by prioridad) x)
    ),
    -- Ranking de jefes de sitio (la fórmula de la v1, con los datos por id): 50 % resolución de pendientes, 30 %
    -- eficiencia de órdenes, 20 puntos menos 4 por cada pendiente vencido.
    'jefes', (select coalesce(jsonb_agg(j order by (j ->> 'puntaje')::numeric desc, j ->> 'nombre'), '[]') from (
                select jsonb_build_object('id', x.id, 'nombre', x.nombre, 'pendientes', x.pt, 'resueltos', x.pr, 'vencidos', x.pv,
                         'ots', x.ot, 'ots_completadas', x.oc, 'mttr_dias', x.mttr,
                         'puntaje', round(coalesce(100.0 * x.pr / nullif(x.pt, 0), 100) * 0.5 + coalesce(100.0 * x.oc / nullif(x.ot - x.ok, 0), 100) * 0.3
                                          + greatest(0, 20 - 4 * x.pv))) as j
                  from (select pf.id, pf.nombre,
                               (select count(*) from pend p where p.jefe_sitio_id = pf.id) as pt,
                               (select count(*) from pend p where p.jefe_sitio_id = pf.id and p.estado = 'resuelto') as pr,
                               (select count(*) from pend p where p.jefe_sitio_id = pf.id and p.estado in ('pendiente','asignado','en_progreso') and p.fecha_limite < current_date) as pv,
                               (select round(avg(p.fecha_resolucion - p.fecha_asignacion), 1) from pend p where p.jefe_sitio_id = pf.id and p.estado = 'resuelto'
                                  and p.fecha_resolucion >= p.fecha_asignacion) as mttr,
                               (select count(*) from ots o where o.jefe_id = pf.id) as ot,
                               (select count(*) from ots o where o.jefe_id = pf.id and o.estado = 'completada') as oc,
                               (select count(*) from ots o where o.jefe_id = pf.id and o.estado = 'cancelada') as ok
                          from public.perfiles pf
                         where pf.activo and pf.sector_id = public.sector_efectivo() and pf.rol = 'jefe_sitio'
                           and (p_jefe is null or pf.id = p_jefe)) x
                 where x.pt + x.ot > 0) y),
    'horas', jsonb_build_object(
      'total', (select coalesce(sum(horas), 0) from horas),
      'extra', (select coalesce(sum(horas), 0) from horas where tipo <> 'normal'),
      'por_persona', (select coalesce(jsonb_agg(jsonb_build_object('nombre', n, 'horas', h, 'ordenes', o) order by h desc), '[]')
                      from (select empleado_nombre as n, sum(horas) as h, count(distinct ot_id) as o from horas group by empleado_nombre) x)
    ),
    'materiales', jsonb_build_object(
      'salidas_valor', (select coalesce(round(sum(x.cantidad * x.costo_unitario), 2), 0) from public.movimientos_panol x
                         where x.tipo = 'salida' and x.motivo in ('consumo','asignacion_obra','perdida') and public.dia_ar(x.created_at) between p_desde and p_hasta),
      'compras_valor', (select coalesce(round(sum(x.cantidad * x.costo_unitario), 2), 0) from public.movimientos_panol x
                         where x.tipo = 'entrada' and x.motivo = 'compra' and public.dia_ar(x.created_at) between p_desde and p_hasta),
      'por_obra', (select coalesce(jsonb_agg(jsonb_build_object('obra', t, 'valor', v) order by v desc), '[]') from (
                     select ob.titulo as t, round(sum(case when x.tipo = 'salida' then x.cantidad * x.costo_unitario else -x.cantidad * x.costo_unitario end), 2) as v
                       from public.movimientos_panol x join public.obras ob on ob.id = x.obra_id
                      where x.motivo in ('consumo','asignacion_obra','devolucion') and public.dia_ar(x.created_at) between p_desde and p_hasta
                        and (p_zona is null or ob.zona = p_zona)
                      group by ob.titulo order by 2 desc limit 15) x),
      'mas_usados', (select coalesce(jsonb_agg(jsonb_build_object('material', n, 'cantidad', c, 'unidad', u, 'valor', v) order by v desc), '[]') from (
                     select m.nombre as n, m.unidad as u, sum(x.cantidad) as c, round(sum(x.cantidad * x.costo_unitario), 2) as v
                       from public.movimientos_panol x join public.materiales m on m.id = x.material_id
                      where x.tipo = 'salida' and x.motivo in ('consumo','asignacion_obra') and public.dia_ar(x.created_at) between p_desde and p_hasta
                      group by m.nombre, m.unidad order by 4 desc limit 10) x),
      'bajo_minimo', (select count(*) from public.materiales m where m.activo and m.stock_minimo > 0 and m.stock <= m.stock_minimo)
    ),
    'emergencias', jsonb_build_object(
      'total', (select count(*) from emerg),
      'abiertas', (select count(*) from emerg where estado in ('activa','en_atencion')),
      'minutos_atencion', (select round(avg(minutos_atencion)) from emerg where minutos_atencion is not null),
      'minutos_resolucion', (select round(avg(minutos_resolucion)) from emerg where minutos_resolucion is not null),
      'por_tipo', (select coalesce(jsonb_agg(jsonb_build_object('clave', tipo, 'cantidad', n) order by n desc), '[]')
                    from (select tipo::text, count(*) as n from emerg group by tipo) x)
    )
  ) into v_res;
  return v_res;
end $$;

-- ------------------------------------------------------------------ permisos
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.importar_certificado_historico(jsonb) from authenticated;
revoke execute on function public.tomar_informes_pendientes(integer) from authenticated;
revoke execute on function public.programar_reintento_informes(text) from authenticated;
-- La auditoría no se escribe ni se borra desde la API (solo el trigger, y la lee gerencia).
revoke update, delete on public.auditoria from authenticated;
