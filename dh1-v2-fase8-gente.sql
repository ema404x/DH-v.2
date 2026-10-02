-- =====================================================================================
-- DH1 v2 — Fase 8 (tanda 2): gente y campo
--
--   1. Empleados: ficha, datos reservados, vínculo con el usuario
--   2. Personal asignado a un lugar y tablets de cuadrilla
--   3. Fichaje (entrada / salida) con posición y lugar
--   4. Horas cargadas a una orden de trabajo
--   5. Mapa: establecimientos con su semáforo, y v_ordenes con el jefe y la posición del lugar
--
-- Se corre después de la fase 7. Es aditiva: no borra ni cambia datos existentes.
--
-- Dos excepciones a la política única de sector (§2.1), decididas con Emanuel el 30/9/2026 para no
-- perder la privacidad que tenía la v1:
--   · empleados_reservado (DNI, costo por hora, contacto de emergencia, notas): lo lee gerencia y el propio empleado.
--   · fichajes (con posición GPS): los lee quien valida (gerencia y jefes de sitio), el propio empleado,
--     quien lo registró y la tablet de su cuadrilla.
-- En las dos, el sector sigue siendo la primera condición: nada cruza de un sector a otro.
-- =====================================================================================

create type public.empleado_estado as enum ('activo','licencia','vacaciones','inactivo');
create type public.especialidad    as enum ('electricidad','plomeria','pintura','albanileria','carpinteria','herreria','climatizacion','general','otro');
create type public.fichaje_tipo    as enum ('entrada','salida');
create type public.hora_tipo       as enum ('normal','extra','guardia');

-- Distancia en metros entre dos puntos (fórmula del haversine).
create or replace function public.distancia_m(p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision)
returns integer language sql immutable as $$
  select round(6371000 * 2 * asin(least(1, sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
           + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)))))::integer
$$;

-- Configuración del sector: radio para considerar que un fichaje fue "en el lugar", y cómo se buscan
-- las direcciones en el mapa (en escuelas, dentro de la Ciudad de Buenos Aires, como en la v1).
update public.sectores
   set config = config || '{"fichaje_radio_m": 300}'::jsonb
 where not (config ? 'fichaje_radio_m');
update public.sectores
   set config = config || '{"geocodificacion": {"sufijo": "Ciudad Autónoma de Buenos Aires, Argentina", "viewbox": "-58.55,-34.52,-58.33,-34.74"}}'::jsonb
 where clave = 'escuela' and not (config ? 'geocodificacion');

-- =====================================================================================
-- 1. EMPLEADOS
-- =====================================================================================
-- La ficha. El rol de acceso NO va acá: es del usuario (perfiles.rol). "puesto" es el cargo, texto libre.
create table public.empleados (
  id              uuid primary key default gen_random_uuid(),
  sector_id       uuid not null references public.sectores(id),
  nombre          text not null check (btrim(nombre) <> ''),
  puesto          text,
  especialidad    public.especialidad not null default 'general',
  estado          public.empleado_estado not null default 'activo',
  email           text,
  telefono        text,
  -- usuario con el que ingresa, si tiene. Un usuario es de un solo empleado.
  perfil_id       uuid unique references public.perfiles(id) on delete set null,
  jefe_sitio_id   uuid references public.perfiles(id) on delete set null,
  zona            text,
  ubicacion_id    uuid,
  fecha_ingreso   date,
  certificaciones text[] not null default '{}',
  id_origen       text unique,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id)
);
create index empleados_sector_idx on public.empleados(sector_id, nombre);
create index empleados_jefe_idx   on public.empleados(jefe_sitio_id);
-- Un email, una ficha vigente por sector (la v1 permitía duplicados y después no sabía a cuál vincular).
create unique index empleados_email_idx on public.empleados(sector_id, lower(email)) where email is not null and estado <> 'inactivo';
select public.aplicar_rls_sector('public.empleados');
create trigger b_rol before insert or update or delete on public.empleados
  for each row execute function public.exigir_rol('gerencia');

