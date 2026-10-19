-- DH1 v2 — Fase 17: importar el directorio emparejando por ubicación técnica (19/10/2026).
-- Al importar la planilla real "LISTADO ESCUELAS POR COMUNA" se vio que importar_directorio (fase 6) buscaba el lugar
-- existente SOLO por nombre: escuelas homónimas en edificios distintos (CENS N° 77, PI Nochecitas, CAIYJ Club Lola
-- Mora, EEM N° 06/21°, PI Larrazábal, Estados Unidos 1228) quedaban en un solo lugar con la dirección de la última fila.
-- Ahora: con código, por código; por nombre solo entre los lugares sin código; sin código, por nombre (como antes).
-- Volver a importar la misma planilla corrige lo ya cargado (crea los lugares que faltaban y cada uno queda con su
-- dirección). Solo reemplaza esa función. Se corre después de la fase 16. Repetible.

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

    -- Con ubicación técnica (la de SAP, única por lugar) se busca por ella; por nombre solo entre los lugares que
    -- todavía no tienen código (cargados a mano). Sin código en la fila, por nombre como antes.
    -- Antes se buscaba solo por nombre y dos escuelas homónimas en edificios distintos se pisaban.
    v_ubi := null;
    if public.norm_txt(f ->> 'codigo') <> '' then
      select u.id into v_ubi from public.ubicaciones u
       where u.sector_id = v_sector and public.norm_txt(u.codigo) = public.norm_txt(f ->> 'codigo')
       limit 1;
      if v_ubi is null then
        select u.id into v_ubi from public.ubicaciones u
         where u.sector_id = v_sector and u.codigo is null
           and public.norm_txt(u.nombre) = public.norm_txt(f ->> 'establecimiento')
         limit 1;
      end if;
    else
      select u.id into v_ubi from public.ubicaciones u
       where u.sector_id = v_sector and public.norm_txt(u.nombre) = public.norm_txt(f ->> 'establecimiento')
       limit 1;
    end if;
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
