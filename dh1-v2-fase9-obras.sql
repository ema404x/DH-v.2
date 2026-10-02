-- =====================================================================================
-- DH1 v2 — Fase 9 (tanda 3): obras
--
--   1. Proveedores (en la v1 la pantalla se llamaba "Clientes" pero era el directorio de proveedores)
--   2. Obras: la planilla de obras de SAP, con columnas de verdad (la v1 guardaba comuna, jefe, inspector y
--      detalle adentro de un texto de notas), sus documentos y sus órdenes de trabajo
--   3. Cobro de obras por ciclo mensual (la "Certificación de obras" de la v1): estado de cobro, tramo, avance
--      y monto a cobrar de cada obra, con historial automático y cierre de ciclo atómico
--   4. Presupuestos de obra: repositorio de planillas (lo único vivo de la v1 en ese módulo)
--   5. Solicitudes de certificado del jefe de sitio, con máquina de estados en la base
--   6. Abonos mensuales: certificar el mes de todos los contratos de abono de una vez
--   7. Bucket privado "documentos" (planillas, documentos de obra, adjuntos)
--
-- Se corre después de la fase 8. Es aditiva: no borra ni cambia datos existentes.
-- =====================================================================================

-- ---------------------------------------------------------------------------- corrección de seguridad (fase 4)
-- cert_fn_on/cert_fn_restore prendían la bandera de certificación aunque se los llamara sueltos. Por PostgREST no
-- servía de nada (cada pedido es su transacción), pero GraphQL puede encadenar operaciones en una sola. Ahora se
-- niegan a correr si no los llama otra función de la base.
create or replace function public.cert_fn_on() returns text
language plpgsql as $$
declare
  v_prev text := coalesce(current_setting('dh1.cert_fn', true), '');
  v_ctx text;
begin
  get diagnostics v_ctx = pg_context;
  if (select count(*) from regexp_matches(v_ctx, 'PL/pgSQL function', 'g')) < 2 then
    raise exception 'Uso interno.' using errcode = '42501';
  end if;
  perform set_config('dh1.cert_fn', '1', true);
  return v_prev;
end $$;

drop function if exists public.cert_fn_restore(text);
create function public.cert_fn_restore(p_prev text) returns void
language plpgsql as $$
declare
  v_ctx text;
begin
  get diagnostics v_ctx = pg_context;
  if (select count(*) from regexp_matches(v_ctx, 'PL/pgSQL function', 'g')) < 2 then
    raise exception 'Uso interno.' using errcode = '42501';
  end if;
  perform set_config('dh1.cert_fn', coalesce(p_prev, ''), true);
end $$;

-- ---------------------------------------------------------------------------- utilidades
-- "Octubre 2026"
create or replace function public.mes_texto(p date) returns text
language sql immutable as $$
  select (array['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'])[extract(month from p)::int]
         || ' ' || extract(year from p)::int
$$;

-- Acota un número a un rango sin convertir el vacío en cero (greatest(0, null) da 0 en Postgres).
create or replace function public.acotar(p numeric, p_min numeric, p_max numeric) returns numeric
language sql immutable as $$
  select case when p is null then null
              else least(coalesce(p_max, p), greatest(coalesce(p_min, p), p)) end
$$;

-- =====================================================================================
-- 1. PROVEEDORES
-- =====================================================================================
create table public.proveedores (
  id               uuid primary key default gen_random_uuid(),
  sector_id        uuid not null references public.sectores(id),
  nombre           text not null check (btrim(nombre) <> ''),
  rubro            text not null default 'otro' check (rubro in ('construccion','electricidad','plomeria','pintura','carpinteria','herreria',
                     'climatizacion','albanileria','impermeabilizacion','materiales','equipos','limpieza','seguridad','transporte','tecnologia','otro')),
  zona             text,
  cuit             text,
  contacto         text,
  email            text,
  telefono         text,
  direccion        text,
  localidad        text,
  estado           text not null default 'activo' check (estado in ('activo','inactivo','suspendido')),
  valoracion       smallint check (valoracion between 1 and 5),
  notas_valoracion text,
  notas            text,
  id_origen        text unique,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, sector_id)
);
create index proveedores_sector_idx on public.proveedores(sector_id, nombre);
select public.aplicar_rls_sector('public.proveedores');
create trigger b_rol before insert or update or delete on public.proveedores
  for each row execute function public.exigir_rol('gerencia');
create trigger c_updated before update on public.proveedores
  for each row execute function public.tocar_updated_at();

-- =====================================================================================
-- 2. OBRAS
-- =====================================================================================
create type public.obra_estado as enum ('pendiente','en_progreso','pausado','completado','cancelado');

create table public.obras (
  id              uuid primary key default gen_random_uuid(),
  sector_id       uuid not null references public.sectores(id),
  -- "Título de obra en SAP"
  titulo          text not null check (btrim(titulo) <> ''),
  -- Nº de orden SAP (MTOM) y Nº de orden de entrada (MEIN)
  codigo_sap      text,
  mein            text,
  ubicacion_id    uuid,
  establecimiento text,
  direccion       text,
  zona            text,
  tipo            text not null default 'obra_nueva' check (tipo in ('obra_nueva','remodelacion','mantenimiento_preventivo','mantenimiento_correctivo','emergencia','inspeccion')),
  estado          public.obra_estado not null default 'pendiente',
  prioridad       public.prioridad not null default 'media',
  -- lo que dice la planilla de SAP, tal cual
  estado_sap      text,
  detalle         text,
  monto_base      numeric(16,2) not null default 0 check (monto_base >= 0),
  costo_real      numeric(16,2) not null default 0 check (costo_real >= 0),
  avance          numeric(5,2) not null default 0 check (avance between 0 and 100),
  plazo_dias      integer check (plazo_dias is null or plazo_dias >= 0),
  -- Acta de inicio (AI) y Acta de recepción (AR)
  fecha_inicio    date,
  fecha_fin       date,
  jefe_sitio_id   uuid references public.perfiles(id) on delete set null,
  jefe_sitio_nombre text,
  inspector_id    uuid references public.perfiles(id) on delete set null,
  inspector_nombre  text,
  supervisor      text,
  proveedor_id    uuid,
  descripcion     text,
  notas           text,
  -- [{ nombre, path, tipo, tamano, subido_at }] en el bucket "documentos"
  documentos      jsonb not null default '[]'::jsonb check (jsonb_typeof(documentos) = 'array'),
  id_origen       text unique,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id),
  foreign key (proveedor_id, sector_id) references public.proveedores(id, sector_id),
  check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio)
);
create index obras_sector_idx on public.obras(sector_id, estado);
-- Un código SAP no se repite en el sector (la v1 los repetía y después no sabía cuál actualizar).
create unique index obras_codigo_idx on public.obras(sector_id, codigo_sap) where codigo_sap is not null;
select public.aplicar_rls_sector('public.obras');
create trigger b_rol before insert or update or delete on public.obras
  for each row execute function public.exigir_rol('validar');

