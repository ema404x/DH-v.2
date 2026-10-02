-- =====================================================================================
-- DH1 v2 — Fase 12 (tanda 6): administración y lo que faltaba
--
--   1. Control de riesgos: la matriz de riesgos por sector (probabilidad × consecuencia), ahora editable
--   2. Foro: hilos, anuncios y respuestas del sector, con "no leídos" por persona (en la v1 cada uno veía solo sus
--      propios hilos y el moderador era un correo escrito en el código)
--   3. Sugerencias y problemas: lo que la gente reporta queda guardado y lo atiende un admin (en la v1 se mandaba un
--      mail a una casilla personal y no quedaba registro)
--   4. Búsqueda global (Ctrl+K) en todo el sector, con enlace al registro (en la v1 llevaba a la lista)
--   5. Resumen del sector para la pantalla de sectores
--
-- Se corre después de la fase 11. Es aditiva.
-- =====================================================================================

-- =====================================================================================
-- 1. CONTROL DE RIESGOS
-- =====================================================================================
create table public.riesgos (
  id             uuid primary key default gen_random_uuid(),
  sector_id      uuid not null references public.sectores(id),
  numero         integer,
  evento         text not null check (btrim(evento) <> ''),
  -- 1 muy baja · 2 baja · 3 media · 4 alta · 5 muy alta
  probabilidad   smallint not null check (probabilidad between 1 and 5),
  -- 1 mínima · 2 menor · 4 moderada · 8 mayor · 16 máxima
  consecuencia   smallint not null check (consecuencia in (1, 2, 4, 8, 16)),
  nivel          smallint generated always as (probabilidad * consecuencia) stored,
  -- MP mantenimiento preventivo · MC correctivo · MT técnico/legal (la planilla de la v1)
  metodo_control text,
  frecuencia     text,
  en_alcance     boolean not null default true,
  estado         text not null default 'activo' check (estado in ('activo','en_control','resuelto')),
  responsable_id uuid references public.perfiles(id) on delete set null,
  comentarios    text,
  id_origen      text unique,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, sector_id)
);
create index riesgos_sector_idx on public.riesgos(sector_id, nivel desc);
select public.aplicar_rls_sector('public.riesgos');
create trigger b_rol before insert or update or delete on public.riesgos
  for each row execute function public.exigir_rol('validar');
create trigger c_updated before update on public.riesgos
  for each row execute function public.tocar_updated_at();

-- Clasificación (la de la planilla de la v1): aceptable < 4 · tolerable 4 a 15 · alto 16 a 31 · extremo 32 o más.
create view public.v_riesgos with (security_invoker = true) as
select r.*,
       case when r.nivel < 4 then 'aceptable' when r.nivel < 16 then 'tolerable' when r.nivel < 32 then 'alto' else 'extremo' end as clase,
       p.nombre as responsable_nombre
  from public.riesgos r
  left join public.perfiles p on p.id = r.responsable_id;

-- =====================================================================================
-- 2. FORO
-- =====================================================================================
create table public.foro_hilos (
  id          uuid primary key default gen_random_uuid(),
  sector_id   uuid not null references public.sectores(id),
  titulo      text not null check (btrim(titulo) <> ''),
  cuerpo      text not null check (btrim(cuerpo) <> ''),
  categoria   text not null default 'general',
  tipo        text not null default 'hilo' check (tipo in ('hilo','anuncio')),
  fijado      boolean not null default false,
  cerrado     boolean not null default false,
  autor_id    uuid references public.perfiles(id) on delete set null default auth.uid(),
  ultima_actividad timestamptz not null default now(),
  id_origen   text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, sector_id)
);
create index foro_hilos_idx on public.foro_hilos(sector_id, fijado desc, ultima_actividad desc);
select public.aplicar_rls_sector('public.foro_hilos');

create table public.foro_respuestas (
  id          uuid primary key default gen_random_uuid(),
  sector_id   uuid not null references public.sectores(id),
  hilo_id     uuid not null,
  cuerpo      text not null check (btrim(cuerpo) <> ''),
  autor_id    uuid references public.perfiles(id) on delete set null default auth.uid(),
  editado     boolean not null default false,
  id_origen   text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (hilo_id, sector_id) references public.foro_hilos(id, sector_id) on delete cascade
);
create index foro_respuestas_idx on public.foro_respuestas(hilo_id, created_at);
select public.aplicar_rls_sector('public.foro_respuestas');

