-- =====================================================================================
-- DH1 v2 · Fase 13 · Ajustes encontrados al recorrer la app con datos de prueba (2/10/2026)
-- Va después de la fase 12. Se puede correr más de una vez.
--
--   1. Numeración: solicitudes (SOL), requerimientos (REQ) e informes (INF) gastaban dos números por alta
--      (el valor por defecto de la columna y después el trigger), así que arrancaban en 000002 y saltaban de a dos.
--      Ahora la columna no tiene valor por defecto: numera solo el trigger. Para el servicio (migración), que
--      no pasa por la validación, un trigger previo pone el número si no vino.
--   2. Cantidades con su unidad legible y en plural ("8 l", "3 unidades", "370 m") en la alerta de stock,
--      el error de stock insuficiente y los buscadores.
-- =====================================================================================

-- ------------------------------------------------------------------ 1. numeración
alter table public.solicitudes_certificado alter column numero drop default;
alter table public.requerimientos_compra   alter column numero drop default;
alter table public.informes                alter column numero drop default;

-- Solo para el servicio: el trigger de validación ya numera a los usuarios y lo hace siempre (no acepta un número
-- elegido a mano). Corre antes que "b_*" por orden alfabético.
create or replace function public.numerar_si_falta() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() and new.numero is null then
    new.numero := nextval(tg_argv[0]::regclass);
  end if;
  return new;
end $$;

drop trigger if exists a0_numerar on public.solicitudes_certificado;
create trigger a0_numerar before insert on public.solicitudes_certificado
  for each row execute function public.numerar_si_falta('public.solicitud_numero_seq');
drop trigger if exists a0_numerar on public.requerimientos_compra;
create trigger a0_numerar before insert on public.requerimientos_compra
  for each row execute function public.numerar_si_falta('public.requerimiento_numero_seq');
drop trigger if exists a0_numerar on public.informes;
create trigger a0_numerar before insert on public.informes
  for each row execute function public.numerar_si_falta('public.informe_numero_seq');

-- La solicitud cargada por el servicio también lleva código (antes quedaba vacío).
create or replace function public.codificar_solicitud_servicio() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() and coalesce(new.codigo, '') = '' then
    new.codigo := 'SOL-' || lpad(new.numero::text, 6, '0');
  end if;
  return new;
end $$;
drop trigger if exists a1_codificar on public.solicitudes_certificado;
create trigger a1_codificar before insert on public.solicitudes_certificado
  for each row execute function public.codificar_solicitud_servicio();

-- ------------------------------------------------------------------ 2. cantidades legibles
-- Igual que en la app: las abreviaturas no cambian; las palabras van en plural si la cantidad no es 1.
create or replace function public.cantidad_txt(p_n numeric, p_unidad text) returns text
language sql immutable set search_path = public as $$
  select replace(trim_scale(coalesce(p_n, 0))::text, '.', ',') || ' ' ||
         case p_unidad
           when 'metro'  then 'm'
           when 'metro2' then 'm²'
           when 'metro3' then 'm³'
           when 'litro'  then 'l'
           when 'kg'     then 'kg'
           when 'unidad' then case when coalesce(p_n, 0) = 1 then 'unidad' else 'unidades' end
           when 'par'    then case when coalesce(p_n, 0) = 1 then 'par' else 'pares' end
           when 'bolsa'  then case when coalesce(p_n, 0) = 1 then 'bolsa' else 'bolsas' end
           when 'caja'   then case when coalesce(p_n, 0) = 1 then 'caja' else 'cajas' end
           when 'rollo'  then case when coalesce(p_n, 0) = 1 then 'rollo' else 'rollos' end
           when 'juego'  then case when coalesce(p_n, 0) = 1 then 'juego' else 'juegos' end
           else coalesce(p_unidad, '')
         end
$$;

create or replace function public.registrar_movimiento(
  p_material uuid, p_tipo text, p_motivo text, p_cantidad numeric,
  p_obra uuid default null, p_ot uuid default null, p_empleado uuid default null, p_responsable text default null,
  p_remito text default null, p_notas text default null, p_costo numeric default null,
  p_requerimiento uuid default null, p_prestamo uuid default null
) returns uuid
language plpgsql set search_path = public as $$
declare
  m public.materiales%rowtype;
  v_nuevo numeric;
  v_obra uuid := p_obra;
  v_id uuid;
  v_prev text;
  v_costo numeric;
