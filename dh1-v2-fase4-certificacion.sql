-- =====================================================================================
-- DH1 v2 — Fase 4: CERTIFICACIÓN (la base es la autoridad)
-- Correr después de dh1-v2-fase3-gestion.sql.
--
--   · Los ítems del contrato tienen id estable; cada línea de certificado apunta a su ítem.
--   · El cliente solo escribe med_presente_unidad. Anterior, acumulado, saldo y totales los
--     dispone la base, siempre desde una única fuente: lo certificado (emitido o aprobado) por ítem.
--     No existe "% pagado anteriormente".
--   · emitir_certificado() bloquea la sobre-certificación (por ítem y por total), numera por
--     contrato con índice único parcial y sella. Emitido y aprobado son inmutables.
--   · Quien emite no aprueba.
--   · DH1 certifica y controla la certificación. No factura ni cobra.
-- =====================================================================================

create type public.certificado_estado as enum ('borrador','emitido','aprobado');

-- ------------------------------------------------------------------ contratos
create table public.contratos (
  id                   uuid primary key default gen_random_uuid(),
  sector_id            uuid not null references public.sectores(id),
  tipo                 text not null default 'abono_mensual' check (tipo in ('abono_mensual','obra')),
  contratista          text not null,
  contratista_cuit     text,
  obra_servicio        text not null,
  emprendimiento       text,
  ada_numero           text,
  oc_numero            text,
  ubicacion_id         uuid,
  fecha_inicio         date,
  fecha_fin            date,
  plazo                text,
  condiciones_pago     text,
  anticipo_pct         numeric(5,2) not null default 0 check (anticipo_pct between 0 and 100),
  fondo_reparo_pct     numeric(5,2) not null default 0 check (fondo_reparo_pct between 0 and 100),
  fondo_reparo_label   text not null default 'Fondo de reparo',
  fondo_reparo_aplicar boolean not null default false,
  monto_contratado     numeric(16,2) not null default 0,
  estado               text not null default 'activo' check (estado in ('activo','cerrado')),
  ada_pdf_url          text,
  notas                text,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id)
);
create index contratos_sector_idx on public.contratos(sector_id, contratista);
select public.aplicar_rls_sector('public.contratos');
create trigger b_rol before insert or update or delete on public.contratos
  for each row execute function public.exigir_rol('gerencia');

create table public.contrato_items (
  id               uuid primary key default gen_random_uuid(),
  sector_id        uuid not null references public.sectores(id),
  contrato_id      uuid not null,
  numero           integer not null,
  descripcion      text not null,
  um               text not null default 'u',
  cantidad         numeric(16,4) not null check (cantidad > 0),
  importe_unitario numeric(16,2) not null check (importe_unitario >= 0),
  importe_total    numeric(16,2) generated always as (round(cantidad * importe_unitario, 2)) stored,
  created_at       timestamptz not null default now(),
  unique (id, sector_id),
  unique (contrato_id, numero),
  foreign key (contrato_id, sector_id) references public.contratos(id, sector_id) on delete cascade
);
select public.aplicar_rls_sector('public.contrato_items');
create trigger b_rol before insert or update or delete on public.contrato_items
  for each row execute function public.exigir_rol('gerencia');

-- ------------------------------------------------------------------ certificados
create table public.certificados (
  id                    uuid primary key default gen_random_uuid(),
  sector_id             uuid not null references public.sectores(id),
  contrato_id           uuid not null,
  numero                integer,
  estado                public.certificado_estado not null default 'borrador',
  periodo               text not null,
  fecha_certificado     date not null default current_date,
  numero_recepcion      text,
  notas                 text,
  -- porcentajes copiados del contrato al crear el certificado
  anticipo_pct          numeric(5,2) not null default 0,
  fondo_reparo_pct      numeric(5,2) not null default 0,
  fondo_reparo_aplicar  boolean not null default false,
  -- totales: los calcula la base
  subtotal_presente     numeric(16,2) not null default 0,
  anticipo_monto        numeric(16,2) not null default 0,
  fondo_reparo_monto    numeric(16,2) not null default 0,
  total_neto            numeric(16,2) not null default 0,
  acum_anterior_importe numeric(16,2) not null default 0,
  acum_presente_importe numeric(16,2) not null default 0,
  porcentaje_avance     numeric(7,2) not null default 0,
  -- sellos
  emitido_por           uuid references public.perfiles(id),
  emitido_at            timestamptz,
  aprobado_por          uuid references public.perfiles(id),
  aprobado_at           timestamptz,
  firma_url             text,
  rechazado_por         uuid references public.perfiles(id),
  rechazado_at          timestamptz,
  rechazo_motivo        text,
  pdf_url               text,
  -- certificados traídos de la v1: se guardan como historia, sin recalcular
  historico             boolean not null default false,
  datos_historicos      jsonb,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (contrato_id, sector_id) references public.contratos(id, sector_id),
  check ((estado = 'borrador') = (numero is null))
);
-- Numeración por contrato sin carrera: dos emisiones simultáneas no pueden quedar con el mismo número.
create unique index certificados_numero_idx   on public.certificados(contrato_id, numero) where numero is not null;
-- Un solo borrador por contrato: así "lo anterior" nunca es ambiguo.
create unique index certificados_borrador_idx on public.certificados(contrato_id) where estado = 'borrador';
create index certificados_sector_idx on public.certificados(sector_id, estado);
select public.aplicar_rls_sector('public.certificados');

