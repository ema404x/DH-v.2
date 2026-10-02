-- =====================================================================================
-- DH1 v2 — Fase 1: FUNDACIÓN
-- Tablas, enums, RLS por sector, triggers, máquina de estados de OT, QR, KPIs.
-- Correr en el SQL Editor de Supabase, sobre un proyecto limpio. Después: fase3, fase4, fase5.
--
-- Reglas que este archivo garantiza (no dependen del código de la app):
--   · Toda tabla de negocio tiene sector_id y UNA sola política: sector_efectivo() o ve_todos.
--   · Un registro sin sector no puede existir (estampar_sector falla cerrado).
--   · Nadie se cambia de sector, de rol ni de "ver todos" a mano (proteger_perfil).
--   · Las transiciones de estado de una OT las valida la base (validar_transicion_ot).
--   · El historial de activos lo escriben los triggers, nadie más.
-- =====================================================================================

-- ------------------------------------------------------------------ enums
create type public.rol_usuario   as enum ('admin','gerente_general','gerente','jefe_sitio','inspector','operario');
create type public.ot_estado     as enum ('pendiente','asignada','en_progreso','pendiente_validacion','completada','cancelada');
create type public.ot_tipo       as enum ('mantenimiento_preventivo','mantenimiento_correctivo','instalacion','inspeccion','reparacion','emergencia');
create type public.prioridad     as enum ('baja','media','alta','urgente');
create type public.activo_estado as enum ('operativo','en_mantenimiento','fuera_de_servicio','baja');
create type public.criticidad    as enum ('baja','media','alta','critica');
create type public.activo_tipo   as enum ('equipo_electrico','equipo_mecanico','instalacion_hvac','instalacion_sanitaria',
                                          'estructura','vehiculo','herramienta','sistemas_informaticos','mobiliario','seguridad','otro');
create type public.historial_tipo as enum ('alta','ot_completada','cambio_estado','movimiento');

-- ------------------------------------------------------------------ sectores y perfiles
create table public.sectores (
  id          uuid primary key default gen_random_uuid(),
  clave       text not null unique check (clave ~ '^[a-z0-9_]+$'),
  nombre      text not null,
  descripcion text,
  color       text,
  icono       text,
  config      jsonb not null default '{}'::jsonb,
  activo      boolean not null default true,
  orden       integer not null default 0,
  created_at  timestamptz not null default now()
);

create table public.perfiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null,
  nombre           text not null,
  rol              public.rol_usuario not null,
  sector_id        uuid not null references public.sectores(id),
  sector_activo_id uuid references public.sectores(id),
  ver_todos        boolean not null default false,
  activo           boolean not null default true,
  telefono         text,
  especialidad     text,
  firma_url        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index perfiles_sector_idx on public.perfiles(sector_id);
create unique index perfiles_email_idx on public.perfiles(lower(email));

-- ------------------------------------------------------------------ funciones de identidad
-- Son las únicas SECURITY DEFINER del sistema: leen el perfil propio sin pasar por la RLS de
-- perfiles (si no, la política se llamaría a sí misma). No reciben parámetros y no escriben.

create or replace function public.sector_efectivo() returns uuid
language sql stable security definer set search_path = public as $$
  select case when p.rol in ('admin','gerente_general')
              then coalesce(p.sector_activo_id, p.sector_id)
              else p.sector_id end
    from public.perfiles p
   where p.id = auth.uid() and p.activo
$$;

create or replace function public.ve_todos_sectores() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.rol = 'admin' and p.ver_todos
                     from public.perfiles p
                    where p.id = auth.uid() and p.activo), false)
$$;

create or replace function public.rol_actual() returns public.rol_usuario
language sql stable security definer set search_path = public as $$
  select p.rol from public.perfiles p where p.id = auth.uid() and p.activo
$$;

create or replace function public.es_gerencia() returns boolean
language sql stable set search_path = public as $$
  select coalesce(public.rol_actual() in ('admin','gerente_general','gerente'), false)
