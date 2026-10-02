-- =====================================================================================
-- DH1 v2 — Fase 3: GESTIÓN
-- Mantenimiento preventivo, vistas de gestión y búsqueda remota para combos.
-- Correr después de dh1-v2-fundacion.sql.
-- Todo acá corre con la RLS del que consulta (security_invoker): nada saltea el sector.
-- =====================================================================================

-- ------------------------------------------------------------------ mantenimiento preventivo
-- Crea una OT preventiva por cada activo cuyo mantenimiento vence en los próximos p_dias.
-- Idempotente: la clave activo + fecha de vencimiento es única, correrla dos veces no duplica.
create or replace function public.generar_ots_preventivas(p_dias integer default 7) returns integer
language plpgsql set search_path = public as $$
declare
  v_creadas integer;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden generar los preventivos.' using errcode = 'P0001';
  end if;
  if public.sector_efectivo() is null then
    raise exception 'Tu usuario no tiene un sector asignado.' using errcode = 'P0001';
  end if;

  -- Siempre dentro del sector activo, aunque "ver todos" esté prendido.
  insert into public.ordenes_trabajo
    (sector_id, titulo, descripcion, tipo, prioridad, ubicacion_id, activo_id, asignado_a,
     fecha_programada, origen, preventivo_clave)
  select a.sector_id,
         'Preventivo: ' || a.nombre,
         'Mantenimiento preventivo programado' ||
           case when a.frecuencia_mant_dias is not null
                then ' (cada ' || a.frecuencia_mant_dias || ' días).' else '.' end,
         'mantenimiento_preventivo',
         case a.criticidad when 'critica' then 'urgente' when 'alta' then 'alta' else 'media' end::public.prioridad,
         a.ubicacion_id,
         a.id,
         a.responsable_id,
         a.proximo_mantenimiento,
         'preventivo',
         a.id::text || ':' || a.proximo_mantenimiento::text
    from public.activos a
   where a.sector_id = public.sector_efectivo()
     and a.estado <> 'baja'
     and a.proximo_mantenimiento is not null
     and a.proximo_mantenimiento <= current_date + coalesce(p_dias, 7)
  on conflict (preventivo_clave) where preventivo_clave is not null do nothing;

  get diagnostics v_creadas = row_count;
  return v_creadas;
end $$;

-- ------------------------------------------------------------------ vistas de gestión
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
          and o.fecha_programada is not null and o.fecha_programada < current_date) as vencida
  from public.ordenes_trabajo o
  left join public.ubicaciones u on u.id = o.ubicacion_id
  left join public.activos a     on a.id = o.activo_id
  left join public.perfiles pa   on pa.id = o.asignado_a
  left join public.perfiles pv   on pv.id = o.validado_por;

create view public.v_expediente_activo with (security_invoker = true) as
select a.*,
       u.nombre  as ubicacion_nombre,
       p.nombre  as padre_nombre,
       r.nombre  as responsable_nombre,
       (select count(*) from public.activos h where h.padre_id = a.id)::integer as componentes,
       (select count(*) from public.ordenes_trabajo o where o.activo_id = a.id)::integer as ots_total,
       (select count(*) from public.ordenes_trabajo o
         where o.activo_id = a.id and o.estado not in ('completada','cancelada'))::integer as ots_abiertas,
       (a.estado <> 'baja' and a.proximo_mantenimiento is not null
          and a.proximo_mantenimiento < current_date) as mantenimiento_vencido
  from public.activos a
  left join public.ubicaciones u on u.id = a.ubicacion_id
  left join public.activos p     on p.id = a.padre_id
  left join public.perfiles r    on r.id = a.responsable_id;

-- ------------------------------------------------------------------ búsqueda remota
-- Para los combos: 10 resultados, nunca la tabla entera. Tablas permitidas por lista cerrada.
-- Siempre dentro del sector activo: un combo nunca ofrece registros de otro sector, ni con "ver todos".
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

  elsif p_tabla = 'plantillas_ot' then
    return query
      select t.id, t.nombre, t.titulo
        from public.plantillas_ot t
       where t.sector_id = public.sector_efectivo() and (t.nombre ilike v_q or t.titulo ilike v_q)
       order by t.nombre limit 10;

  elsif p_tabla = 'contratos' then
    -- La tabla contratos llega con la fase 4; esta rama se resuelve recién al ejecutarse.
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

-- ------------------------------------------------------------------ permisos
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
