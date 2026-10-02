-- =====================================================================================
-- DH1 v2 — Fase 10 (tanda 4): pañol
--
--   1. Materiales: catálogo con stock, mínimo, costo y proveedor. El stock NO se escribe a mano: cambia solo con
--      movimientos, en la base y de a uno por material (en la v1 lo actualizaba el navegador en dos pasos, con el
--      número que tenía en memoria, y solo el admin podía operar)
--   2. Movimientos: entradas y salidas con motivo, obra, orden, quién retira y remito. No se editan ni se borran:
--      un error se corrige con un ajuste
--   3. Préstamo de herramientas (nuevo): sale con nombre y fecha de devolución, vuelve o se da por perdida
--   4. Requerimientos de compra: circuito borrador → enviado → revisión → aprobado → en compra → recibido. Recibir
--      la compra suma stock (en la v1 no) y nadie aprueba lo que pidió
--   5. Materiales usados en cada orden de trabajo, con descuento del pañol
--   6. Importación del catálogo sin duplicar, con ajuste opcional al stock contado
--
-- Se corre después de la fase 9. Es aditiva.
-- =====================================================================================

-- Bandera interna: solo las funciones de esta fase mueven stock. Los ayudantes se niegan a correr si no los llama
-- otra función de la base (llamados sueltos desde la API o desde GraphQL, que puede encadenar varias operaciones
-- en una misma transacción, no prenden nada).
create or replace function public.panol_on() returns text
language plpgsql as $$
declare
  v_prev text := current_setting('dh1.panol_fn', true);
  v_ctx text;
begin
  get diagnostics v_ctx = pg_context;
  if (select count(*) from regexp_matches(v_ctx, 'PL/pgSQL function', 'g')) < 2 then
    raise exception 'Uso interno.' using errcode = '42501';
  end if;
  perform set_config('dh1.panol_fn', '1', true);
  return coalesce(v_prev, '');
end $$;

create or replace function public.panol_restore(p_prev text) returns void
language plpgsql as $$
declare
  v_ctx text;
begin
  get diagnostics v_ctx = pg_context;
  if (select count(*) from regexp_matches(v_ctx, 'PL/pgSQL function', 'g')) < 2 then
    raise exception 'Uso interno.' using errcode = '42501';
  end if;
  perform set_config('dh1.panol_fn', coalesce(p_prev, ''), true);
end $$;

-- =====================================================================================
-- 1. MATERIALES
-- =====================================================================================
create table public.materiales (
  id                 uuid primary key default gen_random_uuid(),
  sector_id          uuid not null references public.sectores(id),
  nombre             text not null check (btrim(nombre) <> ''),
  codigo             text,
  categoria          text not null default 'construccion' check (categoria in ('electrico','plomeria','pintura','construccion','herreria',
                       'herramientas','seguridad','climatizacion','limpieza','otros')),
  unidad             text not null default 'unidad' check (unidad in ('unidad','metro','metro2','metro3','kg','litro','bolsa','caja','rollo','par','juego')),
  stock              numeric(14,3) not null default 0 check (stock >= 0),
  stock_minimo       numeric(14,3) not null default 0 check (stock_minimo >= 0),
  costo_unitario     numeric(16,2) not null default 0 check (costo_unitario >= 0),
  -- herramienta que se presta y vuelve (taladro, escalera): sale con préstamo, no se consume
  prestable          boolean not null default false,
  proveedor_id       uuid,
  proveedor_texto    text,
  ubicacion_deposito text,
  notas              text,
  activo             boolean not null default true,
  id_origen          text unique,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (proveedor_id, sector_id) references public.proveedores(id, sector_id)
);
create index materiales_sector_idx on public.materiales(sector_id, nombre);
create unique index materiales_codigo_idx on public.materiales(sector_id, lower(codigo)) where codigo is not null;
select public.aplicar_rls_sector('public.materiales');
create trigger b_rol before insert or update or delete on public.materiales
  for each row execute function public.exigir_rol('validar');

