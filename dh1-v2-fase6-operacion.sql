-- =====================================================================================
-- DH1 v2 — Fase 6: OPERACIÓN (tanda 1 de la paridad con la v1)
-- Información general (direcciones, jefes e inspectores), Pendientes SAP, Emergencias,
-- Rutinas, Calendario, Calefacción e Inspección de establecimientos.
-- Correr después de dh1-v2-fase5-migracion.sql.
--
-- Misma regla que el resto: cada tabla tiene sector_id y la política única de sector;
-- las reglas de negocio viven acá, no en la app. Lo que en la v1 se vinculaba por nombre escrito
-- (jefe de sitio, establecimiento) acá se vincula por id, y el nombre queda como dato de apoyo
-- para lo importado que todavía no se pudo enganchar.
-- =====================================================================================

-- ------------------------------------------------------------------ utilidades
create or replace function public.norm_txt(p text) returns text
language sql immutable as $$
  select lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')))
$$;

-- Usuario del sector activo con ese nombre. Null si no hay ninguno o si hay más de uno (no se adivina).
create or replace function public.perfil_por_nombre(p_nombre text) returns uuid
language sql stable set search_path = public as $$
  select case when count(*) = 1 then (array_agg(p.id))[1] end
    from public.perfiles p
   where p.activo and p.sector_id = public.sector_efectivo()
     and public.norm_txt(p.nombre) = public.norm_txt(p_nombre)
     and public.norm_txt(p_nombre) <> ''
$$;

-- Mantiene el nombre visible al lado del id: si hay usuario enganchado, el nombre es el del usuario.
create or replace function public.resolver_responsables() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.jefe_sitio_id is not null then
    select p.nombre into new.jefe_sitio_nombre from public.perfiles p where p.id = new.jefe_sitio_id;
  elsif tg_op = 'UPDATE' and old.jefe_sitio_id is not null
        and new.jefe_sitio_nombre is not distinct from old.jefe_sitio_nombre then
    new.jefe_sitio_nombre := null;
  end if;
  if tg_argv[0] = 'con_inspector' then
    if new.inspector_id is not null then
      select p.nombre into new.inspector_nombre from public.perfiles p where p.id = new.inspector_id;
    elsif tg_op = 'UPDATE' and old.inspector_id is not null
          and new.inspector_nombre is not distinct from old.inspector_nombre then
      new.inspector_nombre := null;
    end if;
  end if;
  return new;
end $$;

-- Zonas del sector (en escuelas: las comunas). Es configuración, no un enum fijo en el código.
update public.sectores
   set config = config || '{"zonas": ["8A", "8B", "10A"], "unidad": {"singular": "Escuela", "plural": "Escuelas"}}'::jsonb
 where clave = 'escuela' and not (config ? 'zonas');
update public.sectores
   set config = config || '{"zonas": [], "unidad": {"singular": "Activo", "plural": "Activos"}, "directorio": "activos"}'::jsonb
 where clave = 'bapro' and not (config ? 'unidad');

-- =====================================================================================
-- 1. INFORMACIÓN GENERAL: direcciones → ubicaciones
-- =====================================================================================
create table public.direcciones (
  id                 uuid primary key default gen_random_uuid(),
  sector_id          uuid not null references public.sectores(id),
  direccion          text not null,
  zona               text,
  jefe_sitio_id      uuid references public.perfiles(id) on delete set null,
  jefe_sitio_nombre  text,
  inspector_id       uuid references public.perfiles(id) on delete set null,
  inspector_nombre   text,
  m2                 numeric(12,2),
  sup                numeric(12,2),
  activa             boolean not null default true,
  notas              text,
  id_origen          text unique,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, sector_id)
);
create index direcciones_sector_idx on public.direcciones(sector_id, direccion);
select public.aplicar_rls_sector('public.direcciones');
create trigger b_rol before insert or update or delete on public.direcciones
  for each row execute function public.exigir_rol('gerencia');
create trigger c_responsables before insert or update on public.direcciones
  for each row execute function public.resolver_responsables('con_inspector');
create trigger d_updated before update on public.direcciones
  for each row execute function public.tocar_updated_at();

alter table public.ubicaciones
  add column direccion_id      uuid,
  add column jefe_sitio_nombre text,
  add column inspector_id      uuid references public.perfiles(id) on delete set null,
  add column inspector_nombre  text,
  add column elem_pep          text,
  add constraint ubicaciones_direccion_fk foreign key (direccion_id, sector_id)
    references public.direcciones(id, sector_id);
create index ubicaciones_direccion_idx on public.ubicaciones(direccion_id);

-- Una ubicación nueva dentro de una dirección hereda su jefe de sitio e inspector.
create or replace function public.heredar_de_direccion() returns trigger
language plpgsql set search_path = public as $$
declare
  d public.direcciones%rowtype;
begin
  if new.direccion_id is not null
     and (tg_op = 'INSERT' or new.direccion_id is distinct from old.direccion_id) then
    select * into d from public.direcciones x where x.id = new.direccion_id;
    if new.jefe_sitio_id is null and new.jefe_sitio_nombre is null then
      new.jefe_sitio_id := d.jefe_sitio_id;
      new.jefe_sitio_nombre := d.jefe_sitio_nombre;
    end if;
    if new.inspector_id is null and new.inspector_nombre is null then
      new.inspector_id := d.inspector_id;
      new.inspector_nombre := d.inspector_nombre;
    end if;
    new.zona := coalesce(new.zona, d.zona);
    new.direccion := coalesce(nullif(new.direccion, ''), d.direccion);
  end if;
  return new;
end $$;
create trigger b2_heredar before insert or update on public.ubicaciones
  for each row execute function public.heredar_de_direccion();
create trigger b3_responsables before insert or update on public.ubicaciones
  for each row execute function public.resolver_responsables('con_inspector');

-- Cambiar el jefe o el inspector de una dirección lo lleva a todas sus ubicaciones, en la misma transacción.
create or replace function public.propagar_direccion() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.jefe_sitio_id is distinct from old.jefe_sitio_id
     or new.jefe_sitio_nombre is distinct from old.jefe_sitio_nombre
     or new.inspector_id is distinct from old.inspector_id
     or new.inspector_nombre is distinct from old.inspector_nombre then
    update public.ubicaciones u
       set jefe_sitio_id = new.jefe_sitio_id, jefe_sitio_nombre = new.jefe_sitio_nombre,
           inspector_id = new.inspector_id, inspector_nombre = new.inspector_nombre
     where u.direccion_id = new.id;
  end if;
  return new;
end $$;
create trigger z_propagar after update on public.direcciones
  for each row execute function public.propagar_direccion();

create view public.v_direcciones with (security_invoker = true) as
select d.*,
       (select count(*) from public.ubicaciones u where u.direccion_id = d.id)::integer as ubicaciones_total
  from public.direcciones d;

create view public.v_ubicaciones with (security_invoker = true) as
select u.*,
       coalesce(d.direccion, u.direccion) as domicilio,
       (select count(*) from public.ordenes_trabajo o
         where o.ubicacion_id = u.id and o.estado not in ('completada','cancelada'))::integer as ots_abiertas
  from public.ubicaciones u
  left join public.direcciones d on d.id = u.direccion_id;

