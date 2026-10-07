-- =====================================================================================
-- DH1 v2 · Fase 14 · Certificados como en la v1 (Base44), con las reglas de la v2
-- Va después de la fase 13. Se puede correr más de una vez.
--
-- La pantalla de Certificados pasa a ser la de la v1: se sube el PDF del ADA, se revisa un certificado
-- (no un contrato), vista previa, PDF, borrador o emisión con firma del jefe de sitio, y la solicitud de
-- aprobación sale sola. Por debajo siguen las reglas de la v2: el número lo pone la base, emitido y aprobado no
-- se tocan, no se certifica de más, quien emite no aprueba.
--
--   1. Contratos: tipo "informe" (certificado de avance), base, plazo de entrega, monto de obra contratada.
--   2. Certificados: anticipo y fondo de reparo también como monto fijo, nombre del fondo, % de avance de obra
--      (dato de cabecera), firma del jefe de sitio, marca de generado automáticamente.
--   3. La medición se puede cargar en pesos ("A certificar $" de la v1): la base deriva las unidades.
--   4. guardar_certificado(): crea o reutiliza el contrato (por N° de ADA), sincroniza los ítems, arma el borrador
--      y guarda la medición y la cabecera. Todo junto o nada.
--   5. emitir_certificado(): firma del jefe de sitio en obra, y crea la solicitud de aprobación.
--      aprobar/rechazar_certificado(): resuelven también la solicitud vinculada; la firma del gerente sale de su
--      perfil si no se manda otra.
-- =====================================================================================

-- ------------------------------------------------------------------ 1. contratos
alter table public.contratos drop constraint if exists contratos_tipo_check;
alter table public.contratos add constraint contratos_tipo_check check (tipo in ('abono_mensual','obra','informe'));
alter table public.contratos add column if not exists base text;
alter table public.contratos add column if not exists plazo_entrega text;
alter table public.contratos add column if not exists monto_obra_contratada numeric(16,2) check (monto_obra_contratada >= 0);
-- Abonos maestros (solapa "Abonos Maestros" de la v1): rubro (carpeta), comuna y fecha de emisión de la OC.
alter table public.contratos add column if not exists rubro text;
alter table public.contratos add column if not exists comuna text;
alter table public.contratos add column if not exists fecha_oc_emision date;
-- Un abono se puede pausar (no se certifica) sin cerrarlo.
alter table public.contratos drop constraint if exists contratos_estado_check;
alter table public.contratos add constraint contratos_estado_check check (estado in ('activo','pausado','cerrado'));

-- ------------------------------------------------------------------ 2. certificados
alter table public.certificados add column if not exists anticipo_monto_manual numeric(16,2) check (anticipo_monto_manual >= 0);
alter table public.certificados add column if not exists fondo_reparo_monto_manual numeric(16,2) check (fondo_reparo_monto_manual >= 0);
alter table public.certificados add column if not exists fondo_reparo_label text;
alter table public.certificados add column if not exists avance_obra_pct numeric(5,2) check (avance_obra_pct between 0 and 100);
alter table public.certificados add column if not exists firma_jefe_url text;
alter table public.certificados add column if not exists firma_jefe_por uuid references public.perfiles(id) on delete set null;
alter table public.certificados add column if not exists firma_jefe_nombre text;
alter table public.certificados add column if not exists firma_jefe_at timestamptz;
alter table public.certificados add column if not exists generado_automaticamente boolean not null default false;
-- La línea recuerda si la medición se cargó en pesos: al recalcular se respeta el importe y se derivan las unidades.
alter table public.certificado_items add column if not exists presente_por_importe boolean not null default false;

-- En borrador, la cabecera (incluidas las deducciones) la edita quien trabaja el certificado. Estado, número,
-- sellos, firmas y totales siguen siendo de la base.
create or replace function public.proteger_certificado() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.cert_fn') then
    if tg_op <> 'DELETE' then new.updated_at := now(); end if;
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Los certificados se crean con "Nuevo certificado".' using errcode = 'P0001';
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

  if new.estado <> old.estado or new.numero is distinct from old.numero then
    raise exception 'El estado y el número del certificado no se cambian a mano: usá Emitir.' using errcode = 'P0001';
  end if;
  if new.anticipo_pct < 0 or new.anticipo_pct > 100 or new.fondo_reparo_pct < 0 or new.fondo_reparo_pct > 100 then
    raise exception 'Los porcentajes de anticipo y fondo de reparo van de 0 a 100.' using errcode = 'P0001';
  end if;
  new.sector_id := old.sector_id;
  new.contrato_id := old.contrato_id;
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
  new.firma_jefe_url := old.firma_jefe_url; new.firma_jefe_por := old.firma_jefe_por;
  new.firma_jefe_nombre := old.firma_jefe_nombre; new.firma_jefe_at := old.firma_jefe_at;
  new.generado_automaticamente := old.generado_automaticamente;
  new.rechazado_por := old.rechazado_por; new.rechazado_at := old.rechazado_at;
  new.rechazo_motivo := old.rechazo_motivo;
  new.historico := old.historico;       new.datos_historicos := old.datos_historicos;
  new.created_by := old.created_by;     new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

-- Si cambian las deducciones de la cabecera, los totales se rehacen.
create or replace function public.totalizar_cabecera_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.cert_fn') then
    return null;
  end if;
  if (new.anticipo_pct, new.fondo_reparo_pct, new.fondo_reparo_aplicar, new.anticipo_monto_manual, new.fondo_reparo_monto_manual)
     is distinct from
     (old.anticipo_pct, old.fondo_reparo_pct, old.fondo_reparo_aplicar, old.anticipo_monto_manual, old.fondo_reparo_monto_manual) then
    perform public.totalizar_certificado(new.id);
  end if;
  return null;
