-- =====================================================================================
-- DH1 v2 — Storage: bucket de fotos de las órdenes
-- Correr una sola vez, después de dh1-v2-fundacion.sql (usa public.sector_efectivo()).
--
-- Las fotos se guardan en <sector_id>/<ot_id>/<uuid>.jpg.
-- Solo se sube y se borra dentro de la carpeta del sector en el que está parado el usuario.
-- El bucket es público para lectura: las fotos se ven por URL (la ruta lleva dos UUID, no se adivina).
-- =====================================================================================

insert into storage.buckets (id, name, public)
values ('ot-fotos', 'ot-fotos', true)
on conflict (id) do nothing;

drop policy if exists "ot-fotos subir" on storage.objects;
create policy "ot-fotos subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'ot-fotos' and (storage.foldername(name))[1] = public.sector_efectivo()::text);

drop policy if exists "ot-fotos borrar" on storage.objects;
create policy "ot-fotos borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'ot-fotos' and (storage.foldername(name))[1] = public.sector_efectivo()::text);