-- Importación del directorio (Excel de direcciones, jefes y establecimientos). A diferencia de la v1,
-- volver a importar el mismo archivo no duplica: actualiza lo que ya existe.
-- Cada fila: { direccion, zona, establecimiento, codigo, m2, jefe, inspector }
create or replace function public.importar_directorio(p_filas jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  f jsonb;
  v_sector uuid := public.sector_efectivo();
  v_dir uuid;
  v_ubi uuid;
  v_jefe uuid;
  v_insp uuid;
  r jsonb := '{"direcciones_nuevas":0,"direcciones_actualizadas":0,"ubicaciones_nuevas":0,"ubicaciones_actualizadas":0,"omitidas":0}';
begin
  if not public.es_gerencia() then
    raise exception 'Solo gerencia puede importar el directorio.' using errcode = 'P0001';
  end if;
  if v_sector is null then
    raise exception 'Tu usuario no tiene un sector asignado.' using errcode = 'P0001';
  end if;

  for f in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) loop
    if public.norm_txt(f ->> 'establecimiento') = '' then
      r := jsonb_set(r, '{omitidas}', to_jsonb((r ->> 'omitidas')::int + 1));
      continue;
    end if;
    v_jefe := public.perfil_por_nombre(f ->> 'jefe');
    v_insp := public.perfil_por_nombre(f ->> 'inspector');
    v_dir := null;

    if public.norm_txt(f ->> 'direccion') <> '' then
      select d.id into v_dir from public.direcciones d
       where d.sector_id = v_sector
         and public.norm_txt(d.direccion) = public.norm_txt(f ->> 'direccion')
         and public.norm_txt(d.zona) = public.norm_txt(f ->> 'zona')
       limit 1;
      if v_dir is null then
        insert into public.direcciones (direccion, zona, jefe_sitio_id, jefe_sitio_nombre, inspector_id, inspector_nombre)
        values (btrim(f ->> 'direccion'), nullif(btrim(f ->> 'zona'), ''),
                v_jefe, nullif(btrim(f ->> 'jefe'), ''), v_insp, nullif(btrim(f ->> 'inspector'), ''))
        returning id into v_dir;
        r := jsonb_set(r, '{direcciones_nuevas}', to_jsonb((r ->> 'direcciones_nuevas')::int + 1));
      elsif public.norm_txt(f ->> 'jefe') <> '' or public.norm_txt(f ->> 'inspector') <> '' then
        update public.direcciones d
           set jefe_sitio_id     = case when public.norm_txt(f ->> 'jefe') <> '' then v_jefe else d.jefe_sitio_id end,
               jefe_sitio_nombre = case when public.norm_txt(f ->> 'jefe') <> '' then btrim(f ->> 'jefe') else d.jefe_sitio_nombre end,
               inspector_id      = case when public.norm_txt(f ->> 'inspector') <> '' then v_insp else d.inspector_id end,
               inspector_nombre  = case when public.norm_txt(f ->> 'inspector') <> '' then btrim(f ->> 'inspector') else d.inspector_nombre end
         where d.id = v_dir
           and (d.jefe_sitio_nombre is distinct from coalesce(nullif(btrim(f ->> 'jefe'), ''), d.jefe_sitio_nombre)
                or d.inspector_nombre is distinct from coalesce(nullif(btrim(f ->> 'inspector'), ''), d.inspector_nombre)
                or (v_jefe is not null and d.jefe_sitio_id is distinct from v_jefe)
                or (v_insp is not null and d.inspector_id is distinct from v_insp));
        if found then
          r := jsonb_set(r, '{direcciones_actualizadas}', to_jsonb((r ->> 'direcciones_actualizadas')::int + 1));
        end if;
      end if;
    end if;

    select u.id into v_ubi from public.ubicaciones u
     where u.sector_id = v_sector and public.norm_txt(u.nombre) = public.norm_txt(f ->> 'establecimiento')
     limit 1;
    if v_ubi is null then
      insert into public.ubicaciones (nombre, codigo, zona, m2, direccion_id, jefe_sitio_id, jefe_sitio_nombre, inspector_id, inspector_nombre)
      values (btrim(f ->> 'establecimiento'), nullif(btrim(f ->> 'codigo'), ''), nullif(btrim(f ->> 'zona'), ''),
              nullif(f ->> 'm2', '')::numeric, v_dir,
              case when v_dir is null then v_jefe end, case when v_dir is null then nullif(btrim(f ->> 'jefe'), '') end,
              case when v_dir is null then v_insp end, case when v_dir is null then nullif(btrim(f ->> 'inspector'), '') end);
      r := jsonb_set(r, '{ubicaciones_nuevas}', to_jsonb((r ->> 'ubicaciones_nuevas')::int + 1));
    else
      update public.ubicaciones u
         set direccion_id = coalesce(v_dir, u.direccion_id),
             codigo = coalesce(nullif(btrim(f ->> 'codigo'), ''), u.codigo),
             zona   = coalesce(nullif(btrim(f ->> 'zona'), ''), u.zona),
             m2     = coalesce(nullif(f ->> 'm2', '')::numeric, u.m2)
       where u.id = v_ubi
         and (u.direccion_id is distinct from coalesce(v_dir, u.direccion_id)
              or u.codigo is distinct from coalesce(nullif(btrim(f ->> 'codigo'), ''), u.codigo)
              or u.zona is distinct from coalesce(nullif(btrim(f ->> 'zona'), ''), u.zona)
              or u.m2 is distinct from coalesce(nullif(f ->> 'm2', '')::numeric, u.m2));
      if found then
        r := jsonb_set(r, '{ubicaciones_actualizadas}', to_jsonb((r ->> 'ubicaciones_actualizadas')::int + 1));
      end if;
    end if;
  end loop;
  return r;
end $$;

-- =====================================================================================
-- 2. PENDIENTES SAP
-- =====================================================================================
create type public.pendiente_tipo   as enum ('mantenimiento','obra','inspeccion','emergencia');
create type public.pendiente_estado as enum ('pendiente','asignado','en_progreso','resuelto','cancelado');

create table public.pendientes (
  id                     uuid primary key default gen_random_uuid(),
  sector_id              uuid not null references public.sectores(id),
  numero_sap             text,
  numero_sap_desaprobado text,
  descripcion            text not null,
  ubicacion_id           uuid,
  establecimiento        text,
  sitio                  text,
  zona                   text,
  inspector_nombre       text,
  clase_orden            text,
  status_sap             text,
  tipo                   public.pendiente_tipo not null default 'mantenimiento',
  estado                 public.pendiente_estado not null default 'pendiente',
  prioridad              public.prioridad not null default 'media',
  jefe_sitio_id          uuid references public.perfiles(id) on delete set null,
  jefe_sitio_nombre      text,
  fecha_emision_sap      date,
  fecha_limite           date,
  fecha_asignacion       date,
  fecha_resolucion       date,
  proyecto_nombre        text,
  activo_nombre          text,
  presupuesto_estimado   numeric(16,2) not null default 0,
  materiales_necesarios  text,
  observaciones          text,
  notas_resolucion       text,
  id_origen              text unique,
  created_by             uuid default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id)
);
create index pendientes_sector_idx on public.pendientes(sector_id, zona, estado);
-- Un número de orden de SAP aparece una sola vez por sector: reimportar no duplica.
create unique index pendientes_sap_idx on public.pendientes(sector_id, numero_sap) where numero_sap is not null;
select public.aplicar_rls_sector('public.pendientes');
create trigger b_rol before insert or update or delete on public.pendientes
  for each row execute function public.exigir_rol('validar');
create trigger b3_responsables before insert or update on public.pendientes
  for each row execute function public.resolver_responsables();

