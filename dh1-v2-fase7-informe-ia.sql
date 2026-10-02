-- =====================================================================================
-- DH1 v2 — Fase 7: informe de inspección con IA en segundo plano
--
-- El informe sale al instante armado con la plantilla. La redacción con IA (plan gratis, que se satura
-- seguido) se intenta aparte y, cuando sale, reemplaza a la plantilla sola. Esta fase agrega a la
-- inspección el estado de ese pendiente y la tarea periódica que lo reintenta.
--
-- Se corre después de la fase 6. Es aditiva: no borra ni cambia datos existentes.
-- =====================================================================================

alter table public.inspecciones
  add column if not exists informe_origen       text check (informe_origen in ('ia', 'plantilla')),
  -- hay una redacción con IA esperando: la función la intenta cuando toca `informe_ia_proximo`
  add column if not exists informe_ia_pendiente boolean not null default false,
  add column if not exists informe_ia_intentos  integer not null default 0,
  add column if not exists informe_ia_proximo   timestamptz,
  -- cambia cada vez que se pide un informe: una redacción vieja que llega tarde no pisa a una nueva
  add column if not exists informe_ia_token     uuid,
  -- por qué no salió el último intento (lo que respondió el servicio de IA)
  add column if not exists informe_ia_motivo    text;

create index if not exists inspecciones_ia_pendiente_idx on public.inspecciones(informe_ia_proximo) where informe_ia_pendiente;

-- Entrega a la función los informes a los que les toca un intento de IA, y agenda el siguiente cada vez
-- más espaciado: 10, 20, 40, 80, 160, 320 minutos y después cada 6 horas. A los 12 intentos deja de insistir
-- y el informe queda con la plantilla (siempre se puede volver a generar a mano).
-- Solo la llama la función con la clave de servicio: no está disponible para los usuarios.
create or replace function public.tomar_informes_pendientes(p_max integer default 3)
returns setof public.inspecciones
language plpgsql set search_path = public as $$
begin
  if not public.es_servicio() then
    raise exception 'Esta operación es interna del sistema.' using errcode = 'P0001';
  end if;

  update public.inspecciones
     set informe_ia_pendiente = false,
         informe_ia_motivo = 'Se intentó 12 veces y el servicio de IA no respondió. ' || coalesce(informe_ia_motivo, '')
   where informe_ia_pendiente and informe_ia_intentos >= 12;

  return query
    update public.inspecciones i
       set informe_ia_intentos = i.informe_ia_intentos + 1,
           informe_ia_proximo = now() + make_interval(mins => least(10 * (2 ^ least(i.informe_ia_intentos, 6))::integer, 360))
     where i.id in (
             select p.id from public.inspecciones p
              where p.informe_ia_pendiente and p.informe_ia_proximo <= now() and p.informe_generado is not null
              order by p.informe_ia_proximo
              limit greatest(1, least(coalesce(p_max, 3), 10))
                for update skip locked)
    returning i.*;
end $$;

-- Programa (o reprograma) la tarea que cada 10 minutos le pide a la función que reintente. Solo llama a la
-- función si hay algún informe al que le toca: sin pendientes no sale ningún pedido.
--   select public.programar_reintento_informes('https://<ref>.supabase.co');
-- Para apagarla:  select cron.unschedule('dh1-informes-ia');
create or replace function public.programar_reintento_informes(p_url_proyecto text)
returns text
language plpgsql set search_path = public as $$
declare
  v_url text := rtrim(btrim(coalesce(p_url_proyecto, '')), '/') || '/functions/v1/informe-inspeccion';
begin
  if not public.es_servicio() then
    raise exception 'Esta operación es interna del sistema.' using errcode = 'P0001';
  end if;
  if v_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/informe-inspeccion$' then
    raise exception 'La dirección del proyecto no es válida. Tiene que ser como https://abcd.supabase.co' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_extension where extname in ('pg_cron', 'pg_net')) < 2 then
    raise exception 'Faltan las extensiones pg_cron y pg_net (Database → Extensions).' using errcode = 'P0001';
  end if;

  execute $q$ select cron.unschedule(jobid) from cron.job where jobname = 'dh1-informes-ia' $q$;
  execute format(
    $q$ select cron.schedule('dh1-informes-ia', '*/10 * * * *', %L) $q$,
    format(
      $c$select net.http_post(url := %L, headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"accion":"reintentar"}'::jsonb)
  where exists (select 1 from public.inspecciones where informe_ia_pendiente and informe_ia_proximo <= now())$c$,
      v_url));
  return 'Reintento de informes programado cada 10 minutos contra ' || v_url;
end $$;

-- En Supabase, las dos extensiones que usa la tarea periódica. (En el Postgres de las pruebas no existen: se saltea.)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.importar_certificado_historico(jsonb) from authenticated;
revoke execute on function public.tomar_informes_pendientes(integer) from authenticated;
revoke execute on function public.programar_reintento_informes(text) from authenticated;