-- Hasta cuándo leyó cada uno cada hilo (para marcar lo nuevo).
create table public.foro_lecturas (
  sector_id  uuid not null references public.sectores(id),
  perfil_id  uuid not null references public.perfiles(id) on delete cascade default auth.uid(),
  hilo_id    uuid not null,
  leido_at   timestamptz not null default now(),
  primary key (perfil_id, hilo_id),
  foreign key (hilo_id, sector_id) references public.foro_hilos(id, sector_id) on delete cascade
);
select public.aplicar_rls_sector('public.foro_lecturas');

-- Reglas: cualquiera del sector abre hilos y responde; los anuncios, fijar y cerrar son de gerencia; cada uno edita
-- y borra lo suyo, gerencia modera todo. En un hilo cerrado no se responde.
create or replace function public.validar_foro_hilo() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.sys_fn') then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if not (public.es_gerencia() or old.autor_id = auth.uid()) then
      raise exception 'Un hilo lo borra quien lo escribió o gerencia.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.autor_id := auth.uid();
    new.ultima_actividad := now();
    if (new.tipo = 'anuncio' or new.fijado or new.cerrado) and not public.es_gerencia() then
      raise exception 'Los anuncios, fijar y cerrar son de gerencia.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  new.autor_id := old.autor_id; new.created_at := old.created_at; new.updated_at := now();
  if (new.tipo, new.fijado, new.cerrado) is distinct from (old.tipo, old.fijado, old.cerrado) and not public.es_gerencia() then
    raise exception 'Los anuncios, fijar y cerrar son de gerencia.' using errcode = 'P0001';
  end if;
  if (new.titulo, new.cuerpo, new.categoria) is distinct from (old.titulo, old.cuerpo, old.categoria)
     and not (public.es_gerencia() or old.autor_id = auth.uid()) then
    raise exception 'Un hilo lo edita quien lo escribió o gerencia.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger b_validar before insert or update or delete on public.foro_hilos
  for each row execute function public.validar_foro_hilo();

create or replace function public.validar_foro_respuesta() returns trigger
language plpgsql set search_path = public as $$
declare
  v_cerrado boolean;
  v_prev text;
begin
  if public.es_servicio() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if not (public.es_gerencia() or old.autor_id = auth.uid()) then
      raise exception 'Una respuesta la borra quien la escribió o gerencia.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    select h.cerrado into v_cerrado from public.foro_hilos h where h.id = new.hilo_id;
    if v_cerrado then
      raise exception 'El hilo está cerrado: ya no admite respuestas.' using errcode = 'P0001';
    end if;
    new.autor_id := auth.uid();
    new.editado := false;
    v_prev := current_setting('dh1.sys_fn', true);
    perform set_config('dh1.sys_fn', '1', true);
    update public.foro_hilos set ultima_actividad = now() where id = new.hilo_id;
    perform set_config('dh1.sys_fn', coalesce(v_prev, ''), true);
    return new;
  end if;
  if old.autor_id is distinct from auth.uid() and not public.es_gerencia() then
    raise exception 'Una respuesta la edita quien la escribió o gerencia.' using errcode = 'P0001';
  end if;
  new.autor_id := old.autor_id; new.hilo_id := old.hilo_id; new.created_at := old.created_at;
  new.updated_at := now(); new.editado := true;
  return new;
end $$;
create trigger b_validar before insert or update or delete on public.foro_respuestas
  for each row execute function public.validar_foro_respuesta();

create or replace function public.preparar_foro_lectura() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.es_servicio() then new.perfil_id := auth.uid(); end if;
  return new;
end $$;
create trigger b_preparar before insert or update on public.foro_lecturas
  for each row execute function public.preparar_foro_lectura();