create table public.certificado_items (
  id                         uuid primary key default gen_random_uuid(),
  sector_id                  uuid not null references public.sectores(id),
  certificado_id             uuid not null,
  contrato_item_id           uuid not null,
  -- foto del ítem del contrato al momento de certificar
  numero                     integer not null,
  descripcion                text not null,
  um                         text not null,
  cantidad                   numeric(16,4) not null,
  importe_unitario           numeric(16,2) not null,
  importe_total              numeric(16,2) not null,
  -- medición
  med_acum_anterior_unidad   numeric(16,4) not null default 0,
  med_acum_anterior_importe  numeric(16,2) not null default 0,
  med_presente_unidad        numeric(16,4) not null default 0 check (med_presente_unidad >= 0),
  med_presente_importe       numeric(16,2) not null default 0,
  med_acum_presente_unidad   numeric(16,4) not null default 0,
  med_acum_presente_importe  numeric(16,2) not null default 0,
  saldo_pendiente_unidad     numeric(16,4) not null default 0,
  saldo_pendiente_importe    numeric(16,2) not null default 0,
  unique (certificado_id, contrato_item_id),
  foreign key (certificado_id, sector_id)   references public.certificados(id, sector_id) on delete cascade,
  foreign key (contrato_item_id, sector_id) references public.contrato_items(id, sector_id) on delete cascade
);
create index certificado_items_item_idx on public.certificado_items(contrato_item_id);
select public.aplicar_rls_sector('public.certificado_items');

-- ------------------------------------------------------------------ bandera interna
-- Prende dh1.cert_fn y devuelve el valor previo, para restaurarlo al terminar (las funciones se anidan).
create or replace function public.cert_fn_on() returns text
language plpgsql as $$
declare
  v_prev text := coalesce(current_setting('dh1.cert_fn', true), '');
begin
  perform set_config('dh1.cert_fn', '1', true);
  return v_prev;
end $$;

create or replace function public.cert_fn_restore(p_prev text) returns void
language sql as $$
  select set_config('dh1.cert_fn', coalesce(p_prev, ''), true)
$$;

-- ------------------------------------------------------------------ contrato: monto e ítems
create or replace function public.proteger_contrato() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.es_servicio() then
      new.monto_contratado := 0;
    end if;
    return new;
  end if;
  new.updated_at := now();
  -- El monto contratado es la suma de los ítems. No se escribe a mano.
  if not (public.es_servicio() or public.dh1_flag('dh1.cert_fn')) then
    new.monto_contratado := old.monto_contratado;
  end if;
  return new;
end $$;
create trigger c_proteger before insert or update on public.contratos
  for each row execute function public.proteger_contrato();

create or replace function public.proteger_contrato_item() returns trigger
language plpgsql set search_path = public as $$
declare
  v_certificado boolean;
begin
  if public.es_servicio() or public.dh1_flag('dh1.cert_fn') then
    return coalesce(new, old);
  end if;
  select exists (
    select 1 from public.certificado_items ci
      join public.certificados c on c.id = ci.certificado_id
     where ci.contrato_item_id = old.id and c.estado in ('emitido','aprobado')
  ) into v_certificado;
  if v_certificado then
    if tg_op = 'DELETE' then
      raise exception 'El ítem % ya tiene certificados emitidos. No se puede borrar.', old.numero
        using errcode = 'P0001';
    end if;
    if new.cantidad <> old.cantidad or new.importe_unitario <> old.importe_unitario
       or new.um <> old.um or new.contrato_id <> old.contrato_id then
      raise exception 'El ítem % ya tiene certificados emitidos. No se puede cambiar su cantidad, unidad ni precio.',
        old.numero using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger c_proteger before update or delete on public.contrato_items
  for each row execute function public.proteger_contrato_item();