create or replace function public.preparar_material() returns trigger
language plpgsql set search_path = public as $$
begin
  new.nombre := btrim(regexp_replace(new.nombre, '\s+', ' ', 'g'));
  new.codigo := nullif(btrim(coalesce(new.codigo, '')), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if new.stock is distinct from old.stock and not public.es_servicio() and not public.dh1_flag('dh1.panol_fn') then
      raise exception 'El stock no se cambia a mano: registrá una entrada, una salida o un ajuste por inventario.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger c1_preparar before insert or update on public.materiales
  for each row execute function public.preparar_material();

-- =====================================================================================
-- 2. MOVIMIENTOS
-- =====================================================================================
create sequence public.movimiento_numero_seq;

create table public.movimientos_panol (
  id                uuid primary key default gen_random_uuid(),
  sector_id         uuid not null references public.sectores(id),
  numero            bigint not null unique default nextval('public.movimiento_numero_seq'),
  material_id       uuid not null,
  tipo              text not null check (tipo in ('entrada','salida')),
  motivo            text not null check (motivo in ('stock_inicial','compra','devolucion','devolucion_prestamo','ajuste_entrada',
                      'consumo','asignacion_obra','prestamo','perdida','ajuste_salida')),
  cantidad          numeric(14,3) not null check (cantidad > 0),
  stock_anterior    numeric(14,3) not null,
  stock_nuevo       numeric(14,3) not null check (stock_nuevo >= 0),
  costo_unitario    numeric(16,2) not null default 0,
  obra_id           uuid,
  ot_id             uuid,
  requerimiento_id  uuid,
  prestamo_id       uuid,
  empleado_id       uuid,
  responsable_texto text,
  remito            text,
  notas             text,
  registrado_por    uuid references public.perfiles(id) on delete set null default auth.uid(),
  id_origen         text unique,
  created_at        timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (material_id, sector_id) references public.materiales(id, sector_id),
  foreign key (obra_id, sector_id)     references public.obras(id, sector_id) on delete set null (obra_id),
  foreign key (ot_id, sector_id)       references public.ordenes_trabajo(id, sector_id) on delete set null (ot_id),
  foreign key (empleado_id, sector_id) references public.empleados(id, sector_id) on delete set null (empleado_id),
  check ((tipo = 'entrada') = (motivo in ('stock_inicial','compra','devolucion','devolucion_prestamo','ajuste_entrada')))
);
create index movimientos_material_idx on public.movimientos_panol(material_id, created_at desc);
create index movimientos_sector_idx on public.movimientos_panol(sector_id, created_at desc);
create index movimientos_obra_idx on public.movimientos_panol(obra_id) where obra_id is not null;
select public.aplicar_rls_sector('public.movimientos_panol');

-- Los movimientos son el libro del pañol: los escriben solo las funciones de esta fase y no se tocan después.
create or replace function public.proteger_movimiento() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and public.dh1_flag('dh1.panol_fn') then
    return new;
  end if;
  -- Borrado en cascada de algo que ya no está (no pasa con materiales: tienen la referencia restringida).
  if tg_op = 'DELETE' then
    raise exception 'Un movimiento no se borra: si estuvo mal, registrá un ajuste.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    -- Solo se acepta la limpieza automática al borrar una obra, una orden o un empleado: dentro de la cascada
    -- (profundidad > 1), pasando esas referencias a vacío y sin tocar nada más.
    if pg_trigger_depth() > 1
       and (to_jsonb(new) - array['obra_id','ot_id','empleado_id']) = (to_jsonb(old) - array['obra_id','ot_id','empleado_id'])
       and (new.obra_id is null or new.obra_id = old.obra_id) and (new.ot_id is null or new.ot_id = old.ot_id)
       and (new.empleado_id is null or new.empleado_id = old.empleado_id) then
      return new;
    end if;
    raise exception 'Un movimiento no se modifica: si estuvo mal, registrá un ajuste.' using errcode = 'P0001';
  end if;
  raise exception 'Los movimientos se registran desde el pañol (entrada, salida, préstamo o ajuste).' using errcode = 'P0001';
end $$;
create trigger b_proteger before insert or update or delete on public.movimientos_panol
  for each row execute function public.proteger_movimiento();

-- El único camino para mover stock. Bloquea la fila del material: dos salidas simultáneas no pueden dejarlo negativo.
-- En una compra con costo, el costo del material pasa a ser el promedio ponderado.
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
    raise exception 'No alcanza el stock de %: hay % % y querés sacar %.', m.nombre, trim_scale(m.stock), m.unidad, trim_scale(p_cantidad)
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

-- Inventario físico: deja el stock en lo contado, con un ajuste por la diferencia. Devuelve el movimiento (o null si
-- ya coincidía).
create or replace function public.ajustar_stock(p_material uuid, p_contado numeric, p_notas text default null) returns uuid
language plpgsql set search_path = public as $$
declare
  v_stock numeric;
begin
  if p_contado is null or p_contado < 0 then
    raise exception 'El stock contado tiene que ser cero o más.' using errcode = 'P0001';
  end if;
  -- Bloqueado: entre leer el stock y ajustar no se puede colar otro movimiento.
  select m.stock into v_stock from public.materiales m where m.id = p_material for update;
  if not found then
    raise exception 'El material no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if p_contado = v_stock then
    return null;
  end if;
  return public.registrar_movimiento(p_material, case when p_contado > v_stock then 'entrada' else 'salida' end,
    case when p_contado > v_stock then 'ajuste_entrada' else 'ajuste_salida' end, abs(p_contado - v_stock),
    p_notas => coalesce(nullif(btrim(coalesce(p_notas, '')), ''), 'Ajuste por inventario físico'));
end $$;

-- Un material dado de alta con stock arranca con su movimiento de stock inicial (el stock nunca aparece de la nada).
create or replace function public.stock_inicial_material() returns trigger
language plpgsql set search_path = public as $$
declare
  v_prev text;
begin
  if new.stock > 0 and not public.es_servicio() then
    v_prev := public.panol_on();
    insert into public.movimientos_panol (sector_id, material_id, tipo, motivo, cantidad, stock_anterior, stock_nuevo, costo_unitario, notas)
    values (new.sector_id, new.id, 'entrada', 'stock_inicial', new.stock, 0, new.stock, new.costo_unitario, 'Stock inicial al dar de alta el material');
    perform public.panol_restore(v_prev);
  end if;
  return new;
end $$;
create trigger z_stock_inicial after insert on public.materiales
  for each row execute function public.stock_inicial_material();

-- =====================================================================================
-- 3. PRÉSTAMO DE HERRAMIENTAS
-- =====================================================================================
create sequence public.prestamo_numero_seq;

create table public.prestamos (
  id                 uuid primary key default gen_random_uuid(),
  sector_id          uuid not null references public.sectores(id),
  numero             bigint not null unique default nextval('public.prestamo_numero_seq'),
  material_id        uuid not null,
  cantidad           numeric(14,3) not null check (cantidad > 0),
  empleado_id        uuid not null,
  ot_id              uuid,
  obra_id            uuid,
  devolver_el        date,
  estado             text not null default 'prestado' check (estado in ('prestado','devuelto','perdido')),
  devuelto_at        timestamptz,
  mov_salida_id      uuid,
  mov_vuelta_id      uuid,
  notas              text,
  notas_cierre       text,
  registrado_por     uuid references public.perfiles(id) on delete set null default auth.uid(),
  cerrado_por        uuid references public.perfiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (material_id, sector_id) references public.materiales(id, sector_id),
  foreign key (empleado_id, sector_id) references public.empleados(id, sector_id),
  foreign key (ot_id, sector_id)       references public.ordenes_trabajo(id, sector_id) on delete set null (ot_id),
  foreign key (obra_id, sector_id)     references public.obras(id, sector_id) on delete set null (obra_id)
);
create index prestamos_abiertos_idx on public.prestamos(sector_id, estado);
select public.aplicar_rls_sector('public.prestamos');

create or replace function public.proteger_prestamo() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.panol_fn') then
    return coalesce(new, old);
  end if;
  -- Solo la limpieza automática al borrar la orden o la obra (dentro de la cascada, sin tocar nada más).
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and (to_jsonb(new) - array['ot_id','obra_id']) = (to_jsonb(old) - array['ot_id','obra_id'])
     and (new.ot_id is null or new.ot_id = old.ot_id) and (new.obra_id is null or new.obra_id = old.obra_id) then
    return new;
  end if;
  raise exception 'Los préstamos se registran y se cierran desde el pañol (prestar, devolver o dar por perdido).' using errcode = 'P0001';
end $$;
create trigger b_proteger before insert or update or delete on public.prestamos
  for each row execute function public.proteger_prestamo();

create or replace function public.prestar_herramienta(p_material uuid, p_cantidad numeric, p_empleado uuid,
  p_devolver_el date default null, p_ot uuid default null, p_notas text default null) returns uuid
language plpgsql set search_path = public as $$
declare
  m public.materiales%rowtype;
  v_id uuid := gen_random_uuid();
  v_mov uuid;
  v_obra uuid;
  v_prev text;
begin
  if not public.puede_validar() then
    raise exception 'Prestan herramientas gerencia y los jefes de sitio.' using errcode = 'P0001';
  end if;
  select * into m from public.materiales x where x.id = p_material;
  if not found then
    raise exception 'El material no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if not m.prestable then
    raise exception '% no está marcado como herramienta que se presta. Si se consume, registrá una salida.', m.nombre using errcode = 'P0001';
  end if;
  if p_empleado is null then
    raise exception 'Indicá a quién se le presta.' using errcode = 'P0001';
  end if;
  if p_devolver_el is not null and p_devolver_el < current_date then
    raise exception 'La fecha de devolución no puede ser anterior a hoy.' using errcode = 'P0001';
  end if;
  if p_ot is not null then
    select t.obra_id into v_obra from public.ordenes_trabajo t where t.id = p_ot;
  end if;
  v_prev := public.panol_on();
  v_mov := public.registrar_movimiento(p_material, 'salida', 'prestamo', p_cantidad, v_obra, p_ot, p_empleado,
                                       p_notas => p_notas, p_prestamo => v_id);
  insert into public.prestamos (id, sector_id, material_id, cantidad, empleado_id, ot_id, obra_id, devolver_el, mov_salida_id, notas)
  values (v_id, m.sector_id, m.id, p_cantidad, p_empleado, p_ot, v_obra, p_devolver_el, v_mov, nullif(btrim(coalesce(p_notas, '')), ''));
  perform public.panol_restore(v_prev);
  return v_id;
end $$;

create or replace function public.devolver_prestamo(p_id uuid, p_notas text default null) returns void
language plpgsql set search_path = public as $$
declare
  p public.prestamos%rowtype;
  v_mov uuid;
  v_prev text;
begin
  if not public.puede_validar() then
    raise exception 'Reciben devoluciones gerencia y los jefes de sitio.' using errcode = 'P0001';
  end if;
  select * into p from public.prestamos x where x.id = p_id for update;
  if not found then
    raise exception 'El préstamo no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if p.estado <> 'prestado' then
    raise exception 'Ese préstamo ya está cerrado (%).', p.estado using errcode = 'P0001';
  end if;
  v_prev := public.panol_on();
  v_mov := public.registrar_movimiento(p.material_id, 'entrada', 'devolucion_prestamo', p.cantidad, p.obra_id, p.ot_id, p.empleado_id,
                                       p_notas => p_notas, p_prestamo => p.id);
  update public.prestamos set estado = 'devuelto', devuelto_at = now(), mov_vuelta_id = v_mov, cerrado_por = auth.uid(),
         notas_cierre = nullif(btrim(coalesce(p_notas, '')), '')
   where id = p.id;
  perform public.panol_restore(v_prev);
end $$;

-- La herramienta no vuelve: el stock ya había salido con el préstamo, así que no se mueve; queda registrado por qué.
create or replace function public.perder_prestamo(p_id uuid, p_motivo text) returns void
language plpgsql set search_path = public as $$
declare
  p public.prestamos%rowtype;
  v_prev text;
begin
  if not public.es_gerencia() then
    raise exception 'Dar una herramienta por perdida lo decide gerencia.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Escribí qué pasó con la herramienta.' using errcode = 'P0001';
  end if;
  select * into p from public.prestamos x where x.id = p_id for update;
  if not found then
    raise exception 'El préstamo no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if p.estado <> 'prestado' then
    raise exception 'Ese préstamo ya está cerrado (%).', p.estado using errcode = 'P0001';
  end if;
  v_prev := public.panol_on();
  update public.prestamos set estado = 'perdido', devuelto_at = now(), cerrado_por = auth.uid(), notas_cierre = btrim(p_motivo) where id = p.id;
  perform public.panol_restore(v_prev);
end $$;

-- =====================================================================================
-- 4. REQUERIMIENTOS DE COMPRA
-- =====================================================================================
create sequence public.requerimiento_numero_seq;

create table public.requerimientos_compra (
  id                     uuid primary key default gen_random_uuid(),
  sector_id              uuid not null references public.sectores(id),
  numero                 bigint not null unique default nextval('public.requerimiento_numero_seq'),
  codigo                 text not null default '',
  titulo                 text not null check (btrim(titulo) <> ''),
  solicitante_id         uuid references public.perfiles(id) on delete set null default auth.uid(),
  ubicacion_id           uuid,
  establecimiento        text,
  obra_id                uuid,
  prioridad              text not null default 'normal' check (prioridad in ('baja','normal','alta','urgente')),
  fecha_necesidad        date,
  estado                 text not null default 'borrador'
                           check (estado in ('borrador','enviado','en_revision','aprobado','en_compra','recibido','rechazado','cancelado')),
  observaciones          text,
  motivo_rechazo         text,
  numero_orden_compra    text,
  proveedor_id           uuid,
  proveedor_texto        text,
  fecha_entrega_estimada date,
  -- [{ nombre, path, tipo, tamano }] en el bucket "documentos"
  adjuntos               jsonb not null default '[]'::jsonb check (jsonb_typeof(adjuntos) = 'array'),
  -- [{ fecha, estado, usuario, comentario }]: lo escribe la base
  historial              jsonb not null default '[]'::jsonb,
  total_estimado         numeric(16,2) not null default 0,
  revisor_id             uuid references public.perfiles(id) on delete set null,
  id_origen              text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, sector_id),
  foreign key (ubicacion_id, sector_id) references public.ubicaciones(id, sector_id),
  foreign key (obra_id, sector_id)      references public.obras(id, sector_id) on delete set null (obra_id),
  foreign key (proveedor_id, sector_id) references public.proveedores(id, sector_id)
);
create index requerimientos_sector_idx on public.requerimientos_compra(sector_id, estado);
select public.aplicar_rls_sector('public.requerimientos_compra');