$$;

create or replace function public.puede_validar() returns boolean
language sql stable set search_path = public as $$
  select coalesce(public.rol_actual() in ('admin','gerente_general','gerente','jefe_sitio'), false)
$$;

-- Conexión sin usuario final: SQL Editor o service_role (migración, edge function).
-- 'anon' nunca llega acá: no tiene políticas sobre ninguna tabla.
create or replace function public.es_servicio() returns boolean
language sql stable set search_path = public as $$
  select auth.uid() is null
$$;

-- Banderas internas de transacción. Solo las prenden las funciones de este esquema.
create or replace function public.dh1_flag(p_nombre text) returns boolean
language sql stable as $$
  select coalesce(current_setting(p_nombre, true), '') = '1'
$$;

-- ------------------------------------------------------------------ triggers genéricos
create or replace function public.tocar_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Falla cerrado: sin sector no se guarda nada. Nunca hay un sector por defecto.
create or replace function public.estampar_sector() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.sector_id is null then
      new.sector_id := public.sector_efectivo();
    end if;
    if new.sector_id is null then
      raise exception 'No se puede guardar sin sector. Tu usuario no tiene un sector asignado.'
        using errcode = 'P0001';
    end if;
  elsif new.sector_id is distinct from old.sector_id then
    raise exception 'El sector de un registro no se puede cambiar.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Permisos de escritura por rol. La RLS aísla por sector; esto decide quién puede escribir.
-- Argumento: 'gerencia' o 'validar' (gerencia + jefe de sitio). Borrar siempre exige gerencia.
create or replace function public.exigir_rol() returns trigger
language plpgsql set search_path = public as $$
declare
  v_ok boolean;
begin
  if public.es_servicio() or public.dh1_flag('dh1.sys_fn') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' or tg_argv[0] = 'gerencia' then
    v_ok := public.es_gerencia();
  else
    v_ok := public.puede_validar();
  end if;
  if not v_ok then
    raise exception 'No tenés permiso para hacer este cambio.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

-- Deja una tabla de negocio lista: RLS con la política única de sector + sellado + updated_at.
create or replace function public.aplicar_rls_sector(p_tabla regclass) returns void
language plpgsql set search_path = public as $$
begin
  execute format('alter table %s enable row level security', p_tabla);
  execute format('drop policy if exists sector on %s', p_tabla);
  execute format($f$
    create policy sector on %s for all to authenticated
      using      (sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores()))
      with check (sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores()))
  $f$, p_tabla);
  execute format('drop trigger if exists a_estampar_sector on %s', p_tabla);
  execute format('create trigger a_estampar_sector before insert or update on %s
                  for each row execute function public.estampar_sector()', p_tabla);
end $$;

-- ------------------------------------------------------------------ RLS de sectores y perfiles
alter table public.sectores enable row level security;
create policy sectores_leer on public.sectores for select to authenticated using (true);
create policy sectores_admin on public.sectores for all to authenticated
  using ((select public.rol_actual()) = 'admin') with check ((select public.rol_actual()) = 'admin');

alter table public.perfiles enable row level security;
-- El perfil propio siempre se lee (un admin parado en otro sector tiene que poder verse a sí mismo).
create policy perfiles_leer on public.perfiles for select to authenticated
  using (id = auth.uid()
         or sector_id = (select public.sector_efectivo())
         or (select public.ve_todos_sectores()));
create policy perfiles_editar on public.perfiles for update to authenticated
  using (id = auth.uid()
         or ((select public.rol_actual()) = 'admin'
             and (sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores()))))
  with check (true);
-- Sin política de insert ni delete: el alta la hace la edge function invitar-usuario (service_role).

create or replace function public.proteger_perfil() returns trigger
language plpgsql set search_path = public as $$
declare
  v_admin boolean;