-- Ordena los datos y engancha la ficha con su usuario por email (mismo sector), si todavía no tiene.
create or replace function public.preparar_empleado() returns trigger
language plpgsql set search_path = public as $$
begin
  new.nombre := btrim(regexp_replace(new.nombre, '\s+', ' ', 'g'));
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.puesto := nullif(btrim(coalesce(new.puesto, '')), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  if new.perfil_id is not null then
    if not exists (select 1 from public.perfiles p where p.id = new.perfil_id and p.sector_id = new.sector_id) then
      raise exception 'Ese usuario no es de este sector.' using errcode = 'P0001';
    end if;
  elsif new.email is not null and (tg_op = 'INSERT' or new.email is distinct from old.email or old.perfil_id is null) then
    select p.id into new.perfil_id
      from public.perfiles p
     where lower(p.email) = new.email and p.sector_id = new.sector_id
       and not exists (select 1 from public.empleados x where x.perfil_id = p.id and x.id <> new.id);
  end if;
  if new.jefe_sitio_id is not null
     and not exists (select 1 from public.perfiles p where p.id = new.jefe_sitio_id and p.sector_id = new.sector_id) then
    raise exception 'El jefe de sitio tiene que ser un usuario de este sector.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger c_preparar before insert or update on public.empleados
  for each row execute function public.preparar_empleado();

-- Al dar de alta un usuario (o corregirle el email), se engancha con la ficha que tenga ese email.
create or replace function public.vincular_perfil_nuevo() returns trigger
language plpgsql set search_path = public as $$
declare
  v_prev text := current_setting('dh1.sys_fn', true);
begin
  perform set_config('dh1.sys_fn', '1', true);
  update public.empleados e
     set perfil_id = new.id
   where e.perfil_id is null and e.email = lower(new.email) and e.sector_id = new.sector_id
     and e.estado <> 'inactivo'
     and not exists (select 1 from public.empleados x where x.perfil_id = new.id);
  perform set_config('dh1.sys_fn', coalesce(v_prev, ''), true);
  return new;
end $$;
create trigger z_vincular_empleado after insert or update of email on public.perfiles
  for each row execute function public.vincular_perfil_nuevo();

-- Engancha de una vez todas las fichas del sector con sus usuarios, por email. Devuelve cuántas enganchó.
create or replace function public.vincular_empleados() returns integer
language plpgsql set search_path = public as $$
declare
  v_n integer;
begin
  if not (public.es_servicio() or public.es_gerencia()) then
    raise exception 'Solo gerencia puede vincular empleados con usuarios.' using errcode = 'P0001';
  end if;
  update public.empleados e
     set perfil_id = p.id
    from public.perfiles p
   where e.perfil_id is null and e.email is not null and e.estado <> 'inactivo'
     and lower(p.email) = e.email and p.sector_id = e.sector_id
     and (public.es_servicio() or e.sector_id = public.sector_efectivo())
     and not exists (select 1 from public.empleados x where x.perfil_id = p.id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Datos reservados de la ficha. Tabla aparte para poder restringir quién los lee.
create table public.empleados_reservado (
  empleado_id         uuid primary key,
  sector_id           uuid not null references public.sectores(id),
  dni                 text,
  costo_hora          numeric(12,2) check (costo_hora is null or costo_hora >= 0),
  contacto_emergencia text,
  telefono_emergencia text,
  notas               text,
  updated_at          timestamptz not null default now(),
  foreign key (empleado_id, sector_id) references public.empleados(id, sector_id) on delete cascade
);
alter table public.empleados_reservado enable row level security;
create policy reservado_leer on public.empleados_reservado for select to authenticated
  using ((sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores()))
         and ((select public.es_gerencia())
              or exists (select 1 from public.empleados e where e.id = empleado_id and e.perfil_id = auth.uid())));
create policy reservado_alta on public.empleados_reservado for insert to authenticated
  with check ((sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores())) and (select public.es_gerencia()));
create policy reservado_cambio on public.empleados_reservado for update to authenticated
  using      ((sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores())) and (select public.es_gerencia()))
  with check ((sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores())) and (select public.es_gerencia()));
create policy reservado_baja on public.empleados_reservado for delete to authenticated
  using ((sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores())) and (select public.es_gerencia()));