create or replace function public.sumar_contrato_trg() returns trigger
language plpgsql set search_path = public as $$
declare
  v_contrato uuid := coalesce(new.contrato_id, old.contrato_id);
  v_prev text;
begin
  v_prev := public.cert_fn_on();
  update public.contratos c
     set monto_contratado = coalesce((select sum(i.importe_total) from public.contrato_items i
                                       where i.contrato_id = v_contrato), 0)
   where c.id = v_contrato;
  perform public.cert_fn_restore(v_prev);
  return null;
end $$;
create trigger z_sumar after insert or update or delete on public.contrato_items
  for each row execute function public.sumar_contrato_trg();

-- ------------------------------------------------------------------ certificado: inmutabilidad
create or replace function public.proteger_certificado() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.cert_fn') then
    if tg_op <> 'DELETE' then new.updated_at := now(); end if;
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Los certificados se crean desde el contrato, con "Nuevo certificado".' using errcode = 'P0001';
  end if;
  if old.estado <> 'borrador' then
    raise exception 'El certificado N° % está %. Ya no se puede modificar ni borrar.', old.numero, old.estado
      using errcode = 'P0001';
  end if;
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden trabajar sobre un certificado.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  -- En borrador el cliente solo cambia los datos de cabecera. Estado, número, sellos y totales, no.
  if new.estado <> old.estado or new.numero is distinct from old.numero then
    raise exception 'El estado y el número del certificado no se cambian a mano: usá Emitir.' using errcode = 'P0001';
  end if;
  new.sector_id := old.sector_id;
  new.contrato_id := old.contrato_id;
  new.anticipo_pct := old.anticipo_pct;
  new.fondo_reparo_pct := old.fondo_reparo_pct;
  new.fondo_reparo_aplicar := old.fondo_reparo_aplicar;
  new.subtotal_presente := old.subtotal_presente;
  new.anticipo_monto := old.anticipo_monto;
  new.fondo_reparo_monto := old.fondo_reparo_monto;
  new.total_neto := old.total_neto;
  new.acum_anterior_importe := old.acum_anterior_importe;
  new.acum_presente_importe := old.acum_presente_importe;
  new.porcentaje_avance := old.porcentaje_avance;
  new.emitido_por := old.emitido_por;   new.emitido_at := old.emitido_at;
  new.aprobado_por := old.aprobado_por; new.aprobado_at := old.aprobado_at;
  new.firma_url := old.firma_url;
  new.rechazado_por := old.rechazado_por; new.rechazado_at := old.rechazado_at;
  new.rechazo_motivo := old.rechazo_motivo;
  new.historico := old.historico;       new.datos_historicos := old.datos_historicos;
  new.created_by := old.created_by;     new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
create trigger b_proteger before insert or update or delete on public.certificados
  for each row execute function public.proteger_certificado();