begin
  new.updated_at := now();
  if public.es_servicio() or public.dh1_flag('dh1.perfil_fn') then
    return new;
  end if;

  v_admin := public.rol_actual() = 'admin';

  if new.id = auth.uid() or not v_admin then
    if new.sector_id is distinct from old.sector_id then
      raise exception 'No podés cambiar tu sector.' using errcode = 'P0001';
    end if;
    if new.rol is distinct from old.rol then
      raise exception 'No podés cambiar tu rol.' using errcode = 'P0001';
    end if;
    if new.sector_activo_id is distinct from old.sector_activo_id then
      raise exception 'El sector activo se cambia con el selector de sector, no a mano.' using errcode = 'P0001';
    end if;
    if new.ver_todos is distinct from old.ver_todos then
      raise exception '"Ver todos" se cambia con su propio control, no a mano.' using errcode = 'P0001';
    end if;
    if new.activo is distinct from old.activo or new.email is distinct from old.email then
      raise exception 'No podés cambiar este dato de tu usuario.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- Un admin editando a otro usuario: puede cambiar rol, sector, nombre y activo.
  -- El sector activo y "ver todos" del otro no se tocan: se reinician si cambia rol o sector.
  if new.sector_id is distinct from old.sector_id or new.rol is distinct from old.rol then
    new.sector_activo_id := null;
    new.ver_todos := false;
  else
    new.sector_activo_id := old.sector_activo_id;
    new.ver_todos := old.ver_todos;
  end if;
  return new;
end $$;

create trigger perfiles_proteger before update on public.perfiles
  for each row execute function public.proteger_perfil();

-- Modelo B: gerente_general y admin cambian de sector activo, de a uno. Nunca ven dos mezclados.
create or replace function public.cambiar_sector_activo(p_sector uuid) returns void
language plpgsql set search_path = public as $$
declare
  v_rol public.rol_usuario := public.rol_actual();
begin
  if auth.uid() is null or v_rol is null then
    raise exception 'Tenés que iniciar sesión.' using errcode = 'P0001';
  end if;
  if v_rol not in ('admin','gerente_general') then
    raise exception 'Tu rol no puede cambiar de sector.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.sectores s where s.id = p_sector and s.activo) then
    raise exception 'Ese sector no existe o está inactivo.' using errcode = 'P0001';
  end if;
  perform set_config('dh1.perfil_fn', '1', true);
  update public.perfiles set sector_activo_id = p_sector where id = auth.uid();
  perform set_config('dh1.perfil_fn', '', true);
end $$;

create or replace function public.set_ver_todos(p_valor boolean) returns void
language plpgsql set search_path = public as $$
begin
  if public.rol_actual() is distinct from 'admin' then
    raise exception 'Solo un administrador puede ver todos los sectores.' using errcode = 'P0001';
  end if;
  perform set_config('dh1.perfil_fn', '1', true);
  update public.perfiles set ver_todos = coalesce(p_valor, false) where id = auth.uid();
  perform set_config('dh1.perfil_fn', '', true);
end $$;

-- ------------------------------------------------------------------ token de QR
create or replace function public.nuevo_token_qr() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '')
$$;

-- ------------------------------------------------------------------ ubicaciones
create table public.ubicaciones (
  id            uuid primary key default gen_random_uuid(),
  sector_id     uuid not null references public.sectores(id),
  nombre        text not null,
  codigo        text,
  direccion     text,
  zona          text,
  descripcion   text,
  m2            numeric(12,2),
  lat           double precision,
  lng           double precision,
  jefe_sitio_id uuid references public.perfiles(id) on delete set null,
  activa        boolean not null default true,
  qr_token      text not null unique default public.nuevo_token_qr(),
  datos         jsonb not null default '{}'::jsonb,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, sector_id)
);
create index ubicaciones_sector_idx on public.ubicaciones(sector_id, nombre);
select public.aplicar_rls_sector('public.ubicaciones');
create trigger b_rol before insert or update or delete on public.ubicaciones
  for each row execute function public.exigir_rol('gerencia');