-- Automatismos de la v1, ahora en la base (valen para el formulario, la edición rápida y la importación):
-- asignar un jefe pasa el pendiente a "asignado"; asignar y resolver sellan su fecha.
create or replace function public.preparar_pendiente() returns trigger
language plpgsql set search_path = public as $$
declare
  u public.ubicaciones%rowtype;
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;

  if new.ubicacion_id is not null and (tg_op = 'INSERT' or new.ubicacion_id is distinct from old.ubicacion_id) then
    select * into u from public.ubicaciones x where x.id = new.ubicacion_id;
    new.establecimiento := coalesce(nullif(new.establecimiento, ''), u.nombre);
    new.zona := coalesce(nullif(new.zona, ''), u.zona);
    new.inspector_nombre := coalesce(nullif(new.inspector_nombre, ''), u.inspector_nombre);
    if new.jefe_sitio_id is null and new.jefe_sitio_nombre is null then
      new.jefe_sitio_id := u.jefe_sitio_id;
      new.jefe_sitio_nombre := u.jefe_sitio_nombre;
    end if;
  end if;

  if new.estado = 'pendiente' and (new.jefe_sitio_id is not null or new.jefe_sitio_nombre is not null)
     and (tg_op = 'INSERT' or (old.jefe_sitio_id is null and old.jefe_sitio_nombre is null)) then
    new.estado := 'asignado';
  end if;
  if new.estado = 'asignado' and new.fecha_asignacion is null then
    new.fecha_asignacion := current_date;
  end if;
  if new.estado = 'resuelto' and new.fecha_resolucion is null then
    new.fecha_resolucion := current_date;
  end if;
  if new.estado <> 'resuelto' and tg_op = 'UPDATE' and old.estado = 'resuelto' then
    new.fecha_resolucion := null;
  end if;
  return new;
end $$;
create trigger b2_preparar before insert or update on public.pendientes
  for each row execute function public.preparar_pendiente();

create table public.pendiente_historial (
  id                 uuid primary key default gen_random_uuid(),
  sector_id          uuid not null references public.sectores(id),
  pendiente_id       uuid not null,
  usuario_id         uuid default auth.uid(),
  usuario_nombre     text,
  estado_anterior    public.pendiente_estado,
  estado_nuevo       public.pendiente_estado,
  jefe_anterior      text,
  jefe_nuevo         text,
  campos_modificados text[] not null default '{}',
  comentario         text,
  created_at         timestamptz not null default now(),
  foreign key (pendiente_id, sector_id) references public.pendientes(id, sector_id) on delete cascade
);
create index pendiente_historial_idx on public.pendiente_historial(pendiente_id, created_at desc);
select public.aplicar_rls_sector('public.pendiente_historial');
create or replace function public.proteger_bitacora() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.hist_fn') then
    return coalesce(new, old);
  end if;
  -- Borrado en cascada: el pendiente ya no está.
  if tg_op = 'DELETE' and not exists (select 1 from public.pendientes p where p.id = old.pendiente_id) then
    return old;
  end if;
  raise exception 'El historial se registra solo. No se puede cargar ni modificar a mano.' using errcode = 'P0001';
end $$;

-- Corrección a la fase 1: al borrar un activo, su historial se va con él (antes el borrado quedaba trabado).
create or replace function public.proteger_historial() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.hist_fn') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.activos a where a.id = old.activo_id) then
    return old;
  end if;
  raise exception 'El historial de un activo se registra solo. No se puede cargar ni modificar a mano.'
    using errcode = 'P0001';
end $$;
create trigger b_proteger before insert or update or delete on public.pendiente_historial
  for each row execute function public.proteger_bitacora();

-- El historial lo escribe la base en cada cambio, venga de donde venga (en la v1 solo lo hacía un formulario).
create or replace function public.historial_pendiente_trg() returns trigger
language plpgsql set search_path = public as $$
declare
  v_campos text[] := '{}';
begin
  if new.estado is distinct from old.estado then v_campos := array_append(v_campos, 'estado'); end if;
  if new.jefe_sitio_nombre is distinct from old.jefe_sitio_nombre then v_campos := array_append(v_campos, 'jefe_sitio'); end if;
  if new.prioridad is distinct from old.prioridad then v_campos := array_append(v_campos, 'prioridad'); end if;
  if new.inspector_nombre is distinct from old.inspector_nombre then v_campos := array_append(v_campos, 'inspector'); end if;
  if new.descripcion is distinct from old.descripcion then v_campos := array_append(v_campos, 'descripcion'); end if;
  if new.sitio is distinct from old.sitio then v_campos := array_append(v_campos, 'sitio'); end if;
  if new.fecha_limite is distinct from old.fecha_limite then v_campos := array_append(v_campos, 'fecha_limite'); end if;
  if array_length(v_campos, 1) is null then
    return new;
  end if;
  perform set_config('dh1.hist_fn', '1', true);
  insert into public.pendiente_historial
    (sector_id, pendiente_id, usuario_nombre, estado_anterior, estado_nuevo, jefe_anterior, jefe_nuevo, campos_modificados)
  values
    (new.sector_id, new.id, (select p.nombre from public.perfiles p where p.id = auth.uid()),
     case when new.estado is distinct from old.estado then old.estado end,
     case when new.estado is distinct from old.estado then new.estado end,
     case when new.jefe_sitio_nombre is distinct from old.jefe_sitio_nombre then old.jefe_sitio_nombre end,
     case when new.jefe_sitio_nombre is distinct from old.jefe_sitio_nombre then new.jefe_sitio_nombre end,
     v_campos);
  perform set_config('dh1.hist_fn', '', true);
  return new;
end $$;
create trigger z_historial after update on public.pendientes
  for each row execute function public.historial_pendiente_trg();

create or replace function public.anotar_pendiente(p_id uuid, p_comentario text) returns void
language plpgsql set search_path = public as $$
declare
  v_sector uuid;
begin
  if coalesce(btrim(p_comentario), '') = '' then
    raise exception 'Escribí la nota.' using errcode = 'P0001';
  end if;
  select p.sector_id into v_sector from public.pendientes p where p.id = p_id;
  if v_sector is null then
    raise exception 'El pendiente no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  perform set_config('dh1.hist_fn', '1', true);
  insert into public.pendiente_historial (sector_id, pendiente_id, usuario_nombre, comentario)
  values (v_sector, p_id, (select p.nombre from public.perfiles p where p.id = auth.uid()), btrim(p_comentario));
  perform set_config('dh1.hist_fn', '', true);
end $$;

create view public.v_pendientes with (security_invoker = true) as
select p.*,
       u.nombre as ubicacion_nombre,
       (p.fecha_limite is not null and p.fecha_limite < current_date
          and p.estado not in ('resuelto','cancelado')) as vencido,
       case when p.fecha_limite is null then null else p.fecha_limite - current_date end as dias_restantes
  from public.pendientes p
  left join public.ubicaciones u on u.id = p.ubicacion_id;

-- Busca la ubicación de un pendiente importado: por nombre exacto, por código, y por nombre contenido.
create or replace function public.ubicacion_por_texto(p_establecimiento text, p_sitio text) returns uuid
language sql stable set search_path = public as $$
  select u.id
    from public.ubicaciones u
   where u.sector_id = public.sector_efectivo()
     and (   (public.norm_txt(p_establecimiento) <> '' and public.norm_txt(u.nombre) = public.norm_txt(p_establecimiento))
          or (public.norm_txt(p_sitio) <> '' and public.norm_txt(u.codigo) = public.norm_txt(p_sitio))
          or (public.norm_txt(p_sitio) <> '' and public.norm_txt(u.nombre) = public.norm_txt(p_sitio))
          or (length(public.norm_txt(p_establecimiento)) >= 6
              and public.norm_txt(u.nombre) like '%' || replace(replace(public.norm_txt(p_establecimiento), '%', ''), '_', '') || '%'))
   order by (public.norm_txt(u.nombre) = public.norm_txt(p_establecimiento)) desc,
            (public.norm_txt(u.codigo) = public.norm_txt(p_sitio)) desc, u.nombre
   limit 1
$$;