create view public.v_foro_hilos with (security_invoker = true) as
select h.*, p.nombre as autor_nombre,
       (select count(*) from public.foro_respuestas r where r.hilo_id = h.id)::integer as respuestas,
       (select max(r.created_at) from public.foro_respuestas r where r.hilo_id = h.id) as ultima_respuesta,
       l.leido_at,
       (l.leido_at is null or l.leido_at < h.ultima_actividad) as no_leido
  from public.foro_hilos h
  left join public.perfiles p on p.id = h.autor_id
  left join public.foro_lecturas l on l.hilo_id = h.id and l.perfil_id = auth.uid();

create view public.v_foro_respuestas with (security_invoker = true) as
select r.*, p.nombre as autor_nombre, p.rol::text as autor_rol
  from public.foro_respuestas r
  left join public.perfiles p on p.id = r.autor_id;

-- =====================================================================================
-- 3. SUGERENCIAS Y PROBLEMAS
-- =====================================================================================
create table public.sugerencias (
  id          uuid primary key default gen_random_uuid(),
  sector_id   uuid not null references public.sectores(id),
  tipo        text not null default 'problema' check (tipo in ('problema','sugerencia','pregunta','otro')),
  titulo      text not null check (btrim(titulo) <> '' and length(titulo) <= 120),
  descripcion text not null check (btrim(descripcion) <> '' and length(descripcion) <= 4000),
  pagina      text,
  navegador   text,
  estado      text not null default 'nueva' check (estado in ('nueva','vista','resuelta','descartada')),
  respuesta   text,
  autor_id    uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index sugerencias_idx on public.sugerencias(sector_id, estado, created_at desc);
select public.aplicar_rls_sector('public.sugerencias');

-- Cada uno ve y carga lo suyo; el admin ve todas las del sector y las responde.
create or replace function public.validar_sugerencia() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    new.autor_id := auth.uid(); new.estado := 'nueva'; new.respuesta := null;
    return new;
  end if;
  if public.rol_actual() <> 'admin' then
    raise exception 'Las sugerencias las atiende un admin.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.autor_id := old.autor_id; new.titulo := old.titulo; new.descripcion := old.descripcion; new.tipo := old.tipo;
  new.created_at := old.created_at; new.updated_at := now();
  return new;
end $$;
create trigger b_validar before insert or update or delete on public.sugerencias
  for each row execute function public.validar_sugerencia();

create view public.v_sugerencias with (security_invoker = true) as
select s.*, p.nombre as autor_nombre
  from public.sugerencias s
  left join public.perfiles p on p.id = s.autor_id
 where s.autor_id = auth.uid() or public.rol_actual() = 'admin';

-- =====================================================================================
-- 4. BÚSQUEDA GLOBAL
-- =====================================================================================
-- Hasta 5 resultados por tipo, con el enlace al registro. Respeta la RLS (security invoker).
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
  (select 'material', m.id, m.nombre, concat_ws(' · ', m.codigo, 'stock ' || trim_scale(m.stock) || ' ' || m.unidad), '/gestion/panol'
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

-- =====================================================================================
-- 5. RESUMEN DEL SECTOR (pantalla de sectores, solo admin)
-- =====================================================================================
create or replace function public.resumen_sector() returns jsonb
language plpgsql stable set search_path = public as $$
begin
  if public.rol_actual() is distinct from 'admin' then
    raise exception 'El resumen de sectores es para el admin.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'usuarios', (select count(*) from public.perfiles p where p.sector_id = public.sector_efectivo() and p.activo),
    'ubicaciones', (select count(*) from public.ubicaciones),
    'activos', (select count(*) from public.activos),
    'ordenes', (select count(*) from public.ordenes_trabajo),
    'ordenes_abiertas', (select count(*) from public.ordenes_trabajo where estado not in ('completada','cancelada')),
    'pendientes', (select count(*) from public.pendientes),
    'empleados', (select count(*) from public.empleados),
    'obras', (select count(*) from public.obras),
    'contratos', (select count(*) from public.contratos),
    'materiales', (select count(*) from public.materiales)
  );
end $$;

-- Auditoría de lo nuevo que importa
create trigger zz_auditar after insert or update or delete on public.riesgos
  for each row execute function public.auditar('evento');

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
revoke update, delete on public.auditoria from authenticated;