create trigger c_updated before update on public.ubicaciones
  for each row execute function public.tocar_updated_at();

-- ------------------------------------------------------------------ activos
create table public.activos (
  id                    uuid primary key default gen_random_uuid(),
  sector_id             uuid not null references public.sectores(id),
  nombre                text not null,
  codigo                text,
  tipo                  public.activo_tipo not null default 'otro',
  marca                 text,
  modelo                text,
  numero_serie          text,
  ubicacion_id          uuid,
  padre_id              uuid,
  area                  text,
  estado                public.activo_estado not null default 'operativo',
  criticidad            public.criticidad not null default 'media',
  fecha_compra          date,
  garantia_hasta        date,
  ultimo_mantenimiento  date,
  proximo_mantenimiento date,
  frecuencia_mant_dias  integer check (frecuencia_mant_dias is null or frecuencia_mant_dias > 0),
  costo_compra          numeric(16,2),
  responsable_id        uuid references public.perfiles(id) on delete set null,
  documentos            jsonb not null default '[]'::jsonb,
  notas                 text,
  qr_token              text not null unique default public.nuevo_token_qr(),
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, sector_id),
  -- Ubicación y padre tienen que ser del mismo sector: lo garantiza la clave compuesta.
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id),
  foreign key (padre_id, sector_id)     references public.activos(id, sector_id),
  check (padre_id is null or padre_id <> id)
);
create index activos_sector_idx    on public.activos(sector_id, nombre);
create index activos_ubicacion_idx on public.activos(ubicacion_id);
create index activos_padre_idx     on public.activos(padre_id);
create index activos_proximo_idx   on public.activos(sector_id, proximo_mantenimiento);
select public.aplicar_rls_sector('public.activos');
create trigger b_rol before insert or update or delete on public.activos
  for each row execute function public.exigir_rol('validar');
create trigger c_updated before update on public.activos
  for each row execute function public.tocar_updated_at();

create or replace function public.validar_jerarquia_activo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.padre_id is not null and exists (
    with recursive arriba as (
      select a.id, a.padre_id from public.activos a where a.id = new.padre_id
      union all
      select a.id, a.padre_id from public.activos a join arriba on a.id = arriba.padre_id
    )
    select 1 from arriba where id = new.id
  ) then
    raise exception 'Un activo no puede depender de uno de sus propios componentes.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger d_jerarquia before insert or update of padre_id on public.activos
  for each row execute function public.validar_jerarquia_activo();

-- ------------------------------------------------------------------ historial de activos (solo triggers)
create table public.activo_historial (
  id         uuid primary key default gen_random_uuid(),
  sector_id  uuid not null references public.sectores(id),
  activo_id  uuid not null,
  tipo       public.historial_tipo not null,
  detalle    text not null,
  datos      jsonb not null default '{}'::jsonb,
  ot_id      uuid,
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (activo_id, sector_id) references public.activos(id, sector_id) on delete cascade
);
create index activo_historial_idx on public.activo_historial(activo_id, created_at desc);
select public.aplicar_rls_sector('public.activo_historial');

create or replace function public.proteger_historial() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.hist_fn') then
    return coalesce(new, old);
  end if;
  raise exception 'El historial de un activo se registra solo. No se puede cargar ni modificar a mano.'
    using errcode = 'P0001';
end $$;
create trigger b_proteger before insert or update or delete on public.activo_historial
  for each row execute function public.proteger_historial();

create or replace function public.registrar_historial(
  p_sector uuid, p_activo uuid, p_tipo public.historial_tipo, p_detalle text, p_datos jsonb, p_ot uuid
) returns void
language plpgsql set search_path = public as $$
begin
  perform set_config('dh1.hist_fn', '1', true);
  insert into public.activo_historial (sector_id, activo_id, tipo, detalle, datos, ot_id)
  values (p_sector, p_activo, p_tipo, p_detalle, coalesce(p_datos, '{}'::jsonb), p_ot);
  perform set_config('dh1.hist_fn', '', true);