create trigger a_estampar_sector before insert or update on public.empleados_reservado
  for each row execute function public.estampar_sector();
create trigger c_updated before update on public.empleados_reservado
  for each row execute function public.tocar_updated_at();

-- =====================================================================================
-- 2. PERSONAL ASIGNADO A UN LUGAR Y TABLETS DE CUADRILLA
-- =====================================================================================
-- Quién trabaja habitualmente en cada lugar (en la v1 era una lista de nombres escrita en la ubicación).
create table public.ubicacion_empleados (
  ubicacion_id uuid not null,
  empleado_id  uuid not null,
  sector_id    uuid not null references public.sectores(id),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  primary key (ubicacion_id, empleado_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id) on delete cascade,
  foreign key (empleado_id, sector_id)  references public.empleados(id, sector_id) on delete cascade
);
create index ubicacion_empleados_emp_idx on public.ubicacion_empleados(empleado_id);
select public.aplicar_rls_sector('public.ubicacion_empleados');

-- Asignar y desasignar personal: gerencia o jefe de sitio.
create or replace function public.exigir_validar() returns trigger
language plpgsql set search_path = public as $$
begin
  if not (public.es_servicio() or public.dh1_flag('dh1.sys_fn') or public.puede_validar()) then
    raise exception 'No tenés permiso para hacer este cambio.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger b_rol before insert or update or delete on public.ubicacion_empleados
  for each row execute function public.exigir_validar();

-- Una tablet de cuadrilla: un usuario propio (el de la tablet) atado a un jefe de sitio. Con ese usuario la
-- tablet ve las órdenes de los lugares de ese jefe y ficha a su gente. Reemplaza al código de activación de la v1.
create table public.tablets (
  id               uuid primary key default gen_random_uuid(),
  sector_id        uuid not null references public.sectores(id),
  nombre           text not null check (btrim(nombre) <> ''),
  jefe_sitio_id    uuid not null references public.perfiles(id) on delete cascade,
  perfil_id        uuid unique references public.perfiles(id) on delete set null,
  activa           boolean not null default true,
  ultima_actividad timestamptz,
  notas            text,
  id_origen        text unique,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, sector_id),
  unique (sector_id, nombre)
);
select public.aplicar_rls_sector('public.tablets');
create trigger b_rol before insert or update or delete on public.tablets
  for each row execute function public.exigir_rol('gerencia');

create or replace function public.validar_tablet() returns trigger
language plpgsql set search_path = public as $$
begin
  new.nombre := btrim(new.nombre);
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if not exists (select 1 from public.perfiles p where p.id = new.jefe_sitio_id and p.sector_id = new.sector_id) then
    raise exception 'El jefe de sitio tiene que ser un usuario de este sector.' using errcode = 'P0001';
  end if;
  if new.perfil_id is not null then
    if not exists (select 1 from public.perfiles p where p.id = new.perfil_id and p.sector_id = new.sector_id) then
      raise exception 'El usuario de la tablet tiene que ser de este sector.' using errcode = 'P0001';
    end if;
    if new.perfil_id = new.jefe_sitio_id then
      raise exception 'La tablet necesita un usuario propio, distinto del jefe de sitio.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger c_validar before insert or update on public.tablets
  for each row execute function public.validar_tablet();

create view public.v_tablets with (security_invoker = true) as
select t.*, j.nombre as jefe_sitio_nombre, p.nombre as usuario_nombre, p.email as usuario_email,
       (select count(*) from public.empleados e where e.jefe_sitio_id = t.jefe_sitio_id and e.estado <> 'inactivo')::integer as cuadrilla
  from public.tablets t
  left join public.perfiles j on j.id = t.jefe_sitio_id
  left join public.perfiles p on p.id = t.perfil_id;

-- La tablet con la que ingresó el usuario (o null si no es una tablet). Deja anotada la actividad.
create or replace function public.mi_tablet() returns jsonb
language plpgsql set search_path = public as $$
declare
  t public.tablets%rowtype;
  v_prev text := current_setting('dh1.sys_fn', true);
