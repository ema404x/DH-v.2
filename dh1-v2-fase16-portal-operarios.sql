-- DH1 v2 — Fase 16: portal de operarios sin usuario (opción C de PROPUESTA-portales-sin-login.md,
-- decisión de Emanuel del 19/10/2026). Reabre a pedido suyo "todo con login" (§2 bis) SOLO para esto:
-- desde el QR de un lugar o equipo, con la clave compartida del sector y el nombre, ver sus órdenes,
-- iniciarlas, subir fotos y finalizarlas. Nada más (ni aprobar, ni gestión, ni otros lugares).
--
-- Cómo se mantiene la regla de la base:
--   * Cada sector tiene un usuario "Portal QR" (rol operario, nunca ingresa a la app). Las funciones de
--     abajo actúan COMO ese usuario (auth.uid() = el del portal): la máquina de estados, el checklist
--     obligatorio, las fotos y el sector los controla la base igual que para cualquier operario.
--   * Solo las llama la edge function `portal-operarios` (rol service_role). anon y authenticated no
--     pueden ejecutarlas.
--   * Cada función revisa que la orden sea del lugar o equipo del QR que abrió el pase.
--   * La clave se guarda con sal y hash; 5 intentos fallidos por IP en 15 minutos bloquean.
--   * El pase dura 12 h; cada acción queda registrada con el nombre tipeado y la IP.
-- Se corre después de la fase 15. Repetible.

