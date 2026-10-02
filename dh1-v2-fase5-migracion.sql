-- =====================================================================================
-- DH1 v2 — Fase 5: MIGRACIÓN desde la v1 (Base44)
-- Correr después de dh1-v2-fase4-certificacion.sql.
--
--   · id_origen en cada tabla: el id del registro en Base44. Hace la migración re-ejecutable
--     (upsert por id_origen) y deja trazabilidad.
--   · importar_certificado_historico(): carga un certificado de la v1 COMO HISTORIA, con los
--     valores que tenía, sin recalcular. Lo que sí queda enganchado es cada línea a un ítem de
--     contrato con id estable, para que los certificados nuevos calculen bien "lo anterior".
--   · Solo corre con service_role (el script migracion/migrar.ts). Nunca desde la app.
-- =====================================================================================

alter table public.perfiles        add column id_origen text unique;
alter table public.ubicaciones     add column id_origen text unique;
alter table public.ubicaciones     add column origen_entidad text;
alter table public.activos         add column id_origen text unique;
alter table public.plantillas_ot   add column id_origen text unique;
alter table public.ordenes_trabajo add column id_origen text unique;
alter table public.ot_fotos        add column id_origen text unique;
alter table public.contratos       add column id_origen text unique;
alter table public.certificados    add column id_origen text unique;