create table public.requerimiento_items (
  id                  uuid primary key default gen_random_uuid(),
  sector_id           uuid not null references public.sectores(id),
  requerimiento_id    uuid not null,
  material_id         uuid,
  descripcion         text not null check (btrim(descripcion) <> ''),
  unidad              text not null default 'unidad',
  cantidad_solicitada numeric(14,3) not null check (cantidad_solicitada > 0),
  cantidad_aprobada   numeric(14,3) check (cantidad_aprobada >= 0),
  cantidad_recibida   numeric(14,3) not null default 0 check (cantidad_recibida >= 0),
  costo_estimado      numeric(16,2) not null default 0 check (costo_estimado >= 0),
  notas               text,
  orden               integer not null default 0,
  created_at          timestamptz not null default now(),
  foreign key (requerimiento_id, sector_id) references public.requerimientos_compra(id, sector_id) on delete cascade,
  foreign key (material_id, sector_id)      references public.materiales(id, sector_id)
);
create index requerimiento_items_idx on public.requerimiento_items(requerimiento_id, orden);
select public.aplicar_rls_sector('public.requerimiento_items');

-- Circuito:
--   borrador → enviado (quien lo pidió, con al menos un ítem) · enviado → en_revision (gerencia)
--   enviado | en_revision → aprobado | rechazado (gerencia, nunca quien lo pidió; rechazar pide motivo)
--   rechazado → borrador (quien lo pidió) · aprobado → en_compra (gerencia, con N° de orden de compra)
--   en_compra → recibido (solo recibiendo la mercadería) · borrador | enviado | en_revision | aprobado → cancelado
-- Quien lo pidió edita en borrador. Gerencia completa los datos de compra mientras está aprobado o en compra.
create or replace function public.validar_requerimiento() returns trigger
language plpgsql set search_path = public as $$
declare
  v_yo uuid := auth.uid();
  v_nombre text := (select p.nombre from public.perfiles p where p.id = auth.uid());
  v_sys boolean := public.dh1_flag('dh1.panol_fn');
  v_com text;