-- Importación de órdenes de SAP. La app lee el Excel (los tres formatos de planilla) y manda las filas.
--   p_filas: [{ numero_sap, numero_sap_desaprobado, descripcion, sitio, establecimiento, inspector,
--               fecha_inicio, fecha_limite, clase_orden, status_sap }]
--   p_jefes: { "NOMBRE DEL INSPECTOR": "<id de perfil>" }  jefe de sitio elegido para cada inspector
-- Lo que ya existe (mismo número de SAP en el sector) se omite: nunca se pisa un pendiente cargado.
create or replace function public.importar_pendientes_sap(p_filas jsonb, p_zona text, p_jefes jsonb default '{}'::jsonb)
returns jsonb
language plpgsql set search_path = public as $$
declare
  f jsonb;
  v_sector uuid := public.sector_efectivo();
  v_ubi uuid;
  v_jefe uuid;
  v_jefe_nombre text;
  v_estado public.pendiente_estado;
  v_tipo public.pendiente_tipo;
  v_status text;
  v_clase text;
  n_imp integer := 0;
  n_omi integer := 0;
  n_inv integer := 0;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden importar pendientes.' using errcode = 'P0001';
  end if;
  if v_sector is null then
    raise exception 'Tu usuario no tiene un sector asignado.' using errcode = 'P0001';
  end if;

  for f in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) loop
    if coalesce(btrim(f ->> 'numero_sap'), '') = '' or coalesce(btrim(f ->> 'descripcion'), '') = '' then
      n_inv := n_inv + 1;
      continue;
    end if;
    if exists (select 1 from public.pendientes p
                where p.sector_id = v_sector and p.numero_sap = btrim(f ->> 'numero_sap')) then
      n_omi := n_omi + 1;
      continue;
    end if;

    v_status := upper(coalesce(f ->> 'status_sap', ''));
    v_clase  := upper(coalesce(f ->> 'clase_orden', ''));
    v_estado := case when v_status like '%EJER%' then 'en_progreso'
                     when v_status like '%CIER%' or v_status like '%CERR%' then 'resuelto'
                     when v_status like '%CANC%' then 'cancelado'
                     else 'pendiente' end;
    v_tipo := case when v_clase like '%OBR%' then 'obra'
                   when v_clase like '%INS%' then 'inspeccion'
                   when v_clase like '%EME%' or v_clase like '%URG%' then 'emergencia'
                   else 'mantenimiento' end;

    v_ubi := public.ubicacion_por_texto(f ->> 'establecimiento', f ->> 'sitio');

    -- Jefe de sitio: el elegido para ese inspector; si no, el de la ubicación (lo pone el trigger);
    -- si no, el de una dirección a cargo de ese inspector.
    v_jefe := nullif(p_jefes ->> upper(btrim(coalesce(f ->> 'inspector', ''))), '')::uuid;
    v_jefe_nombre := null;
    if v_jefe is null and v_ubi is null and public.norm_txt(f ->> 'inspector') <> '' then
      select d.jefe_sitio_id, d.jefe_sitio_nombre into v_jefe, v_jefe_nombre
        from public.direcciones d
       where d.sector_id = v_sector and public.norm_txt(d.inspector_nombre) = public.norm_txt(f ->> 'inspector')
         and (d.jefe_sitio_id is not null or d.jefe_sitio_nombre is not null)
       limit 1;
    end if;

    insert into public.pendientes
      (numero_sap, numero_sap_desaprobado, descripcion, ubicacion_id, establecimiento, sitio, zona, inspector_nombre,
       clase_orden, status_sap, tipo, estado, fecha_emision_sap, fecha_limite, jefe_sitio_id, jefe_sitio_nombre)
    values
      (btrim(f ->> 'numero_sap'), nullif(btrim(f ->> 'numero_sap_desaprobado'), ''), btrim(f ->> 'descripcion'),
       v_ubi, coalesce(nullif(btrim(f ->> 'establecimiento'), ''), nullif(btrim(f ->> 'sitio'), '')),
       nullif(btrim(f ->> 'sitio'), ''), nullif(btrim(p_zona), ''), nullif(btrim(f ->> 'inspector'), ''),
       nullif(btrim(f ->> 'clase_orden'), ''), nullif(btrim(f ->> 'status_sap'), ''), v_tipo, v_estado,
       nullif(f ->> 'fecha_inicio', '')::date, nullif(f ->> 'fecha_limite', '')::date, v_jefe, v_jefe_nombre);
    n_imp := n_imp + 1;
  end loop;

  return jsonb_build_object('importados', n_imp, 'omitidos', n_omi, 'invalidos', n_inv);
end $$;

-- =====================================================================================
-- 3. EMERGENCIAS
-- =====================================================================================
create type public.emergencia_tipo   as enum ('incendio','inundacion','corte_electrico','derrumbe','rotura_gas','vandalismo','accidente','otro');
create type public.emergencia_estado as enum ('activa','en_atencion','resuelta','cancelada');
create sequence public.emergencia_numero_seq;

create table public.emergencias (
  id                 uuid primary key default gen_random_uuid(),
  sector_id          uuid not null references public.sectores(id),
  codigo             text not null unique,
  titulo             text not null,
  descripcion        text,
  tipo               public.emergencia_tipo not null,
  estado             public.emergencia_estado not null default 'activa',
  ubicacion_id       uuid not null,
  jefe_sitio_id      uuid references public.perfiles(id) on delete set null,
  jefe_sitio_nombre  text,
  reportado_por      text,
  telefono_contacto  text,
  fotos              jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos) = 'array'),
  ot_id              uuid,
  notas_resolucion   text,
  fecha_atencion     timestamptz,
  fecha_resolucion   timestamptz,
  minutos_atencion   integer,
  minutos_resolucion integer,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id),
  foreign key (ot_id, sector_id) references public.ordenes_trabajo(id, sector_id)
);
create index emergencias_sector_idx on public.emergencias(sector_id, estado, created_at desc);
select public.aplicar_rls_sector('public.emergencias');
create trigger b3_responsables before insert or update on public.emergencias
  for each row execute function public.resolver_responsables();

-- activa → en_atencion → resuelta. Cancelar: desde cualquier estado abierto.
-- Reportar puede cualquiera del sector (con reportar_emergencia); atender, resolver y cancelar: gerencia o jefe de sitio.
create or replace function public.validar_emergencia() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not (public.es_servicio() or public.es_gerencia()) then
      raise exception 'Solo gerencia puede borrar una emergencia.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if public.es_servicio() or public.dh1_flag('dh1.sys_fn') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Las emergencias se cargan con "Nueva emergencia".' using errcode = 'P0001';
  end if;

  new.updated_at := now();
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden atender una emergencia.' using errcode = 'P0001';
  end if;
  if old.estado in ('resuelta','cancelada') then
    raise exception 'La emergencia % ya está %.', old.codigo, old.estado using errcode = 'P0001';
  end if;
  if new.estado <> old.estado then
    if old.estado = 'activa' and new.estado = 'en_atencion' then
      new.fecha_atencion := now();
      new.minutos_atencion := greatest(0, round(extract(epoch from (now() - old.created_at)) / 60))::integer;
    elsif new.estado = 'resuelta' then
      new.fecha_resolucion := now();
      new.minutos_resolucion := greatest(0, round(extract(epoch from (now() - old.created_at)) / 60))::integer;
    elsif new.estado = 'cancelada' then
      null;
    else
      raise exception 'Una emergencia % no puede pasar a %.', replace(old.estado::text, '_', ' '), replace(new.estado::text, '_', ' ')
        using errcode = 'P0001';
    end if;
  end if;
  new.codigo := old.codigo;
  new.ot_id := old.ot_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end $$;
create trigger b_validar before insert or update or delete on public.emergencias
  for each row execute function public.validar_emergencia();