create or replace function public.preparar_obra() returns trigger
language plpgsql set search_path = public as $$
begin
  new.titulo := btrim(regexp_replace(new.titulo, '\s+', ' ', 'g'));
  new.codigo_sap := nullif(btrim(coalesce(new.codigo_sap, '')), '');
  new.mein := nullif(btrim(coalesce(new.mein, '')), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  -- Del lugar se toman el establecimiento, la dirección, la zona y los responsables que falten.
  if new.ubicacion_id is not null and (tg_op = 'INSERT' or new.ubicacion_id is distinct from old.ubicacion_id) then
    select coalesce(new.establecimiento, u.nombre), coalesce(new.direccion, u.direccion), coalesce(new.zona, u.zona),
           coalesce(new.jefe_sitio_id, u.jefe_sitio_id), coalesce(new.inspector_id, u.inspector_id)
      into new.establecimiento, new.direccion, new.zona, new.jefe_sitio_id, new.inspector_id
      from public.ubicaciones u where u.id = new.ubicacion_id;
  end if;
  return new;
end $$;
create trigger c1_preparar before insert or update on public.obras
  for each row execute function public.preparar_obra();

-- Órdenes de trabajo de una obra (en la v1, project_id).
alter table public.ordenes_trabajo add column if not exists obra_id uuid;
alter table public.ordenes_trabajo add constraint ordenes_trabajo_obra_fk
  foreign key (obra_id, sector_id) references public.obras(id, sector_id);
create index if not exists ot_obra_idx on public.ordenes_trabajo(obra_id);

-- La obra de una orden la cambian gerencia y los jefes de sitio (el operario trabaja la orden, no la reasigna).
create or replace function public.proteger_obra_de_ot() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.obra_id is distinct from old.obra_id and not (public.es_servicio() or public.puede_validar() or pg_trigger_depth() > 1) then
    raise exception 'La obra de una orden la cambian gerencia y los jefes de sitio.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger b2_obra before update of obra_id on public.ordenes_trabajo
  for each row execute function public.proteger_obra_de_ot();

-- Una obra con historia de cobro no se borra (se perdería el seguimiento): se cancela.
create or replace function public.proteger_baja_obra() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.es_servicio() and exists (select 1 from public.obra_cobros c where c.obra_id = old.id) then
    raise exception 'La obra ya tiene seguimiento de cobro: no se borra, pasala a cancelada.' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger b3_baja before delete on public.obras
  for each row execute function public.proteger_baja_obra();

-- Alerta de plazo (la regla de la v1, que estaba escrita pero no se mostraba en ninguna pantalla):
-- avance esperado = días transcurridos / días totales; déficit = esperado − avance real.
--   peligro: vencida, o faltan ≤ 15 días con 30 puntos de atraso · alerta: ≤ 30 días y 20 puntos · aviso: ≤ 60 días y 15 puntos
create view public.v_obras with (security_invoker = true) as
select o.*,
       u.nombre as ubicacion_nombre,
       pr.nombre as proveedor_nombre,
       ot.abiertas as ots_abiertas, ot.total as ots_total,
       x.esperado as avance_esperado,
       case when o.estado in ('completado','cancelado') or o.fecha_fin is null then null
            when x.dias_restantes < 0 or (x.dias_restantes <= 15 and x.esperado - o.avance >= 30) then 'peligro'
            when x.dias_restantes <= 30 and x.esperado - o.avance >= 20 then 'alerta'
            when x.dias_restantes <= 60 and x.esperado - o.avance >= 15 then 'aviso'
       end as alerta_plazo,
       case when o.fecha_fin is null then null else x.dias_restantes end as dias_restantes
  from public.obras o
  left join public.ubicaciones u  on u.id = o.ubicacion_id
  left join public.proveedores pr on pr.id = o.proveedor_id
  cross join lateral (
    select (o.fecha_fin - current_date) as dias_restantes,
           case when o.fecha_inicio is null or o.fecha_fin is null or o.fecha_fin <= o.fecha_inicio then 100
                else least(100, greatest(0, round((current_date - o.fecha_inicio) * 100.0 / (o.fecha_fin - o.fecha_inicio))))
           end as esperado
  ) x
  left join lateral (
    select count(*) filter (where t.estado not in ('completada','cancelada'))::integer as abiertas, count(*)::integer as total
      from public.ordenes_trabajo t where t.obra_id = o.id
  ) ot on true;

-- Importa la planilla de obras de SAP. Clave: el código SAP; sin código, el título. Reimportar actualiza, no duplica.
-- Lo que no viene en la planilla no se toca (a diferencia de la v1, cambiar el título en SAP no crea otra obra).
-- p_filas: [{ codigo_sap, titulo, establecimiento, direccion, zona, monto_base, estado_sap, detalle, plazo_dias,
--             fecha_inicio, fecha_fin, avance, jefe, inspector, supervisor }]
create or replace function public.importar_planilla_obras(p_filas jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  f jsonb;
  v_id uuid;
  v_estado public.obra_estado;
  v_det text;
  v_sap text;
  v_nuevas int := 0;
  v_act int := 0;
  v_omit int := 0;
  v_ubi uuid;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden importar la planilla de obras.' using errcode = 'P0001';
  end if;
  for f in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) loop
    if coalesce(btrim(f ->> 'titulo'), '') = '' then
      v_omit := v_omit + 1;
      continue;
    end if;
    -- Estado a partir del detalle y del estado de SAP (misma regla que la v1).
    v_det := upper(coalesce(f ->> 'detalle', ''));
    v_sap := upper(coalesce(f ->> 'estado_sap', ''));
    v_estado := case
      when v_det like '%CERTIFICADO%' or v_sap like '%APR2%' then 'completado'
      when v_det like '%EN EJECUCI%' or v_det like '%EJECUCION%' or v_sap like '%AEJE%' then 'en_progreso'
      when v_det like '%CANCELADO%' or v_sap like '%CANC%' then 'cancelado'
      when v_sap like '%FINA%' then 'completado'
      else 'pendiente' end;
    v_ubi := public.ubicacion_por_texto(f ->> 'establecimiento', null);

    v_id := null;
    if nullif(btrim(f ->> 'codigo_sap'), '') is not null then
      select o.id into v_id from public.obras o where o.sector_id = public.sector_efectivo() and o.codigo_sap = btrim(f ->> 'codigo_sap');
    else
      select o.id into v_id from public.obras o
       where o.sector_id = public.sector_efectivo() and o.codigo_sap is null
         and public.norm_txt(o.titulo) = public.norm_txt(f ->> 'titulo') limit 1;
    end if;

    if v_id is null then
      insert into public.obras (titulo, codigo_sap, establecimiento, direccion, zona, monto_base, estado_sap, detalle, plazo_dias,
                                fecha_inicio, fecha_fin, avance, estado, jefe_sitio_nombre, inspector_nombre, supervisor, ubicacion_id)
      values (f ->> 'titulo', f ->> 'codigo_sap', nullif(f ->> 'establecimiento', ''), nullif(f ->> 'direccion', ''), nullif(f ->> 'zona', ''),
              coalesce(public.acotar((f ->> 'monto_base')::numeric, 0, null), 0), nullif(f ->> 'estado_sap', ''), nullif(f ->> 'detalle', ''),
              (f ->> 'plazo_dias')::integer, (f ->> 'fecha_inicio')::date, (f ->> 'fecha_fin')::date,
              coalesce(public.acotar((f ->> 'avance')::numeric, 0, 100), 0), v_estado,
              nullif(f ->> 'jefe', ''), nullif(f ->> 'inspector', ''), nullif(f ->> 'supervisor', ''), v_ubi);
      v_nuevas := v_nuevas + 1;
    else
      update public.obras o set
        titulo = f ->> 'titulo',
        establecimiento = coalesce(nullif(f ->> 'establecimiento', ''), o.establecimiento),
        direccion = coalesce(nullif(f ->> 'direccion', ''), o.direccion),
        zona = coalesce(nullif(f ->> 'zona', ''), o.zona),
        monto_base = coalesce(public.acotar((f ->> 'monto_base')::numeric, 0, null), o.monto_base),
        estado_sap = coalesce(nullif(f ->> 'estado_sap', ''), o.estado_sap),
        detalle = coalesce(nullif(f ->> 'detalle', ''), o.detalle),
        plazo_dias = coalesce((f ->> 'plazo_dias')::integer, o.plazo_dias),
        fecha_inicio = coalesce((f ->> 'fecha_inicio')::date, o.fecha_inicio),
        fecha_fin = coalesce((f ->> 'fecha_fin')::date, o.fecha_fin),
        avance = coalesce(public.acotar((f ->> 'avance')::numeric, 0, 100), o.avance),
        -- Sin detalle ni estado de SAP en la fila, el estado de la obra no se toca.
        estado = case when coalesce(btrim(f ->> 'detalle'), '') = '' and coalesce(btrim(f ->> 'estado_sap'), '') = '' then o.estado else v_estado end,
        jefe_sitio_nombre = case when o.jefe_sitio_id is null then coalesce(nullif(f ->> 'jefe', ''), o.jefe_sitio_nombre) else o.jefe_sitio_nombre end,
        inspector_nombre = case when o.inspector_id is null then coalesce(nullif(f ->> 'inspector', ''), o.inspector_nombre) else o.inspector_nombre end,
        supervisor = coalesce(nullif(f ->> 'supervisor', ''), o.supervisor),
        ubicacion_id = coalesce(o.ubicacion_id, v_ubi)
       where o.id = v_id;
      v_act := v_act + 1;
    end if;
  end loop;
  return jsonb_build_object('nuevas', v_nuevas, 'actualizadas', v_act, 'omitidas', v_omit);
end $$;

-- Si el jefe o el inspector llegaron como nombre, se engancha el usuario que tenga ese nombre (si hay uno solo).
create or replace function public.enganchar_responsables_obra() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.jefe_sitio_id is null and new.jefe_sitio_nombre is not null then
    new.jefe_sitio_id := public.perfil_por_nombre(new.jefe_sitio_nombre);
  end if;
  if new.inspector_id is null and new.inspector_nombre is not null then
    new.inspector_id := public.perfil_por_nombre(new.inspector_nombre);
  end if;
  return new;
end $$;
create trigger c2_enganchar before insert or update on public.obras
  for each row execute function public.enganchar_responsables_obra();
create trigger c3_responsables before insert or update on public.obras
  for each row execute function public.resolver_responsables('con_inspector');

-- =====================================================================================
-- 3. COBRO DE OBRAS POR CICLO MENSUAL
-- =====================================================================================
create type public.cobro_estado as enum ('listo_certificar','faltan_actas','pendiente','observado','falta_aprobar_mein');

create table public.ciclos_cobro (
  id          uuid primary key default gen_random_uuid(),
  sector_id   uuid not null references public.sectores(id),
  nombre      text not null check (btrim(nombre) <> ''),
  abierto     boolean not null default true,
  cerrado_at  timestamptz,
  cerrado_por uuid references public.perfiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (id, sector_id),
  unique (sector_id, nombre)
);
-- Un solo ciclo abierto por sector.
create unique index ciclos_cobro_abierto_idx on public.ciclos_cobro(sector_id) where abierto;
select public.aplicar_rls_sector('public.ciclos_cobro');
create trigger b_rol before insert or update or delete on public.ciclos_cobro
  for each row execute function public.exigir_rol('gerencia');

-- Un ciclo se abre y se cierra solo con las funciones (cerrar el ciclo pasa las obras al siguiente); uno cerrado,
-- o con obras cargadas, no se borra. A mano solo se le cambia el nombre.
create or replace function public.validar_ciclo_cobro() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.sys_fn') then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if not old.abierto or exists (select 1 from public.obra_cobros c where c.ciclo_id = old.id) then
      raise exception 'Un ciclo cerrado o con obras cargadas no se borra.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Los ciclos se abren solos (al sumar la primera obra) o al cerrar el anterior.' using errcode = 'P0001';
  end if;
  if (new.abierto, new.cerrado_at, new.cerrado_por) is distinct from (old.abierto, old.cerrado_at, old.cerrado_por) then
    raise exception 'Un ciclo se cierra con "Cerrar el ciclo", y un ciclo cerrado no se vuelve a abrir.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger c_validar before insert or update or delete on public.ciclos_cobro
  for each row execute function public.validar_ciclo_cobro();

create table public.obra_cobros (
  id                 uuid primary key default gen_random_uuid(),
  sector_id          uuid not null references public.sectores(id),
  ciclo_id           uuid not null,
  obra_id            uuid not null,
  estado_cobro       public.cobro_estado not null default 'pendiente',
  prioridad          text not null default 'normal' check (prioridad in ('normal','alta','urgente')),
  monto_a_cobrar     numeric(16,2) not null default 0 check (monto_a_cobrar >= 0),
  avance             numeric(5,2) not null default 0 check (avance between 0 and 100),
  -- Tramo y color: por defecto salen del avance (vista). Se pueden fijar a mano.
  tramo_manual       text check (tramo_manual in ('primer_50','segundo_50')),
  color_avance       text not null default 'auto' check (color_avance in ('auto','rojo','amarillo','naranja','verde','azul','gris')),
  motivo_observacion text,
  periodo            text,
  notas              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (ciclo_id, obra_id),
  unique (id, sector_id),
  foreign key (ciclo_id, sector_id) references public.ciclos_cobro(id, sector_id) on delete cascade,
  foreign key (obra_id, sector_id)  references public.obras(id, sector_id) on delete cascade
);
create index obra_cobros_obra_idx on public.obra_cobros(obra_id);
select public.aplicar_rls_sector('public.obra_cobros');

create table public.obra_cobro_historial (
  id          uuid primary key default gen_random_uuid(),
  sector_id   uuid not null references public.sectores(id),
  cobro_id    uuid not null,
  descripcion text not null,
  estado      public.cobro_estado,
  avance      numeric(5,2),
  monto       numeric(16,2),
  usuario_id  uuid default auth.uid(),
  usuario_nombre text,
  created_at  timestamptz not null default now(),
  foreign key (cobro_id, sector_id) references public.obra_cobros(id, sector_id) on delete cascade
);
create index obra_cobro_historial_idx on public.obra_cobro_historial(cobro_id, created_at);
select public.aplicar_rls_sector('public.obra_cobro_historial');
create or replace function public.proteger_historial_cobro() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.hist_fn') then
    return coalesce(new, old);
  end if;
  -- Borrado en cascada: la fila de cobro ya no está.
  if tg_op = 'DELETE' and not exists (select 1 from public.obra_cobros c where c.id = old.cobro_id) then
    return old;
  end if;
  raise exception 'El historial se registra solo. No se puede cargar ni modificar a mano.' using errcode = 'P0001';
end $$;
create trigger b_proteger before insert or update or delete on public.obra_cobro_historial
  for each row execute function public.proteger_historial_cobro();

-- Reglas: se trabaja solo sobre el ciclo abierto; lo cambia gerencia o un jefe de sitio; "observado" pide el motivo.
-- Alta y baja de filas: gerencia (o la importación y el cierre de ciclo, que corren con la bandera del sistema).
create or replace function public.validar_obra_cobro() returns trigger
language plpgsql set search_path = public as $$
declare
  v_abierto boolean;
begin
  if public.es_servicio() then
    if tg_op <> 'DELETE' then new.updated_at := now(); end if;
    return coalesce(new, old);
  end if;
  select c.abierto into v_abierto from public.ciclos_cobro c where c.id = coalesce(new.ciclo_id, old.ciclo_id);
  -- Borrado en cascada (se borró el ciclo o la obra, y eso ya lo validó su propio trigger).
  if tg_op = 'DELETE' and (v_abierto is null or not exists (select 1 from public.obras o where o.id = old.obra_id)) then
    return old;
  end if;
  if not coalesce(v_abierto, false) and not public.dh1_flag('dh1.sys_fn') then
    raise exception 'Ese ciclo está cerrado: sus registros son de solo lectura.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    if not public.es_gerencia() then
      raise exception 'Solo gerencia puede sacar una obra del ciclo.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if not (public.puede_validar() or public.dh1_flag('dh1.sys_fn')) then
    raise exception 'Solo gerencia o un jefe de sitio pueden cambiar el cobro de una obra.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    new.ciclo_id := old.ciclo_id;
    new.obra_id := old.obra_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  if new.estado_cobro = 'observado' and coalesce(btrim(new.motivo_observacion), '') = '' then
    raise exception 'Para marcar la obra como observada, escribí el motivo.' using errcode = 'P0001';
  end if;
  if new.estado_cobro <> 'observado' then
    new.motivo_observacion := null;
  end if;
  return new;
end $$;
create trigger b_validar before insert or update or delete on public.obra_cobros
  for each row execute function public.validar_obra_cobro();

-- Historial automático: cada alta y cada cambio de estado, avance o monto, con quién y cuándo.
create or replace function public.historial_obra_cobro() returns trigger
language plpgsql set search_path = public as $$
declare
  v_desc text;
  v_prev text := current_setting('dh1.hist_fn', true);
begin
  if tg_op = 'INSERT' then
    v_desc := 'Entró al ciclo';
  else
    v_desc := concat_ws(' · ',
      case when new.estado_cobro is distinct from old.estado_cobro then 'Estado: ' || replace(old.estado_cobro::text, '_', ' ') || ' → ' || replace(new.estado_cobro::text, '_', ' ') end,
      case when new.avance is distinct from old.avance then 'Avance: ' || trim_scale(old.avance) || ' % → ' || trim_scale(new.avance) || ' %' end,
      case when new.monto_a_cobrar is distinct from old.monto_a_cobrar then 'A cobrar: $ ' || old.monto_a_cobrar || ' → $ ' || new.monto_a_cobrar end);
    if coalesce(v_desc, '') = '' then return new; end if;
  end if;
  perform set_config('dh1.hist_fn', '1', true);
  insert into public.obra_cobro_historial (sector_id, cobro_id, descripcion, estado, avance, monto, usuario_nombre)
  values (new.sector_id, new.id, v_desc, new.estado_cobro, new.avance, new.monto_a_cobrar,
          (select p.nombre from public.perfiles p where p.id = auth.uid()));
  perform set_config('dh1.hist_fn', coalesce(v_prev, ''), true);
  return new;
end $$;
create trigger z_historial after insert or update on public.obra_cobros
  for each row execute function public.historial_obra_cobro();

-- El ciclo abierto del sector. Si todavía no hay ninguno, se abre uno con el mes actual.
create or replace function public.ciclo_cobro_abierto() returns uuid
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  v_prev text;
begin
  select c.id into v_id from public.ciclos_cobro c where c.sector_id = public.sector_efectivo() and c.abierto;
  if v_id is null then
    if not public.puede_validar() then
      raise exception 'Todavía no hay un ciclo de cobro abierto. Lo abre gerencia o un jefe de sitio.' using errcode = 'P0001';
    end if;
    v_prev := current_setting('dh1.sys_fn', true);
    perform set_config('dh1.sys_fn', '1', true);
    insert into public.ciclos_cobro (nombre) values (public.mes_texto(current_date)) returning id into v_id;
    perform set_config('dh1.sys_fn', coalesce(v_prev, ''), true);
  end if;
  return v_id;
end $$;

-- Cierra el ciclo abierto y abre el siguiente, en una sola transacción (en la v1 se archivaba obra por obra y un corte
-- dejaba el ciclo a medias). Las obras pasan al nuevo ciclo con su estado, para seguir el cobro mes a mes; las que
-- quedaron listas para certificar pasan como pendientes de un nuevo tramo solo si no llegaron al 100 %.
create or replace function public.cerrar_ciclo_cobro(p_nuevo text) returns uuid
language plpgsql set search_path = public as $$
declare
  v_viejo uuid;
  v_nuevo uuid;
  v_prev text;
begin
  if not public.es_gerencia() then
    raise exception 'Solo gerencia puede cerrar el ciclo de cobro.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_nuevo), '') = '' then
    raise exception 'Poné el nombre del ciclo nuevo (por ejemplo: Noviembre 2026).' using errcode = 'P0001';
  end if;
  select c.id into v_viejo from public.ciclos_cobro c where c.sector_id = public.sector_efectivo() and c.abierto for update;
  if v_viejo is null then
    raise exception 'No hay un ciclo abierto para cerrar.' using errcode = 'P0001';
  end if;
  v_prev := current_setting('dh1.sys_fn', true);
  perform set_config('dh1.sys_fn', '1', true);
  update public.ciclos_cobro set abierto = false, cerrado_at = now(), cerrado_por = auth.uid() where id = v_viejo;
  insert into public.ciclos_cobro (nombre) values (btrim(p_nuevo)) returning id into v_nuevo;
  insert into public.obra_cobros (ciclo_id, obra_id, estado_cobro, prioridad, monto_a_cobrar, avance, tramo_manual, color_avance, motivo_observacion, periodo, notas)
  select v_nuevo, x.obra_id,
         case when x.estado_cobro = 'listo_certificar' and x.avance < 100 then 'pendiente'::public.cobro_estado else x.estado_cobro end,
         x.prioridad, x.monto_a_cobrar, x.avance, null, 'auto', x.motivo_observacion, null, x.notas
    from public.obra_cobros x
    join public.obras o on o.id = x.obra_id
   where x.ciclo_id = v_viejo and o.estado <> 'cancelado'
     and not (x.estado_cobro = 'listo_certificar' and x.avance >= 100);
  perform set_config('dh1.sys_fn', coalesce(v_prev, ''), true);
  return v_nuevo;
end $$;

-- Suma una obra al ciclo abierto (si ya está, no hace nada). Devuelve la fila del ciclo.
create or replace function public.sumar_obra_al_ciclo(p_obra uuid) returns uuid
language plpgsql set search_path = public as $$
declare
  v_ciclo uuid := public.ciclo_cobro_abierto();
  v_id uuid;
  o public.obras%rowtype;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden sumar obras al ciclo.' using errcode = 'P0001';
  end if;
  select * into o from public.obras x where x.id = p_obra;
  if not found then
    raise exception 'La obra no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  select c.id into v_id from public.obra_cobros c where c.ciclo_id = v_ciclo and c.obra_id = p_obra;
  if v_id is null then
    insert into public.obra_cobros (ciclo_id, obra_id, monto_a_cobrar, avance)
    values (v_ciclo, p_obra, o.monto_base, o.avance) returning id into v_id;
  end if;
  return v_id;
end $$;

-- Importa la planilla de certificación (una hoja por zona) al ciclo abierto. Busca la obra por MTOM y, si no está,
-- la crea. Si la obra ya está en el ciclo, la actualiza. A diferencia de la v1, no la saltea por existir en ciclos
-- anteriores (eso hacía que después de cerrar un ciclo no se pudiera volver a cargar nada).
-- p_filas: [{ titulo, direccion, establecimiento, zona, jefe, inspector, mtom, mein, monto_base, avance, plazo_dias,
--             fecha_inicio, fecha_fin, observaciones }]
create or replace function public.importar_cobros(p_filas jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  f jsonb;
  v_ciclo uuid := public.ciclo_cobro_abierto();
  v_obra uuid;
  v_cobro uuid;
  v_obs text;
  v_estado public.cobro_estado;
  v_prio text;
  v_nuevas_obras int := 0;
  v_nuevas int := 0;
  v_act int := 0;
  v_omit int := 0;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden importar la planilla de cobro.' using errcode = 'P0001';
  end if;
  for f in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) loop
    if coalesce(btrim(f ->> 'titulo'), '') = '' then v_omit := v_omit + 1; continue; end if;
    v_obs := upper(coalesce(f ->> 'observaciones', ''));
    v_prio := 'normal';
    v_estado := case
      when v_obs like '%LISTO PARA CERTIFICAR%' then 'listo_certificar'
      when v_obs like '%FALTA CARGAR ACTAS%' or v_obs like '%FALTAN ACTAS%' or v_obs like '%FALTA CARGAR%' then 'faltan_actas'
      when v_obs like '%OBSERVADO%' or v_obs like '%OBSERVACION%' then 'observado'
      else 'pendiente' end;
    if v_estado = 'listo_certificar' then v_prio := 'alta'; end if;

    v_obra := null;
    if nullif(btrim(f ->> 'mtom'), '') is not null then
      select o.id into v_obra from public.obras o where o.sector_id = public.sector_efectivo() and o.codigo_sap = btrim(f ->> 'mtom');
    end if;
    if v_obra is null then
      select o.id into v_obra from public.obras o
       where o.sector_id = public.sector_efectivo() and public.norm_txt(o.titulo) = public.norm_txt(f ->> 'titulo') limit 1;
    end if;
    if v_obra is null then
      insert into public.obras (titulo, codigo_sap, mein, establecimiento, direccion, zona, monto_base, avance, plazo_dias,
                                fecha_inicio, fecha_fin, jefe_sitio_nombre, inspector_nombre, ubicacion_id)
      values (f ->> 'titulo', nullif(f ->> 'mtom', ''), nullif(f ->> 'mein', ''), nullif(f ->> 'establecimiento', ''),
              nullif(f ->> 'direccion', ''), nullif(f ->> 'zona', ''), coalesce(public.acotar((f ->> 'monto_base')::numeric, 0, null), 0),
              coalesce(public.acotar((f ->> 'avance')::numeric, 0, 100), 0), (f ->> 'plazo_dias')::integer,
              (f ->> 'fecha_inicio')::date, (f ->> 'fecha_fin')::date, nullif(f ->> 'jefe', ''), nullif(f ->> 'inspector', ''),
              public.ubicacion_por_texto(f ->> 'establecimiento', null))
      returning id into v_obra;
      v_nuevas_obras := v_nuevas_obras + 1;
    else
      update public.obras o set mein = coalesce(nullif(f ->> 'mein', ''), o.mein),
             avance = coalesce(public.acotar((f ->> 'avance')::numeric, 0, 100), o.avance)
       where o.id = v_obra;
    end if;

    select c.id into v_cobro from public.obra_cobros c where c.ciclo_id = v_ciclo and c.obra_id = v_obra;
    if v_cobro is null then
      insert into public.obra_cobros (ciclo_id, obra_id, estado_cobro, prioridad, monto_a_cobrar, avance, motivo_observacion, notas)
      values (v_ciclo, v_obra, v_estado, v_prio, coalesce(public.acotar((f ->> 'monto_base')::numeric, 0, null), 0),
              coalesce(public.acotar((f ->> 'avance')::numeric, 0, 100), 0),
              case when v_estado = 'observado' then coalesce(nullif(btrim(f ->> 'observaciones'), ''), 'Observado en la planilla') end,
              nullif(btrim(f ->> 'observaciones'), ''));
      v_nuevas := v_nuevas + 1;
    else
      update public.obra_cobros c set estado_cobro = v_estado, prioridad = case when v_prio = 'alta' then 'alta' else c.prioridad end,
             avance = coalesce(public.acotar((f ->> 'avance')::numeric, 0, 100), c.avance),
             motivo_observacion = case when v_estado = 'observado' then coalesce(c.motivo_observacion, nullif(btrim(f ->> 'observaciones'), ''), 'Observado en la planilla') end,
             notas = coalesce(nullif(btrim(f ->> 'observaciones'), ''), c.notas)
       where c.id = v_cobro;
      v_act := v_act + 1;
    end if;
  end loop;
  return jsonb_build_object('obras_nuevas', v_nuevas_obras, 'nuevas', v_nuevas, 'actualizadas', v_act, 'omitidas', v_omit);
end $$;

-- La fila de cobro con los datos de su obra, el tramo y el color. Tramo automático: hasta 50 % primer tramo, más de
-- 50 % segundo tramo, 100 % completo (misma regla que la v1).
create view public.v_obra_cobros with (security_invoker = true) as
select c.*,
       k.nombre as ciclo_nombre, k.abierto as ciclo_abierto,
       o.titulo, o.codigo_sap as mtom, o.mein, o.establecimiento, o.direccion, o.zona, o.monto_base,
       o.jefe_sitio_id, o.jefe_sitio_nombre, o.inspector_id, o.inspector_nombre, o.plazo_dias, o.fecha_inicio, o.fecha_fin,
       coalesce(c.tramo_manual, case when c.avance >= 100 then null when c.avance > 50 then 'segundo_50' when c.avance > 0 then 'primer_50' end) as tramo,
       case when c.color_avance <> 'auto' then c.color_avance
            when c.avance >= 100 then 'verde' when c.avance > 50 then 'naranja' else 'amarillo' end as color
  from public.obra_cobros c
  join public.ciclos_cobro k on k.id = c.ciclo_id
  join public.obras o        on o.id = c.obra_id;

-- =====================================================================================
-- 4. PRESUPUESTOS DE OBRA (repositorio de planillas)
-- =====================================================================================
create table public.presupuestos (
  id             uuid primary key default gen_random_uuid(),
  sector_id      uuid not null references public.sectores(id),
  nombre         text not null check (btrim(nombre) <> ''),
  obra_id        uuid,
  obra_texto     text,
  descripcion    text,
  estado         text not null default 'borrador' check (estado in ('borrador','enviado','aprobado','rechazado')),
  archivo_path   text not null,
  archivo_nombre text not null,
  archivo_tamano bigint,
  id_origen      text unique,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (obra_id, sector_id) references public.obras(id, sector_id) on delete set null (obra_id)
);
create index presupuestos_sector_idx on public.presupuestos(sector_id, created_at desc);
select public.aplicar_rls_sector('public.presupuestos');
create trigger b_rol before insert or update or delete on public.presupuestos
  for each row execute function public.exigir_rol('validar');
create trigger c_updated before update on public.presupuestos
  for each row execute function public.tocar_updated_at();

create view public.v_presupuestos with (security_invoker = true) as
select p.*, o.titulo as obra_titulo, pc.nombre as creado_por_nombre
  from public.presupuestos p
  left join public.obras o     on o.id = p.obra_id
  left join public.perfiles pc on pc.id = p.created_by;

-- =====================================================================================
-- 5. SOLICITUDES DE CERTIFICADO
-- =====================================================================================
create sequence public.solicitud_numero_seq;
create type public.solicitud_estado as enum ('borrador','enviada','en_revision','aprobada','rechazada');

create table public.solicitudes_certificado (
  id                uuid primary key default gen_random_uuid(),
  sector_id         uuid not null references public.sectores(id),
  numero            bigint not null unique default nextval('public.solicitud_numero_seq'),
  codigo            text not null default '',
  titulo            text not null check (btrim(titulo) <> ''),
  obra_id           uuid,
  contrato_id       uuid,
  certificado_id    uuid,
  establecimiento   text,
  descripcion       text,
  monto_solicitado  numeric(16,2) not null default 0 check (monto_solicitado >= 0),
  avance            numeric(5,2) not null default 0 check (avance between 0 and 100),
  periodo           text,
  prioridad         text not null default 'normal' check (prioridad in ('normal','alta','urgente')),
  -- [{ nombre, path, tipo, tamano }] en el bucket "documentos"
  adjuntos          jsonb not null default '[]'::jsonb check (jsonb_typeof(adjuntos) = 'array'),
  estado            public.solicitud_estado not null default 'borrador',
  solicitante_id    uuid references public.perfiles(id) on delete set null default auth.uid(),
  revisor_id        uuid references public.perfiles(id) on delete set null,
  comentarios       text,
  motivo_rechazo    text,
  resuelto_at       timestamptz,
  -- [{ fecha, estado, usuario, comentario }]: lo escribe la base
  historial         jsonb not null default '[]'::jsonb,
  id_origen         text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (obra_id, sector_id)        references public.obras(id, sector_id) on delete set null (obra_id),
  foreign key (contrato_id, sector_id)    references public.contratos(id, sector_id) on delete set null (contrato_id),
  foreign key (certificado_id, sector_id) references public.certificados(id, sector_id) on delete set null (certificado_id)
);
create index solicitudes_sector_idx on public.solicitudes_certificado(sector_id, estado);
select public.aplicar_rls_sector('public.solicitudes_certificado');

-- Máquina de estados:
--   borrador → enviada (quien la pidió) · enviada → en_revision (gerencia) · enviada|en_revision → aprobada|rechazada
--   (gerencia, nunca quien la pidió; rechazar pide el motivo) · rechazada → borrador (quien la pidió, para corregir).
-- Quien la pidió edita solo en borrador. Una aprobada no se toca.
create or replace function public.validar_solicitud() returns trigger
language plpgsql set search_path = public as $$
declare
  v_yo uuid := auth.uid();
  v_nombre text := (select p.nombre from public.perfiles p where p.id = auth.uid());
  v_entrada jsonb;
  v_com text;
  v_cert uuid;
begin
  if public.es_servicio() then
    return coalesce(new, old);
  end if;
  -- Al borrar la obra, el contrato o el certificado, la referencia se limpia sola (dentro de la cascada y sin tocar nada más).
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and (to_jsonb(new) - array['obra_id','contrato_id','certificado_id']) = (to_jsonb(old) - array['obra_id','contrato_id','certificado_id']) then
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.estado = 'aprobada' then
      raise exception 'Una solicitud aprobada no se borra.' using errcode = 'P0001';
    end if;
    if not (public.es_gerencia() or (old.solicitante_id = v_yo and old.estado = 'borrador')) then
      raise exception 'La solicitud la borra quien la pidió (mientras está en borrador) o gerencia.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not (public.puede_validar() or public.rol_actual() = 'inspector') then
      raise exception 'Tu rol no puede pedir certificados.' using errcode = 'P0001';
    end if;
    if new.estado not in ('borrador','enviada') then
      raise exception 'Una solicitud nueva queda en borrador o enviada.' using errcode = 'P0001';
    end if;
    new.solicitante_id := v_yo;
    new.numero := nextval('public.solicitud_numero_seq');
    new.codigo := 'SOL-' || lpad(new.numero::text, 6, '0');
    new.revisor_id := null; new.resuelto_at := null; new.motivo_rechazo := null;
    new.historial := jsonb_build_array(jsonb_build_object('fecha', now(), 'estado', new.estado, 'usuario', v_nombre, 'comentario', 'Creada'));
    return new;
  end if;

  -- UPDATE
  new.numero := old.numero; new.codigo := old.codigo; new.solicitante_id := old.solicitante_id;
  new.created_at := old.created_at; new.updated_at := now(); new.historial := old.historial;
  if old.estado = 'aprobada' then
    raise exception 'La solicitud ya está aprobada: no se modifica.' using errcode = 'P0001';
  end if;

  if new.estado is distinct from old.estado then
    if old.estado = 'borrador' and new.estado = 'enviada' then
      if old.solicitante_id is distinct from v_yo then
        raise exception 'La envía quien la pidió.' using errcode = 'P0001';
      end if;
      new.revisor_id := null; new.resuelto_at := null; new.motivo_rechazo := null;
    elsif old.estado = 'rechazada' and new.estado = 'borrador' then
      if old.solicitante_id is distinct from v_yo then
        raise exception 'La vuelve a borrador quien la pidió.' using errcode = 'P0001';
      end if;
      new.motivo_rechazo := null; new.revisor_id := null; new.resuelto_at := null;
    elsif old.estado = 'enviada' and new.estado = 'en_revision' then
      if not public.es_gerencia() then
        raise exception 'La toma para revisar gerencia.' using errcode = 'P0001';
      end if;
      new.revisor_id := v_yo; new.resuelto_at := null; new.motivo_rechazo := null;
    elsif old.estado in ('enviada','en_revision') and new.estado in ('aprobada','rechazada') then
      if not public.es_gerencia() then
        raise exception 'Solo gerencia aprueba o rechaza solicitudes de certificado.' using errcode = 'P0001';
      end if;
      if old.solicitante_id = v_yo then
        raise exception 'No podés aprobar ni rechazar una solicitud que pediste vos.' using errcode = 'P0001';
      end if;
      if new.estado = 'rechazada' and coalesce(btrim(new.motivo_rechazo), '') = '' then
        raise exception 'Para rechazar, escribí el motivo.' using errcode = 'P0001';
      end if;
      new.revisor_id := v_yo; new.resuelto_at := now();
    else
      raise exception 'Una solicitud % no puede pasar a %.', replace(old.estado::text, '_', ' '), replace(new.estado::text, '_', ' ')
        using errcode = 'P0001';
    end if;
    -- Fuera del borrador, cambiar de estado no toca lo pedido (nadie aprueba un monto distinto del que se pidió).
    if old.estado <> 'borrador' then
      new.titulo := old.titulo; new.obra_id := old.obra_id; new.contrato_id := old.contrato_id;
      new.establecimiento := old.establecimiento; new.descripcion := old.descripcion; new.monto_solicitado := old.monto_solicitado;
      new.avance := old.avance; new.periodo := old.periodo; new.prioridad := old.prioridad; new.adjuntos := old.adjuntos;
    end if;
    v_entrada := jsonb_build_object('fecha', now(), 'estado', new.estado, 'usuario', v_nombre,
                                    'comentario', coalesce(case when new.estado = 'rechazada' then new.motivo_rechazo end, nullif(btrim(new.comentarios), '')));
    new.historial := old.historial || jsonb_build_array(v_entrada);
    return new;
  end if;

  -- Sin cambio de estado: quien la pidió edita en borrador; gerencia puede dejar comentarios mientras la revisa.
  if old.estado = 'borrador' and old.solicitante_id = v_yo then
    new.revisor_id := old.revisor_id; new.resuelto_at := old.resuelto_at; new.motivo_rechazo := old.motivo_rechazo;
    return new;
  end if;
  if public.es_gerencia() and old.estado in ('enviada','en_revision') then
    -- Gerencia solo cambia los comentarios y el vínculo con el certificado; el resto queda como lo mandaron.
    v_com := new.comentarios;
    v_cert := new.certificado_id;
    new := old;
    new.comentarios := v_com;
    new.certificado_id := v_cert;
    if v_cert is not null and new.contrato_id is not null
       and not exists (select 1 from public.certificados c where c.id = v_cert and c.contrato_id = new.contrato_id) then
      raise exception 'Ese certificado no es del contrato de la solicitud.' using errcode = 'P0001';
    end if;
    new.updated_at := now();
    return new;
  end if;
  raise exception 'No podés modificar esta solicitud en este estado.' using errcode = 'P0001';
end $$;
create trigger b_validar before insert or update or delete on public.solicitudes_certificado
  for each row execute function public.validar_solicitud();

create view public.v_solicitudes_certificado with (security_invoker = true) as
select s.*, ps.nombre as solicitante_nombre, pr.nombre as revisor_nombre, o.titulo as obra_titulo,
       k.contratista as contrato_contratista, c.numero as certificado_numero, c.estado as certificado_estado
  from public.solicitudes_certificado s
  left join public.perfiles ps     on ps.id = s.solicitante_id
  left join public.perfiles pr     on pr.id = s.revisor_id
  left join public.obras o         on o.id = s.obra_id
  left join public.contratos k     on k.id = s.contrato_id
  left join public.certificados c  on c.id = s.certificado_id;

-- =====================================================================================
-- 6. ABONOS MENSUALES: certificar el mes de todos los contratos de abono
-- =====================================================================================
-- Para cada contrato de abono activo cuyo período de validez incluye el mes: crea el certificado del mes, mide en
-- cada ítem la parte del mes (cantidad ÷ meses del contrato) y lo emite. Queda para aprobar por otra persona de
-- gerencia (quien emite no aprueba). Cada contrato es independiente: si uno falla, los demás siguen.
-- Se saltea el contrato que ya tiene certificado para ese período o un borrador abierto. Idempotente.
create or replace function public.certificar_abonos_del_mes(p_mes date, p_contrato uuid default null) returns jsonb
language plpgsql set search_path = public as $$
declare
  k record;
  v_mes date := date_trunc('month', coalesce(p_mes, current_date))::date;
  v_periodo text := public.mes_texto(coalesce(p_mes, current_date));
  v_meses integer;
  v_cert uuid;
  v_num integer;
  v_res jsonb := '[]'::jsonb;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden certificar abonos.' using errcode = 'P0001';
  end if;
  if v_mes > date_trunc('month', current_date)::date then
    raise exception 'No se certifica un mes que todavía no empezó.' using errcode = 'P0001';
  end if;
  for k in
    select c.* from public.contratos c
     where c.tipo = 'abono_mensual' and c.estado = 'activo' and (p_contrato is null or c.id = p_contrato)
     order by c.contratista
  loop
    if k.fecha_inicio is null or k.fecha_fin is null then
      v_res := v_res || jsonb_build_object('contrato', k.contratista, 'resultado', 'sin_fechas', 'detalle', 'Le faltan las fechas de inicio y fin.');
      continue;
    end if;
    if v_mes < date_trunc('month', k.fecha_inicio)::date or v_mes > date_trunc('month', k.fecha_fin)::date then
      v_res := v_res || jsonb_build_object('contrato', k.contratista, 'resultado', 'fuera_de_plazo', 'detalle', 'El mes está fuera de su vigencia.');
      continue;
    end if;
    -- El contrato se bloquea antes de mirar: dos corridas simultáneas no pueden certificar el mismo mes dos veces.
    perform 1 from public.contratos c where c.id = k.id for update;
    if exists (select 1 from public.certificados x where x.contrato_id = k.id and x.estado <> 'borrador' and lower(x.periodo) = lower(v_periodo)) then
      v_res := v_res || jsonb_build_object('contrato', k.contratista, 'resultado', 'ya_certificado', 'detalle', 'Ya tiene certificado de ' || v_periodo || '.');
      continue;
    end if;
    if exists (select 1 from public.certificados x where x.contrato_id = k.id and x.estado = 'borrador') then
      v_res := v_res || jsonb_build_object('contrato', k.contratista, 'resultado', 'con_borrador', 'detalle', 'Tiene un borrador abierto: emitilo o borralo.');
      continue;
    end if;
    v_meses := (extract(year from age(date_trunc('month', k.fecha_fin), date_trunc('month', k.fecha_inicio))) * 12
                + extract(month from age(date_trunc('month', k.fecha_fin), date_trunc('month', k.fecha_inicio))))::integer + 1;
    begin
      v_cert := public.crear_certificado(k.id, v_periodo);
      -- Cada mes tiene su parte fija: cantidad ÷ meses, y el último mes lleva el resto del redondeo
      -- (cantidad − parte × (meses − 1)). Así da lo mismo el orden en que se certifiquen los meses.
      update public.certificado_items ci
         set med_presente_unidad = greatest(0, least(ci.cantidad - ci.med_acum_anterior_unidad,
               case when v_mes = date_trunc('month', k.fecha_fin)::date
                    then ci.cantidad - round(ci.cantidad / v_meses, 4) * (v_meses - 1)
                    else round(ci.cantidad / v_meses, 4) end))
       where ci.certificado_id = v_cert;
      v_num := public.emitir_certificado(v_cert);
      v_res := v_res || jsonb_build_object('contrato', k.contratista, 'resultado', 'emitido', 'numero', v_num, 'certificado_id', v_cert,
                                           'detalle', 'Certificado N° ' || v_num || ' emitido.');
    exception when others then
      v_res := v_res || jsonb_build_object('contrato', k.contratista, 'resultado', 'error', 'detalle', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('periodo', v_periodo, 'contratos', v_res);
end $$;

-- =====================================================================================
-- 7. VISTAS QUE CAMBIAN Y BÚSQUEDA
-- =====================================================================================
-- v_ordenes suma la obra (la tabla ganó la columna obra_id).
drop view if exists public.v_ordenes;
create view public.v_ordenes with (security_invoker = true) as
select o.*,
       u.nombre  as ubicacion_nombre,
       u.direccion as ubicacion_direccion,
       a.nombre  as activo_nombre,
       a.codigo  as activo_codigo,
       -- Tokens de QR: el teléfono los guarda con la orden para reconocer un QR escaneado sin señal.
       u.qr_token as ubicacion_qr_token,
       a.qr_token as activo_qr_token,
       pa.nombre as asignado_nombre,
       pv.nombre as validado_nombre,
       jsonb_array_length(o.checklist) as tareas_total,
       (select count(*) from jsonb_array_elements(o.checklist) e
         where coalesce((e ->> 'hecho')::boolean, false))::integer as tareas_hechas,
       (select count(*) from public.ot_fotos f where f.ot_id = o.id)::integer as fotos_total,
       (o.estado in ('pendiente','asignada','en_progreso')
          and o.fecha_programada is not null and o.fecha_programada < current_date) as vencida,
       u.jefe_sitio_id,
       u.jefe_sitio_nombre,
       u.lat as ubicacion_lat,
       u.lng as ubicacion_lng,
       (select coalesce(sum(h.horas), 0) from public.ot_horas h where h.ot_id = o.id) as horas_cargadas,
       ob.titulo as obra_titulo
  from public.ordenes_trabajo o
  left join public.ubicaciones u on u.id = o.ubicacion_id
  left join public.activos a     on a.id = o.activo_id
  left join public.perfiles pa   on pa.id = o.asignado_a
  left join public.perfiles pv   on pv.id = o.validado_por
  left join public.obras ob      on ob.id = o.obra_id;

create or replace function public.buscar(p_tabla text, p_q text)
returns table (id uuid, etiqueta text, detalle text)
language plpgsql stable set search_path = public as $$
declare
  v_q text := '%' || replace(replace(replace(coalesce(btrim(p_q), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if auth.uid() is null then
    raise exception 'Tenés que iniciar sesión.' using errcode = 'P0001';
  end if;

  if p_tabla = 'ubicaciones' then
    return query
      select u.id, u.nombre, nullif(concat_ws(' · ', u.codigo, u.direccion, u.zona), '')
        from public.ubicaciones u
       where u.activa and u.sector_id = public.sector_efectivo()
         and (u.nombre ilike v_q or u.codigo ilike v_q or u.direccion ilike v_q)
       order by u.nombre limit 10;
  elsif p_tabla = 'direcciones' then
    return query
      select d.id, d.direccion, nullif(concat_ws(' · ', d.zona, d.jefe_sitio_nombre), '')
        from public.direcciones d
       where d.activa and d.sector_id = public.sector_efectivo() and d.direccion ilike v_q
       order by d.direccion limit 10;
  elsif p_tabla = 'activos' then
    return query
      select a.id, a.nombre, nullif(concat_ws(' · ', a.codigo, a.marca, a.modelo), '')
        from public.activos a
       where a.estado <> 'baja' and a.sector_id = public.sector_efectivo()
         and (a.nombre ilike v_q or a.codigo ilike v_q or a.numero_serie ilike v_q)
       order by a.nombre limit 10;
  elsif p_tabla = 'perfiles' then
    return query
      select p.id, p.nombre, replace(p.rol::text, '_', ' ')
        from public.perfiles p
       where p.activo and p.sector_id = public.sector_efectivo()
         and (p.nombre ilike v_q or p.email ilike v_q)
       order by p.nombre limit 10;
  elsif p_tabla = 'jefes' then
    return query
      select p.id, p.nombre, replace(p.rol::text, '_', ' ')
        from public.perfiles p
       where p.activo and p.sector_id = public.sector_efectivo() and p.rol in ('jefe_sitio','gerente','gerente_general','admin')
         and (p.nombre ilike v_q or p.email ilike v_q)
       order by (p.rol = 'jefe_sitio') desc, p.nombre limit 10;
  elsif p_tabla = 'empleados' then
    return query
      select e.id, e.nombre, nullif(concat_ws(' · ', e.puesto, e.zona), '')
        from public.empleados e
       where e.estado <> 'inactivo' and e.sector_id = public.sector_efectivo()
         and (e.nombre ilike v_q or e.puesto ilike v_q or e.email ilike v_q)
       order by e.nombre limit 10;
  elsif p_tabla = 'obras' then
    return query
      select o.id, o.titulo, nullif(concat_ws(' · ', o.codigo_sap, o.establecimiento, o.zona), '')
        from public.obras o
       where o.sector_id = public.sector_efectivo() and o.estado <> 'cancelado'
         and (o.titulo ilike v_q or o.codigo_sap ilike v_q or o.establecimiento ilike v_q)
       order by o.titulo limit 10;
  elsif p_tabla = 'proveedores' then
    return query
      select p.id, p.nombre, nullif(concat_ws(' · ', replace(p.rubro, '_', ' '), p.cuit), '')
        from public.proveedores p
       where p.sector_id = public.sector_efectivo() and p.estado <> 'inactivo'
         and (p.nombre ilike v_q or p.cuit ilike v_q or p.contacto ilike v_q)
       order by p.nombre limit 10;
  elsif p_tabla = 'plantillas_ot' then
    return query
      select t.id, t.nombre, t.titulo
        from public.plantillas_ot t
       where t.sector_id = public.sector_efectivo() and (t.nombre ilike v_q or t.titulo ilike v_q)
       order by t.nombre limit 10;
  elsif p_tabla = 'contratos' then
    return query
      select k.id, k.contratista, nullif(concat_ws(' · ', k.obra_servicio, 'ADA ' || k.ada_numero, 'OC ' || k.oc_numero), '')
        from public.contratos k
       where k.sector_id = public.sector_efectivo()
         and (k.contratista ilike v_q or k.obra_servicio ilike v_q or k.ada_numero ilike v_q or k.oc_numero ilike v_q)
       order by k.contratista limit 10;
  else
    raise exception 'No se puede buscar en "%".', p_tabla using errcode = 'P0001';
  end if;
end $$;

-- =====================================================================================
-- 8. BUCKET "documentos" (privado): planillas de presupuesto, documentos de obra, adjuntos de solicitudes
-- Ruta: <sector_id>/<carpeta>/<uuid>-<nombre>. Se lee con URL firmada; solo dentro del sector activo.
-- =====================================================================================
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('documentos', 'documentos', false) on conflict (id) do nothing;
    execute 'drop policy if exists "documentos leer" on storage.objects';
    execute $p$create policy "documentos leer" on storage.objects for select to authenticated
      using (bucket_id = 'documentos' and (storage.foldername(name))[1] = public.sector_efectivo()::text)$p$;
    execute 'drop policy if exists "documentos subir" on storage.objects';
    execute $p$create policy "documentos subir" on storage.objects for insert to authenticated
      with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = public.sector_efectivo()::text)$p$;
    execute 'drop policy if exists "documentos borrar" on storage.objects';
    -- Borrar archivos: gerencia y jefes de sitio (un operario no borra documentos de obra ni planillas).
    execute $p$create policy "documentos borrar" on storage.objects for delete to authenticated
      using (bucket_id = 'documentos' and (storage.foldername(name))[1] = public.sector_efectivo()::text and public.puede_validar())$p$;
  end if;
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