-- ------------------------------------------------------------------ 1. tablas
create table if not exists public.portal_config (
  sector_id  uuid primary key references public.sectores(id),
  perfil_id  uuid not null references public.perfiles(id),
  clave_sal  text not null,
  clave_hash text not null,
  activo     boolean not null default true,
  -- Los pases creados antes de esta hora no sirven más (se cambió la clave o se apagó el portal).
  cortes_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.portal_config enable row level security;
-- Solo el admin de su sector, y por set_portal_operarios(). El hash y la sal no se leen por la API:
-- se da permiso de lectura solo a las otras columnas.
drop policy if exists portal_config_admin on public.portal_config;
create policy portal_config_admin on public.portal_config for all to authenticated
  using (sector_id = public.sector_efectivo() and coalesce(public.rol_actual()::text, '') = 'admin')
  with check (sector_id = public.sector_efectivo() and coalesce(public.rol_actual()::text, '') = 'admin');
revoke all on public.portal_config from anon, authenticated;
grant select (sector_id, perfil_id, activo, cortes_at, updated_at, updated_by) on public.portal_config to authenticated;
grant insert, update on public.portal_config to authenticated;

create table if not exists public.portal_intentos (
  id     bigint generated always as identity primary key,
  ip     text not null,
  token  text not null,
  ok     boolean not null,
  at     timestamptz not null default now()
);
create index if not exists portal_intentos_ip_idx on public.portal_intentos(ip, at);
alter table public.portal_intentos enable row level security;
revoke all on public.portal_intentos from anon, authenticated;

create table if not exists public.portal_pases (
  hash         text primary key,
  sector_id    uuid not null references public.sectores(id),
  ubicacion_id uuid references public.ubicaciones(id) on delete cascade,
  activo_id    uuid references public.activos(id) on delete cascade,
  nombre       text not null,
  ip           text not null,
  creado       timestamptz not null default now(),
  expira       timestamptz not null default now() + interval '12 hours',
  check ((ubicacion_id is null) <> (activo_id is null))
);
alter table public.portal_pases enable row level security;
revoke all on public.portal_pases from anon, authenticated;

-- Registro de lo hecho desde el portal. Lo lee gerencia de su sector.
create table if not exists public.portal_acciones (
  id        bigint generated always as identity primary key,
  sector_id uuid not null references public.sectores(id),
  ot_id     uuid references public.ordenes_trabajo(id) on delete set null,
  accion    text not null check (accion in ('entrar','iniciar','foto','finalizar')),
  nombre    text not null,
  ip        text not null,
  at        timestamptz not null default now()
);
create index if not exists portal_acciones_sector_idx on public.portal_acciones(sector_id, at desc);
alter table public.portal_acciones enable row level security;
drop policy if exists portal_acciones_leer on public.portal_acciones;
create policy portal_acciones_leer on public.portal_acciones for select to authenticated
  using (sector_id = public.sector_efectivo() and public.es_gerencia());
revoke insert, update, delete on public.portal_acciones from anon, authenticated;
grant select on public.portal_acciones to authenticated;

-- Quién la trabaja desde el portal (el nombre que tipeó). Lo pone la base al iniciar desde el portal.
alter table public.ordenes_trabajo add column if not exists portal_nombre text;

-- ------------------------------------------------------------------ 2. configuración (solo admin)
create or replace function public.set_portal_operarios(p_perfil uuid, p_clave text, p_activo boolean default true)
returns void language plpgsql set search_path = public as $$
declare
  v_sector uuid := public.sector_efectivo();
  v_sal text;
begin
  if coalesce(public.rol_actual()::text, '') <> 'admin' then
    raise exception 'Solo un administrador configura el portal de operarios.' using errcode = 'P0001';
  end if;
  if v_sector is null then
    raise exception 'No se puede guardar sin sector.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.perfiles p where p.id = p_perfil and p.sector_id = v_sector and p.rol = 'operario' and p.activo) then
    raise exception 'El usuario del portal tiene que ser un operario activo de este sector.' using errcode = 'P0001';
  end if;
  if p_clave is not null and length(btrim(p_clave)) < 6 then
    raise exception 'La clave tiene que tener al menos 6 caracteres.' using errcode = 'P0001';
  end if;
  if p_clave is null and not exists (select 1 from public.portal_config c where c.sector_id = v_sector) then
    raise exception 'Poné una clave para el portal.' using errcode = 'P0001';
  end if;
  -- Cambiar la clave o apagar el portal corta los pases abiertos (cortes_at).
  if p_clave is null then
    update public.portal_config
       set perfil_id = p_perfil, activo = p_activo, updated_at = now(), updated_by = auth.uid(),
           cortes_at = case when p_activo then cortes_at else now() end
     where sector_id = v_sector;
  else
    v_sal := replace(gen_random_uuid()::text, '-', '');
    update public.portal_config
       set perfil_id = p_perfil, activo = p_activo, clave_sal = v_sal,
           clave_hash = encode(sha256(convert_to(v_sal || btrim(p_clave), 'UTF8')), 'hex'),
           cortes_at = now(), updated_at = now(), updated_by = auth.uid()
     where sector_id = v_sector;
    if not found then
      insert into public.portal_config (sector_id, perfil_id, clave_sal, clave_hash, activo)
      values (v_sector, p_perfil, v_sal, encode(sha256(convert_to(v_sal || btrim(p_clave), 'UTF8')), 'hex'), p_activo);
    end if;
  end if;
end $$;

-- Lo que el admin puede ver de la configuración (sin la clave).
create or replace function public.ver_portal_operarios() returns jsonb
language plpgsql stable set search_path = public as $$
begin
  if coalesce(public.rol_actual()::text, '') <> 'admin' then
    raise exception 'Solo un administrador configura el portal de operarios.' using errcode = 'P0001';
  end if;
  return (select jsonb_build_object('perfil_id', c.perfil_id, 'perfil_nombre', p.nombre, 'activo', c.activo, 'updated_at', c.updated_at)
            from public.portal_config c join public.perfiles p on p.id = c.perfil_id
           where c.sector_id = public.sector_efectivo());
end $$;

-- ------------------------------------------------------------------ 3. ayudantes internos
-- Normaliza un nombre para compararlo (minúsculas, sin acentos ni espacios de más).
create or replace function public.portal_norm(p text) returns text
language sql immutable as $$
  select lower(regexp_replace(translate(btrim(coalesce(p, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g'))
$$;

-- Valida el pase y deja la transacción actuando como el usuario del portal del sector.
create or replace function public.portal_tomar(p_pase text) returns public.portal_pases
language plpgsql set search_path = public as $$
declare
  v public.portal_pases;
  v_perfil uuid;
begin
  if current_user <> 'service_role' and not public.es_servicio() then
    raise exception 'Solo el portal de operarios usa esta función.' using errcode = 'P0001';
  end if;
  select * into v from public.portal_pases
   where hash = encode(sha256(convert_to(coalesce(p_pase, ''), 'UTF8')), 'hex') and expira > now();
  if v.hash is null then
    raise exception 'Tu ingreso venció. Escaneá el QR y poné la clave de nuevo.' using errcode = 'P0001';
  end if;
  select c.perfil_id into v_perfil from public.portal_config c
   where c.sector_id = v.sector_id and c.activo and c.cortes_at < v.creado;
  if v_perfil is null then
    raise exception 'Tu ingreso venció. Escaneá el QR y poné la clave de nuevo.' using errcode = 'P0001';
  end if;
  perform set_config('request.jwt.claim.sub', v_perfil::text, true);
  return v;
end $$;

-- La orden tiene que ser del lugar o del equipo del QR.
create or replace function public.portal_orden(v public.portal_pases, p_ot uuid) returns public.ordenes_trabajo
language plpgsql set search_path = public as $$
declare
  o public.ordenes_trabajo;
begin
  select * into o from public.ordenes_trabajo t
   where t.id = p_ot and t.sector_id = v.sector_id
     and ((v.ubicacion_id is not null and (t.ubicacion_id = v.ubicacion_id
            or t.activo_id in (select a.id from public.activos a where a.ubicacion_id = v.ubicacion_id)))
       or (v.activo_id is not null and t.activo_id = v.activo_id));
  if o.id is null then
    raise exception 'Esta orden no es de este lugar.' using errcode = 'P0001';
  end if;
  return o;
end $$;

create or replace function public.portal_registrar(v public.portal_pases, p_ot uuid, p_accion text) returns void
language sql set search_path = public as $$
  insert into public.portal_acciones (sector_id, ot_id, accion, nombre, ip) values (v.sector_id, p_ot, p_accion, v.nombre, v.ip)
$$;

-- ------------------------------------------------------------------ 4. lo que llama la edge function
-- Entrar: QR + clave + nombre → pase. Los errores de clave se devuelven (no se lanzan) para que el
-- intento fallido quede guardado y cuente para el bloqueo.
create or replace function public.portal_entrar(p_token text, p_clave text, p_nombre text, p_ip text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_ip text := left(coalesce(nullif(btrim(p_ip), ''), 'desconocida'), 64);
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_sector uuid; v_ubi uuid; v_act uuid; v_lugar text; v_dir text;
  c public.portal_config;
  v_pase text;
begin
  if current_user <> 'service_role' and not public.es_servicio() then
    raise exception 'Solo el portal de operarios usa esta función.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.portal_intentos i where i.ip = v_ip and not i.ok and i.at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('error', 'Demasiados intentos con la clave equivocada. Esperá 15 minutos.');
  end if;
  if length(v_nombre) < 3 or length(v_nombre) > 80 then
    return jsonb_build_object('error', 'Ingresá tu nombre y apellido para registrar tu trabajo.');
  end if;

  select u.sector_id, u.id, u.nombre, u.direccion into v_sector, v_ubi, v_lugar, v_dir
    from public.ubicaciones u where u.qr_token = p_token and u.activa;
  if v_sector is null then
    select a.sector_id, a.id, a.nombre, u.nombre into v_sector, v_act, v_lugar, v_dir
      from public.activos a left join public.ubicaciones u on u.id = a.ubicacion_id where a.qr_token = p_token;
  end if;
  select * into c from public.portal_config where sector_id = v_sector;

  if v_sector is null or c.sector_id is null or not c.activo
     or c.clave_hash <> encode(sha256(convert_to(c.clave_sal || btrim(coalesce(p_clave, '')), 'UTF8')), 'hex') then
    insert into public.portal_intentos (ip, token, ok) values (v_ip, left(coalesce(p_token, ''), 80), false);
    if v_sector is not null and c.sector_id is not null and not c.activo then
      return jsonb_build_object('error', 'El portal de operarios está apagado. Consultá con tu supervisor.');
    end if;
    -- Mismo mensaje para QR inexistente y clave equivocada: no se revela qué lugares existen.
    return jsonb_build_object('error', 'Clave incorrecta. Consultá con tu supervisor.');
  end if;

  insert into public.portal_intentos (ip, token, ok) values (v_ip, left(p_token, 80), true);
  delete from public.portal_intentos where at < now() - interval '1 day';
  delete from public.portal_pases where expira < now();
  v_pase := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.portal_pases (hash, sector_id, ubicacion_id, activo_id, nombre, ip)
  values (encode(sha256(convert_to(v_pase, 'UTF8')), 'hex'), v_sector, v_ubi, v_act, v_nombre, v_ip);
  insert into public.portal_acciones (sector_id, accion, nombre, ip) values (v_sector, 'entrar', v_nombre, v_ip);
  return jsonb_build_object('pase', v_pase, 'nombre', v_nombre,
    'lugar', jsonb_build_object('tipo', case when v_ubi is not null then 'ubicacion' else 'activo' end, 'nombre', v_lugar, 'direccion', v_dir));
end $$;

-- Las órdenes del lugar: abiertas, en validación y las completadas de los últimos 30 días.
create or replace function public.portal_ordenes(p_pase text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v public.portal_pases := public.portal_tomar(p_pase);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'codigo', t.codigo, 'titulo', t.titulo, 'descripcion', t.descripcion, 'tipo', t.tipo,
             'prioridad', t.prioridad, 'estado', t.estado, 'checklist', t.checklist, 'requiere_fotos', t.requiere_fotos,
             'portal_nombre', t.portal_nombre, 'asignado_nombre', p.nombre, 'fecha_programada', t.fecha_programada,
             'fotos', coalesce((select jsonb_agg(f.url order by f.created_at) from public.ot_fotos f where f.ot_id = t.id), '[]'::jsonb))
           order by case t.estado when 'en_progreso' then 0 when 'asignada' then 1 when 'pendiente' then 2 when 'pendiente_validacion' then 3 else 4 end,
                    case t.prioridad when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end, t.created_at)
      from public.ordenes_trabajo t
      left join public.perfiles p on p.id = t.asignado_a
     where t.sector_id = v.sector_id
       and ((v.ubicacion_id is not null and (t.ubicacion_id = v.ubicacion_id
              or t.activo_id in (select a.id from public.activos a where a.ubicacion_id = v.ubicacion_id)))
         or (v.activo_id is not null and t.activo_id = v.activo_id))
       and (t.estado in ('pendiente','asignada','en_progreso','pendiente_validacion')
            or (t.estado = 'completada' and t.fecha_validacion > now() - interval '30 days'))), '[]'::jsonb);
end $$;

create or replace function public.portal_iniciar(p_pase text, p_ot uuid, p_gps jsonb default null) returns jsonb
language plpgsql set search_path = public as $$
declare
  v public.portal_pases := public.portal_tomar(p_pase);
  o public.ordenes_trabajo := public.portal_orden(v, p_ot);
begin
  if o.estado not in ('pendiente','asignada') then
    raise exception 'Esta orden ya no está para empezar.' using errcode = 'P0001';
  end if;
  update public.ordenes_trabajo
     set estado = 'en_progreso', portal_nombre = v.nombre,
         gps_lat = coalesce((p_gps ->> 'lat')::double precision, gps_lat),
         gps_lng = coalesce((p_gps ->> 'lng')::double precision, gps_lng),
         gps_precision = coalesce((p_gps ->> 'precision')::double precision, gps_precision)
   where id = o.id;
  perform public.portal_registrar(v, o.id, 'iniciar');
  return jsonb_build_object('estado', 'en_progreso');
end $$;

-- Solo el que la empezó desde el portal (mismo nombre) la sigue: como canActOn de la v1.
create or replace function public.portal_propia(v public.portal_pases, o public.ordenes_trabajo) returns void
language plpgsql as $$
begin
  if o.estado <> 'en_progreso' then
    raise exception 'Esta orden no está en curso.' using errcode = 'P0001';
  end if;
  if public.portal_norm(o.portal_nombre) is distinct from public.portal_norm(v.nombre) then
    raise exception 'Esta orden la está haciendo %.', coalesce(o.portal_nombre, 'otra persona') using errcode = 'P0001';
  end if;
end $$;

-- Antes de subir: dónde va la foto (solo si la orden es del lugar y la está haciendo esta persona).
create or replace function public.portal_ruta_foto(p_pase text, p_ot uuid, p_foto uuid) returns text
language plpgsql set search_path = public as $$
declare
  v public.portal_pases := public.portal_tomar(p_pase);
  o public.ordenes_trabajo := public.portal_orden(v, p_ot);
begin
  perform public.portal_propia(v, o);
  return v.sector_id::text || '/' || o.id::text || '/' || p_foto::text || '.jpg';
end $$;

-- La edge function ya subió el archivo a <sector>/<orden>/<id>.jpg; acá se registra.
create or replace function public.portal_foto(p_pase text, p_ot uuid, p_foto uuid, p_path text, p_url text) returns void
language plpgsql set search_path = public as $$
declare
  v public.portal_pases := public.portal_tomar(p_pase);
  o public.ordenes_trabajo := public.portal_orden(v, p_ot);
begin
  perform public.portal_propia(v, o);
  if p_path <> v.sector_id::text || '/' || o.id::text || '/' || p_foto::text || '.jpg' then
    raise exception 'La foto no corresponde a esta orden.' using errcode = 'P0001';
  end if;
  -- Reenviar la misma foto (se perdió la respuesta) no duplica; un id de otra foto es un error.
  if exists (select 1 from public.ot_fotos f where f.id = p_foto) then
    if not exists (select 1 from public.ot_fotos f where f.id = p_foto and f.ot_id = o.id and f.path = p_path) then
      raise exception 'La foto no corresponde a esta orden.' using errcode = 'P0001';
    end if;
    return;
  end if;
  insert into public.ot_fotos (id, ot_id, path, url) values (p_foto, o.id, p_path, p_url);
  perform public.portal_registrar(v, o.id, 'foto');
end $$;

-- Finalizar: se marcan las tareas (por id, sin tocar el texto), el motivo de lo que no se hizo,
-- notas y firma. El checklist y las fotos los controla la base (validar_transicion_ot).
create or replace function public.portal_finalizar(p_pase text, p_ot uuid, p_hechas text[], p_motivo text,
  p_notas text, p_firma_url text, p_firma_nombre text, p_gps jsonb default null) returns jsonb
language plpgsql set search_path = public as $$
declare
  v public.portal_pases := public.portal_tomar(p_pase);
  o public.ordenes_trabajo := public.portal_orden(v, p_ot);
  v_check jsonb;
begin
  perform public.portal_propia(v, o);
  select coalesce(jsonb_agg(case when e ->> 'id' = any(coalesce(p_hechas, '{}')) then jsonb_set(e, '{hecho}', 'true') else e end order by n), '[]'::jsonb)
    into v_check from jsonb_array_elements(o.checklist) with ordinality as x(e, n);
  update public.ordenes_trabajo
     set checklist = v_check,
         motivos_incompleto = case when coalesce(btrim(p_motivo), '') = '' then motivos_incompleto
                                   else motivos_incompleto || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'texto', btrim(p_motivo))) end,
         notas = case when coalesce(btrim(p_notas), '') = '' then notas
                      else concat_ws(E'\n', notas, '[Portal · ' || v.nombre || '] ' || btrim(p_notas)) end,
         firma_url = coalesce(nullif(p_firma_url, ''), firma_url),
         firma_nombre = case when nullif(p_firma_url, '') is not null then coalesce(nullif(btrim(p_firma_nombre), ''), v.nombre) else firma_nombre end,
         gps_lat = coalesce((p_gps ->> 'lat')::double precision, gps_lat),
         gps_lng = coalesce((p_gps ->> 'lng')::double precision, gps_lng),
         gps_precision = coalesce((p_gps ->> 'precision')::double precision, gps_precision),
         estado = 'pendiente_validacion'
   where id = o.id;
  perform public.portal_registrar(v, o.id, 'finalizar');
  return jsonb_build_object('estado', 'pendiente_validacion');
end $$;

-- ------------------------------------------------------------------ 5. permisos
-- Las del portal solo para service_role (la edge function). Las de configuración, para usuarios.
do $$
declare f text;
begin
  foreach f in array array[
    'portal_norm(text)', 'portal_tomar(text)', 'portal_orden(public.portal_pases, uuid)', 'portal_registrar(public.portal_pases, uuid, text)',
    'portal_propia(public.portal_pases, public.ordenes_trabajo)', 'portal_entrar(text, text, text, text)',
    'portal_ordenes(text)', 'portal_ruta_foto(text, uuid, uuid)', 'portal_iniciar(text, uuid, jsonb)', 'portal_foto(text, uuid, uuid, text, text)',
    'portal_finalizar(text, uuid, text[], text, text, text, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
grant all on public.portal_config, public.portal_intentos, public.portal_pases, public.portal_acciones to service_role;
revoke all on function public.set_portal_operarios(uuid, text, boolean) from public, anon;
grant execute on function public.set_portal_operarios(uuid, text, boolean) to authenticated;
revoke all on function public.ver_portal_operarios() from public, anon;
grant execute on function public.ver_portal_operarios() to authenticated;

-- ------------------------------------------------------------------ 6. v_ordenes con portal_nombre
-- o.* se fija al crear la vista: se vuelve a crear igual que en la fase 15.
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
grant select on public.v_ordenes to authenticated;
grant all on public.v_ordenes to service_role;