create or replace function public.importar_certificado_historico(p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  v_sector   uuid := nullif(p ->> 'sector_id', '')::uuid;
  v_origen   text := nullif(p ->> 'id_origen', '');
  v_estado   public.certificado_estado;
  v_numero   integer := nullif(p ->> 'numero', '')::numeric::integer;
  v_tipo     text := coalesce(nullif(p ->> 'tipo', ''), 'abono_mensual');
  v_contratista text := btrim(coalesce(p ->> 'contratista', ''));
  v_ada      text := nullif(btrim(coalesce(p ->> 'ada_numero', '')), '');
  v_oc       text := nullif(btrim(coalesce(p ->> 'oc_numero', '')), '');
  v_contrato uuid;
  v_cert     uuid;
  v_item     uuid;
  v_linea    jsonb;
  v_n        integer;
  v_subtotal numeric(16,2);
  v_anticipo numeric(16,2);
  v_fondo    numeric(16,2);
begin
  if not public.es_servicio() then
    raise exception 'La importación histórica solo corre desde el script de migración.' using errcode = 'P0001';
  end if;
  if v_sector is null then
    raise exception 'Certificado % sin sector: no se importa.', coalesce(v_origen, '?') using errcode = 'P0001';
  end if;
  if v_origen is null then
    raise exception 'Falta id_origen.' using errcode = 'P0001';
  end if;
  if v_contratista = '' then
    raise exception 'Certificado % sin contratista: no se importa.', v_origen using errcode = 'P0001';
  end if;
  if (p ->> 'estado') not in ('emitido','aprobado') then
    raise exception 'Certificado % en estado "%": solo se importan emitidos y aprobados.', v_origen, p ->> 'estado'
      using errcode = 'P0001';
  end if;
  v_estado := (p ->> 'estado')::public.certificado_estado;
  if v_numero is null then
    raise exception 'Certificado % sin número: no se importa.', v_origen using errcode = 'P0001';
  end if;
  if v_tipo not in ('abono_mensual','obra') then
    raise exception 'Certificado % de tipo "%": no se importa.', v_origen, v_tipo using errcode = 'P0001';
  end if;

  -- Re-ejecutable: si ya está, no se toca.
  select c.id into v_cert from public.certificados c where c.id_origen = v_origen;
  if found then
    return v_cert;
  end if;

  -- Contrato: mismo sector, tipo, contratista, ADA y OC.
  select k.id into v_contrato
    from public.contratos k
   where k.sector_id = v_sector and k.tipo = v_tipo
     and lower(btrim(k.contratista)) = lower(v_contratista)
     and coalesce(k.ada_numero, '') = coalesce(v_ada, '')
     and coalesce(k.oc_numero, '') = coalesce(v_oc, '')
   order by k.created_at limit 1;

  if v_contrato is null then
    insert into public.contratos
      (sector_id, tipo, contratista, obra_servicio, emprendimiento, ada_numero, oc_numero,
       fecha_inicio, fecha_fin, plazo, condiciones_pago, anticipo_pct, fondo_reparo_pct,
       fondo_reparo_label, fondo_reparo_aplicar, ada_pdf_url, id_origen)
    values
      (v_sector, v_tipo, v_contratista,
       coalesce(nullif(btrim(p ->> 'obra_servicio'), ''), '(sin descripción)'),
       nullif(p ->> 'emprendimiento', ''), v_ada, v_oc,
       nullif(p ->> 'fecha_inicio', '')::date, nullif(p ->> 'fecha_fin', '')::date,
       nullif(p ->> 'plazo', ''), nullif(p ->> 'condiciones_pago', ''),
       least(greatest(coalesce((p ->> 'anticipo_pct')::numeric, 0), 0), 100),
       least(greatest(coalesce((p ->> 'fondo_reparo_pct')::numeric, 0), 0), 100),
       coalesce(nullif(p ->> 'fondo_reparo_label', ''), 'Fondo de reparo'),
       coalesce((p ->> 'fondo_reparo_aplicar')::boolean, false),
       nullif(p ->> 'ada_pdf_url', ''),
       'cert:' || v_origen)
    returning id into v_contrato;
  end if;

  v_subtotal := coalesce((p ->> 'subtotal')::numeric,
                         (select sum(coalesce((l ->> 'med_presente_importe')::numeric, 0))
                            from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) l), 0);
  v_anticipo := coalesce((p ->> 'anticipo_monto')::numeric,
                         round(v_subtotal * coalesce((p ->> 'anticipo_pct')::numeric, 0) / 100, 2));
  v_fondo    := case when coalesce((p ->> 'fondo_reparo_aplicar')::boolean, false)
                     then coalesce((p ->> 'fondo_reparo_monto')::numeric,
                                   round(v_subtotal * coalesce((p ->> 'fondo_reparo_pct')::numeric, 0) / 100, 2))
                     else 0 end;

  begin
    insert into public.certificados
      (sector_id, contrato_id, numero, estado, periodo, fecha_certificado, numero_recepcion, notas,
       anticipo_pct, fondo_reparo_pct, fondo_reparo_aplicar,
       subtotal_presente, anticipo_monto, fondo_reparo_monto, total_neto,
       porcentaje_avance, aprobado_at, firma_url, pdf_url,
       historico, datos_historicos, id_origen, created_at)
    values
      (v_sector, v_contrato, v_numero, v_estado,
       coalesce(nullif(btrim(p ->> 'periodo'), ''), '(sin período)'),
       coalesce(nullif(p ->> 'fecha_certificado', '')::date, current_date),
       nullif(p ->> 'numero_recepcion', ''), nullif(p ->> 'notas', ''),
       least(greatest(coalesce((p ->> 'anticipo_pct')::numeric, 0), 0), 100),
       least(greatest(coalesce((p ->> 'fondo_reparo_pct')::numeric, 0), 0), 100),
       coalesce((p ->> 'fondo_reparo_aplicar')::boolean, false),
       v_subtotal, v_anticipo, v_fondo, v_subtotal - v_anticipo - v_fondo,
       least(coalesce((p ->> 'porcentaje_avance')::numeric, 0), 99999),
       nullif(p ->> 'aprobado_at', '')::timestamptz,
       nullif(p ->> 'firma_url', ''), nullif(p ->> 'pdf_url', ''),
       true, p -> 'original', v_origen,
       coalesce(nullif(p ->> 'created_at', '')::timestamptz, now()))
    returning id into v_cert;
  exception when unique_violation then
    raise exception 'Certificado %: el N° % ya existe en el contrato de % (ADA %, OC %). Número duplicado en origen.',
      v_origen, v_numero, v_contratista, coalesce(v_ada, '-'), coalesce(v_oc, '-') using errcode = 'P0001';
  end;

  -- Líneas: valores de origen tal cual. Cada una queda enganchada a un ítem de contrato estable.
  for v_linea in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    v_item := null;
    select i.id into v_item
      from public.contrato_items i
     where i.contrato_id = v_contrato
       and lower(btrim(i.descripcion)) = lower(btrim(coalesce(v_linea ->> 'descripcion', '')))
     order by i.numero limit 1;

    if v_item is null then
      v_n := nullif(v_linea ->> 'numero', '')::numeric::integer;
      if v_n is null or exists (select 1 from public.contrato_items i
                                 where i.contrato_id = v_contrato and i.numero = v_n) then
        select coalesce(max(i.numero), 0) + 1 into v_n from public.contrato_items i where i.contrato_id = v_contrato;
      end if;
      insert into public.contrato_items (sector_id, contrato_id, numero, descripcion, um, cantidad, importe_unitario)
      values (v_sector, v_contrato, v_n,
              coalesce(nullif(btrim(v_linea ->> 'descripcion'), ''), '(sin descripción)'),
              coalesce(nullif(v_linea ->> 'um', ''), 'u'),
              coalesce(nullif(greatest((v_linea ->> 'cantidad')::numeric, 0), 0), 1),
              greatest(coalesce((v_linea ->> 'importe_unitario')::numeric, 0), 0))
      returning id into v_item;
    end if;

    insert into public.certificado_items
      (sector_id, certificado_id, contrato_item_id, numero, descripcion, um, cantidad, importe_unitario, importe_total,
       med_acum_anterior_unidad, med_acum_anterior_importe, med_presente_unidad, med_presente_importe,
       med_acum_presente_unidad, med_acum_presente_importe, saldo_pendiente_unidad, saldo_pendiente_importe)
    select v_sector, v_cert, v_item,
           coalesce(nullif(v_linea ->> 'numero', '')::numeric::integer, i.numero),
           i.descripcion, i.um,
           coalesce((v_linea ->> 'cantidad')::numeric, i.cantidad),
           coalesce((v_linea ->> 'importe_unitario')::numeric, i.importe_unitario),
           coalesce((v_linea ->> 'importe_total')::numeric, i.importe_total),
           coalesce((v_linea ->> 'med_acum_anterior_unidad')::numeric, 0),
           coalesce((v_linea ->> 'med_acum_anterior_importe')::numeric, 0),
           greatest(coalesce((v_linea ->> 'med_presente_unidad')::numeric, 0), 0),
           coalesce((v_linea ->> 'med_presente_importe')::numeric, 0),
           coalesce((v_linea ->> 'med_acum_presente_unidad')::numeric, 0),
           coalesce((v_linea ->> 'med_acum_presente_importe')::numeric, 0),
           coalesce((v_linea ->> 'saldo_pendiente_unidad')::numeric, 0),
           coalesce((v_linea ->> 'saldo_pendiente_importe')::numeric, 0)
      from public.contrato_items i where i.id = v_item
    on conflict (certificado_id, contrato_item_id) do update
      set med_presente_unidad       = public.certificado_items.med_presente_unidad + excluded.med_presente_unidad,
          med_presente_importe      = public.certificado_items.med_presente_importe + excluded.med_presente_importe,
          med_acum_presente_unidad  = public.certificado_items.med_acum_presente_unidad + excluded.med_presente_unidad,
          med_acum_presente_importe = public.certificado_items.med_acum_presente_importe + excluded.med_presente_importe;
  end loop;

  update public.certificados c
     set acum_anterior_importe = t.anterior, acum_presente_importe = t.acumulado
    from (select coalesce(sum(i.med_acum_anterior_importe), 0) as anterior,
                 coalesce(sum(i.med_acum_presente_importe), 0) as acumulado
            from public.certificado_items i where i.certificado_id = v_cert) t
   where c.id = v_cert;

  return v_cert;
end $$;

-- ------------------------------------------------------------------ permisos
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.importar_certificado_historico(jsonb) from authenticated;