begin
  -- Al borrar la obra, la referencia se limpia sola (dentro de la cascada y sin tocar nada más).
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and (to_jsonb(new) - 'obra_id') = (to_jsonb(old) - 'obra_id') then
    return new;
  end if;
  if public.es_servicio() then
    if tg_op = 'INSERT' and coalesce(new.codigo, '') = '' then
      new.codigo := 'REQ-' || lpad(new.numero::text, 6, '0');
    end if;
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if not (public.es_gerencia() or (old.solicitante_id = v_yo and old.estado = 'borrador')) then
      raise exception 'Un requerimiento lo borra quien lo pidió (en borrador) o gerencia.' using errcode = 'P0001';
    end if;
    if old.estado in ('en_compra','recibido') then
      raise exception 'Un requerimiento en compra o recibido no se borra: queda como registro.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then
      raise exception 'Un requerimiento nuevo nace en borrador: cargá los ítems y después envialo.' using errcode = 'P0001';
    end if;
    new.solicitante_id := v_yo;
    new.numero := nextval('public.requerimiento_numero_seq');
    new.codigo := 'REQ-' || lpad(new.numero::text, 6, '0');
    new.revisor_id := null; new.motivo_rechazo := null; new.total_estimado := 0;
    new.numero_orden_compra := null; new.proveedor_id := null; new.proveedor_texto := null; new.fecha_entrega_estimada := null;
    new.historial := jsonb_build_array(jsonb_build_object('fecha', now(), 'estado', 'borrador', 'usuario', v_nombre, 'comentario', 'Creado'));
    return new;
  end if;

  -- UPDATE
  new.numero := old.numero; new.codigo := old.codigo; new.solicitante_id := old.solicitante_id; new.created_at := old.created_at;
  new.updated_at := now(); new.historial := old.historial;
  if not v_sys then new.total_estimado := old.total_estimado; end if;

  if new.estado is distinct from old.estado then
    if old.estado = 'borrador' and new.estado = 'enviado' then
      if old.solicitante_id is distinct from v_yo then
        raise exception 'Lo envía quien lo pidió.' using errcode = 'P0001';
      end if;
      if not exists (select 1 from public.requerimiento_items i where i.requerimiento_id = old.id) then
        raise exception 'Agregá al menos un ítem antes de enviarlo.' using errcode = 'P0001';
      end if;
    elsif old.estado = 'enviado' and new.estado = 'en_revision' then
      if not public.es_gerencia() then
        raise exception 'Lo toma para revisar gerencia.' using errcode = 'P0001';
      end if;
      new.revisor_id := v_yo;
    elsif old.estado in ('enviado','en_revision') and new.estado in ('aprobado','rechazado') then
      if not public.es_gerencia() then
        raise exception 'Solo gerencia aprueba o rechaza requerimientos.' using errcode = 'P0001';
      end if;
      if old.solicitante_id = v_yo then
        raise exception 'No podés aprobar ni rechazar un requerimiento que pediste vos.' using errcode = 'P0001';
      end if;
      if new.estado = 'rechazado' and coalesce(btrim(new.motivo_rechazo), '') = '' then
        raise exception 'Para rechazar, escribí el motivo.' using errcode = 'P0001';
      end if;
      new.revisor_id := v_yo;
    elsif old.estado = 'rechazado' and new.estado = 'borrador' then
      if old.solicitante_id is distinct from v_yo then
        raise exception 'Lo vuelve a borrador quien lo pidió.' using errcode = 'P0001';
      end if;
      new.motivo_rechazo := null; new.revisor_id := null;
    elsif old.estado = 'aprobado' and new.estado = 'en_compra' then
      if not public.es_gerencia() then
        raise exception 'Lo pasa a compra gerencia.' using errcode = 'P0001';
      end if;
      if coalesce(btrim(new.numero_orden_compra), '') = '' then
        raise exception 'Para pasarlo a compra, cargá el N° de orden de compra.' using errcode = 'P0001';
      end if;
    elsif old.estado = 'en_compra' and new.estado = 'recibido' then
      if not v_sys then
        raise exception 'Se marca recibido al recibir la mercadería (así entra al stock).' using errcode = 'P0001';
      end if;
    elsif old.estado in ('borrador','enviado','en_revision','aprobado') and new.estado = 'cancelado' then
      if not (public.es_gerencia() or old.solicitante_id = v_yo) then
        raise exception 'Lo cancela quien lo pidió o gerencia.' using errcode = 'P0001';
      end if;
    else
      raise exception 'Un requerimiento % no puede pasar a %.', replace(old.estado, '_', ' '), replace(new.estado, '_', ' ') using errcode = 'P0001';
    end if;
    -- Fuera del borrador, cambiar de estado no toca lo pedido.
    if old.estado <> 'borrador' then
      new.titulo := old.titulo; new.ubicacion_id := old.ubicacion_id; new.establecimiento := old.establecimiento; new.obra_id := old.obra_id;
      new.prioridad := old.prioridad; new.fecha_necesidad := old.fecha_necesidad; new.adjuntos := old.adjuntos;
    end if;
    v_com := case when new.estado = 'rechazado' then new.motivo_rechazo
                  when new.estado = 'en_compra' then 'OC ' || new.numero_orden_compra
                  else nullif(btrim(coalesce(new.observaciones, '')), '') end;
    if new.estado <> 'rechazado' and old.estado <> 'borrador' and new.observaciones is not distinct from old.observaciones then
      v_com := case when new.estado = 'en_compra' then v_com end;
    end if;
    new.historial := old.historial || jsonb_build_array(jsonb_build_object('fecha', now(), 'estado', new.estado, 'usuario', v_nombre, 'comentario', v_com));
    return new;
  end if;

  if v_sys then return new; end if;
  if old.estado = 'borrador' and old.solicitante_id = v_yo then
    new.revisor_id := old.revisor_id; new.motivo_rechazo := old.motivo_rechazo;
    new.numero_orden_compra := old.numero_orden_compra; new.proveedor_id := old.proveedor_id; new.proveedor_texto := old.proveedor_texto;
    new.fecha_entrega_estimada := old.fecha_entrega_estimada;
    return new;
  end if;
  if public.es_gerencia() and old.estado in ('enviado','en_revision','aprobado','en_compra') then
    -- Gerencia completa los datos de compra y las observaciones; lo pedido queda como está.
    new.titulo := old.titulo; new.ubicacion_id := old.ubicacion_id; new.establecimiento := old.establecimiento; new.obra_id := old.obra_id;
    new.prioridad := old.prioridad; new.fecha_necesidad := old.fecha_necesidad; new.adjuntos := old.adjuntos;
    new.revisor_id := old.revisor_id; new.motivo_rechazo := old.motivo_rechazo;
    return new;
  end if;
  raise exception 'No podés modificar este requerimiento en este estado.' using errcode = 'P0001';