-- Al resolver o cancelar la emergencia, su orden de trabajo se cierra con ella (como en la v1).
create or replace function public.cerrar_ot_de_emergencia() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estado in ('resuelta','cancelada') and old.estado not in ('resuelta','cancelada') and new.ot_id is not null then
    perform set_config('dh1.sys_fn', '1', true);
    update public.ordenes_trabajo o
       set estado = case when new.estado = 'resuelta' then 'completada' else 'cancelada' end::public.ot_estado,
           validado_por = auth.uid(), fecha_validacion = now(),
           fecha_fin_real = coalesce(o.fecha_fin_real, now()),
           notas = concat_ws(E'\n', o.notas, 'Cerrada al ' || case when new.estado = 'resuelta' then 'resolver' else 'cancelar' end
                                             || ' la emergencia ' || new.codigo || '.')
     where o.id = new.ot_id and o.estado not in ('completada','cancelada');
    perform set_config('dh1.sys_fn', '', true);
  end if;
  return new;
end $$;
create trigger z_cerrar_ot after update on public.emergencias
  for each row execute function public.cerrar_ot_de_emergencia();

-- Alta de una emergencia con su orden de trabajo urgente, todo o nada (en la v1 eran 3 pasos sueltos).
--   p: { titulo, descripcion, tipo, ubicacion_id, jefe_sitio_id, reportado_por, telefono_contacto, fotos }
create or replace function public.reportar_emergencia(p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  u public.ubicaciones%rowtype;
  v_id uuid;
  v_ot uuid;
  v_codigo text;
  v_jefe uuid;
begin
  if auth.uid() is null or public.sector_efectivo() is null then
    raise exception 'Tenés que iniciar sesión.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p ->> 'titulo'), '') = '' then
    raise exception 'Poné un título a la emergencia.' using errcode = 'P0001';
  end if;
  select * into u from public.ubicaciones x
   where x.id = nullif(p ->> 'ubicacion_id', '')::uuid and x.sector_id = public.sector_efectivo();
  if not found then
    raise exception 'Elegí el establecimiento de la lista.' using errcode = 'P0001';
  end if;

  v_codigo := 'EMG-' || lpad(nextval('public.emergencia_numero_seq')::text, 6, '0');
  v_jefe := coalesce(nullif(p ->> 'jefe_sitio_id', '')::uuid, u.jefe_sitio_id);

  perform set_config('dh1.sys_fn', '1', true);
  insert into public.ordenes_trabajo
    (sector_id, titulo, descripcion, tipo, prioridad, estado, ubicacion_id, asignado_a, fecha_programada, notas)
  values
    (u.sector_id, '[EMERGENCIA] ' || btrim(p ->> 'titulo'), nullif(btrim(p ->> 'descripcion'), ''), 'emergencia', 'urgente',
     case when v_jefe is null then 'pendiente' else 'asignada' end::public.ot_estado,
     u.id, v_jefe, current_date, 'Emergencia ' || v_codigo)
  returning id into v_ot;

  insert into public.emergencias
    (sector_id, codigo, titulo, descripcion, tipo, ubicacion_id, jefe_sitio_id, jefe_sitio_nombre,
     reportado_por, telefono_contacto, fotos, ot_id)
  values
    (u.sector_id, v_codigo, btrim(p ->> 'titulo'), nullif(btrim(p ->> 'descripcion'), ''),
     (p ->> 'tipo')::public.emergencia_tipo, u.id, v_jefe,
     case when v_jefe is null then u.jefe_sitio_nombre end,
     nullif(btrim(p ->> 'reportado_por'), ''), nullif(btrim(p ->> 'telefono_contacto'), ''),
     coalesce(p -> 'fotos', '[]'::jsonb), v_ot)
  returning id into v_id;
  perform set_config('dh1.sys_fn', '', true);
  return v_id;
end $$;

create view public.v_emergencias with (security_invoker = true) as
select e.*,
       u.nombre as ubicacion_nombre, coalesce(d.direccion, u.direccion) as domicilio, u.zona,
       o.codigo as ot_codigo, o.estado as ot_estado
  from public.emergencias e
  join public.ubicaciones u on u.id = e.ubicacion_id
  left join public.direcciones d on d.id = u.direccion_id
  left join public.ordenes_trabajo o on o.id = e.ot_id;

-- Patrones: 3 o más emergencias en un mismo establecimiento en los últimos 30 días.
create view public.v_patrones_emergencia with (security_invoker = true) as
select e.sector_id, e.ubicacion_id, u.nombre as ubicacion_nombre, count(*)::integer as cantidad,
       mode() within group (order by e.tipo) as tipo_mas_frecuente,
       max(e.created_at) as ultima
  from public.emergencias e
  join public.ubicaciones u on u.id = e.ubicacion_id
 where e.created_at >= now() - interval '30 days' and e.estado <> 'cancelada'
 group by e.sector_id, e.ubicacion_id, u.nombre
having count(*) >= 3;

-- =====================================================================================
-- 4. RUTINAS
-- =====================================================================================
create type public.rutina_ciclo  as enum ('Semanal','Quincenal','Mensual','Bimestral','Trimestral','Cuatrimestral','Semestral','Anual','Bienal');
create type public.rutina_estado as enum ('pendiente','en_proceso','ejecutada','vencida','derivada_tom');

create or replace function public.dias_de_ciclo(p public.rutina_ciclo) returns integer
language sql immutable as $$
  select case p when 'Semanal' then 7 when 'Quincenal' then 15 when 'Mensual' then 30 when 'Bimestral' then 60
                when 'Trimestral' then 90 when 'Cuatrimestral' then 120 when 'Semestral' then 180
                when 'Anual' then 365 when 'Bienal' then 730 end
$$;

create table public.rutinas_catalogo (
  id                 uuid primary key default gen_random_uuid(),
  sector_id          uuid not null references public.sectores(id),
  rubro_id           text,
  rubro_nombre       text not null,
  item               text,
  objeto             text not null,
  acciones           text,
  observaciones_tom  text,
  tipo               text not null default 'mantenimiento' check (tipo in ('mantenimiento','informe')),
  ciclo              public.rutina_ciclo not null,
  frecuencia_dias    integer not null check (frecuencia_dias > 0),
  -- meses en los que corresponde (1 a 12). Vacío = todo el año.
  estacionalidad     integer[] not null default '{}',
  plazo_dias         integer not null default 15 check (plazo_dias > 0),
  requiere_informe_matriculado boolean not null default false,
  carga_sismesc      boolean not null default false,
  activa             boolean not null default true,
  id_origen          text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, sector_id)
);
create index rutinas_catalogo_idx on public.rutinas_catalogo(sector_id, rubro_nombre, objeto);
select public.aplicar_rls_sector('public.rutinas_catalogo');
create trigger b_rol before insert or update or delete on public.rutinas_catalogo
  for each row execute function public.exigir_rol('gerencia');

-- La frecuencia sale del ciclo (en la v1 era un dato suelto que nadie verificaba).
create or replace function public.preparar_rutina() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.frecuencia_dias is null or (tg_op = 'UPDATE' and new.ciclo is distinct from old.ciclo) then
    new.frecuencia_dias := public.dias_de_ciclo(new.ciclo);
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
create trigger a2_preparar before insert or update on public.rutinas_catalogo
  for each row execute function public.preparar_rutina();

-- Qué rutinas le tocan a cada ubicación. (En la v1 había una copia de las escuelas llamada "Edificio".)
create table public.rutinas_ubicacion (
  id                uuid primary key default gen_random_uuid(),
  sector_id         uuid not null references public.sectores(id),
  ubicacion_id      uuid not null,
  rutina_id         uuid not null,
  activa            boolean not null default true,
  ultima_ejecucion  date,
  proxima_ejecucion date not null default current_date,
  created_at        timestamptz not null default now(),
  unique (id, sector_id),
  unique (ubicacion_id, rutina_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id) on delete cascade,
  foreign key (rutina_id, sector_id)    references public.rutinas_catalogo(id, sector_id) on delete cascade
);
create index rutinas_ubicacion_prox_idx on public.rutinas_ubicacion(sector_id, proxima_ejecucion) where activa;
select public.aplicar_rls_sector('public.rutinas_ubicacion');
create trigger b_rol before insert or update or delete on public.rutinas_ubicacion
  for each row execute function public.exigir_rol('gerencia');