begin
  select * into t from public.tablets x where x.perfil_id = auth.uid() and x.activa;
  if not found then
    return null;
  end if;
  perform set_config('dh1.sys_fn', '1', true);
  update public.tablets set ultima_actividad = now() where id = t.id;
  perform set_config('dh1.sys_fn', coalesce(v_prev, ''), true);
  return jsonb_build_object('id', t.id, 'nombre', t.nombre, 'jefe_sitio_id', t.jefe_sitio_id,
                            'jefe_sitio_nombre', (select p.nombre from public.perfiles p where p.id = t.jefe_sitio_id));
end $$;

-- =====================================================================================
-- 3. FICHAJE
-- =====================================================================================
create table public.fichajes (
  id             uuid primary key default gen_random_uuid(),
  sector_id      uuid not null references public.sectores(id),
  empleado_id    uuid not null,
  tipo           public.fichaje_tipo not null,
  momento        timestamptz not null default now(),
  ubicacion_id   uuid,
  lat            double precision,
  lng            double precision,
  precision_m    double precision,
  -- distancia al lugar, si se conocen las dos posiciones. "lejos": pasó el radio del sector. Se avisa, no se bloquea.
  distancia_m    integer,
  lejos          boolean not null default false,
  -- propio: fichó con su usuario · tablet: lo fichó la tablet de la cuadrilla · jefe / gerencia: lo cargó otra persona
  origen         text not null default 'propio' check (origen in ('propio','tablet','jefe','gerencia','migracion')),
  registrado_por uuid references public.perfiles(id) on delete set null default auth.uid(),
  dispositivo    text,
  notas          text,
  id_origen      text unique,
  created_at     timestamptz not null default now(),
  foreign key (empleado_id, sector_id)  references public.empleados(id, sector_id) on delete cascade,
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id)
);
create index fichajes_empleado_idx on public.fichajes(empleado_id, momento desc);
create index fichajes_sector_idx   on public.fichajes(sector_id, momento desc);

alter table public.fichajes enable row level security;
create policy fichajes_leer on public.fichajes for select to authenticated
  using ((sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores()))
         and ((select public.puede_validar())
              or registrado_por = auth.uid()
              or exists (select 1 from public.empleados e where e.id = empleado_id and e.perfil_id = auth.uid())
              or exists (select 1 from public.tablets t
                           join public.empleados e on e.jefe_sitio_id = t.jefe_sitio_id
                          where t.perfil_id = auth.uid() and t.activa and e.id = empleado_id)));
create policy fichajes_alta on public.fichajes for insert to authenticated
  with check (sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores()));
create policy fichajes_baja on public.fichajes for delete to authenticated
  using (sector_id = (select public.sector_efectivo()) or (select public.ve_todos_sectores()));
create trigger a_estampar_sector before insert or update on public.fichajes
  for each row execute function public.estampar_sector();

-- Un fichaje se registra solo con fichar(). No se edita. Lo borra gerencia (queda quién y cuándo en la auditoría de la tanda 5).
create or replace function public.proteger_fichaje() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if not public.dh1_flag('dh1.fich_fn') then
      raise exception 'Los fichajes se registran con el botón Fichar.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Un fichaje no se modifica. Si está mal, gerencia lo borra y lo carga de nuevo.' using errcode = 'P0001';
  end if;
  if not public.es_gerencia() then
    raise exception 'Solo gerencia puede borrar un fichaje.' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger b_proteger before insert or update or delete on public.fichajes
  for each row execute function public.proteger_fichaje();