-- ------------------------------------------------------------------ líneas: el cliente solo mide
create or replace function public.totalizar_certificado(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  v_prev text;
begin
  v_prev := public.cert_fn_on();
  update public.certificados c
     set subtotal_presente     = t.presente,
         anticipo_monto        = round(t.presente * c.anticipo_pct / 100, 2),
         fondo_reparo_monto    = case when c.fondo_reparo_aplicar
                                      then round(t.presente * c.fondo_reparo_pct / 100, 2) else 0 end,
         total_neto            = t.presente
                                 - round(t.presente * c.anticipo_pct / 100, 2)
                                 - case when c.fondo_reparo_aplicar
                                        then round(t.presente * c.fondo_reparo_pct / 100, 2) else 0 end,
         acum_anterior_importe = t.anterior,
         acum_presente_importe = t.acumulado,
         porcentaje_avance     = case when k.monto_contratado > 0
                                      then round(t.acumulado * 100 / k.monto_contratado, 2) else 0 end
    from (select coalesce(sum(i.med_presente_importe), 0)      as presente,
                 coalesce(sum(i.med_acum_anterior_importe), 0) as anterior,
                 coalesce(sum(i.med_acum_presente_importe), 0) as acumulado
            from public.certificado_items i where i.certificado_id = p_id) t,
         public.contratos k
   where c.id = p_id and k.id = c.contrato_id;
  perform public.cert_fn_restore(v_prev);
end $$;

create or replace function public.calcular_linea_certificado() returns trigger
language plpgsql set search_path = public as $$
declare
  v_estado public.certificado_estado;
  v_presente numeric(16,4);
  v_item public.contrato_items%rowtype;
begin
  if public.es_servicio() or public.dh1_flag('dh1.cert_fn') then
    return coalesce(new, old);
  end if;

  select c.estado into v_estado from public.certificados c
   where c.id = coalesce(new.certificado_id, old.certificado_id);

  if tg_op = 'DELETE' then
    -- Borrado en cascada (el certificado ya no está) o línea de un borrador.
    if v_estado is null or v_estado = 'borrador' then
      return old;
    end if;
    raise exception 'El certificado está %. Sus líneas no se pueden borrar.', v_estado using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Las líneas de un certificado las arma la base a partir del contrato.' using errcode = 'P0001';
  end if;

  if v_estado <> 'borrador' then
    raise exception 'El certificado está %. Ya no se puede modificar.', v_estado using errcode = 'P0001';
  end if;
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden cargar la medición.' using errcode = 'P0001';
  end if;
  if new.med_presente_unidad is null or new.med_presente_unidad < 0 then
    raise exception 'La medición del período no puede ser negativa.' using errcode = 'P0001';
  end if;

  -- Del cliente se toma solo la medición del período. Todo lo demás lo dispone la base.
  v_presente := new.med_presente_unidad;
  new := old;
  new.med_presente_unidad := v_presente;

  select * into v_item from public.contrato_items i where i.id = new.contrato_item_id;
  new.numero := v_item.numero;
  new.descripcion := v_item.descripcion;
  new.um := v_item.um;
  new.cantidad := v_item.cantidad;
  new.importe_unitario := v_item.importe_unitario;
  new.importe_total := v_item.importe_total;

  -- Fuente única de lo ya certificado: lo medido en certificados emitidos o aprobados de este ítem.
  select coalesce(sum(ci.med_presente_unidad), 0), coalesce(sum(ci.med_presente_importe), 0)
    into new.med_acum_anterior_unidad, new.med_acum_anterior_importe
    from public.certificado_items ci
    join public.certificados c on c.id = ci.certificado_id
   where ci.contrato_item_id = new.contrato_item_id
     and c.estado in ('emitido','aprobado')
     and c.id <> new.certificado_id;

  new.med_presente_importe      := round(new.med_presente_unidad * new.importe_unitario, 2);
  new.med_acum_presente_unidad  := new.med_acum_anterior_unidad + new.med_presente_unidad;
  new.med_acum_presente_importe := new.med_acum_anterior_importe + new.med_presente_importe;
  new.saldo_pendiente_unidad    := new.cantidad - new.med_acum_presente_unidad;
  new.saldo_pendiente_importe   := new.importe_total - new.med_acum_presente_importe;
  return new;
end $$;
create trigger b_calcular before insert or update or delete on public.certificado_items
  for each row execute function public.calcular_linea_certificado();

create or replace function public.totalizar_certificado_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.cert_fn') then
    return null;
  end if;
  perform public.totalizar_certificado(new.certificado_id);
  return null;
end $$;
create trigger z_totalizar after update on public.certificado_items
  for each row execute function public.totalizar_certificado_trg();

-- ------------------------------------------------------------------ funciones de certificación
-- Todas corren con la RLS del usuario: un certificado de otro sector "no existe".

create or replace function public.recalcular_certificado(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  v public.certificados%rowtype;
  v_prev text;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden trabajar sobre un certificado.' using errcode = 'P0001';
  end if;
  select * into v from public.certificados c where c.id = p_id;
  if not found then
    raise exception 'El certificado no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if v.estado <> 'borrador' then
    raise exception 'El certificado N° % está %. Ya no se recalcula.', v.numero, v.estado using errcode = 'P0001';
  end if;

  -- Ítems que se agregaron al contrato después de crear el borrador.
  v_prev := public.cert_fn_on();
  insert into public.certificado_items
    (sector_id, certificado_id, contrato_item_id, numero, descripcion, um, cantidad, importe_unitario, importe_total)
  select i.sector_id, p_id, i.id, i.numero, i.descripcion, i.um, i.cantidad, i.importe_unitario, i.importe_total
    from public.contrato_items i
   where i.contrato_id = v.contrato_id
     and not exists (select 1 from public.certificado_items ci
                      where ci.certificado_id = p_id and ci.contrato_item_id = i.id);
  perform public.cert_fn_restore(v_prev);

  -- Pasa cada línea por el mismo cálculo que una edición del cliente (un solo camino de cálculo).
  update public.certificado_items set med_presente_unidad = med_presente_unidad where certificado_id = p_id;
  perform public.totalizar_certificado(p_id);
end $$;

create or replace function public.crear_certificado(p_contrato uuid, p_periodo text) returns uuid
language plpgsql set search_path = public as $$
declare
  k public.contratos%rowtype;
  v_id uuid;
  v_prev text;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden crear un certificado.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_periodo), '') = '' then
    raise exception 'Indicá el período del certificado (por ejemplo: Septiembre 2026).' using errcode = 'P0001';
  end if;
  select * into k from public.contratos c where c.id = p_contrato for update;
  if not found then
    raise exception 'El contrato no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if k.estado <> 'activo' then
    raise exception 'El contrato está cerrado. No admite nuevos certificados.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.contrato_items i where i.contrato_id = p_contrato) then
    raise exception 'El contrato no tiene ítems. Cargalos antes de certificar.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.certificados c where c.contrato_id = p_contrato and c.estado = 'borrador') then
    raise exception 'Este contrato ya tiene un certificado en borrador. Emitilo o borralo antes de crear otro.'
      using errcode = 'P0001';
  end if;

  v_prev := public.cert_fn_on();
  insert into public.certificados
    (sector_id, contrato_id, periodo, anticipo_pct, fondo_reparo_pct, fondo_reparo_aplicar)
  values
    (k.sector_id, k.id, btrim(p_periodo), k.anticipo_pct, k.fondo_reparo_pct, k.fondo_reparo_aplicar)
  returning id into v_id;
  perform public.cert_fn_restore(v_prev);

  perform public.recalcular_certificado(v_id);
  return v_id;
