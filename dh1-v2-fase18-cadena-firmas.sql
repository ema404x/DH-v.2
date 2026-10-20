-- =====================================================================================
-- DH1 v2 · Fase 18 · Cadena de firmas intermedias de certificados (como la v1, 23/9/2026)
-- Decisión de Emanuel del 20/10/2026. Va después de la fase 17. Se puede correr más de una vez.
--
-- Antes de llegar al gerente, un certificado puede pasar por una lista ordenada de firmantes. En la v1:
-- CadenaFirmasPanel, FirmaIntermediaModal, firmarCertificadoIntermedio. Con las reglas de la v2:
--   · La cadena se arma en el borrador (certificados.cadena_firmas, ids de perfiles del sector, en orden).
--   · enviar_a_firmas(): los mismos controles que emitir (firma del jefe en obra, sobre-certificación, algo medido);
--     el certificado pasa a "en_firmas" y queda congelado como un emitido. NO numera. Quien lo manda es el emisor.
--   · firmar_certificado_intermedio(): firma solo al que le toca. El último numera, emite y crea la solicitud de
--     aprobación (lo mismo que emitir_certificado).
--   · rechazar_firma_intermedia(): el firmante de turno, con motivo; el certificado vuelve a borrador.
--   · Mientras está en firmas, el contrato no admite otro certificado (no se mezcla número ni acumulado).
--   · Aprobar: además de quien emitió, tampoco quien firmó en la cadena (decisión conservadora; revisable).
--   · Cada envío es una "ronda": un rechazo no borra la historia (la auditoría muestra todas).
-- =====================================================================================

alter type public.certificado_estado add value if not exists 'en_firmas';

-- Fase 4: "borrador ⇔ sin número". En firmas tampoco tiene número (se numera al emitir). Se compara como texto:
-- el valor nuevo del enum no se puede usar en un DDL de la misma transacción en que se agrega.
alter table public.certificados drop constraint if exists certificados_check;
alter table public.certificados drop constraint if exists certificados_numero_estado_chk;
alter table public.certificados add constraint certificados_numero_estado_chk
  check ((estado::text in ('borrador','en_firmas')) = (numero is null));

alter table public.certificados add column if not exists cadena_firmas uuid[] not null default '{}';
alter table public.certificados add column if not exists enviado_firmas_at timestamptz;

create table if not exists public.certificado_firmantes (
  id             uuid primary key default gen_random_uuid(),
  sector_id      uuid not null references public.sectores(id),
  certificado_id uuid not null,
  ronda          integer not null,
  orden          integer not null check (orden >= 1),
  perfil_id      uuid references public.perfiles(id) on delete set null,
  nombre         text not null,
  estado         text not null default 'pendiente' check (estado in ('pendiente','firmado','rechazado')),
  firma_url      text check (firma_url is null or firma_url like 'data:image/%' or firma_url like 'http%'),
  firmado_at     timestamptz,
  motivo         text,
  created_at     timestamptz not null default now(),
  unique (certificado_id, ronda, orden),
  foreign key (certificado_id, sector_id) references public.certificados(id, sector_id) on delete cascade
);
create index if not exists certificado_firmantes_cert_idx on public.certificado_firmantes(certificado_id, ronda, orden);
create index if not exists certificado_firmantes_perfil_idx on public.certificado_firmantes(perfil_id, estado);
select public.aplicar_rls_sector('public.certificado_firmantes');

-- La cadena la escriben solo las funciones de abajo (y las cascadas al borrar un borrador).
create or replace function public.proteger_firmantes() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.es_servicio() or public.dh1_flag('dh1.cert_fn') or (tg_op = 'DELETE' and pg_trigger_depth() > 1) then
    return coalesce(new, old);
  end if;
  raise exception 'Las firmas del certificado no se cargan a mano: se firman desde el certificado.' using errcode = 'P0001';
end $$;
drop trigger if exists b_proteger on public.certificado_firmantes;
create trigger b_proteger before insert or update or delete on public.certificado_firmantes
  for each row execute function public.proteger_firmantes();