-- Registra una entrada o una salida.
--   · Sin p_empleado: ficha el propio usuario (si todavía no tiene ficha de empleado, se le crea una mínima).
--   · Con p_empleado: lo ficha otro. Solo gerencia, un jefe de sitio o la tablet de la cuadrilla de ese empleado.
--   · Sin p_tipo: alterna según su último fichaje (después de una entrada, salida).
--   · El lugar sale del QR escaneado (p_qr), de p_ubicacion o, si hay posición, del lugar más cercano dentro del radio.
--   · p_id lo genera el teléfono: reenviar el mismo fichaje (cola sin señal) no lo duplica.
--   · p_momento: la hora en que se fichó sin señal. Hasta 3 días para atrás; gerencia puede cargar cualquier fecha pasada.
create or replace function public.fichar(
  p_empleado    uuid default null,
  p_tipo        public.fichaje_tipo default null,
  p_qr          text default null,
  p_ubicacion   uuid default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_precision   double precision default null,
  p_dispositivo text default null,
  p_id          uuid default null,
  p_momento     timestamptz default null,
  p_nota        text default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_sector   uuid := public.sector_efectivo();
  v_emp      public.empleados%rowtype;
  v_perfil   public.perfiles%rowtype;
  v_origen   text := 'propio';
  v_momento  timestamptz := coalesce(p_momento, now());
  v_ultimo   public.fichajes%rowtype;
  v_tipo     public.fichaje_tipo;
  v_ubi      public.ubicaciones%rowtype;
  v_dist     integer;
  v_radio    integer;
  v_tablet   uuid;
  v_id       uuid := coalesce(p_id, gen_random_uuid());
  v_prev     text;
  v_fila     public.fichajes%rowtype;
begin
  if v_uid is null or v_sector is null then
    raise exception 'Tenés que iniciar sesión.' using errcode = 'P0001';
  end if;

  -- Reenvío del mismo fichaje: se devuelve el que ya está.
  if p_id is not null then
    select * into v_fila from public.fichajes f where f.id = p_id;
    if found then
      return jsonb_build_object('id', v_fila.id, 'tipo', v_fila.tipo, 'momento', v_fila.momento, 'empleado_id', v_fila.empleado_id,
                                'ubicacion_id', v_fila.ubicacion_id, 'distancia_m', v_fila.distancia_m, 'lejos', v_fila.lejos, 'repetido', true);
    end if;
  end if;

  -- ¿A quién se ficha?
  if p_empleado is null then
    select * into v_emp from public.empleados e where e.perfil_id = v_uid and e.sector_id = v_sector;
    if not found then
      select * into v_perfil from public.perfiles p where p.id = v_uid;
      if v_perfil.sector_id <> v_sector then
        raise exception 'Estás parado en otro sector. Para fichar, volvé al tuyo con el selector de sector.' using errcode = 'P0001';
      end if;
      v_prev := current_setting('dh1.sys_fn', true);
      perform set_config('dh1.sys_fn', '1', true);
      insert into public.empleados (nombre, email, perfil_id, puesto)
      values (v_perfil.nombre, v_perfil.email, v_uid, null)
      returning * into v_emp;
      perform set_config('dh1.sys_fn', coalesce(v_prev, ''), true);
    end if;
  else
    select * into v_emp from public.empleados e where e.id = p_empleado;
    if not found then
      raise exception 'Ese empleado no existe o no es de tu sector.' using errcode = 'P0001';
    end if;
    if v_emp.perfil_id is distinct from v_uid then
      select t.id into v_tablet from public.tablets t
       where t.perfil_id = v_uid and t.activa and t.jefe_sitio_id = v_emp.jefe_sitio_id;
      if v_tablet is not null then
        v_origen := 'tablet';
      elsif public.puede_validar() then
        v_origen := case when public.es_gerencia() then 'gerencia' else 'jefe' end;
      else
        raise exception 'Solo podés fichar por vos. A otra persona la ficha su jefe de sitio, gerencia o la tablet de su cuadrilla.'
          using errcode = 'P0001';
      end if;
    end if;
  end if;
  if v_emp.estado = 'inactivo' then
    raise exception '% está dado de baja: no puede fichar.', v_emp.nombre using errcode = 'P0001';
  end if;

  -- ¿Cuándo?
  if v_momento > now() + interval '5 minutes' then
    raise exception 'La hora del fichaje no puede ser futura.' using errcode = 'P0001';
  end if;
  if v_momento < now() - interval '3 days' and not public.es_gerencia() then
    raise exception 'Ese fichaje es de hace más de 3 días. Pedile a gerencia que lo cargue.' using errcode = 'P0001';
  end if;

  -- ¿Entrada o salida?
  select * into v_ultimo from public.fichajes f
   where f.empleado_id = v_emp.id and f.momento <= v_momento
   order by f.momento desc limit 1;
  v_tipo := coalesce(p_tipo, case when v_ultimo.tipo = 'entrada' then 'salida'::public.fichaje_tipo else 'entrada'::public.fichaje_tipo end);
  -- Doble toque: otra marca a menos de un minuto de la anterior, sin pedir expresamente el tipo contrario.
  -- Se devuelve la que ya está (si no, un doble toque dejaría una entrada y una salida seguidas).
  if v_ultimo.id is not null and v_momento - v_ultimo.momento < interval '1 minute'
     and (p_tipo is null or p_tipo = v_ultimo.tipo) then
    return jsonb_build_object('id', v_ultimo.id, 'tipo', v_ultimo.tipo, 'momento', v_ultimo.momento, 'empleado_id', v_emp.id,
                              'empleado', v_emp.nombre, 'ubicacion_id', v_ultimo.ubicacion_id, 'distancia_m', v_ultimo.distancia_m,
                              'lejos', v_ultimo.lejos, 'repetido', true);
  end if;

  -- ¿Dónde?
  v_radio := coalesce((select nullif(s.config ->> 'fichaje_radio_m', '')::integer from public.sectores s where s.id = v_sector), 300);
  if nullif(btrim(coalesce(p_qr, '')), '') is not null then
    select * into v_ubi from public.ubicaciones u where u.qr_token = btrim(p_qr);
    if not found then
      raise exception 'Este QR no es de un lugar de tu sector.' using errcode = 'P0001';
    end if;
  elsif p_ubicacion is not null then
    select * into v_ubi from public.ubicaciones u where u.id = p_ubicacion;
    if not found then
      raise exception 'Ese lugar no existe o no es de tu sector.' using errcode = 'P0001';
    end if;
  elsif p_lat is not null and p_lng is not null then
    select u.* into v_ubi
      from public.ubicaciones u
     where u.sector_id = v_sector and u.activa and u.lat is not null and u.lng is not null
       and public.distancia_m(p_lat, p_lng, u.lat, u.lng) <= v_radio
     order by public.distancia_m(p_lat, p_lng, u.lat, u.lng)
     limit 1;
  end if;
  if v_ubi.id is not null and p_lat is not null and p_lng is not null and v_ubi.lat is not null and v_ubi.lng is not null then
    v_dist := public.distancia_m(p_lat, p_lng, v_ubi.lat, v_ubi.lng);
  end if;

  v_prev := current_setting('dh1.fich_fn', true);
  perform set_config('dh1.fich_fn', '1', true);
  insert into public.fichajes (id, empleado_id, tipo, momento, ubicacion_id, lat, lng, precision_m, distancia_m, lejos,
                               origen, dispositivo, notas)
  values (v_id, v_emp.id, v_tipo, v_momento, v_ubi.id, p_lat, p_lng, p_precision, v_dist, coalesce(v_dist > v_radio, false),
          v_origen, left(p_dispositivo, 160), nullif(btrim(coalesce(p_nota, '')), ''))
  returning * into v_fila;
  perform set_config('dh1.fich_fn', coalesce(v_prev, ''), true);

  if v_tablet is not null then
    v_prev := current_setting('dh1.sys_fn', true);
    perform set_config('dh1.sys_fn', '1', true);
    update public.tablets set ultima_actividad = now() where id = v_tablet;
    perform set_config('dh1.sys_fn', coalesce(v_prev, ''), true);
  end if;

  return jsonb_build_object('id', v_fila.id, 'tipo', v_fila.tipo, 'momento', v_fila.momento, 'empleado_id', v_emp.id,
                            'empleado', v_emp.nombre, 'ubicacion_id', v_ubi.id, 'ubicacion', v_ubi.nombre,
                            'distancia_m', v_dist, 'lejos', v_fila.lejos, 'repetido', false);
end $$;

-- Hora local de la operación (Buenos Aires): con esto se decide a qué día pertenece un fichaje.
create or replace function public.dia_local(p timestamptz) returns date
language sql immutable as $$
  select (p at time zone 'America/Argentina/Buenos_Aires')::date
$$;

create view public.v_fichajes with (security_invoker = true) as
select f.*, public.dia_local(f.momento) as dia,
       e.nombre as empleado_nombre, e.puesto as empleado_puesto, e.jefe_sitio_id,
       u.nombre as ubicacion_nombre, p.nombre as registrado_por_nombre
  from public.fichajes f
  join public.empleados e        on e.id = f.empleado_id
  left join public.ubicaciones u on u.id = f.ubicacion_id
  left join public.perfiles p    on p.id = f.registrado_por;

-- Jornadas: cada entrada con la salida que le sigue. Si la siguiente marca no es una salida, la jornada queda abierta.
create view public.v_jornadas with (security_invoker = true) as
select x.id, x.sector_id, x.empleado_id, e.nombre as empleado_nombre, e.puesto as empleado_puesto,
       public.dia_local(x.momento) as dia,
       x.momento as entrada,
       case when x.sig_tipo = 'salida' then x.sig_momento end as salida,
       case when x.sig_tipo = 'salida' then round((extract(epoch from x.sig_momento - x.momento) / 3600.0)::numeric, 2) end as horas,
       x.ubicacion_id, u.nombre as ubicacion_nombre, x.lejos
  from (select f.*,
               lead(f.tipo)    over (partition by f.empleado_id order by f.momento) as sig_tipo,
               lead(f.momento) over (partition by f.empleado_id order by f.momento) as sig_momento
          from public.fichajes f) x
  join public.empleados e        on e.id = x.empleado_id
  left join public.ubicaciones u on u.id = x.ubicacion_id
 where x.tipo = 'entrada';

-- La ficha completa. Los datos reservados vienen vacíos para quien no puede leerlos (lo decide la política).
create view public.v_empleados with (security_invoker = true) as
select e.*,
       r.dni, r.costo_hora, r.contacto_emergencia, r.telefono_emergencia, r.notas,
       p.email as usuario_email, p.rol as usuario_rol, p.activo as usuario_activo,
       j.nombre as jefe_sitio_nombre,
       u.nombre as ubicacion_nombre,
       (select count(*) from public.ubicaciones x where x.jefe_sitio_id = e.perfil_id and e.perfil_id is not null)::integer as lugares_a_cargo,
       uf.tipo as ultimo_fichaje_tipo, uf.momento as ultimo_fichaje_momento, uf.ubicacion_nombre as ultimo_fichaje_lugar
  from public.empleados e
  left join public.empleados_reservado r on r.empleado_id = e.id
  left join public.perfiles p    on p.id = e.perfil_id
  left join public.perfiles j    on j.id = e.jefe_sitio_id
  left join public.ubicaciones u on u.id = e.ubicacion_id
  left join lateral (
    select f.tipo, f.momento, l.nombre as ubicacion_nombre
      from public.fichajes f
      left join public.ubicaciones l on l.id = f.ubicacion_id
     where f.empleado_id = e.id
     order by f.momento desc limit 1) uf on true;

-- =====================================================================================
-- 4. HORAS CARGADAS A UNA ORDEN DE TRABAJO
-- =====================================================================================
create table public.ot_horas (
  id              uuid primary key default gen_random_uuid(),
  sector_id       uuid not null references public.sectores(id),
  ot_id           uuid not null,
  empleado_id     uuid,
  -- nombre escrito a mano cuando quien trabajó no tiene ficha (un contratista, por ejemplo)
  empleado_nombre text,
  fecha           date not null default current_date,
  horas           numeric(5,2) not null check (horas > 0 and horas <= 24),
  tipo            public.hora_tipo not null default 'normal',
  descripcion     text,
  id_origen       text unique,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (ot_id, sector_id)       references public.ordenes_trabajo(id, sector_id) on delete cascade,
  foreign key (empleado_id, sector_id) references public.empleados(id, sector_id) on delete set null (empleado_id)
);
create index ot_horas_ot_idx on public.ot_horas(ot_id);
select public.aplicar_rls_sector('public.ot_horas');

-- Carga horas cualquier usuario del sector. Las cambia o borra quien las cargó, un jefe de sitio o gerencia.
create or replace function public.validar_ot_horas() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' and not (public.puede_validar() or old.created_by = auth.uid()) then
    raise exception 'Estas horas las cargó otra persona. Las puede cambiar quien las cargó, un jefe de sitio o gerencia.'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.ot_id := old.ot_id;
  end if;
  if new.empleado_id is not null then
    select e.nombre into new.empleado_nombre from public.empleados e where e.id = new.empleado_id;
  end if;
  new.empleado_nombre := nullif(btrim(coalesce(new.empleado_nombre, '')), '');
  if new.empleado_nombre is null then
    raise exception 'Indicá quién hizo las horas.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger b_validar before insert or update or delete on public.ot_horas
  for each row execute function public.validar_ot_horas();

-- Con el costo: solo lo ve quien puede leer el costo por hora del empleado (gerencia).
create view public.v_ot_horas with (security_invoker = true) as
select h.*, round(h.horas * r.costo_hora, 2) as costo
  from public.ot_horas h
  left join public.empleados_reservado r on r.empleado_id = h.empleado_id;

-- =====================================================================================
-- 5. MAPA
-- =====================================================================================
-- De dónde salió la posición de un lugar y cuándo se intentó ubicarlo por su dirección sin encontrarla
-- (para no volver a preguntar lo mismo cada vez).
alter table public.ubicaciones
  add column if not exists geo_origen     text check (geo_origen in ('manual','direccion')),
  add column if not exists geo_intento_at timestamptz;

-- Establecimientos para el mapa, con su semáforo. Misma regla que la v1, pero por el lugar y no por
-- parecido de nombre: rojo con una emergencia abierta, 2 pendientes vencidos o 3 abiertos; amarillo con
-- algún pendiente abierto; verde sin nada.
create view public.v_mapa_ubicaciones with (security_invoker = true) as
select u.id, u.sector_id, u.nombre, u.codigo, u.zona, u.m2, u.lat, u.lng, u.activa, u.qr_token, u.geo_origen, u.geo_intento_at,
       u.direccion_id, coalesce(d.direccion, u.direccion) as domicilio,
       u.jefe_sitio_id, u.jefe_sitio_nombre, u.inspector_nombre,
       c.pendientes_abiertos, c.pendientes_vencidos, c.emergencias_activas, c.ots_abiertas, c.empleados_asignados,
       case when c.emergencias_activas > 0 or c.pendientes_vencidos >= 2 or c.pendientes_abiertos >= 3 then 'rojo'
            when c.pendientes_abiertos >= 1 then 'amarillo'
            else 'verde' end as semaforo
  from public.ubicaciones u
  left join public.direcciones d on d.id = u.direccion_id
  cross join lateral (
    select (select count(*) from public.pendientes p
             where p.ubicacion_id = u.id and p.estado not in ('resuelto','cancelado'))::integer as pendientes_abiertos,
           (select count(*) from public.pendientes p
             where p.ubicacion_id = u.id and p.estado not in ('resuelto','cancelado') and p.fecha_limite < current_date)::integer as pendientes_vencidos,
           (select count(*) from public.emergencias e
             where e.ubicacion_id = u.id and e.estado in ('activa','en_atencion'))::integer as emergencias_activas,
           (select count(*) from public.ordenes_trabajo o
             where o.ubicacion_id = u.id and o.estado not in ('completada','cancelada'))::integer as ots_abiertas,
           (select count(*) from public.ubicacion_empleados x where x.ubicacion_id = u.id)::integer as empleados_asignados
  ) c;

-- v_ordenes suma el jefe de sitio y la posición del lugar: los usan la tablet de cuadrilla (órdenes de los
-- lugares de su jefe) y el mapa. Se rehace entera porque la tabla ganó columnas después de la fase 3.
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
       (select coalesce(sum(h.horas), 0) from public.ot_horas h where h.ot_id = o.id) as horas_cargadas
  from public.ordenes_trabajo o
  left join public.ubicaciones u on u.id = o.ubicacion_id
  left join public.activos a     on a.id = o.activo_id
  left join public.perfiles pa   on pa.id = o.asignado_a
  left join public.perfiles pv   on pv.id = o.validado_por;

-- búsqueda remota: se suma "empleados"
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
revoke execute on function public.tomar_informes_pendientes(integer) from authenticated;
revoke execute on function public.programar_reintento_informes(text) from authenticated;