end $$;

create or replace function public.emitir_certificado(p_id uuid) returns integer
language plpgsql set search_path = public as $$
declare
  v public.certificados%rowtype;
  k public.contratos%rowtype;
  v_linea record;
  v_numero integer;
  v_prev text;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden emitir un certificado.' using errcode = 'P0001';
  end if;
  select * into v from public.certificados c where c.id = p_id;
  if not found then
    raise exception 'El certificado no existe o no es de tu sector.' using errcode = 'P0001';
  end if;

  -- Una emisión por contrato a la vez: la segunda espera acá y después ve el estado real.
  select * into k from public.contratos c where c.id = v.contrato_id for update;
  select * into v from public.certificados c where c.id = p_id;
  if v.estado <> 'borrador' then
    raise exception 'El certificado ya fue emitido con el N° %.', v.numero using errcode = 'P0001';
  end if;

  perform public.recalcular_certificado(p_id);
  select * into v from public.certificados c where c.id = p_id;

  select ci.numero, ci.descripcion, ci.cantidad, ci.um, ci.med_acum_presente_unidad
    into v_linea
    from public.certificado_items ci
   where ci.certificado_id = p_id and ci.med_acum_presente_unidad > ci.cantidad
   order by ci.numero limit 1;
  if found then
    raise exception 'Sobre-certificación en el ítem % (%): el acumulado llega a % % y el contrato tiene %.',
      v_linea.numero, v_linea.descripcion, trim_scale(v_linea.med_acum_presente_unidad), v_linea.um,
      trim_scale(v_linea.cantidad)
      using errcode = 'P0001';
  end if;
  if v.acum_presente_importe > k.monto_contratado then
    raise exception 'Sobre-certificación: el acumulado ($ %) supera el monto contratado ($ %).',
      v.acum_presente_importe, k.monto_contratado using errcode = 'P0001';
  end if;
  if v.subtotal_presente <= 0 then
    raise exception 'El certificado no tiene nada medido en este período.' using errcode = 'P0001';
  end if;

  select coalesce(max(c.numero), 0) + 1 into v_numero
    from public.certificados c where c.contrato_id = v.contrato_id;

  v_prev := public.cert_fn_on();
  update public.certificados
     set estado = 'emitido', numero = v_numero, emitido_por = auth.uid(), emitido_at = now(),
         rechazo_motivo = null, rechazado_por = null, rechazado_at = null
   where id = p_id;
  perform public.cert_fn_restore(v_prev);
  return v_numero;
end $$;