-- Mientras un certificado espera firmas, el contrato no admite otro (sería un borrador con el acumulado viejo).
create or replace function public.cadena_bloquea_contrato() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.certificados c
              where c.contrato_id = new.contrato_id and c.estado::text = 'en_firmas' and c.id <> new.id) then
    raise exception 'Este contrato tiene un certificado esperando firmas. Hasta que se firme o se rechace no se puede hacer otro.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists a_cadena_bloquea on public.certificados;
create trigger a_cadena_bloquea before insert on public.certificados
  for each row execute function public.cadena_bloquea_contrato();

-- ------------------------------------------------------------------ enviar a firmas
create or replace function public.enviar_a_firmas(p_id uuid, p_firma_jefe text default null) returns void
language plpgsql set search_path = public as $$
declare
  v public.certificados%rowtype;
  k public.contratos%rowtype;
  v_prev text;
  v_ronda integer;
  v_nombre text := (select x.nombre from public.perfiles x where x.id = auth.uid());
begin
  if not public.puede_validar() then
    raise exception 'Solo gerencia o un jefe de sitio pueden mandar un certificado a firmar.' using errcode = 'P0001';
  end if;
  select * into v from public.certificados c where c.id = p_id;
  if not found then
    raise exception 'El certificado no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  select * into k from public.contratos c where c.id = v.contrato_id for update;
  select * into v from public.certificados c where c.id = p_id;
  if v.estado <> 'borrador' then
    raise exception 'Solo se manda a firmar un borrador. Este certificado está %.', v.estado using errcode = 'P0001';
  end if;
  if coalesce(array_length(v.cadena_firmas, 1), 0) = 0 then
    raise exception 'Agregá al menos un firmante a la cadena.' using errcode = 'P0001';
  end if;
  if (select count(distinct x) from unnest(v.cadena_firmas) x) <> array_length(v.cadena_firmas, 1) then
    raise exception 'Una misma persona está dos veces en la cadena de firmas.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v.cadena_firmas) x
              where not exists (select 1 from public.perfiles p where p.id = x and p.sector_id = v.sector_id and p.activo)) then
    raise exception 'Los firmantes tienen que ser usuarios activos de este sector.' using errcode = 'P0001';
  end if;
  if k.tipo = 'obra' and coalesce(btrim(p_firma_jefe), '') = '' then
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

  select coalesce(max(f.ronda), 0) + 1 into v_ronda from public.certificado_firmantes f where f.certificado_id = p_id;
  v_prev := public.cert_fn_on();
  update public.certificados
     set estado = 'en_firmas', emitido_por = auth.uid(), enviado_firmas_at = now(),
         rechazo_motivo = null, rechazado_por = null, rechazado_at = null,
         firma_jefe_url = nullif(btrim(p_firma_jefe), ''),
         firma_jefe_por = case when nullif(btrim(p_firma_jefe), '') is not null then auth.uid() end,
         firma_jefe_nombre = case when nullif(btrim(p_firma_jefe), '') is not null then v_nombre end,
         firma_jefe_at = case when nullif(btrim(p_firma_jefe), '') is not null then now() end
   where id = p_id;
  insert into public.certificado_firmantes (sector_id, certificado_id, ronda, orden, perfil_id, nombre)
  select v.sector_id, p_id, v_ronda, x.n::integer, x.perfil, p.nombre
    from unnest(v.cadena_firmas) with ordinality as x(perfil, n)
    join public.perfiles p on p.id = x.perfil;
  perform public.cert_fn_restore(v_prev);
end $$;

-- ------------------------------------------------------------------ firmar (el último emite)
create or replace function public.firmar_certificado_intermedio(p_id uuid, p_firma_url text default null) returns jsonb
language plpgsql set search_path = public as $$
declare
  v public.certificados%rowtype;
  k public.contratos%rowtype;
  f public.certificado_firmantes%rowtype;
  v_prev text;
  v_numero integer;
  v_firma text := coalesce(nullif(btrim(p_firma_url), ''), (select x.firma_url from public.perfiles x where x.id = auth.uid()));