end $$;
create trigger b_validar before insert or update or delete on public.requerimientos_compra
  for each row execute function public.validar_requerimiento();

-- Ítems: los arma quien lo pidió en borrador. Gerencia ajusta la cantidad aprobada mientras lo revisa.
-- Lo recibido lo escribe solo la recepción.
create or replace function public.validar_requerimiento_item() returns trigger
language plpgsql set search_path = public as $$
declare
  r public.requerimientos_compra%rowtype;
  m public.materiales%rowtype;
begin
  if public.es_servicio() then
    return coalesce(new, old);
  end if;
  select * into r from public.requerimientos_compra x where x.id = coalesce(new.requerimiento_id, old.requerimiento_id);
  if not found then
    return coalesce(new, old);   -- borrado en cascada del requerimiento
  end if;
  if public.dh1_flag('dh1.panol_fn') then
    return coalesce(new, old);
  end if;
  if r.estado = 'borrador' and r.solicitante_id = auth.uid() then
    if tg_op = 'DELETE' then return old; end if;
    if tg_op = 'UPDATE' then new.requerimiento_id := old.requerimiento_id; end if;
    new.cantidad_aprobada := null;
    new.cantidad_recibida := 0;
    if new.material_id is not null then
      select * into m from public.materiales x where x.id = new.material_id;
      new.descripcion := coalesce(nullif(btrim(new.descripcion), ''), m.nombre);
      new.unidad := m.unidad;
      if coalesce(new.costo_estimado, 0) = 0 then new.costo_estimado := m.costo_unitario; end if;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and public.es_gerencia() and r.estado in ('enviado','en_revision') then
    if r.solicitante_id = auth.uid() then
      raise exception 'No podés ajustar lo aprobado de un requerimiento que pediste vos.' using errcode = 'P0001';
    end if;
    -- solo la cantidad aprobada y el costo estimado
    new.requerimiento_id := old.requerimiento_id; new.material_id := old.material_id; new.descripcion := old.descripcion;
    new.unidad := old.unidad; new.cantidad_solicitada := old.cantidad_solicitada; new.cantidad_recibida := old.cantidad_recibida;
    new.notas := old.notas; new.orden := old.orden;
    return new;
  end if;
  raise exception 'Los ítems se cambian mientras el requerimiento está en borrador (quien lo pidió) o en revisión (gerencia).' using errcode = 'P0001';
end $$;
create trigger b_validar before insert or update or delete on public.requerimiento_items
  for each row execute function public.validar_requerimiento_item();

-- Total estimado: lo aprobado (o lo pedido, si todavía no se aprobó) por su costo.
create or replace function public.totalizar_requerimiento() returns trigger
language plpgsql set search_path = public as $$
declare
  v_id uuid := coalesce(new.requerimiento_id, old.requerimiento_id);
  v_prev text;