create or replace function public.aprobar_certificado(p_id uuid, p_firma_url text default null) returns void
language plpgsql set search_path = public as $$
declare
  v public.certificados%rowtype;
  v_prev text;
begin
  if not public.es_gerencia() then
    raise exception 'Solo gerencia puede aprobar un certificado.' using errcode = 'P0001';
  end if;
  select * into v from public.certificados c where c.id = p_id for update;
  if not found then
    raise exception 'El certificado no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if v.estado <> 'emitido' then
    raise exception 'Solo se aprueba un certificado emitido. Este está %.', v.estado using errcode = 'P0001';
  end if;
  if v.emitido_por = auth.uid() then
    raise exception 'Quien emite un certificado no puede aprobarlo. Lo tiene que aprobar otra persona.'
      using errcode = 'P0001';
  end if;
  v_prev := public.cert_fn_on();
  update public.certificados
     set estado = 'aprobado', aprobado_por = auth.uid(), aprobado_at = now(), firma_url = p_firma_url
   where id = p_id;
  perform public.cert_fn_restore(v_prev);
end $$;

-- Rechazar devuelve el certificado a borrador y libera su número. Solo el último del contrato.
create or replace function public.rechazar_certificado(p_id uuid, p_motivo text) returns void
language plpgsql set search_path = public as $$
declare
  v public.certificados%rowtype;
  v_prev text;
begin
  if not public.es_gerencia() then
    raise exception 'Solo gerencia puede rechazar un certificado.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Para rechazar el certificado hay que escribir el motivo.' using errcode = 'P0001';
  end if;
  select * into v from public.certificados c where c.id = p_id;
  if not found then
    raise exception 'El certificado no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  perform 1 from public.contratos c where c.id = v.contrato_id for update;
  select * into v from public.certificados c where c.id = p_id;
  if v.estado <> 'emitido' then
    raise exception 'Solo se rechaza un certificado emitido. Este está %.', v.estado using errcode = 'P0001';
  end if;
  if exists (select 1 from public.certificados c where c.contrato_id = v.contrato_id and c.numero > v.numero) then
    raise exception 'Hay certificados posteriores al N° %. Solo se puede rechazar el último del contrato.', v.numero
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.certificados c where c.contrato_id = v.contrato_id and c.estado = 'borrador') then
    raise exception 'El contrato tiene otro certificado en borrador. Borralo antes de rechazar este.'
      using errcode = 'P0001';
  end if;
  v_prev := public.cert_fn_on();
  update public.certificados
     set estado = 'borrador', numero = null, emitido_por = null, emitido_at = null,
         rechazado_por = auth.uid(), rechazado_at = now(), rechazo_motivo = btrim(p_motivo)
   where id = p_id;
  perform public.cert_fn_restore(v_prev);
end $$;

-- ------------------------------------------------------------------ vistas
create view public.v_contratos with (security_invoker = true) as
select k.*,
       u.nombre as ubicacion_nombre,
       coalesce(c.certificado, 0)                         as certificado_importe,
       k.monto_contratado - coalesce(c.certificado, 0)    as saldo_importe,
       case when k.monto_contratado > 0
            then round(coalesce(c.certificado, 0) * 100 / k.monto_contratado, 2) else 0 end as porcentaje_certificado,
       coalesce(c.cantidad, 0)::integer                   as certificados_total,
       c.ultimo_numero,
       coalesce(c.por_aprobar, 0)::integer                as por_aprobar,
       (select b.id from public.certificados b
         where b.contrato_id = k.id and b.estado = 'borrador') as borrador_id
  from public.contratos k
  left join public.ubicaciones u on u.id = k.ubicacion_id
  left join lateral (
    select sum(x.subtotal_presente) as certificado, count(*) as cantidad, max(x.numero) as ultimo_numero,
           count(*) filter (where x.estado = 'emitido') as por_aprobar
      from public.certificados x
     where x.contrato_id = k.id and x.estado in ('emitido','aprobado')
  ) c on true;

create view public.v_certificados with (security_invoker = true) as
select c.*,
       k.tipo, k.contratista, k.obra_servicio, k.ada_numero, k.oc_numero, k.monto_contratado,
       k.fondo_reparo_label,
       pe.nombre as emitido_nombre,
       pa.nombre as aprobado_nombre
  from public.certificados c
  join public.contratos k     on k.id = c.contrato_id
  left join public.perfiles pe on pe.id = c.emitido_por
  left join public.perfiles pa on pa.id = c.aprobado_por;

-- ------------------------------------------------------------------ permisos
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