end $$;

create or replace function public.historial_activo_trg() returns trigger
language plpgsql set search_path = public as $$
declare
  v_desde text;
  v_hasta text;
begin
  if tg_op = 'INSERT' then
    perform public.registrar_historial(new.sector_id, new.id, 'alta', 'Alta del activo', null, null);
    return new;
  end if;
  if new.estado is distinct from old.estado then
    perform public.registrar_historial(new.sector_id, new.id, 'cambio_estado',
      'Estado: ' || replace(old.estado::text, '_', ' ') || ' → ' || replace(new.estado::text, '_', ' '),
      jsonb_build_object('desde', old.estado, 'hasta', new.estado), null);
  end if;
  if new.ubicacion_id is distinct from old.ubicacion_id then
    select u.nombre into v_desde from public.ubicaciones u where u.id = old.ubicacion_id;
    select u.nombre into v_hasta from public.ubicaciones u where u.id = new.ubicacion_id;
    perform public.registrar_historial(new.sector_id, new.id, 'movimiento',
      'Movimiento: ' || coalesce(v_desde, 'sin ubicación') || ' → ' || coalesce(v_hasta, 'sin ubicación'),
      jsonb_build_object('desde', old.ubicacion_id, 'hasta', new.ubicacion_id), null);
  end if;
  return new;
end $$;
create trigger z_historial after insert or update on public.activos
  for each row execute function public.historial_activo_trg();

-- ------------------------------------------------------------------ plantillas de OT
create table public.plantillas_ot (
  id              uuid primary key default gen_random_uuid(),
  sector_id       uuid not null references public.sectores(id),
  nombre          text not null,
  titulo          text not null,
  tipo            public.ot_tipo not null default 'mantenimiento_correctivo',
  prioridad       public.prioridad not null default 'media',
  descripcion     text,
  horas_estimadas numeric(8,2),
  checklist       jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  requiere_fotos  boolean not null default false,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index plantillas_ot_sector_idx on public.plantillas_ot(sector_id, nombre);
select public.aplicar_rls_sector('public.plantillas_ot');
create trigger b_rol before insert or update or delete on public.plantillas_ot
  for each row execute function public.exigir_rol('gerencia');
create trigger c_updated before update on public.plantillas_ot
  for each row execute function public.tocar_updated_at();

-- ------------------------------------------------------------------ órdenes de trabajo
create sequence public.ot_numero_seq;

create table public.ordenes_trabajo (
  id                   uuid primary key default gen_random_uuid(),
  sector_id            uuid not null references public.sectores(id),
  numero               bigint not null unique default nextval('public.ot_numero_seq'),
  codigo               text not null,
  titulo               text not null,
  descripcion          text,
  tipo                 public.ot_tipo not null default 'mantenimiento_correctivo',
  prioridad            public.prioridad not null default 'media',
  estado               public.ot_estado not null default 'pendiente',
  ubicacion_id         uuid,
  activo_id            uuid,
  asignado_a           uuid references public.perfiles(id) on delete set null,
  fecha_programada     date,
  horas_estimadas      numeric(8,2),
  horas_reales         numeric(8,2),
  -- checklist: [{ id, tarea, hecho, nota, foto_url }]
  checklist            jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  requiere_fotos       boolean not null default false,
  -- motivos_incompleto: [{ id, texto }]   materiales_faltantes: [{ material, cantidad, motivo }]
  motivos_incompleto   jsonb not null default '[]'::jsonb check (jsonb_typeof(motivos_incompleto) = 'array'),
  materiales_faltantes jsonb not null default '[]'::jsonb check (jsonb_typeof(materiales_faltantes) = 'array'),
  notas                text,
  rechazo_comentario   text,
  fecha_inicio_real    timestamptz,
  fecha_fin_real       timestamptz,
  fecha_validacion     timestamptz,
  validado_por         uuid references public.perfiles(id) on delete set null,
  gps_lat              double precision,
  gps_lng              double precision,
  gps_precision        double precision,
  origen               text not null default 'manual' check (origen in ('manual','preventivo','migracion')),
  preventivo_clave     text,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id),
  foreign key (activo_id, sector_id)    references public.activos(id, sector_id)
);
create index ot_sector_estado_idx on public.ordenes_trabajo(sector_id, estado);
create index ot_asignado_idx      on public.ordenes_trabajo(asignado_a, estado);
create index ot_ubicacion_idx     on public.ordenes_trabajo(ubicacion_id);
create index ot_activo_idx        on public.ordenes_trabajo(activo_id);
-- Un solo preventivo por activo y vencimiento: es lo que hace idempotente a generar_ots_preventivas.
create unique index ot_preventivo_idx on public.ordenes_trabajo(preventivo_clave) where preventivo_clave is not null;
select public.aplicar_rls_sector('public.ordenes_trabajo');