create table public.ordenes_rutina (
  id                   uuid primary key default gen_random_uuid(),
  sector_id            uuid not null references public.sectores(id),
  asignacion_id        uuid not null,
  ubicacion_id         uuid not null,
  rutina_id            uuid not null,
  estado               public.rutina_estado not null default 'pendiente',
  fecha_generada       date not null default current_date,
  fecha_limite         date not null,
  fecha_ejecucion      date,
  plazo_dias           integer not null,
  responsable_id       uuid references public.perfiles(id) on delete set null,
  matricula_profesional text,
  observaciones        text,
  -- adjuntos: [{ nombre, url, tipo }]
  adjuntos             jsonb not null default '[]'::jsonb check (jsonb_typeof(adjuntos) = 'array'),
  ot_id                uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (asignacion_id, sector_id) references public.rutinas_ubicacion(id, sector_id) on delete cascade,
  foreign key (ubicacion_id, sector_id)  references public.ubicaciones(id, sector_id) on delete cascade,
  foreign key (rutina_id, sector_id)     references public.rutinas_catalogo(id, sector_id),
  foreign key (ot_id, sector_id)         references public.ordenes_trabajo(id, sector_id)
);
create index ordenes_rutina_idx on public.ordenes_rutina(sector_id, estado, fecha_limite);
-- Una sola orden abierta por rutina y ubicación: procesar dos veces no duplica.
create unique index ordenes_rutina_abierta_idx on public.ordenes_rutina(asignacion_id)
  where estado in ('pendiente','en_proceso','vencida');
select public.aplicar_rls_sector('public.ordenes_rutina');
create trigger b_rol before insert or update or delete on public.ordenes_rutina
  for each row execute function public.exigir_rol('validar');

-- Reglas al cambiar una orden de rutina.
create or replace function public.validar_orden_rutina() returns trigger
language plpgsql set search_path = public as $$
declare
  c public.rutinas_catalogo%rowtype;
begin
  new.updated_at := now();
  if public.es_servicio() or public.dh1_flag('dh1.sys_fn') then
    return new;
  end if;
  if old.estado = 'ejecutada' then
    raise exception 'La rutina ya fue ejecutada el %. No se modifica.', to_char(old.fecha_ejecucion, 'DD/MM/YYYY')
      using errcode = 'P0001';
  end if;
  if new.estado = 'ejecutada' then
    select * into c from public.rutinas_catalogo r where r.id = new.rutina_id;
    if c.carga_sismesc and jsonb_array_length(new.adjuntos) = 0 then
      raise exception 'Esta rutina se carga en SISMESC: adjuntá el comprobante antes de darla por ejecutada.'
        using errcode = 'P0001';
    end if;
    if c.requiere_informe_matriculado and coalesce(btrim(new.matricula_profesional), '') = '' then
      raise exception 'Esta rutina requiere informe de un matriculado: indicá la matrícula.' using errcode = 'P0001';
    end if;
    new.fecha_ejecucion := current_date;
    new.responsable_id := coalesce(new.responsable_id, auth.uid());
  end if;
  new.asignacion_id := old.asignacion_id;
  new.ubicacion_id := old.ubicacion_id;
  new.rutina_id := old.rutina_id;
  new.fecha_generada := old.fecha_generada;
  return new;
end $$;
create trigger c_validar before update on public.ordenes_rutina
  for each row execute function public.validar_orden_rutina();

-- Al ejecutarse, la asignación anota la fecha y reprograma según la frecuencia REAL de la rutina.
create or replace function public.orden_rutina_ejecutada() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estado = 'ejecutada' and old.estado <> 'ejecutada' then
    perform set_config('dh1.sys_fn', '1', true);
    update public.rutinas_ubicacion a
       set ultima_ejecucion = current_date,
           proxima_ejecucion = current_date + (select r.frecuencia_dias from public.rutinas_catalogo r where r.id = new.rutina_id)
     where a.id = new.asignacion_id;
    perform set_config('dh1.sys_fn', '', true);
  end if;
  return new;
end $$;
create trigger z_ejecutada after update on public.ordenes_rutina
  for each row execute function public.orden_rutina_ejecutada();

create view public.v_ordenes_rutina with (security_invoker = true) as
select o.*,
       u.nombre as ubicacion_nombre, u.zona, u.jefe_sitio_id, u.jefe_sitio_nombre,
       r.rubro_nombre, r.item, r.objeto, r.ciclo, r.acciones, r.observaciones_tom, r.tipo as rutina_tipo,
       r.requiere_informe_matriculado, r.carga_sismesc,
       t.codigo as ot_codigo,
       (o.fecha_limite - current_date) as dias_restantes,
       case when o.estado in ('ejecutada','derivada_tom') then null
            when o.estado = 'vencida' or o.fecha_limite < current_date then 'rojo'
            when o.fecha_limite - current_date <= 3 then 'amarillo'
            else 'verde' end as semaforo
  from public.ordenes_rutina o
  join public.ubicaciones u      on u.id = o.ubicacion_id
  join public.rutinas_catalogo r on r.id = o.rutina_id
  left join public.ordenes_trabajo t on t.id = o.ot_id;

create view public.v_rutinas_ubicacion with (security_invoker = true) as
select a.*, u.nombre as ubicacion_nombre, r.rubro_nombre, r.item, r.objeto, r.ciclo, r.frecuencia_dias, r.plazo_dias
  from public.rutinas_ubicacion a
  join public.ubicaciones u      on u.id = a.ubicacion_id
  join public.rutinas_catalogo r on r.id = a.rutina_id;

-- Asigna el catálogo activo a todas las ubicaciones activas del sector. Se puede correr las veces que haga
-- falta: agrega lo que falte (ubicaciones nuevas y rutinas nuevas) y no toca lo ya asignado.
create or replace function public.sincronizar_rutinas() returns jsonb
language plpgsql set search_path = public as $$
declare
  v_sector uuid := public.sector_efectivo();
  n integer;
begin
  if not public.es_gerencia() then
    raise exception 'Solo gerencia puede sincronizar las rutinas.' using errcode = 'P0001';
  end if;
  insert into public.rutinas_ubicacion (sector_id, ubicacion_id, rutina_id, proxima_ejecucion)
  select v_sector, u.id, r.id, current_date
    from public.ubicaciones u
   cross join public.rutinas_catalogo r
   where u.sector_id = v_sector and u.activa and r.sector_id = v_sector and r.activa
  on conflict (ubicacion_id, rutina_id) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object(
    'asignaciones_creadas', n,
    'ubicaciones', (select count(*) from public.ubicaciones u where u.sector_id = v_sector and u.activa),
    'rutinas', (select count(*) from public.rutinas_catalogo r where r.sector_id = v_sector and r.activa),
    'asignaciones', (select count(*) from public.rutinas_ubicacion a where a.sector_id = v_sector));
end $$;

-- Primer día del próximo mes en temporada, a partir de una fecha.
create or replace function public.proximo_en_temporada(p_desde date, p_meses integer[]) returns date
language sql immutable as $$
  select min(d)::date
    from generate_series(date_trunc('month', p_desde) + interval '1 month',
                         date_trunc('month', p_desde) + interval '12 months', interval '1 month') d
   where extract(month from d)::integer = any (p_meses)
$$;