begin
  if not exists (select 1 from public.requerimientos_compra r where r.id = v_id) then
    return null;
  end if;
  v_prev := public.panol_on();
  update public.requerimientos_compra r
     set total_estimado = coalesce((select sum(round(coalesce(i.cantidad_aprobada, i.cantidad_solicitada) * i.costo_estimado, 2))
                                      from public.requerimiento_items i where i.requerimiento_id = v_id), 0)
   where r.id = v_id;
  perform public.panol_restore(v_prev);
  return null;
end $$;
create trigger z_total after insert or update or delete on public.requerimiento_items
  for each row execute function public.totalizar_requerimiento();

-- Al aprobar, cada ítem sin cantidad aprobada toma lo pedido.
create or replace function public.al_aprobar_requerimiento() returns trigger
language plpgsql set search_path = public as $$
declare
  v_prev text;
begin
  if new.estado = 'aprobado' and old.estado is distinct from 'aprobado' then
    v_prev := public.panol_on();
    update public.requerimiento_items set cantidad_aprobada = cantidad_solicitada where requerimiento_id = new.id and cantidad_aprobada is null;
    perform public.panol_restore(v_prev);
  end if;
  -- Vuelto a borrador para corregir: lo aprobado en la revisión anterior no queda pegado.
  if new.estado = 'borrador' and old.estado = 'rechazado' then
    v_prev := public.panol_on();
    update public.requerimiento_items set cantidad_aprobada = null where requerimiento_id = new.id;
    perform public.panol_restore(v_prev);
  end if;
  return null;
end $$;
-- El movimiento apunta al requerimiento que lo originó (la recepción) y al préstamo (que se graba después del movimiento,
-- por eso esa referencia se verifica al terminar la transacción).
alter table public.movimientos_panol
  add constraint movimientos_requerimiento_fk foreign key (requerimiento_id, sector_id) references public.requerimientos_compra(id, sector_id),
  add constraint movimientos_prestamo_fk foreign key (prestamo_id, sector_id) references public.prestamos(id, sector_id) deferrable initially deferred;

create trigger z_aprobar after update on public.requerimientos_compra
  for each row execute function public.al_aprobar_requerimiento();

-- Recepción de la compra (total o parcial). Cada ítem del catálogo entra al stock con su costo; los ítems sin material
-- del catálogo solo registran lo recibido. Con p_cerrar (o cuando llegó todo lo aprobado), queda recibido.
-- p_items: [{ item_id, cantidad, costo }]
create or replace function public.recibir_requerimiento(p_id uuid, p_items jsonb, p_remito text default null, p_cerrar boolean default false)
returns jsonb
language plpgsql set search_path = public as $$
declare
  r public.requerimientos_compra%rowtype;
  i public.requerimiento_items%rowtype;
  f jsonb;
  v_cant numeric;
  v_costo numeric;
  v_entradas int := 0;
  v_prev text;
  v_completo boolean;
begin
  if not public.puede_validar() then
    raise exception 'Reciben la mercadería gerencia y los jefes de sitio.' using errcode = 'P0001';
  end if;
  select * into r from public.requerimientos_compra x where x.id = p_id for update;
  if not found then
    raise exception 'El requerimiento no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if r.estado <> 'en_compra' then
    raise exception 'Solo se recibe un requerimiento en compra (este está %).', replace(r.estado, '_', ' ') using errcode = 'P0001';
  end if;
  v_prev := public.panol_on();
  for f in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_cant := nullif(f ->> 'cantidad', '')::numeric;
    if v_cant is null or v_cant = 0 then continue; end if;
    if v_cant < 0 then
      raise exception 'Una cantidad recibida no puede ser negativa.' using errcode = 'P0001';
    end if;
    select * into i from public.requerimiento_items x where x.id = (f ->> 'item_id')::uuid and x.requerimiento_id = r.id;
    if not found then
      raise exception 'Hay un ítem que no es de este requerimiento.' using errcode = 'P0001';
    end if;
    if i.cantidad_recibida + v_cant > coalesce(i.cantidad_aprobada, i.cantidad_solicitada) then
      raise exception 'De "%" se aprobaron % y con esto se recibirían %. Si llegó de más, ajustá lo aprobado o registralo como entrada aparte.',
        i.descripcion, trim_scale(coalesce(i.cantidad_aprobada, i.cantidad_solicitada)), trim_scale(i.cantidad_recibida + v_cant) using errcode = 'P0001';
    end if;
    v_costo := coalesce(nullif(f ->> 'costo', '')::numeric, i.costo_estimado);
    update public.requerimiento_items set cantidad_recibida = cantidad_recibida + v_cant where id = i.id;
    if i.material_id is not null then
      perform public.registrar_movimiento(i.material_id, 'entrada', 'compra', v_cant, r.obra_id, null, null, null,
        coalesce(nullif(btrim(coalesce(p_remito, '')), ''), r.numero_orden_compra), 'Recepción de ' || r.codigo, v_costo, r.id);
      v_entradas := v_entradas + 1;
    end if;
  end loop;
  select bool_and(x.cantidad_recibida >= coalesce(x.cantidad_aprobada, x.cantidad_solicitada)) into v_completo
    from public.requerimiento_items x where x.requerimiento_id = r.id;
  if p_cerrar or coalesce(v_completo, false) then
    update public.requerimientos_compra set estado = 'recibido' where id = r.id;
  end if;
  perform public.panol_restore(v_prev);
  return jsonb_build_object('entradas', v_entradas, 'completo', coalesce(v_completo, false),
                            'estado', (select x.estado from public.requerimientos_compra x where x.id = r.id));
end $$;

-- =====================================================================================
-- 5. MATERIALES DE LA ORDEN DE TRABAJO
-- =====================================================================================
create table public.ot_materiales (
  id              uuid primary key default gen_random_uuid(),
  sector_id       uuid not null references public.sectores(id),
  ot_id           uuid not null,
  material_id     uuid,
  descripcion     text not null check (btrim(descripcion) <> ''),
  unidad          text not null default 'unidad',
  cantidad        numeric(14,3) not null check (cantidad > 0),
  costo_unitario  numeric(16,2) not null default 0 check (costo_unitario >= 0),
  -- true: sale del pañol (descuenta stock). false: se anota lo usado (comprado en el momento, del contratista...)
  descontar       boolean not null default false,
  movimiento_id   uuid,
  id_origen       text unique,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (ot_id, sector_id)       references public.ordenes_trabajo(id, sector_id) on delete cascade,
  foreign key (material_id, sector_id) references public.materiales(id, sector_id)
);
create index ot_materiales_ot_idx on public.ot_materiales(ot_id);
select public.aplicar_rls_sector('public.ot_materiales');