-- ------------------------------------------------------------------ fotos de OT
create table public.ot_fotos (
  id         uuid primary key default gen_random_uuid(),
  sector_id  uuid not null references public.sectores(id),
  ot_id      uuid not null,
  path       text not null,
  url        text not null,
  subida_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (ot_id, sector_id) references public.ordenes_trabajo(id, sector_id) on delete cascade
);
create index ot_fotos_ot_idx on public.ot_fotos(ot_id);
select public.aplicar_rls_sector('public.ot_fotos');

create or replace function public.proteger_foto_ot() returns trigger
language plpgsql set search_path = public as $$
declare
  v_estado public.ot_estado;
begin
  if public.es_servicio() then
    return coalesce(new, old);
  end if;
  select o.estado into v_estado from public.ordenes_trabajo o where o.id = coalesce(new.ot_id, old.ot_id);
  if v_estado in ('completada','cancelada') then
    raise exception 'La orden está cerrada. No se pueden cambiar sus fotos.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Una foto no se modifica: se borra y se sube de nuevo.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger b_proteger before insert or update or delete on public.ot_fotos
  for each row execute function public.proteger_foto_ot();

-- ------------------------------------------------------------------ máquina de estados de OT
--
--   pendiente ─────────────┐
--      │ (se asigna)       │ iniciar (cualquiera del sector)
--      ▼                   ▼
--   asignada ──────────► en_progreso ──finalizar──► pendiente_validacion ──aprobar──► completada
--                            ▲                              │
--                            └──────────rechazar────────────┘
--   cancelar: desde cualquier estado abierto. completada y cancelada son finales.
--   Asignar, aprobar, rechazar y cancelar: solo gerencia o jefe de sitio.

create or replace function public.preparar_ot() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := 'OT-' || lpad(new.numero::text, 6, '0');
  end if;
  if public.es_servicio() or public.dh1_flag('dh1.sys_fn') then
    return new;
  end if;
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden crear órdenes de trabajo.' using errcode = 'P0001';
  end if;
  -- Una orden nueva nunca nace avanzada.
  new.estado := case when new.asignado_a is null then 'pendiente' else 'asignada' end::public.ot_estado;
  new.fecha_inicio_real := null;
  new.fecha_fin_real := null;
  new.fecha_validacion := null;
  new.validado_por := null;
  new.rechazo_comentario := null;
  return new;
end $$;
create trigger b_preparar before insert on public.ordenes_trabajo
  for each row execute function public.preparar_ot();

create or replace function public.validar_transicion_ot() returns trigger
language plpgsql set search_path = public as $$
declare
  v_valida boolean;
begin
  new.updated_at := now();
  if public.es_servicio() or public.dh1_flag('dh1.sys_fn') then
    return new;
  end if;

  v_valida := public.puede_validar();

  -- El operario carga la ejecución (checklist, notas, motivos, faltantes, horas, GPS).
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
create trigger b_transicion before update on public.ordenes_trabajo
  for each row execute function public.validar_transicion_ot();