-- Vence lo atrasado y genera las órdenes que tocan hoy. Idempotente.
-- Correcciones sobre la v1: reprograma con la frecuencia real (no siempre 30 días), avanza la próxima
-- fecha al generar (no duplica) y, fuera de temporada, espera al primer mes que corresponde.
create or replace function public.procesar_rutinas() returns jsonb
language plpgsql set search_path = public as $$
declare
  v_sector uuid := public.sector_efectivo();
  a record;
  n_vencidas integer;
  n_creadas integer := 0;
  v_mes integer := extract(month from current_date)::integer;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden procesar las rutinas.' using errcode = 'P0001';
  end if;
  perform set_config('dh1.sys_fn', '1', true);

  update public.ordenes_rutina o set estado = 'vencida'
   where o.sector_id = v_sector and o.estado in ('pendiente','en_proceso') and o.fecha_limite < current_date;
  get diagnostics n_vencidas = row_count;

  for a in
    select x.id, x.ubicacion_id, x.rutina_id, r.frecuencia_dias, r.plazo_dias, r.estacionalidad
      from public.rutinas_ubicacion x
      join public.rutinas_catalogo r on r.id = x.rutina_id and r.activa
      join public.ubicaciones u on u.id = x.ubicacion_id and u.activa
     where x.sector_id = v_sector and x.activa and x.proxima_ejecucion <= current_date
  loop
    if cardinality(a.estacionalidad) > 0 and not (v_mes = any (a.estacionalidad)) then
      update public.rutinas_ubicacion set proxima_ejecucion = public.proximo_en_temporada(current_date, a.estacionalidad)
       where id = a.id;
      continue;
    end if;
    insert into public.ordenes_rutina (sector_id, asignacion_id, ubicacion_id, rutina_id, fecha_limite, plazo_dias)
    values (v_sector, a.id, a.ubicacion_id, a.rutina_id, current_date + a.plazo_dias, a.plazo_dias)
    on conflict (asignacion_id) where estado in ('pendiente','en_proceso','vencida') do nothing;
    if found then
      n_creadas := n_creadas + 1;
    end if;
    update public.rutinas_ubicacion set proxima_ejecucion = current_date + a.frecuencia_dias where id = a.id;
  end loop;

  perform set_config('dh1.sys_fn', '', true);
  return jsonb_build_object('ordenes_creadas', n_creadas, 'ordenes_vencidas', n_vencidas);
end $$;

-- Genera UNA orden de trabajo con todas las rutinas pendientes o vencidas de una ubicación que todavía
-- no tienen orden. Cada rutina va como una tarea del checklist. Queda asignada al jefe de sitio del lugar.
create or replace function public.generar_ot_rutinas(p_ubicacion uuid, p_asignado uuid default null) returns uuid
language plpgsql set search_path = public as $$
declare
  u public.ubicaciones%rowtype;
  v_ot uuid;
  v_n integer;
  v_vencidas integer;
  v_limite date;
  v_checklist jsonb;
  v_descripcion text;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden generar la orden.' using errcode = 'P0001';
  end if;
  select * into u from public.ubicaciones x where x.id = p_ubicacion;
  if not found then
    raise exception 'La ubicación no existe o no es de tu sector.' using errcode = 'P0001';
  end if;

  select count(*), count(*) filter (where o.estado = 'vencida'), min(o.fecha_limite),
         jsonb_agg(jsonb_build_object('id', o.id, 'tarea', o.rubro_nombre || ': ' || o.objeto, 'hecho', false)
                   order by o.fecha_limite, o.rubro_nombre),
         string_agg('• ' || o.rubro_nombre || ': ' || o.objeto || ' (' || o.ciclo || ', vence ' || to_char(o.fecha_limite, 'DD/MM') || ')'
                    || case when o.requiere_informe_matriculado then ' — requiere matriculado' else '' end
                    || case when o.carga_sismesc then ' — cargar en SISMESC' else '' end,
                    E'\n' order by o.fecha_limite, o.rubro_nombre)
    into v_n, v_vencidas, v_limite, v_checklist, v_descripcion
    from public.v_ordenes_rutina o
   where o.ubicacion_id = p_ubicacion and o.estado in ('pendiente','vencida') and o.ot_id is null;
  if v_n = 0 then
    raise exception 'Esta ubicación no tiene rutinas pendientes sin orden de trabajo.' using errcode = 'P0001';
  end if;

  insert into public.ordenes_trabajo
    (titulo, descripcion, tipo, prioridad, ubicacion_id, asignado_a, fecha_programada, checklist, notas)
  values
    ('[Rutinas] ' || u.nombre || ' — ' || v_n || case when v_n = 1 then ' rutina pendiente' else ' rutinas pendientes' end,
     v_descripcion, 'mantenimiento_preventivo',
     case when v_vencidas > 0 then 'urgente' when v_n >= 5 then 'alta' else 'media' end::public.prioridad,
     u.id, coalesce(p_asignado, u.jefe_sitio_id), coalesce(v_limite, current_date), v_checklist,
     'Generada desde Rutinas.')
  returning id into v_ot;

  perform set_config('dh1.sys_fn', '1', true);
  update public.ordenes_rutina o
     set ot_id = v_ot, estado = case when o.estado = 'vencida' then o.estado else 'en_proceso' end
   where o.ubicacion_id = p_ubicacion and o.estado in ('pendiente','vencida') and o.ot_id is null;
  perform set_config('dh1.sys_fn', '', true);
  return v_ot;
end $$;

-- Orden de trabajo para UNA rutina, con los datos que cargó el usuario.
--   p: { titulo, descripcion, tipo, prioridad, asignado_a, fecha_programada, notas }
create or replace function public.generar_ot_rutina(p_orden uuid, p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  o public.v_ordenes_rutina%rowtype;
  v_ot uuid;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden generar la orden.' using errcode = 'P0001';
  end if;
  select * into o from public.v_ordenes_rutina x where x.id = p_orden;
  if not found then
    raise exception 'La orden de rutina no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if o.ot_id is not null then
    raise exception 'Esta rutina ya tiene la orden de trabajo %.', o.ot_codigo using errcode = 'P0001';
  end if;
  if o.estado not in ('pendiente','en_proceso','vencida') then
    raise exception 'La rutina está %: no corresponde generarle una orden.', replace(o.estado::text, '_', ' ')
      using errcode = 'P0001';
  end if;

  insert into public.ordenes_trabajo
    (titulo, descripcion, tipo, prioridad, ubicacion_id, asignado_a, fecha_programada, checklist, notas)
  values
    (coalesce(nullif(btrim(p ->> 'titulo'), ''), '[Rutina] ' || o.objeto || ' — ' || o.ubicacion_nombre),
     nullif(btrim(p ->> 'descripcion'), ''),
     coalesce(nullif(p ->> 'tipo', ''), 'mantenimiento_preventivo')::public.ot_tipo,
     coalesce(nullif(p ->> 'prioridad', ''),
              case when o.estado = 'vencida' then 'urgente'
                   when o.ciclo in ('Semanal','Quincenal') then 'alta'
                   when o.ciclo = 'Mensual' then 'media' else 'baja' end)::public.prioridad,
     o.ubicacion_id, coalesce(nullif(p ->> 'asignado_a', '')::uuid, o.jefe_sitio_id),
     coalesce(nullif(p ->> 'fecha_programada', '')::date, o.fecha_limite),
     jsonb_build_array(jsonb_build_object('id', o.id, 'tarea', o.rubro_nombre || ': ' || o.objeto, 'hecho', false)),
     concat_ws(E'\n', nullif(btrim(p ->> 'notas'), ''), 'Generada desde Rutinas.'))
  returning id into v_ot;

  perform set_config('dh1.sys_fn', '1', true);
  update public.ordenes_rutina x
     set ot_id = v_ot, estado = case when x.estado = 'vencida' then x.estado else 'en_proceso' end
   where x.id = p_orden;
  perform set_config('dh1.sys_fn', '', true);
  return v_ot;
end $$;

-- =====================================================================================
-- 5. CALENDARIO (sin tablas propias)
-- =====================================================================================
-- Todo lo que tiene fecha, en un solo lugar: órdenes programadas, mantenimientos de activos y rutinas por vencer.
-- La app pide el rango del mes que está mirando (la v1 traía un recorte fijo y podían faltar eventos).
create view public.v_calendario with (security_invoker = true) as
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
 where r.estado in ('pendiente','en_proceso','vencida') and r.ot_id is null;

-- =====================================================================================
-- 6. CALEFACCIÓN (relevamiento de equipos por establecimiento y período)
-- =====================================================================================
create type public.equipo_calefaccion as enum ('estufas','radiadores','conductos','calderas','vrv','vrv_bajo_silueta','aire_acondicionado_calor','otros');

-- Un solo criterio para el estado (la v1 usaba 90 en un lado y 95 en otro).
create or replace function public.estado_operativo(p_funciona integer, p_total integer) returns text
language sql immutable as $$
  select case when coalesce(p_total, 0) <= 0 then 'critico'
              when p_funciona * 100.0 / p_total < 50 then 'critico'
              when p_funciona * 100.0 / p_total < 75 then 'alerta'
              when p_funciona * 100.0 / p_total < 90 then 'normal'
              else 'optimo' end
$$;

create table public.equipamiento_calefaccion (
  id                   uuid primary key default gen_random_uuid(),
  sector_id            uuid not null references public.sectores(id),
  ubicacion_id         uuid,
  escuela              text not null,
  zona                 text,
  jefe_sitio_id        uuid references public.perfiles(id) on delete set null,
  jefe_sitio_nombre    text,
  tipo_equipo          public.equipo_calefaccion not null,
  periodo              text not null,
  cantidad_total       integer not null check (cantidad_total > 0),
  cantidad_funciona    integer not null check (cantidad_funciona >= 0),
  cantidad_no_funciona integer generated always as (greatest(cantidad_total - cantidad_funciona, 0)) stored,
  porcentaje_operativo integer generated always as (round(least(cantidad_funciona, cantidad_total) * 100.0 / cantidad_total)::integer) stored,
  estado               text generated always as (public.estado_operativo(least(cantidad_funciona, cantidad_total), cantidad_total)) stored,
  observaciones        text,
  id_origen            text unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id)
);
create unique index equipamiento_calefaccion_uk on public.equipamiento_calefaccion(sector_id, periodo, public.norm_txt(escuela), tipo_equipo);
select public.aplicar_rls_sector('public.equipamiento_calefaccion');
create trigger b_rol before insert or update or delete on public.equipamiento_calefaccion
  for each row execute function public.exigir_rol('gerencia');
