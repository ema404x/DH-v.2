-- =====================================================================================
-- DH1 v2 · Fase 15 · Órdenes de trabajo: estado "Obra" y firma de conformidad (como la v1) — 7/10/2026
-- Va después de la fase 14. Se puede correr más de una vez.
--
--   1. Estado "obra" (Futura Obra de la v1). Desde cualquier estado abierto, gerencia o un jefe de sitio la pasa a
--      "obra" (con convertir_ot_en_obra, que además crea el pendiente de tipo obra, como el botón "Obra" de la v1).
--      Desde "obra": se completa (gerencia/jefe; mismas condiciones que al finalizar: checklist completo o el motivo,
--      y fotos si las pide) o se cancela. No es un estado de trabajo del operario: no aparece en "Mis Órdenes".
--   2. Firma de conformidad en la orden: imagen (PNG en data URL), nombre de quien firma y fecha (la pone la base).
--      La carga quien puede editar la orden; con la orden cerrada no cambia (regla que ya existía).
--   3. v_ordenes se vuelve a crear para que traiga las columnas nuevas.
-- =====================================================================================

-- ------------------------------------------------------------------ 1. estado obra
-- Agregar un valor a un enum puede ir dentro de la misma tanda; las funciones lo usan recién al ejecutarse.
alter type public.ot_estado add value if not exists 'obra';

-- ------------------------------------------------------------------ 2. firma
alter table public.ordenes_trabajo add column if not exists firma_url    text;
alter table public.ordenes_trabajo add column if not exists firma_nombre text;
alter table public.ordenes_trabajo add column if not exists firma_at     timestamptz;
alter table public.ordenes_trabajo drop constraint if exists ordenes_trabajo_firma_chk;
alter table public.ordenes_trabajo add constraint ordenes_trabajo_firma_chk
  check (firma_url is null or (firma_url like 'data:image/%' and length(firma_url) <= 400000));

-- ------------------------------------------------------------------ 3. transiciones
create or replace function public.validar_transicion_ot() returns trigger
language plpgsql set search_path = public as $$
declare
  v_valida boolean;
begin
  new.updated_at := now();
  -- La fecha de la firma la pone la base (también para el servicio).
  if new.firma_url is distinct from old.firma_url then
    new.firma_at := case when new.firma_url is null then null else now() end;
    if new.firma_url is null then new.firma_nombre := null; end if;
  end if;
  if public.es_servicio() or public.dh1_flag('dh1.sys_fn') then
    return new;
  end if;

  v_valida := public.puede_validar();

  -- El operario carga la ejecución (checklist, notas, motivos, faltantes, horas, GPS, firma).
  -- Los datos de la orden en sí solo los cambia gerencia o el jefe de sitio.
  if not v_valida then
    if new.titulo is distinct from old.titulo
       or new.descripcion is distinct from old.descripcion
       or new.tipo is distinct from old.tipo
       or new.prioridad is distinct from old.prioridad
       or new.ubicacion_id is distinct from old.ubicacion_id
       or new.activo_id is distinct from old.activo_id
       or new.fecha_programada is distinct from old.fecha_programada
       or new.horas_estimadas is distinct from old.horas_estimadas
       or new.requiere_fotos is distinct from old.requiere_fotos
       or new.rechazo_comentario is distinct from old.rechazo_comentario
       or new.asignado_a is distinct from old.asignado_a then
      raise exception 'Solo gerencia o un jefe de sitio pueden cambiar los datos de la orden.'
        using errcode = 'P0001';
    end if;
  end if;

  if new.estado = old.estado then
    if old.estado in ('completada','cancelada') then
      raise exception 'La orden está cerrada. No se puede modificar.' using errcode = 'P0001';
    end if;
    -- Asignar una orden pendiente la pasa a "asignada"; desasignarla la devuelve a "pendiente".
    if v_valida and old.estado = 'pendiente' and new.asignado_a is not null then
      new.estado := 'asignada';
    elsif v_valida and old.estado = 'asignada' and new.asignado_a is null then
      new.estado := 'pendiente';
    end if;
  else
    if old.estado = 'pendiente' and new.estado = 'asignada' then
      if not v_valida then
        raise exception 'Solo gerencia o un jefe de sitio pueden asignar la orden.' using errcode = 'P0001';
      end if;
      if new.asignado_a is null then
        raise exception 'Para asignar la orden hay que elegir a quién.' using errcode = 'P0001';
      end if;

    elsif old.estado = 'asignada' and new.estado = 'pendiente' then
      if not v_valida then
        raise exception 'Solo gerencia o un jefe de sitio pueden desasignar la orden.' using errcode = 'P0001';
      end if;
      new.asignado_a := null;

    elsif old.estado in ('pendiente','asignada') and new.estado = 'en_progreso' then
      -- Iniciar: cualquiera del sector. Queda asignado solo si la orden estaba libre.
      if new.asignado_a is null then
        new.asignado_a := auth.uid();
      end if;
      new.fecha_inicio_real := coalesce(old.fecha_inicio_real, now());

    elsif old.estado = 'en_progreso' and new.estado = 'pendiente_validacion' then
      -- Finalizar: checklist completo, o decir por qué no se pudo.
      if exists (select 1 from jsonb_array_elements(new.checklist) e
                  where coalesce((e ->> 'hecho')::boolean, false) = false)
         and jsonb_array_length(new.motivos_incompleto) = 0 then
        raise exception 'Faltan tareas del checklist. Marcalas o indicá por qué no se pudieron hacer.'
          using errcode = 'P0001';
      end if;
      if new.requiere_fotos and not exists (select 1 from public.ot_fotos f where f.ot_id = new.id) then
        raise exception 'Esta orden pide fotos. Subí al menos una antes de finalizar.' using errcode = 'P0001';
      end if;
      new.fecha_fin_real := now();
      new.rechazo_comentario := null;

    elsif old.estado = 'pendiente_validacion' and new.estado = 'completada' then
      if not v_valida then
        raise exception 'Solo gerencia o un jefe de sitio pueden aprobar la orden.' using errcode = 'P0001';
      end if;
      new.validado_por := auth.uid();
      new.fecha_validacion := now();

    elsif old.estado = 'pendiente_validacion' and new.estado = 'en_progreso' then
      if not v_valida then
        raise exception 'Solo gerencia o un jefe de sitio pueden rechazar la orden.' using errcode = 'P0001';
      end if;
      if coalesce(btrim(new.rechazo_comentario), '') = '' then
        raise exception 'Para rechazar la orden hay que escribir el motivo.' using errcode = 'P0001';
      end if;
      new.fecha_fin_real := null;

    -- Futura Obra (v1): desde cualquier estado abierto.
    elsif new.estado::text = 'obra' and old.estado::text not in ('completada','cancelada','obra') then
      if not v_valida then
        raise exception 'Solo gerencia o un jefe de sitio pueden convertir la orden en obra.' using errcode = 'P0001';
      end if;

    -- Cerrar una obra: con las mismas condiciones que finalizar (o el motivo de lo que quedó sin hacer).
    elsif old.estado::text = 'obra' and new.estado = 'completada' then
      if not v_valida then
        raise exception 'Solo gerencia o un jefe de sitio pueden completar la obra.' using errcode = 'P0001';
      end if;
      if jsonb_array_length(new.motivos_incompleto) = 0 then
        if exists (select 1 from jsonb_array_elements(new.checklist) e
                    where coalesce((e ->> 'hecho')::boolean, false) = false) then
          raise exception 'Faltan tareas del checklist. Marcalas o indicá por qué no se pudieron hacer.'
            using errcode = 'P0001';
        end if;
        if new.requiere_fotos and not exists (select 1 from public.ot_fotos f where f.ot_id = new.id) then
          raise exception 'Esta orden pide fotos. Subí al menos una antes de completarla.' using errcode = 'P0001';
        end if;
      end if;
      new.fecha_fin_real := coalesce(new.fecha_fin_real, now());
      new.validado_por := auth.uid();
      new.fecha_validacion := now();

    elsif new.estado = 'cancelada' and old.estado not in ('completada','cancelada') then
      if not v_valida then
        raise exception 'Solo gerencia o un jefe de sitio pueden cancelar la orden.' using errcode = 'P0001';
      end if;

    else
      raise exception 'Una orden % no puede pasar a %.',
        replace(old.estado::text, '_', ' '), replace(new.estado::text, '_', ' ')
        using errcode = 'P0001';
    end if;
  end if;

  -- Estos campos los dispone la base, nunca el cliente.
  new.numero := old.numero;
  new.codigo := old.codigo;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.estado <> 'completada' then
    new.validado_por := old.validado_por;
    new.fecha_validacion := old.fecha_validacion;
  end if;
  return new;