create trigger c_borrar before delete on public.ordenes_trabajo
  for each row execute function public.exigir_rol('gerencia');

-- Al completarse una OT con activo: historial + (si es preventiva) reprogramar el mantenimiento.
create or replace function public.ot_completada_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estado = 'completada' and old.estado <> 'completada' and new.activo_id is not null then
    perform public.registrar_historial(new.sector_id, new.activo_id, 'ot_completada',
      'Orden ' || new.codigo || ' completada: ' || new.titulo,
      jsonb_build_object('tipo', new.tipo, 'codigo', new.codigo), new.id);
    if new.tipo = 'mantenimiento_preventivo' then
      perform set_config('dh1.sys_fn', '1', true);
      update public.activos a
         set ultimo_mantenimiento  = current_date,
             proximo_mantenimiento = case when a.frecuencia_mant_dias is null then null
                                          else current_date + a.frecuencia_mant_dias end
       where a.id = new.activo_id;
      perform set_config('dh1.sys_fn', '', true);
    end if;
  end if;
  return new;
end $$;
create trigger z_completada after update on public.ordenes_trabajo
  for each row execute function public.ot_completada_trg();

-- ------------------------------------------------------------------ QR: un solo formato
-- <origen>/q?t=<token>. Se resuelve con la RLS del usuario: un QR de otro sector "no existe".
create or replace function public.resolver_qr(p_token text) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
    raise exception 'Tenés que iniciar sesión.' using errcode = 'P0001';
  end if;
  select jsonb_build_object('tipo', 'ubicacion', 'id', u.id, 'nombre', u.nombre)
    into v from public.ubicaciones u where u.qr_token = p_token;
  if v is null then
    select jsonb_build_object('tipo', 'activo', 'id', a.id, 'nombre', a.nombre)
      into v from public.activos a where a.qr_token = p_token;
  end if;
  if v is null then
    raise exception 'Este QR no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  return v;
end $$;

-- ------------------------------------------------------------------ KPIs (con la RLS del que consulta)
create view public.v_kpi_ots with (security_invoker = true) as
select o.sector_id,
       count(*) filter (where o.estado = 'pendiente')            as pendientes,
       count(*) filter (where o.estado = 'asignada')             as asignadas,
       count(*) filter (where o.estado = 'en_progreso')          as en_progreso,
       count(*) filter (where o.estado = 'pendiente_validacion') as por_validar,
       count(*) filter (where o.estado = 'completada'
                          and o.fecha_validacion >= date_trunc('month', now())) as completadas_mes,
       count(*) filter (where o.estado in ('pendiente','asignada','en_progreso')
                          and o.fecha_programada < current_date) as vencidas,
       count(*) filter (where o.estado in ('pendiente','asignada','en_progreso')
                          and o.prioridad = 'urgente')           as urgentes
  from public.ordenes_trabajo o
 group by o.sector_id;

create view public.v_kpi_activos with (security_invoker = true) as
select a.sector_id,
       count(*) filter (where a.estado <> 'baja')             as total,
       count(*) filter (where a.estado = 'operativo')         as operativos,
       count(*) filter (where a.estado = 'en_mantenimiento')  as en_mantenimiento,
       count(*) filter (where a.estado = 'fuera_de_servicio') as fuera_de_servicio,
       count(*) filter (where a.estado <> 'baja' and a.proximo_mantenimiento is not null
                          and a.proximo_mantenimiento <= current_date + 7) as preventivos_por_vencer
  from public.activos a
 group by a.sector_id;

-- ------------------------------------------------------------------ permisos
-- 'anon' no toca nada. 'authenticated' llega a las tablas, y ahí manda la RLS.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;

-- ------------------------------------------------------------------ sectores iniciales
insert into public.sectores (clave, nombre, orden) values
  ('escuela', 'Escuelas', 1),
  ('bapro',   'Banco Provincia', 2)
on conflict (clave) do nothing;