end $$;
drop trigger if exists z_totalizar_cabecera on public.certificados;
create trigger z_totalizar_cabecera after update on public.certificados
  for each row execute function public.totalizar_cabecera_trg();

-- Anticipo y fondo de reparo: el monto fijo, si se cargó; si no, el porcentaje sobre lo certificado en el período.
create or replace function public.totalizar_certificado(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  v_prev text;
begin
  v_prev := public.cert_fn_on();
  update public.certificados c
     set subtotal_presente     = t.presente,
         anticipo_monto        = d.anticipo,
         fondo_reparo_monto    = d.fondo,
         total_neto            = t.presente - d.anticipo - d.fondo,
         acum_anterior_importe = t.anterior,
         acum_presente_importe = t.acumulado,
         porcentaje_avance     = case when k.monto_contratado > 0
                                      then round(t.acumulado * 100 / k.monto_contratado, 2) else 0 end
    from (select coalesce(sum(i.med_presente_importe), 0)      as presente,
                 coalesce(sum(i.med_acum_anterior_importe), 0) as anterior,
                 coalesce(sum(i.med_acum_presente_importe), 0) as acumulado
            from public.certificado_items i where i.certificado_id = p_id) t,
         public.contratos k,
         lateral (select coalesce(x.anticipo_monto_manual, round(t.presente * x.anticipo_pct / 100, 2)) as anticipo,
                         case when x.fondo_reparo_aplicar
                              then coalesce(x.fondo_reparo_monto_manual, round(t.presente * x.fondo_reparo_pct / 100, 2))
                              else 0 end as fondo
                    from public.certificados x where x.id = p_id) d
   where c.id = p_id and k.id = c.contrato_id;
  perform public.cert_fn_restore(v_prev);
end $$;

-- ------------------------------------------------------------------ 3. medición en unidades o en pesos
create or replace function public.calcular_linea_certificado() returns trigger
language plpgsql set search_path = public as $$
declare
  v_estado public.certificado_estado;
  v_unidad numeric(16,4);
  v_importe numeric(16,2);
  v_por_importe boolean;
  v_item public.contrato_items%rowtype;
begin
  if public.es_servicio() or public.dh1_flag('dh1.cert_fn') then
    return coalesce(new, old);
  end if;

  select c.estado into v_estado from public.certificados c
   where c.id = coalesce(new.certificado_id, old.certificado_id);

  if tg_op = 'DELETE' then
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

  -- Se mide en pesos si el cliente cambió el importe y no las unidades; si no, en unidades.
  -- Un recálculo (nada cambia) respeta cómo se midió la última vez.
  if new.med_presente_importe is distinct from old.med_presente_importe
     and new.med_presente_unidad is not distinct from old.med_presente_unidad then
    v_por_importe := true;
  elsif new.med_presente_unidad is distinct from old.med_presente_unidad then
    v_por_importe := false;
  else
    v_por_importe := old.presente_por_importe;
  end if;
  v_unidad := new.med_presente_unidad;
  v_importe := new.med_presente_importe;
  if v_unidad is null or v_unidad < 0 or v_importe is null or v_importe < 0 then
    raise exception 'La medición del período no puede ser negativa.' using errcode = 'P0001';
  end if;

  new := old;
  select * into v_item from public.contrato_items i where i.id = new.contrato_item_id;
  new.numero := v_item.numero;
  new.descripcion := v_item.descripcion;
  new.um := v_item.um;
  new.cantidad := v_item.cantidad;
  new.importe_unitario := v_item.importe_unitario;
  new.importe_total := v_item.importe_total;
  new.presente_por_importe := v_por_importe;

  if v_por_importe then
    if v_item.importe_unitario = 0 and v_importe > 0 then
      raise exception 'El ítem % no tiene precio: no se puede certificar en pesos.', v_item.numero using errcode = 'P0001';
    end if;
    new.med_presente_importe := round(v_importe, 2);
    new.med_presente_unidad := case when v_item.importe_unitario > 0 then round(v_importe / v_item.importe_unitario, 4) else 0 end;
  else
    new.med_presente_unidad := v_unidad;
    new.med_presente_importe := round(v_unidad * v_item.importe_unitario, 2);
  end if;

  select coalesce(sum(ci.med_presente_unidad), 0), coalesce(sum(ci.med_presente_importe), 0)
    into new.med_acum_anterior_unidad, new.med_acum_anterior_importe
    from public.certificado_items ci
    join public.certificados c on c.id = ci.certificado_id
   where ci.contrato_item_id = new.contrato_item_id
     and c.estado in ('emitido','aprobado')
     and c.id <> new.certificado_id;

  new.med_acum_presente_unidad  := new.med_acum_anterior_unidad + new.med_presente_unidad;
  new.med_acum_presente_importe := new.med_acum_anterior_importe + new.med_presente_importe;
  new.saldo_pendiente_unidad    := new.cantidad - new.med_acum_presente_unidad;
  new.saldo_pendiente_importe   := new.importe_total - new.med_acum_presente_importe;
  return new;
end $$;

-- Sobre-certificación en pesos: un ítem medido en pesos no puede pasar su importe total (las unidades derivadas
-- pueden diferir en la cuarta cifra decimal por redondeo, así que se controla el importe).
create or replace function public.controlar_sobrecertificacion(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  v_linea record;
begin
  select ci.numero, ci.descripcion, ci.cantidad, ci.um, ci.med_acum_presente_unidad, ci.med_acum_presente_importe, ci.importe_total
    into v_linea
    from public.certificado_items ci
   where ci.certificado_id = p_id
     and ((not ci.presente_por_importe and ci.med_acum_presente_unidad > ci.cantidad)
          or ci.med_acum_presente_importe > ci.importe_total + 0.01)
   order by ci.numero limit 1;
  if found then
    raise exception 'Sobre-certificación en el ítem % (%): el acumulado llega a $ % y el ítem es de $ %.',
      v_linea.numero, v_linea.descripcion, v_linea.med_acum_presente_importe, v_linea.importe_total
      using errcode = 'P0001';
  end if;
end $$;

-- ------------------------------------------------------------------ 4. guardar el certificado (como la v1)
-- Deja los ítems del contrato como dice la lista (en ese orden): actualiza los que traen id, agrega los nuevos al
-- final y quita los que no vinieron. p_multiplicador: los abonos cargan la cantidad mensual y el contrato guarda
-- la de toda la vigencia (mensual × meses). Devuelve los id en el orden de la lista. Corre con los permisos de
-- quien llama (cambiar ítems es de gerencia).
create or replace function public.sincronizar_items_contrato(p_contrato uuid, p_items jsonb, p_multiplicador numeric)
returns uuid[]
language plpgsql set search_path = public as $$
declare
  v_it jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_n integer := 0;
  v_max integer;
  v_desc text;
  v_um text;
  v_cant numeric;
  v_pu numeric;
begin
  select coalesce(max(i.numero), 0) into v_max from public.contrato_items i where i.contrato_id = p_contrato;
  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_desc := btrim(coalesce(v_it ->> 'descripcion', ''));
    v_um := coalesce(nullif(btrim(v_it ->> 'um'), ''), 'u');
    v_cant := round(coalesce(nullif(v_it ->> 'cantidad', '')::numeric, 0) * coalesce(p_multiplicador, 1), 4);
    v_pu := coalesce(nullif(v_it ->> 'importe_unitario', '')::numeric, 0);
    if v_desc = '' then
      raise exception 'El ítem % no tiene descripción.', v_n using errcode = 'P0001';
    end if;
    if v_cant <= 0 then
      raise exception 'El ítem % (%) tiene que tener cantidad mayor a cero.', v_n, v_desc using errcode = 'P0001';
    end if;
    if v_pu < 0 then
      raise exception 'El ítem % (%) no puede tener precio negativo.', v_n, v_desc using errcode = 'P0001';
    end if;
    v_id := nullif(v_it ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.contrato_items i where i.id = v_id and i.contrato_id = p_contrato) then
      update public.contrato_items i set descripcion = v_desc, um = v_um, cantidad = v_cant, importe_unitario = v_pu
       where i.id = v_id and (i.descripcion, i.um, i.cantidad, i.importe_unitario) is distinct from (v_desc, v_um, v_cant, v_pu);
    else
      v_max := v_max + 1;
      insert into public.contrato_items (contrato_id, numero, descripcion, um, cantidad, importe_unitario)
      values (p_contrato, v_max, v_desc, v_um, v_cant, v_pu)
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  if array_length(v_ids, 1) is null then
    raise exception 'Tiene que haber al menos un ítem.' using errcode = 'P0001';
  end if;
  delete from public.contrato_items i where i.contrato_id = p_contrato and not (i.id = any (v_ids));
  return v_ids;
end $$;

-- p = {
--   certificado_id?, contrato_id?,
--   contrato: { tipo, contratista, contratista_cuit, obra_servicio, emprendimiento, ada_numero, oc_numero, fecha_inicio,
--               fecha_fin, plazo, plazo_entrega, condiciones_pago, base, monto_obra_contratada, ada_pdf_url },
--   items: [ { id?, descripcion, um, cantidad, importe_unitario, presente_importe } ],   -- en el orden del certificado
--   cabecera: { periodo, fecha_certificado, numero_recepcion, anticipo_pct, anticipo_monto_manual, fondo_reparo_pct,
--               fondo_reparo_monto_manual, fondo_reparo_label, fondo_reparo_aplicar, avance_obra_pct }
-- }
-- Sin certificado ni contrato: si hay un contrato activo con el mismo N° de ADA, se usa ese (así el certificado
-- arrastra lo ya certificado); si no, se crea. Cabecera e ítems del contrato los cambia solo gerencia.
create or replace function public.guardar_certificado(p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  k public.contratos%rowtype;
  c jsonb := coalesce(p -> 'contrato', '{}'::jsonb);
  h jsonb := coalesce(p -> 'cabecera', '{}'::jsonb);
  v_items jsonb := p -> 'items';
  v_cert uuid := nullif(p ->> 'certificado_id', '')::uuid;
  v_contrato uuid := nullif(p ->> 'contrato_id', '')::uuid;
  v_ada text := nullif(btrim(c ->> 'ada_numero'), '');
  v_periodo text := coalesce(nullif(btrim(h ->> 'periodo'), ''), public.mes_texto(current_date));
  v_gerencia boolean := public.es_gerencia();
  v_estado public.certificado_estado;
  v_it jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_n integer := 0;
  v_max integer;
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden trabajar sobre un certificado.' using errcode = 'P0001';
  end if;

  -- ¿Sobre qué contrato?
  if v_cert is not null then
    select x.contrato_id, x.estado into v_contrato, v_estado from public.certificados x where x.id = v_cert;
    if not found then
      raise exception 'El certificado no existe o no es de tu sector.' using errcode = 'P0001';
    end if;
    if v_estado <> 'borrador' then
      raise exception 'El certificado ya está %: no se modifica.', v_estado using errcode = 'P0001';
    end if;
  elsif v_contrato is null and v_ada is not null then
    select x.id into v_contrato from public.contratos x
     where x.estado = 'activo' and lower(btrim(x.ada_numero)) = lower(v_ada)
     order by x.created_at desc limit 1;
  end if;

  if v_contrato is null then
    if not v_gerencia then
      raise exception 'Un contrato nuevo (ADA nueva) lo carga gerencia.' using errcode = 'P0001';
    end if;
    if coalesce(btrim(c ->> 'contratista'), '') = '' or coalesce(btrim(c ->> 'obra_servicio'), '') = '' then
      raise exception 'Faltan el contratista y la obra o servicio.' using errcode = 'P0001';
    end if;
    insert into public.contratos (tipo, contratista, obra_servicio)
    values (coalesce(nullif(c ->> 'tipo', ''), 'abono_mensual'), btrim(c ->> 'contratista'), btrim(c ->> 'obra_servicio'))
    returning id into v_contrato;
  end if;
  select * into k from public.contratos x where x.id = v_contrato for update;
  if not found then
    raise exception 'El contrato no existe o no es de tu sector.' using errcode = 'P0001';
  end if;

  -- Cabecera del contrato (gerencia). Lo que no viene, queda como está.
  if v_gerencia and c <> '{}'::jsonb then
    update public.contratos x set
      tipo                  = coalesce(nullif(c ->> 'tipo', ''), x.tipo),
      contratista           = coalesce(nullif(btrim(c ->> 'contratista'), ''), x.contratista),
      contratista_cuit      = case when c ? 'contratista_cuit' then nullif(btrim(c ->> 'contratista_cuit'), '') else x.contratista_cuit end,
      obra_servicio         = coalesce(nullif(btrim(c ->> 'obra_servicio'), ''), x.obra_servicio),
      emprendimiento        = case when c ? 'emprendimiento' then nullif(btrim(c ->> 'emprendimiento'), '') else x.emprendimiento end,
      ada_numero            = case when c ? 'ada_numero' then nullif(btrim(c ->> 'ada_numero'), '') else x.ada_numero end,
      oc_numero             = case when c ? 'oc_numero' then nullif(btrim(c ->> 'oc_numero'), '') else x.oc_numero end,
      fecha_inicio          = case when c ? 'fecha_inicio' then nullif(c ->> 'fecha_inicio', '')::date else x.fecha_inicio end,
      fecha_fin             = case when c ? 'fecha_fin' then nullif(c ->> 'fecha_fin', '')::date else x.fecha_fin end,
      plazo                 = case when c ? 'plazo' then nullif(btrim(c ->> 'plazo'), '') else x.plazo end,
      plazo_entrega         = case when c ? 'plazo_entrega' then nullif(btrim(c ->> 'plazo_entrega'), '') else x.plazo_entrega end,
      condiciones_pago      = case when c ? 'condiciones_pago' then nullif(btrim(c ->> 'condiciones_pago'), '') else x.condiciones_pago end,
      base                  = case when c ? 'base' then nullif(btrim(c ->> 'base'), '') else x.base end,
      comuna                = case when c ? 'comuna' then nullif(btrim(c ->> 'comuna'), '') else x.comuna end,
      monto_obra_contratada = case when c ? 'monto_obra_contratada' then nullif(c ->> 'monto_obra_contratada', '')::numeric else x.monto_obra_contratada end,
      ada_pdf_url           = case when c ? 'ada_pdf_url' and nullif(c ->> 'ada_pdf_url', '') is not null then c ->> 'ada_pdf_url' else x.ada_pdf_url end
     where x.id = v_contrato;
  end if;

  -- Ítems del contrato (gerencia). La base frena los cambios sobre ítems que ya tienen certificados emitidos.
  if v_gerencia and jsonb_typeof(v_items) = 'array' then
    v_ids := public.sincronizar_items_contrato(v_contrato, v_items, 1);
  end if;

  -- El borrador: el que se pidió, el que ya tenía el contrato, o uno nuevo.
  if v_cert is null then
    select x.id into v_cert from public.certificados x where x.contrato_id = v_contrato and x.estado = 'borrador';
  end if;
  if v_cert is null then
    v_cert := public.crear_certificado(v_contrato, v_periodo);
  else
    perform public.recalcular_certificado(v_cert);
  end if;

  -- Medición: "A certificar $" de cada ítem.
  if jsonb_typeof(v_items) = 'array' then
    v_n := 0;
    for v_it in select * from jsonb_array_elements(v_items) loop
      v_n := v_n + 1;
      v_id := case when v_gerencia then v_ids[v_n] else nullif(v_it ->> 'id', '')::uuid end;
      if v_id is not null and v_it ? 'presente_importe' then
        update public.certificado_items ci
           set med_presente_importe = greatest(0, coalesce((v_it ->> 'presente_importe')::numeric, 0))
         where ci.certificado_id = v_cert and ci.contrato_item_id = v_id;
      end if;
    end loop;
  end if;

  -- Cabecera del certificado.
  update public.certificados x set
    periodo                   = v_periodo,
    fecha_certificado         = coalesce(nullif(h ->> 'fecha_certificado', '')::date, x.fecha_certificado),
    numero_recepcion          = case when h ? 'numero_recepcion' then nullif(btrim(h ->> 'numero_recepcion'), '') else x.numero_recepcion end,
    anticipo_pct              = case when h ? 'anticipo_pct' then coalesce(nullif(h ->> 'anticipo_pct', '')::numeric, 0) else x.anticipo_pct end,
    anticipo_monto_manual     = case when h ? 'anticipo_monto_manual' then nullif(h ->> 'anticipo_monto_manual', '')::numeric else x.anticipo_monto_manual end,
    fondo_reparo_pct          = case when h ? 'fondo_reparo_pct' then coalesce(nullif(h ->> 'fondo_reparo_pct', '')::numeric, 0) else x.fondo_reparo_pct end,
    fondo_reparo_monto_manual = case when h ? 'fondo_reparo_monto_manual' then nullif(h ->> 'fondo_reparo_monto_manual', '')::numeric else x.fondo_reparo_monto_manual end,
    fondo_reparo_label        = case when h ? 'fondo_reparo_label' then nullif(btrim(h ->> 'fondo_reparo_label'), '') else x.fondo_reparo_label end,
    fondo_reparo_aplicar      = case when h ? 'fondo_reparo_aplicar' then coalesce((h ->> 'fondo_reparo_aplicar')::boolean, false) else x.fondo_reparo_aplicar end,
    avance_obra_pct           = case when h ? 'avance_obra_pct' then nullif(h ->> 'avance_obra_pct', '')::numeric else x.avance_obra_pct end,
    notas                     = case when h ? 'notas' then nullif(btrim(h ->> 'notas'), '') else x.notas end
   where x.id = v_cert;
  perform public.totalizar_certificado(v_cert);
  return v_cert;
end $$;

-- ------------------------------------------------------------------ 5. emitir, aprobar, rechazar
drop function if exists public.emitir_certificado(uuid);
drop function if exists public.emitir_certificado(uuid, text, boolean);
-- p_firma_jefe: la firma del jefe de sitio (PNG en data URL o enlace). Obligatoria en los certificados de obra.
-- p_solicitud: crea la solicitud de aprobación (como la v1). Los abonos del mes en lote no la crean.
create or replace function public.emitir_certificado(p_id uuid, p_firma_jefe text default null, p_solicitud boolean default true)
returns integer
language plpgsql set search_path = public as $$
declare
  v public.certificados%rowtype;
  k public.contratos%rowtype;
  v_numero integer;
  v_prev text;
  v_nombre text := (select x.nombre from public.perfiles x where x.id = auth.uid());
begin
  if not (public.puede_validar() or public.es_servicio()) then
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
  if k.tipo = 'obra' and coalesce(btrim(p_firma_jefe), '') = '' and not public.es_servicio() then
    raise exception 'Los certificados de obra los firma el jefe de sitio al emitir.' using errcode = 'P0001';
  end if;

  perform public.recalcular_certificado(p_id);
  select * into v from public.certificados c where c.id = p_id;
  perform public.controlar_sobrecertificacion(p_id);
  if v.acum_presente_importe > k.monto_contratado + 0.01 then
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
         rechazo_motivo = null, rechazado_por = null, rechazado_at = null,
         firma_jefe_url = nullif(btrim(p_firma_jefe), ''),
         firma_jefe_por = case when nullif(btrim(p_firma_jefe), '') is not null then auth.uid() end,
         firma_jefe_nombre = case when nullif(btrim(p_firma_jefe), '') is not null then v_nombre end,
         firma_jefe_at = case when nullif(btrim(p_firma_jefe), '') is not null then now() end
   where id = p_id;
  perform public.cert_fn_restore(v_prev);

  -- La solicitud de aprobación sale sola (como en la v1). Pasa por las reglas de las solicitudes.
  if p_solicitud and not public.es_servicio()
     and not exists (select 1 from public.solicitudes_certificado s
                      where s.certificado_id = p_id and s.estado in ('enviada','en_revision')) then
    insert into public.solicitudes_certificado (titulo, contrato_id, certificado_id, establecimiento, descripcion,
                                                monto_solicitado, avance, periodo, estado)
    values (left('Certificado N°' || v_numero || ' — ' || coalesce(nullif(k.contratista, ''), k.emprendimiento, ''), 200),
            k.id, p_id, coalesce(k.emprendimiento, k.obra_servicio), k.obra_servicio,
            v.subtotal_presente, least(100, greatest(0, coalesce(v.avance_obra_pct, v.porcentaje_avance, 0))), v.periodo, 'enviada');
  end if;
  return v_numero;
end $$;

-- Aprobar: con la firma que se manda o, si no, la del perfil de quien aprueba. Resuelve la solicitud vinculada.
create or replace function public.aprobar_certificado(p_id uuid, p_firma_url text default null) returns void
language plpgsql set search_path = public as $$
declare
  v public.certificados%rowtype;
  v_prev text;
  v_firma text := coalesce(nullif(btrim(p_firma_url), ''), (select x.firma_url from public.perfiles x where x.id = auth.uid()));
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
     set estado = 'aprobado', aprobado_por = auth.uid(), aprobado_at = now(), firma_url = v_firma
   where id = p_id;
  perform public.cert_fn_restore(v_prev);
  -- (Una solicitud que pidió quien aprueba no se resuelve sola: las reglas de las solicitudes no lo permiten.)
  update public.solicitudes_certificado s set estado = 'aprobada'
   where s.certificado_id = p_id and s.estado in ('enviada','en_revision') and s.solicitante_id is distinct from auth.uid();
end $$;

-- Rechazar: vuelve a borrador y libera el número (solo el último del contrato). Rechaza la solicitud vinculada.
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
         firma_jefe_url = null, firma_jefe_por = null, firma_jefe_nombre = null, firma_jefe_at = null,
         rechazado_por = auth.uid(), rechazado_at = now(), rechazo_motivo = btrim(p_motivo)
   where id = p_id;
  perform public.cert_fn_restore(v_prev);
  update public.solicitudes_certificado s set estado = 'rechazada', motivo_rechazo = btrim(p_motivo)
   where s.certificado_id = p_id and s.estado in ('enviada','en_revision') and s.solicitante_id is distinct from auth.uid();
end $$;

-- ------------------------------------------------------------------ 6. vistas
drop view if exists public.v_certificados;
drop view if exists public.v_contratos;
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

-- El certificado con todo lo que muestra la pantalla y el PDF de la v1.
create view public.v_certificados with (security_invoker = true) as
select c.*,
       k.tipo, k.contratista, k.contratista_cuit, k.obra_servicio, k.emprendimiento, k.ada_numero, k.oc_numero,
       k.fecha_inicio, k.fecha_fin, k.plazo, k.plazo_entrega, k.condiciones_pago, k.base, k.monto_obra_contratada,
       k.monto_contratado, k.ada_pdf_url, k.comuna, k.rubro,
       coalesce(c.fondo_reparo_label, k.fondo_reparo_label) as fondo_reparo_nombre,
       pe.nombre as emitido_nombre,
       pa.nombre as aprobado_nombre,
       (select max(x.numero) from public.certificados x where x.contrato_id = c.contrato_id) as ultimo_numero_contrato
  from public.certificados c
  join public.contratos k     on k.id = c.contrato_id
  left join public.perfiles pe on pe.id = c.emitido_por
  left join public.perfiles pa on pa.id = c.aprobado_por;

-- ------------------------------------------------------------------ 7. abonos maestros
-- La tarea automática corre sin usuario (servicio): crear y recalcular certificados también la admiten.
create or replace function public.recalcular_certificado(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  v public.certificados%rowtype;
  v_prev text;
begin
  if not (public.puede_validar() or public.es_servicio()) then
    raise exception 'Solo gerencia o un jefe de sitio pueden trabajar sobre un certificado.' using errcode = 'P0001';
  end if;
  select * into v from public.certificados c where c.id = p_id;
  if not found then
    raise exception 'El certificado no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  if v.estado <> 'borrador' then
    raise exception 'El certificado N° % está %. Ya no se recalcula.', v.numero, v.estado using errcode = 'P0001';
  end if;
  v_prev := public.cert_fn_on();
  insert into public.certificado_items
    (sector_id, certificado_id, contrato_item_id, numero, descripcion, um, cantidad, importe_unitario, importe_total)
  select i.sector_id, p_id, i.id, i.numero, i.descripcion, i.um, i.cantidad, i.importe_unitario, i.importe_total
    from public.contrato_items i
   where i.contrato_id = v.contrato_id
     and not exists (select 1 from public.certificado_items ci
                      where ci.certificado_id = p_id and ci.contrato_item_id = i.id);
  perform public.cert_fn_restore(v_prev);
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
  if not (public.puede_validar() or public.es_servicio()) then
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
    raise exception 'El contrato está %. No admite nuevos certificados.', k.estado using errcode = 'P0001';
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
    (sector_id, contrato_id, periodo, anticipo_pct, fondo_reparo_pct, fondo_reparo_aplicar, fondo_reparo_label)
  values
    (k.sector_id, k.id, btrim(p_periodo), k.anticipo_pct, k.fondo_reparo_pct, k.fondo_reparo_aplicar, k.fondo_reparo_label)
  returning id into v_id;
  perform public.cert_fn_restore(v_prev);
  perform public.recalcular_certificado(v_id);
  return v_id;
end $$;

-- Alta o edición de un abono maestro (formulario de la v1). La vigencia sale de la OC: arranca el mes siguiente a
-- la emisión y dura `duracion_meses`. Los ítems vienen por mes (como en la v1) y el contrato guarda toda la
-- vigencia: cantidad mensual × meses. Estado: activo, pausado o completado (= cerrado).
-- p = { id?, rubro, comuna, contratista, oc_numero, ada_numero, obra_servicio, emprendimiento, fecha_oc_emision,
--       duracion_meses, plazo, plazo_entrega, condiciones_pago, anticipo_pct, fondo_reparo_pct, estado, notas,
--       ada_pdf_url, items: [ { id?, descripcion, um, cantidad, importe_unitario } ] }
create or replace function public.guardar_abono(p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_oc date := nullif(p ->> 'fecha_oc_emision', '')::date;
  v_meses integer := coalesce(nullif(p ->> 'duracion_meses', '')::integer, 0);
  v_inicio date;
  v_fin date;
  v_estado text := case coalesce(p ->> 'estado', 'activo') when 'completado' then 'cerrado' when 'pausado' then 'pausado' else 'activo' end;
begin
  if not public.es_gerencia() then
    raise exception 'Los abonos los carga gerencia.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p ->> 'contratista'), '') = '' then
    raise exception 'Falta el contratista.' using errcode = 'P0001';
  end if;
  if v_oc is null then
    raise exception 'Falta la fecha de emisión de la OC.' using errcode = 'P0001';
  end if;
  if v_meses < 1 then
    raise exception 'La duración tiene que ser de al menos un mes.' using errcode = 'P0001';
  end if;
  v_inicio := (date_trunc('month', v_oc) + interval '1 month')::date;
  v_fin := (date_trunc('month', v_inicio) + make_interval(months => v_meses) - interval '1 day')::date;

  if v_id is null then
    insert into public.contratos (tipo, contratista, obra_servicio)
    values ('abono_mensual', btrim(p ->> 'contratista'), coalesce(nullif(btrim(p ->> 'obra_servicio'), ''), 'Abono mensual'))
    returning id into v_id;
  elsif not exists (select 1 from public.contratos c where c.id = v_id and c.tipo = 'abono_mensual') then
    raise exception 'El abono no existe o no es de tu sector.' using errcode = 'P0001';
  end if;

  update public.contratos c set
    contratista      = btrim(p ->> 'contratista'),
    obra_servicio    = coalesce(nullif(btrim(p ->> 'obra_servicio'), ''), c.obra_servicio),
    emprendimiento   = nullif(btrim(p ->> 'emprendimiento'), ''),
    ada_numero       = nullif(btrim(p ->> 'ada_numero'), ''),
    oc_numero        = nullif(btrim(p ->> 'oc_numero'), ''),
    rubro            = coalesce(nullif(btrim(p ->> 'rubro'), ''), 'OTROS'),
    comuna           = nullif(btrim(p ->> 'comuna'), ''),
    fecha_oc_emision = v_oc,
    fecha_inicio     = v_inicio,
    fecha_fin        = v_fin,
    plazo            = nullif(btrim(p ->> 'plazo'), ''),
    plazo_entrega    = nullif(btrim(p ->> 'plazo_entrega'), ''),
    condiciones_pago = nullif(btrim(p ->> 'condiciones_pago'), ''),
    anticipo_pct     = public.acotar(coalesce(nullif(p ->> 'anticipo_pct', '')::numeric, 0), 0, 100),
    fondo_reparo_pct = public.acotar(coalesce(nullif(p ->> 'fondo_reparo_pct', '')::numeric, 0), 0, 100),
    estado           = v_estado,
    notas            = nullif(btrim(p ->> 'notas'), ''),
    ada_pdf_url      = coalesce(nullif(p ->> 'ada_pdf_url', ''), c.ada_pdf_url)
   where c.id = v_id;

  perform public.sincronizar_items_contrato(v_id, p -> 'items', v_meses);
  return v_id;
end $$;

-- Último día hábil del mes (sin sábados, domingos ni los feriados fijos que usaba la v1).
create or replace function public.ultimo_dia_habil(p date) returns date
language plpgsql immutable as $$
declare
  d date := (date_trunc('month', p) + interval '1 month' - interval '1 day')::date;
begin
  while extract(isodow from d) in (6, 7)
     or (extract(month from d)::int, extract(day from d)::int) in
        ((1,1),(3,24),(4,2),(5,1),(5,25),(6,20),(7,9),(8,17),(10,12),(11,20),(12,8),(12,25)) loop
    d := d - 1;
  end loop;
  return d;
end $$;

-- "Certificar mes" (solapa Abonos Maestros): emite el certificado del mes de cada abono activo que lo incluye en su
-- vigencia, con la parte del mes de cada ítem. Filtra por comunas; con p_regenerar, descarta el borrador abierto y
-- lo rehace (lo emitido no se toca: reglas de la v2). p_siguiente admite el mes que viene (lo usa la emisión
-- automática, que en la v1 emitía el mes siguiente el último día hábil). p_fecha: fecha del certificado.
drop function if exists public.certificar_abonos_del_mes(date, uuid);
create or replace function public.certificar_abonos_del_mes(
  p_mes date, p_contrato uuid default null, p_comunas text[] default null,
  p_regenerar boolean default false, p_siguiente boolean default false, p_fecha date default null)
returns jsonb
language plpgsql set search_path = public as $$
declare
  k record;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_mes date := date_trunc('month', coalesce(p_mes, v_hoy))::date;
  v_periodo text := public.mes_texto(coalesce(p_mes, v_hoy));
  v_tope date := (date_trunc('month', v_hoy) + case when p_siguiente then interval '1 month' else interval '0 month' end)::date;
  v_meses integer;
  v_cert uuid;
  v_num integer;
  v_monto numeric;
  v_base jsonb;
  v_res jsonb := '[]'::jsonb;
  v_prev text;
begin
  if not (public.puede_validar() or public.es_servicio()) then
    raise exception 'Solo gerencia o un jefe de sitio pueden certificar abonos.' using errcode = 'P0001';
  end if;
  if v_mes > v_tope then
    raise exception 'No se certifica un mes que todavía no empezó.' using errcode = 'P0001';
  end if;
  for k in
    select c.* from public.contratos c
     where c.tipo = 'abono_mensual' and c.estado = 'activo'
       and (p_contrato is null or c.id = p_contrato)
       and (coalesce(cardinality(p_comunas), 0) = 0 or c.comuna = any (p_comunas))
     order by c.comuna nulls last, c.contratista
  loop
    v_base := jsonb_build_object('contrato', k.contratista, 'contrato_id', k.id, 'comuna', coalesce(k.comuna, '—'), 'mes', v_periodo);
    if k.fecha_inicio is null or k.fecha_fin is null then
      v_res := v_res || (v_base || jsonb_build_object('resultado', 'sin_fechas', 'detalle', 'Sin fechas de validez'));
      continue;
    end if;
    if v_mes < date_trunc('month', k.fecha_inicio)::date or v_mes > date_trunc('month', k.fecha_fin)::date then
      v_res := v_res || (v_base || jsonb_build_object('resultado', 'fuera_de_plazo', 'detalle', 'Fuera del contrato'));
      continue;
    end if;
    perform 1 from public.contratos c where c.id = k.id for update;
    if exists (select 1 from public.certificados x where x.contrato_id = k.id and x.estado <> 'borrador' and lower(x.periodo) = lower(v_periodo)) then
      v_res := v_res || (v_base || jsonb_build_object('resultado', 'ya_certificado', 'detalle', 'Ya certificado'));
      continue;
    end if;
    if exists (select 1 from public.certificados x where x.contrato_id = k.id and x.estado = 'borrador') then
      if p_regenerar then
        delete from public.certificados x where x.contrato_id = k.id and x.estado = 'borrador';
      else
        v_res := v_res || (v_base || jsonb_build_object('resultado', 'con_borrador', 'detalle', 'Tiene un borrador abierto: emitilo o borralo.'));
        continue;
      end if;
    end if;
    v_meses := (extract(year from age(date_trunc('month', k.fecha_fin), date_trunc('month', k.fecha_inicio))) * 12
                + extract(month from age(date_trunc('month', k.fecha_fin), date_trunc('month', k.fecha_inicio))))::integer + 1;
    begin
      v_cert := public.crear_certificado(k.id, v_periodo);
      update public.certificado_items ci
         set med_presente_unidad = greatest(0, least(ci.cantidad - ci.med_acum_anterior_unidad,
               case when v_mes = date_trunc('month', k.fecha_fin)::date
                    then ci.cantidad - round(ci.cantidad / v_meses, 4) * (v_meses - 1)
                    else round(ci.cantidad / v_meses, 4) end))
       where ci.certificado_id = v_cert;
      if public.es_servicio() then
        -- Sin usuario, los triggers de medición no calculan: se calcula acá con la misma regla.
        v_prev := public.cert_fn_on();
        update public.certificado_items ci
           set med_acum_anterior_unidad  = coalesce(a.u, 0), med_acum_anterior_importe = coalesce(a.i, 0)
          from (select x.id,
                       (select sum(z.med_presente_unidad) from public.certificado_items z
                          join public.certificados c on c.id = z.certificado_id
                         where z.contrato_item_id = x.contrato_item_id and c.estado in ('emitido','aprobado')) as u,
                       (select sum(z.med_presente_importe) from public.certificado_items z
                          join public.certificados c on c.id = z.certificado_id
                         where z.contrato_item_id = x.contrato_item_id and c.estado in ('emitido','aprobado')) as i
                  from public.certificado_items x where x.certificado_id = v_cert) a
         where ci.id = a.id;
        update public.certificado_items ci
           set med_presente_unidad = greatest(0, least(ci.cantidad - ci.med_acum_anterior_unidad,
                 case when v_mes = date_trunc('month', k.fecha_fin)::date
                      then ci.cantidad - round(ci.cantidad / v_meses, 4) * (v_meses - 1)
                      else round(ci.cantidad / v_meses, 4) end))
         where ci.certificado_id = v_cert;
        update public.certificado_items ci
           set med_presente_importe = round(ci.med_presente_unidad * ci.importe_unitario, 2)
         where ci.certificado_id = v_cert;
        update public.certificado_items ci
           set med_acum_presente_unidad = ci.med_acum_anterior_unidad + ci.med_presente_unidad,
               med_acum_presente_importe = ci.med_acum_anterior_importe + ci.med_presente_importe,
               saldo_pendiente_unidad = ci.cantidad - (ci.med_acum_anterior_unidad + ci.med_presente_unidad),
               saldo_pendiente_importe = ci.importe_total - (ci.med_acum_anterior_importe + ci.med_presente_importe)
         where ci.certificado_id = v_cert;
        perform public.cert_fn_restore(v_prev);
        perform public.totalizar_certificado(v_cert);
      end if;
      v_num := public.emitir_certificado(v_cert, null, false);
      v_prev := public.cert_fn_on();
      update public.certificados x
         set generado_automaticamente = true, fecha_certificado = coalesce(p_fecha, x.fecha_certificado)
       where x.id = v_cert
      returning x.subtotal_presente into v_monto;
      perform public.cert_fn_restore(v_prev);
      v_res := v_res || (v_base || jsonb_build_object('resultado', 'emitido', 'numero', v_num, 'certificado_id', v_cert, 'monto', v_monto,
                                                      'detalle', 'Certificado N° ' || v_num || ' emitido.'));
    exception when others then
      v_res := v_res || (v_base || jsonb_build_object('resultado', 'error', 'detalle', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('periodo', v_periodo, 'mes', to_char(v_mes, 'YYYY-MM'), 'contratos', v_res);
end $$;

-- Emisión automática (solapa "Automáticos"): el último día hábil del mes emite el mes siguiente, como la v1. Fuera
-- de ese día no hace nada salvo que se fuerce. La llama la pantalla y, si se programa, la tarea diaria.
create or replace function public.certificados_automaticos(p_forzar boolean default false) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_ultimo date := public.ultimo_dia_habil(v_hoy);
  v_sig date := (date_trunc('month', v_hoy) + interval '1 month')::date;
  r jsonb;
  v_emitidos integer;
  v_total integer;
begin
  if not (public.puede_validar() or public.es_servicio()) then
    raise exception 'Solo gerencia o un jefe de sitio pueden certificar abonos.' using errcode = 'P0001';
  end if;
  if v_hoy <> v_ultimo and not p_forzar then
    return jsonb_build_object('ejecutado', false, 'proxima', v_ultimo,
      'mensaje', 'No es el último día hábil del mes. Próxima emisión automática: ' || to_char(v_ultimo, 'DD/MM/YYYY') || '.');
  end if;
  r := public.certificar_abonos_del_mes(v_sig, null, null, false, true, v_ultimo);
  select count(*) filter (where x ->> 'resultado' = 'emitido'), count(*)
    into v_emitidos, v_total from jsonb_array_elements(r -> 'contratos') x;
  return r || jsonb_build_object('ejecutado', true, 'proxima', v_ultimo,
    'mensaje', 'Emisión para ' || public.mes_texto(v_sig) || ': ' || v_emitidos || ' certificados generados, '
               || (v_total - v_emitidos) || ' omitidos.');
end $$;

-- Programa la emisión automática todos los días a las 8 (hora argentina): solo hace algo el último día hábil.
-- No se programa sola: correr una vez   select public.programar_certificados_automaticos();
-- Para apagarla:   select cron.unschedule('dh1-certificados-automaticos');
create or replace function public.programar_certificados_automaticos() returns text
language plpgsql set search_path = public as $$
begin
  if not public.es_servicio() then
    raise exception 'Esta operación es interna del sistema.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Falta la extensión pg_cron (Database → Extensions).' using errcode = 'P0001';
  end if;
  execute $q$ select cron.unschedule(jobid) from cron.job where jobname = 'dh1-certificados-automaticos' $q$;
  execute $q$ select cron.schedule('dh1-certificados-automaticos', '0 11 * * *', 'select public.certificados_automaticos(false)') $q$;
  return 'Emisión automática programada: todos los días a las 8 (hora argentina); emite el último día hábil del mes.';
end $$;

-- ------------------------------------------------------------------ permisos
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.importar_certificado_historico(jsonb) from authenticated;
revoke execute on function public.tomar_informes_pendientes(integer) from authenticated;
revoke execute on function public.programar_reintento_informes(text) from authenticated;
revoke execute on function public.programar_certificados_automaticos() from authenticated;
grant select on public.v_contratos, public.v_certificados to authenticated;