create trigger b3_responsables before insert or update on public.equipamiento_calefaccion
  for each row execute function public.resolver_responsables();
create trigger c_updated before update on public.equipamiento_calefaccion
  for each row execute function public.tocar_updated_at();

-- Importa un relevamiento. Reemplaza el período completo en una sola transacción (si algo falla, queda como estaba).
--   p_filas: [{ escuela, zona, jefe, tipo_equipo, total, funciona, no_funciona }]
create or replace function public.importar_calefaccion(p_filas jsonb, p_periodo text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_sector uuid := public.sector_efectivo();
  n integer;
begin
  if not public.es_gerencia() then
    raise exception 'Solo gerencia puede importar el relevamiento.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_periodo), '') = '' then
    raise exception 'Indicá el período del relevamiento (por ejemplo: Mayo 2026).' using errcode = 'P0001';
  end if;

  delete from public.equipamiento_calefaccion e where e.sector_id = v_sector and e.periodo = btrim(p_periodo);

  insert into public.equipamiento_calefaccion
    (sector_id, ubicacion_id, escuela, zona, jefe_sitio_id, jefe_sitio_nombre, tipo_equipo, periodo, cantidad_total, cantidad_funciona)
  select v_sector, u.id, g.escuela, coalesce(u.zona, g.zona),
         u.jefe_sitio_id, case when u.jefe_sitio_id is null then coalesce(u.jefe_sitio_nombre, g.jefe) end,
         g.tipo, btrim(p_periodo), g.total, least(g.funciona, g.total)
    from (
      select min(btrim(f ->> 'escuela')) as escuela, max(nullif(btrim(f ->> 'zona'), '')) as zona,
             max(nullif(btrim(f ->> 'jefe'), '')) as jefe, (f ->> 'tipo_equipo')::public.equipo_calefaccion as tipo,
             sum(round((f ->> 'total')::numeric))::integer as total,
             -- si la planilla no trae "funciona" pero sí "no funciona", se deduce
             sum(round(coalesce(nullif(f ->> 'funciona', '')::numeric,
                                (f ->> 'total')::numeric - coalesce(nullif(f ->> 'no_funciona', '')::numeric, 0))))::integer as funciona
        from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) f
       where public.norm_txt(f ->> 'escuela') <> '' and coalesce((f ->> 'total')::numeric, 0) > 0
       group by public.norm_txt(f ->> 'escuela'), (f ->> 'tipo_equipo')
    ) g
    left join lateral (
      select x.* from public.ubicaciones x
       where x.sector_id = v_sector and public.norm_txt(x.nombre) = public.norm_txt(g.escuela) limit 1
    ) u on true;
  get diagnostics n = row_count;

  return jsonb_build_object('importados', n, 'por_estado', (
    select coalesce(jsonb_object_agg(x.estado, x.c), '{}'::jsonb) from (
      select e.estado, count(*) as c from public.equipamiento_calefaccion e
       where e.sector_id = v_sector and e.periodo = btrim(p_periodo) group by e.estado) x));
end $$;

-- =====================================================================================
-- 7. INSPECCIÓN DE ESTABLECIMIENTOS
-- =====================================================================================
create type public.inspeccion_estado as enum ('en_progreso','generando','completado');

create table public.inspecciones (
  id                uuid primary key default gen_random_uuid(),
  sector_id         uuid not null references public.sectores(id),
  titulo            text not null,
  ubicacion_id      uuid,
  establecimiento   text not null,
  direccion         text,
  zona              text,
  inspector_id      uuid references public.perfiles(id) on delete set null default auth.uid(),
  estado            public.inspeccion_estado not null default 'en_progreso',
  fecha_inspeccion  date not null default current_date,
  -- secciones: [{ id, nombre, urgencia, transcripcion, notas_libres, fotos[], completada }]
  secciones         jsonb not null default '[]'::jsonb check (jsonb_typeof(secciones) = 'array'),
  informe_generado  text,
  id_origen         text unique,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id)
);
create index inspecciones_idx on public.inspecciones(sector_id, created_at desc);
select public.aplicar_rls_sector('public.inspecciones');

-- Inspeccionan gerencia, jefes de sitio e inspectores. Borra quien la creó o gerencia.
create or replace function public.validar_inspeccion() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if not (public.es_gerencia() or old.created_by = auth.uid()) then
      raise exception 'Solo quien hizo la inspección o gerencia pueden borrarla.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if not (public.puede_validar() or public.rol_actual() = 'inspector') then
    raise exception 'Tu rol no puede cargar inspecciones.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger b_validar before insert or update or delete on public.inspecciones
  for each row execute function public.validar_inspeccion();

-- =====================================================================================
-- Migración desde la v1: referencia al registro de origen en las tablas que todavía no la tenían.
-- Tiempo real: la app escucha las emergencias nuevas para avisar en el momento.
-- =====================================================================================
alter table public.rutinas_ubicacion add column if not exists id_origen text unique;
alter table public.ordenes_rutina    add column if not exists id_origen text unique;
alter table public.emergencias       add column if not exists id_origen text unique;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'emergencias') then
    alter publication supabase_realtime add table public.emergencias;
  end if;
end $$;

-- búsqueda remota: se suma "direcciones"
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

-- ------------------------------------------------------------------ permisos
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.importar_certificado_historico(jsonb) from authenticated;