begin
  select * into v from public.certificados c where c.id = p_id;
  if not found then
    raise exception 'El certificado no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  select * into k from public.contratos c where c.id = v.contrato_id for update;
  select * into v from public.certificados c where c.id = p_id;
  if v.estado::text <> 'en_firmas' then
    raise exception 'Este certificado no está esperando firmas.' using errcode = 'P0001';
  end if;
  select * into f from public.certificado_firmantes x
   where x.certificado_id = p_id and x.estado = 'pendiente'
     and x.ronda = (select max(y.ronda) from public.certificado_firmantes y where y.certificado_id = p_id)
   order by x.orden limit 1;
  if f.id is null or f.perfil_id is distinct from auth.uid() then
    raise exception 'Ahora no te toca firmar este certificado%.',
      case when f.id is not null then ': le toca a ' || f.nombre else '' end using errcode = 'P0001';
  end if;
  if v_firma is null then
    raise exception 'Dibujá tu firma para firmar.' using errcode = 'P0001';
  end if;

  v_prev := public.cert_fn_on();
  update public.certificado_firmantes set estado = 'firmado', firma_url = v_firma, firmado_at = now() where id = f.id;

  if exists (select 1 from public.certificado_firmantes x where x.certificado_id = p_id and x.ronda = f.ronda and x.estado = 'pendiente') then
    perform public.cert_fn_restore(v_prev);
    return jsonb_build_object('estado', 'en_firmas');
  end if;

  -- Último firmante: se emite (número, sello y solicitud, como emitir_certificado). El emisor es quien lo mandó a firmar.
  perform public.controlar_sobrecertificacion(p_id);
  select coalesce(max(c.numero), 0) + 1 into v_numero from public.certificados c where c.contrato_id = v.contrato_id;
  update public.certificados set estado = 'emitido', numero = v_numero, emitido_at = now() where id = p_id;
  perform public.cert_fn_restore(v_prev);
  if not exists (select 1 from public.solicitudes_certificado s
                  where s.certificado_id = p_id and s.estado in ('enviada','en_revision')) then
    insert into public.solicitudes_certificado (titulo, contrato_id, certificado_id, establecimiento, descripcion,
                                                monto_solicitado, avance, periodo, estado)
    values (left('Certificado N°' || v_numero || ' — ' || coalesce(nullif(k.contratista, ''), k.emprendimiento, ''), 200),
            k.id, p_id, coalesce(k.emprendimiento, k.obra_servicio), k.obra_servicio,
            v.subtotal_presente, least(100, greatest(0, coalesce(v.avance_obra_pct, v.porcentaje_avance, 0))), v.periodo, 'enviada');
  end if;
  return jsonb_build_object('estado', 'emitido', 'numero', v_numero);
end $$;

-- ------------------------------------------------------------------ rechazar una firma
create or replace function public.rechazar_firma_intermedia(p_id uuid, p_motivo text) returns void
language plpgsql set search_path = public as $$
declare
  v public.certificados%rowtype;
  f public.certificado_firmantes%rowtype;
  v_prev text;
begin
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Para rechazar hay que escribir el motivo.' using errcode = 'P0001';
  end if;
  select * into v from public.certificados c where c.id = p_id;
  if not found then
    raise exception 'El certificado no existe o no es de tu sector.' using errcode = 'P0001';
  end if;
  perform 1 from public.contratos c where c.id = v.contrato_id for update;
  select * into v from public.certificados c where c.id = p_id;
  if v.estado::text <> 'en_firmas' then
    raise exception 'Este certificado no está esperando firmas.' using errcode = 'P0001';
  end if;
  select * into f from public.certificado_firmantes x
   where x.certificado_id = p_id and x.estado = 'pendiente'
     and x.ronda = (select max(y.ronda) from public.certificado_firmantes y where y.certificado_id = p_id)
   order by x.orden limit 1;
  if f.id is null or f.perfil_id is distinct from auth.uid() then
    raise exception 'Solo puede rechazar el firmante al que le toca firmar.' using errcode = 'P0001';
  end if;
  v_prev := public.cert_fn_on();
  update public.certificado_firmantes set estado = 'rechazado', motivo = btrim(p_motivo), firmado_at = now() where id = f.id;
  update public.certificados
     set estado = 'borrador', emitido_por = null, enviado_firmas_at = null,
         firma_jefe_url = null, firma_jefe_por = null, firma_jefe_nombre = null, firma_jefe_at = null,
         rechazado_por = auth.uid(), rechazado_at = now(), rechazo_motivo = btrim(p_motivo)
   where id = p_id;
  perform public.cert_fn_restore(v_prev);