-- Anota materiales cualquiera del sector. Sacarlos del pañol (descontar) lo hacen gerencia y los jefes de sitio.
-- Quitar un material que salió del pañol lo devuelve al stock.
create or replace function public.validar_ot_material() returns trigger
language plpgsql set search_path = public as $$
declare
  m public.materiales%rowtype;
  v_prev text;
begin
  if public.es_servicio() then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' and not (public.puede_validar() or (old.created_by = auth.uid() and not old.descontar)) then
    raise exception 'Este material lo cargó otra persona o ya salió del pañol: lo cambia un jefe de sitio o gerencia.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    if old.descontar and exists (select 1 from public.ordenes_trabajo t where t.id = old.ot_id) then
      perform public.registrar_movimiento(old.material_id, 'entrada', 'devolucion', old.cantidad, null, old.ot_id,
        p_notas => 'Se quitó de la orden: vuelve al pañol');
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.descontar then
      raise exception 'Un material que salió del pañol no se modifica: quitalo (vuelve al stock) y cargalo de nuevo.' using errcode = 'P0001';
    end if;
    if new.descontar then
      raise exception 'Para sacarlo del pañol, quitalo y cargalo de nuevo marcando que sale del pañol.' using errcode = 'P0001';
    end if;
    new.ot_id := old.ot_id; new.created_by := old.created_by; new.created_at := old.created_at; new.movimiento_id := old.movimiento_id;
  end if;
  if new.material_id is not null then
    select * into m from public.materiales x where x.id = new.material_id;
    new.descripcion := coalesce(nullif(btrim(new.descripcion), ''), m.nombre);
    new.unidad := m.unidad;
    if tg_op = 'INSERT' and coalesce(new.costo_unitario, 0) = 0 then new.costo_unitario := m.costo_unitario; end if;
  end if;
  if tg_op = 'INSERT' then
    new.movimiento_id := null;
    new.created_by := auth.uid();
    if not public.puede_validar() and exists (select 1 from public.ordenes_trabajo t where t.id = new.ot_id and t.estado in ('completada','cancelada')) then
      raise exception 'La orden ya está cerrada: los materiales los corrige un jefe de sitio o gerencia.' using errcode = 'P0001';
    end if;
    if new.descontar then
      if new.material_id is null then
        raise exception 'Para sacarlo del pañol, elegí el material del catálogo.' using errcode = 'P0001';
      end if;
      if not public.puede_validar() then
        raise exception 'Sacar material del pañol lo hacen gerencia y los jefes de sitio. Anotalo sin descontar y avisá.' using errcode = 'P0001';
      end if;
      new.costo_unitario := m.costo_unitario;
      new.movimiento_id := public.registrar_movimiento(new.material_id, 'salida', 'consumo', new.cantidad, null, new.ot_id,
                                                       p_notas => 'Usado en la orden');
    end if;
  end if;
  return new;
end $$;
create trigger b_validar before insert or update or delete on public.ot_materiales
  for each row execute function public.validar_ot_material();

-- =====================================================================================
-- 6. VISTAS
-- =====================================================================================
create view public.v_materiales with (security_invoker = true) as
select m.*,
       pr.nombre as proveedor_nombre,
       (m.stock_minimo > 0 and m.stock <= m.stock_minimo) as bajo_minimo,
       (m.stock = 0) as sin_stock,
       round(m.stock * m.costo_unitario, 2) as valor,
       coalesce(pp.prestado, 0) as prestado,
       um.ultimo as ultimo_movimiento_at
  from public.materiales m
  left join public.proveedores pr on pr.id = m.proveedor_id
  left join lateral (select sum(p.cantidad) as prestado from public.prestamos p where p.material_id = m.id and p.estado = 'prestado') pp on true
  left join lateral (select max(x.created_at) as ultimo from public.movimientos_panol x where x.material_id = m.id) um on true;

create view public.v_movimientos_panol with (security_invoker = true) as
select x.*,
       m.nombre as material_nombre, m.codigo as material_codigo, m.unidad as material_unidad,
       o.titulo as obra_titulo, t.codigo as ot_codigo, e.nombre as empleado_nombre, p.nombre as registrado_por_nombre,
       r.codigo as requerimiento_codigo,
       round(x.cantidad * x.costo_unitario, 2) as valor
  from public.movimientos_panol x
  join public.materiales m           on m.id = x.material_id
  left join public.obras o           on o.id = x.obra_id
  left join public.ordenes_trabajo t on t.id = x.ot_id
  left join public.empleados e       on e.id = x.empleado_id
  left join public.perfiles p        on p.id = x.registrado_por
  left join public.requerimientos_compra r on r.id = x.requerimiento_id;

create view public.v_prestamos with (security_invoker = true) as
select p.*,
       m.nombre as material_nombre, m.codigo as material_codigo, m.unidad as material_unidad,
       e.nombre as empleado_nombre, t.codigo as ot_codigo, o.titulo as obra_titulo,
       (p.estado = 'prestado' and p.devolver_el is not null and p.devolver_el < current_date) as vencido
  from public.prestamos p
  join public.materiales m           on m.id = p.material_id
  join public.empleados e            on e.id = p.empleado_id
  left join public.ordenes_trabajo t on t.id = p.ot_id
  left join public.obras o           on o.id = p.obra_id;

create view public.v_requerimientos with (security_invoker = true) as
select r.*,
       ps.nombre as solicitante_nombre, pv.nombre as revisor_nombre, o.titulo as obra_titulo, u.nombre as ubicacion_nombre,
       pr.nombre as proveedor_nombre,
       (select count(*) from public.requerimiento_items i where i.requerimiento_id = r.id)::integer as items_total,
       (r.fecha_necesidad is not null and r.fecha_necesidad < current_date and r.estado in ('enviado','en_revision','aprobado','en_compra')) as atrasado
  from public.requerimientos_compra r
  left join public.perfiles ps    on ps.id = r.solicitante_id
  left join public.perfiles pv    on pv.id = r.revisor_id
  left join public.obras o        on o.id = r.obra_id
  left join public.ubicaciones u  on u.id = r.ubicacion_id
  left join public.proveedores pr on pr.id = r.proveedor_id;