end $$;

-- El botón "Obra" de la v1: crea el pendiente de tipo obra y pasa la orden a "obra", todo junto.
create or replace function public.convertir_ot_en_obra(p_ot uuid) returns uuid
language plpgsql set search_path = public as $$
declare
  o    public.ordenes_trabajo%rowtype;
  u    public.ubicaciones%rowtype;
  v_id uuid;
  v_mats text;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden convertir la orden en obra.' using errcode = 'P0001';
  end if;
  select * into o from public.ordenes_trabajo where id = p_ot for update;
  if not found then
    raise exception 'Orden de trabajo no encontrada.' using errcode = 'P0001';
  end if;
  if o.estado::text in ('completada','cancelada','obra') then
    raise exception 'No se puede convertir: la orden está %.', replace(o.estado::text, '_', ' ') using errcode = 'P0001';
  end if;
  if o.ubicacion_id is not null then
    select * into u from public.ubicaciones where id = o.ubicacion_id;
  end if;
  select string_agg(nullif(m.descripcion, ''), ', ' order by m.created_at) into v_mats
    from public.v_ot_materiales m where m.ot_id = p_ot;

  insert into public.pendientes (sector_id, descripcion, tipo, estado, prioridad, ubicacion_id, sitio,
                                 activo_nombre, materiales_necesarios, observaciones, fecha_limite)
  values (o.sector_id, o.titulo, 'obra', 'pendiente', o.prioridad, o.ubicacion_id,
          nullif(concat_ws(' · ', u.nombre, u.direccion), ''),
          (select a.nombre from public.activos a where a.id = o.activo_id),
          v_mats, o.descripcion, o.fecha_programada)
  returning id into v_id;

  update public.ordenes_trabajo set estado = 'obra'::public.ot_estado where id = p_ot;
  return v_id;
end $$;

-- ------------------------------------------------------------------ 4. vista (trae las columnas nuevas)
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

-- ------------------------------------------------------------------ permisos
grant select on public.v_ordenes to authenticated;
grant all on public.v_ordenes to service_role;
revoke execute on function public.convertir_ot_en_obra(uuid) from public, anon;
grant  execute on function public.convertir_ot_en_obra(uuid) to authenticated, service_role;