end $$;

grant execute on function public.enviar_a_firmas(uuid, text) to authenticated;
grant execute on function public.firmar_certificado_intermedio(uuid, text) to authenticated;
grant execute on function public.rechazar_firma_intermedia(uuid, text) to authenticated;
revoke all on function public.enviar_a_firmas(uuid, text) from anon;
revoke all on function public.firmar_certificado_intermedio(uuid, text) from anon;
revoke all on function public.rechazar_firma_intermedia(uuid, text) from anon;
revoke all on public.certificado_firmantes from anon;
-- Las funciones corren con los permisos de quien llama: escribe el usuario, pero el trigger solo deja a las funciones.
grant select, insert, update, delete on public.certificado_firmantes to authenticated;
grant all on public.certificado_firmantes to service_role;

-- ------------------------------------------------------------------ copias de la fase 14 con los cambios de arriba
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
  if old.estado::text = 'en_firmas' then
    raise exception 'El certificado está esperando firmas: no se modifica. Si hay que corregirlo, que lo rechace el firmante.'
      using errcode = 'P0001';
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
  if v.estado::text = 'en_firmas' then
    raise exception 'El certificado está esperando firmas: se emite solo cuando firma el último.' using errcode = 'P0001';
  end if;
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
  if exists (select 1 from public.certificado_firmantes f
              where f.certificado_id = p_id and f.perfil_id = auth.uid() and f.estado = 'firmado'
                and f.ronda = (select max(y.ronda) from public.certificado_firmantes y where y.certificado_id = p_id)) then
    raise exception 'Firmaste este certificado en la cadena: lo tiene que aprobar otra persona.' using errcode = 'P0001';
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

drop view if exists public.v_certificados;
create view public.v_certificados with (security_invoker = true) as
select c.*,
       k.tipo, k.contratista, k.contratista_cuit, k.obra_servicio, k.emprendimiento, k.ada_numero, k.oc_numero,
       k.fecha_inicio, k.fecha_fin, k.plazo, k.plazo_entrega, k.condiciones_pago, k.base, k.monto_obra_contratada,
       k.monto_contratado, k.ada_pdf_url, k.comuna, k.rubro,
       coalesce(c.fondo_reparo_label, k.fondo_reparo_label) as fondo_reparo_nombre,
       pe.nombre as emitido_nombre,
       pa.nombre as aprobado_nombre,
       (select max(x.numero) from public.certificados x where x.contrato_id = c.contrato_id) as ultimo_numero_contrato,
       coalesce((select jsonb_agg(jsonb_build_object('orden', f.orden, 'perfil_id', f.perfil_id, 'nombre', f.nombre, 'estado', f.estado,
                                                     'firma_url', f.firma_url, 'firmado_at', f.firmado_at, 'motivo', f.motivo) order by f.orden)
                   from public.certificado_firmantes f
                  where f.certificado_id = c.id
                    and f.ronda = (select max(y.ronda) from public.certificado_firmantes y where y.certificado_id = c.id)), '[]'::jsonb) as firmas,
       (select f.perfil_id from public.certificado_firmantes f
         where f.certificado_id = c.id and f.estado = 'pendiente' and c.estado::text = 'en_firmas'
           and f.ronda = (select max(y.ronda) from public.certificado_firmantes y where y.certificado_id = c.id)
         order by f.orden limit 1) as firmante_actual_id
  from public.certificados c
  join public.contratos k     on k.id = c.contrato_id
  left join public.perfiles pe on pe.id = c.emitido_por
  left join public.perfiles pa on pa.id = c.aprobado_por;

grant select on public.v_certificados to authenticated;
grant all on public.v_certificados to service_role;
revoke all on public.v_certificados from anon;