begin
  if not public.puede_validar() and not public.dh1_flag('dh1.panol_fn') then
    raise exception 'Mueven stock gerencia y los jefes de sitio.' using errcode = 'P0001';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad tiene que ser mayor a cero.' using errcode = 'P0001';
  end if;
  if p_tipo not in ('entrada','salida') then
    raise exception 'El tipo es entrada o salida.' using errcode = 'P0001';
  end if;
  if (p_tipo = 'entrada') <> (p_motivo in ('stock_inicial','compra','devolucion','devolucion_prestamo','ajuste_entrada')) then
    raise exception 'El motivo "%" no corresponde a una %.', replace(coalesce(p_motivo, ''), '_', ' '), p_tipo using errcode = 'P0001';
  end if;
  select * into m from public.materiales x where x.id = p_material for update;
  if not found then
    raise exception 'El material no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if (p_requerimiento is not null or p_prestamo is not null) and not public.dh1_flag('dh1.panol_fn') then
    raise exception 'El requerimiento y el préstamo de un movimiento los pone el sistema.' using errcode = 'P0001';
  end if;
  if p_motivo = 'prestamo' and not public.dh1_flag('dh1.panol_fn') then
    raise exception 'Los préstamos se registran desde Préstamos, para poder seguir la devolución.' using errcode = 'P0001';
  end if;
  if p_ot is not null and v_obra is null then
    select t.obra_id into v_obra from public.ordenes_trabajo t where t.id = p_ot;
  end if;
  if p_motivo = 'asignacion_obra' and v_obra is null then
    raise exception 'Para asignar material a una obra, elegí la obra.' using errcode = 'P0001';
  end if;
  if p_tipo = 'salida' and p_cantidad > m.stock then
    raise exception 'No alcanza el stock de %: hay % y querés sacar %.', m.nombre, public.cantidad_txt(m.stock, m.unidad), public.cantidad_txt(p_cantidad, m.unidad)
      using errcode = 'P0001';
  end if;
  v_nuevo := case when p_tipo = 'entrada' then m.stock + p_cantidad else m.stock - p_cantidad end;
  v_costo := case when p_costo is not null and p_costo >= 0 and p_motivo = 'compra' then p_costo else m.costo_unitario end;

  v_prev := public.panol_on();
  insert into public.movimientos_panol (sector_id, material_id, tipo, motivo, cantidad, stock_anterior, stock_nuevo, costo_unitario,
                                        obra_id, ot_id, requerimiento_id, prestamo_id, empleado_id, responsable_texto, remito, notas)
  values (m.sector_id, m.id, p_tipo, p_motivo, p_cantidad, m.stock, v_nuevo, v_costo, v_obra, p_ot, p_requerimiento, p_prestamo,
          p_empleado, nullif(btrim(coalesce(p_responsable, '')), ''), nullif(btrim(coalesce(p_remito, '')), ''), nullif(btrim(coalesce(p_notas, '')), ''))
  returning id into v_id;
  update public.materiales set
    stock = v_nuevo,
    costo_unitario = case when p_motivo = 'compra' and p_costo is not null and p_costo >= 0 and v_nuevo > 0
                          then round((m.stock * m.costo_unitario + p_cantidad * p_costo) / v_nuevo, 2)
                          else costo_unitario end
   where id = m.id;
  perform public.panol_restore(v_prev);
  return v_id;
end $$;

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
  elsif p_tabla = 'materiales' then
    return query
      select m.id, m.nombre, concat_ws(' · ', m.codigo, 'stock ' || public.cantidad_txt(m.stock, m.unidad), case when m.prestable then 'se presta' end)
        from public.materiales m
       where m.activo and m.sector_id = public.sector_efectivo()
         and (m.nombre ilike v_q or m.codigo ilike v_q)
       order by m.nombre limit 10;
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