create view public.v_ot_materiales with (security_invoker = true) as
select x.*, m.codigo as material_codigo, round(x.cantidad * x.costo_unitario, 2) as total, p.nombre as cargado_por_nombre
  from public.ot_materiales x
  left join public.materiales m on m.id = x.material_id
  left join public.perfiles p   on p.id = x.created_by;

-- Lo que salió del pañol hacia cada obra (consumo y asignación), neto de devoluciones.
create view public.v_consumo_obra with (security_invoker = true) as
select x.obra_id, x.sector_id,
       sum(case when x.tipo = 'salida' and x.motivo in ('consumo','asignacion_obra') then x.cantidad * x.costo_unitario
                when x.tipo = 'entrada' and x.motivo = 'devolucion' then -x.cantidad * x.costo_unitario else 0 end)::numeric(16,2) as costo_materiales,
       count(*) filter (where x.tipo = 'salida')::integer as salidas
  from public.movimientos_panol x
 where x.obra_id is not null
 group by x.obra_id, x.sector_id;

-- =====================================================================================
-- 7. IMPORTACIÓN DEL CATÁLOGO
-- =====================================================================================
-- Clave: el código (sin distinguir mayúsculas); sin código, el nombre. Lo nuevo entra con su stock inicial (con su
-- movimiento). En lo existente se actualizan los datos que trae la planilla; el stock solo si se pide ajustar al
-- contado (queda un ajuste por la diferencia).
-- p_filas: [{ nombre, codigo, categoria, unidad, stock, stock_minimo, costo_unitario, proveedor, ubicacion, notas }]
create or replace function public.importar_materiales(p_filas jsonb, p_ajustar boolean default false) returns jsonb
language plpgsql set search_path = public as $$
declare
  f jsonb;
  v_id uuid;
  v_nuevos int := 0;
  v_act int := 0;
  v_ajustes int := 0;
  v_omit int := 0;
  v_cat text;
  v_uni text;
  v_stock numeric;
begin
  if not public.puede_validar() then
    raise exception 'Importan el catálogo gerencia y los jefes de sitio.' using errcode = 'P0001';
  end if;
  for f in select * from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) loop
    if coalesce(btrim(f ->> 'nombre'), '') = '' then v_omit := v_omit + 1; continue; end if;
    v_cat := case when f ->> 'categoria' in ('electrico','plomeria','pintura','construccion','herreria','herramientas','seguridad','climatizacion','limpieza','otros')
                  then f ->> 'categoria' end;
    v_uni := case when f ->> 'unidad' in ('unidad','metro','metro2','metro3','kg','litro','bolsa','caja','rollo','par','juego') then f ->> 'unidad' end;
    v_stock := public.acotar((f ->> 'stock')::numeric, 0, null);
    v_id := null;
    if nullif(btrim(f ->> 'codigo'), '') is not null then
      select m.id into v_id from public.materiales m where m.sector_id = public.sector_efectivo() and lower(m.codigo) = lower(btrim(f ->> 'codigo'));
    else
      select m.id into v_id from public.materiales m
       where m.sector_id = public.sector_efectivo() and public.norm_txt(m.nombre) = public.norm_txt(f ->> 'nombre') limit 1;
    end if;
    if v_id is null then
      insert into public.materiales (nombre, codigo, categoria, unidad, stock, stock_minimo, costo_unitario, proveedor_texto, ubicacion_deposito, notas,
                                     prestable)
      values (f ->> 'nombre', f ->> 'codigo', coalesce(v_cat, 'otros'), coalesce(v_uni, 'unidad'), coalesce(v_stock, 0),
              coalesce(public.acotar((f ->> 'stock_minimo')::numeric, 0, null), 0), coalesce(public.acotar((f ->> 'costo_unitario')::numeric, 0, null), 0),
              nullif(btrim(f ->> 'proveedor'), ''), nullif(btrim(f ->> 'ubicacion'), ''), nullif(btrim(f ->> 'notas'), ''),
              coalesce(v_cat, '') = 'herramientas');
      v_nuevos := v_nuevos + 1;
    else
      update public.materiales m set
        nombre = btrim(f ->> 'nombre'),
        categoria = coalesce(v_cat, m.categoria),
        unidad = coalesce(v_uni, m.unidad),
        stock_minimo = coalesce(public.acotar((f ->> 'stock_minimo')::numeric, 0, null), m.stock_minimo),
        costo_unitario = coalesce(public.acotar((f ->> 'costo_unitario')::numeric, 0, null), m.costo_unitario),
        proveedor_texto = coalesce(nullif(btrim(f ->> 'proveedor'), ''), m.proveedor_texto),
        ubicacion_deposito = coalesce(nullif(btrim(f ->> 'ubicacion'), ''), m.ubicacion_deposito),
        notas = coalesce(nullif(btrim(f ->> 'notas'), ''), m.notas)
       where m.id = v_id;
      v_act := v_act + 1;
      if p_ajustar and v_stock is not null then
        if public.ajustar_stock(v_id, v_stock, 'Ajuste por planilla de inventario') is not null then
          v_ajustes := v_ajustes + 1;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_act, 'ajustados', v_ajustes, 'omitidos', v_omit);
end $$;

-- =====================================================================================
-- 8. BÚSQUEDA: se suma "materiales"
-- =====================================================================================
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
      select m.id, m.nombre, concat_ws(' · ', m.codigo, 'stock ' || trim_scale(m.stock) || ' ' || m.unidad, case when m.prestable then 'se presta' end)
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
-- panol_on/panol_restore quedan ejecutables: las funciones de esta fase corren con los permisos de quien llama.
-- Prenderla en una llamada suelta a la API no sirve: cada pedido es su propia transacción y la bandera es local.