create or replace function public.buscar_todo(p_q text)
returns table (tipo text, id uuid, titulo text, detalle text, enlace text)
language plpgsql stable set search_path = public as $$
declare
  v_q text := '%' || replace(replace(replace(coalesce(btrim(p_q), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if auth.uid() is null then
    raise exception 'Tenés que iniciar sesión.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_q, ''))) < 2 then
    return;
  end if;
  return query
  (select 'orden'::text, o.id, o.codigo || ' · ' || o.titulo, coalesce(u.nombre, ''), '/ot/' || o.id
     from public.ordenes_trabajo o left join public.ubicaciones u on u.id = o.ubicacion_id
    where o.titulo ilike v_q or o.codigo ilike v_q order by o.created_at desc limit 5)
  union all
  (select 'pendiente', p.id, coalesce(p.numero_sap || ' · ', '') || left(p.descripcion, 80), coalesce(p.establecimiento, ''), '/gestion/pendientes'
     from public.pendientes p where p.descripcion ilike v_q or p.numero_sap ilike v_q or p.establecimiento ilike v_q order by p.created_at desc limit 5)
  union all
  (select 'lugar', u.id, u.nombre, concat_ws(' · ', u.codigo, u.direccion, u.zona), '/gestion/mapa'
     from public.ubicaciones u where u.nombre ilike v_q or u.codigo ilike v_q or u.direccion ilike v_q order by u.nombre limit 5)
  union all
  (select 'activo', a.id, a.nombre, concat_ws(' · ', a.codigo, a.marca, a.modelo), '/gestion/activos/' || a.id
     from public.activos a where a.nombre ilike v_q or a.codigo ilike v_q or a.numero_serie ilike v_q order by a.nombre limit 5)
  union all
  (select 'obra', o.id, o.titulo, concat_ws(' · ', o.codigo_sap, o.establecimiento), '/gestion/obras'
     from public.obras o where o.titulo ilike v_q or o.codigo_sap ilike v_q or o.establecimiento ilike v_q order by o.titulo limit 5)
  union all
  (select 'empleado', e.id, e.nombre, concat_ws(' · ', e.puesto, e.zona), '/gestion/empleados'
     from public.empleados e where e.nombre ilike v_q or e.email ilike v_q order by e.nombre limit 5)
  union all
  (select 'contrato', k.id, k.contratista, concat_ws(' · ', k.obra_servicio, 'ADA ' || k.ada_numero, 'OC ' || k.oc_numero), '/gestion/certificacion/' || k.id
     from public.contratos k where k.contratista ilike v_q or k.obra_servicio ilike v_q or k.ada_numero ilike v_q or k.oc_numero ilike v_q order by k.contratista limit 5)
  union all
  (select 'material', m.id, m.nombre, concat_ws(' · ', m.codigo, 'stock ' || public.cantidad_txt(m.stock, m.unidad)), '/gestion/panol'
     from public.materiales m where m.nombre ilike v_q or m.codigo ilike v_q order by m.nombre limit 5)
  union all
  (select 'proveedor', p.id, p.nombre, concat_ws(' · ', p.cuit, p.contacto), '/gestion/proveedores'
     from public.proveedores p where p.nombre ilike v_q or p.cuit ilike v_q order by p.nombre limit 5)
  union all
  (select 'emergencia', e.id, e.codigo || ' · ' || e.titulo, e.estado::text, '/gestion/emergencias'
     from public.emergencias e where e.titulo ilike v_q or e.codigo ilike v_q order by e.created_at desc limit 5)
  union all
  (select 'informe', i.id, i.codigo || ' · ' || i.titulo, i.estado, '/gestion/informes'
     from public.informes i where i.titulo ilike v_q or i.codigo ilike v_q order by i.created_at desc limit 5)
  union all
  (select 'requerimiento', r.id, r.codigo || ' · ' || r.titulo, r.estado, '/gestion/requerimientos'
     from public.requerimientos_compra r where r.titulo ilike v_q or r.codigo ilike v_q or r.numero_orden_compra ilike v_q order by r.created_at desc limit 5);
end $$;

create or replace view public.v_alertas with (security_invoker = true) as
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
       'Hay ' || public.cantidad_txt(m.stock, m.unidad) || ' · mínimo ' || public.cantidad_txt(m.stock_minimo, m.unidad),
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

grant execute on function public.cantidad_txt(numeric, text) to authenticated, service_role;
