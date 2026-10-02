-- =====================================================================================
-- DH1 v2 · Limpieza de los datos de prueba del recorrido del 2/10/2026 (sector "escuela")
--
-- Borra TODO lo del sector escuela en las tablas que tocó el recorrido. Antes del recorrido esas tablas
-- estaban vacías en escuela (todo lo que hay tiene "PRUEBA" en el nombre: ver la consulta de vista previa).
-- No toca: sectores, perfiles, catálogo de rutinas, ubicaciones, activos, ni nada del sector bapro.
--
-- Corre como el dueño de la base (SQL Editor) con los triggers apagados en esta transacción
-- (session_replication_role = replica): así no lo frenan las protecciones de "no se borra" (movimientos,
-- certificados emitidos, auditoría) y no se escriben filas nuevas de auditoría. Como con eso tampoco corren
-- las cascadas, se borra explícitamente cada tabla hija. Si algo falla, no se borra nada.
--
-- Los archivos del bucket "documentos" NO se borran desde SQL (Supabase lo impide): se quitan antes desde la app.
-- =====================================================================================

-- ------------------------------------------------------------------ vista previa (correr sola primero)
-- select 'obras' t, count(*), string_agg(titulo, ' | ') from obras o join sectores s on s.id = o.sector_id and s.clave = 'escuela'
-- union all select 'materiales', count(*), string_agg(x.nombre, ' | ') from materiales x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'proveedores', count(*), string_agg(x.nombre, ' | ') from proveedores x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'empleados', count(*), string_agg(x.nombre, ' | ') from empleados x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'ordenes', count(*), string_agg(titulo, ' | ') from ordenes_trabajo x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'contratos', count(*), string_agg(contratista, ' | ') from contratos x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'informes', count(*), string_agg(titulo, ' | ') from informes x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'requerimientos', count(*), string_agg(titulo, ' | ') from requerimientos_compra x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'solicitudes', count(*), string_agg(titulo, ' | ') from solicitudes_certificado x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'presupuestos', count(*), string_agg(x.nombre, ' | ') from presupuestos x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'riesgos', count(*), string_agg(evento, ' | ') from riesgos x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'foro', count(*), string_agg(titulo, ' | ') from foro_hilos x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'sugerencias', count(*), string_agg(titulo, ' | ') from sugerencias x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'plantillas', count(*), string_agg(x.nombre, ' | ') from plantillas_ot x join sectores s on s.id = x.sector_id and s.clave = 'escuela'
-- union all select 'ciclos', count(*), string_agg(x.nombre, ' | ') from ciclos_cobro x join sectores s on s.id = x.sector_id and s.clave = 'escuela';

begin;
set local session_replication_role = replica;

create temp table _s on commit drop as select id from public.sectores where clave = 'escuela';
do $$ begin
  if (select count(*) from _s) <> 1 then raise exception 'No encuentro el sector escuela.'; end if;
end $$;

-- hijas primero (sin cascadas en este modo)
delete from public.foro_lecturas           where sector_id in (select id from _s);
delete from public.foro_respuestas         where sector_id in (select id from _s);
delete from public.foro_hilos              where sector_id in (select id from _s);
delete from public.sugerencias             where sector_id in (select id from _s);
delete from public.riesgos                 where sector_id in (select id from _s);
delete from public.alertas_vistas          where sector_id in (select id from _s);
delete from public.informes                where sector_id in (select id from _s);
delete from public.plantillas_ot           where sector_id in (select id from _s);

delete from public.certificado_items       where sector_id in (select id from _s);
delete from public.solicitudes_certificado where sector_id in (select id from _s);
delete from public.certificados            where sector_id in (select id from _s);
delete from public.contrato_items          where sector_id in (select id from _s);
delete from public.contratos               where sector_id in (select id from _s);

-- lo que no se borra pero apuntaba a una orden que sí: queda sin la referencia
update public.emergencias    set ot_id = null where sector_id in (select id from _s) and ot_id is not null;
update public.ordenes_rutina set ot_id = null where sector_id in (select id from _s) and ot_id is not null;
delete from public.ot_materiales           where sector_id in (select id from _s);
delete from public.ot_horas                where sector_id in (select id from _s);
delete from public.ot_fotos                where sector_id in (select id from _s);
delete from public.activo_historial        where sector_id in (select id from _s) and ot_id is not null;
delete from public.requerimiento_items     where sector_id in (select id from _s);
delete from public.prestamos               where sector_id in (select id from _s);
delete from public.movimientos_panol       where sector_id in (select id from _s);
delete from public.requerimientos_compra   where sector_id in (select id from _s);
delete from public.ordenes_trabajo         where sector_id in (select id from _s);
delete from public.materiales              where sector_id in (select id from _s);

delete from public.empleados_reservado     where sector_id in (select id from _s);
delete from public.ubicacion_empleados     where sector_id in (select id from _s);
delete from public.fichajes                where sector_id in (select id from _s);
delete from public.empleados               where sector_id in (select id from _s);

delete from public.obra_cobro_historial    where sector_id in (select id from _s);
delete from public.obra_cobros             where sector_id in (select id from _s);
delete from public.ciclos_cobro            where sector_id in (select id from _s);
delete from public.presupuestos            where sector_id in (select id from _s);
delete from public.obras                   where sector_id in (select id from _s);
delete from public.proveedores             where sector_id in (select id from _s);

-- la auditoría de esas tablas (la de usuarios, sectores y lo demás queda)
delete from public.auditoria where sector_id in (select id from _s) and tabla in (
  'foro_hilos','foro_respuestas','sugerencias','riesgos','informes','plantillas_ot','certificado_items','solicitudes_certificado',
  'certificados','contrato_items','contratos','ot_materiales','ot_horas','requerimiento_items','prestamos','movimientos_panol',
  'requerimientos_compra','ordenes_trabajo','materiales','empleados','empleados_reservado','obra_cobros','ciclos_cobro',
  'presupuestos','obras','proveedores');

-- numeración: vuelve al siguiente libre (si no queda nada, arranca en 1)
select setval('public.ot_numero_seq',            coalesce((select max(numero) from public.ordenes_trabajo), 0) + 1, false);
select setval('public.movimiento_numero_seq',    coalesce((select max(numero) from public.movimientos_panol), 0) + 1, false);
select setval('public.prestamo_numero_seq',      coalesce((select max(numero) from public.prestamos), 0) + 1, false);
select setval('public.requerimiento_numero_seq', coalesce((select max(numero) from public.requerimientos_compra), 0) + 1, false);
select setval('public.solicitud_numero_seq',     coalesce((select max(numero) from public.solicitudes_certificado), 0) + 1, false);
select setval('public.informe_numero_seq',       coalesce((select max(numero) from public.informes), 0) + 1, false);

commit;

-- control: todo en 0 para escuela
select (select count(*) from public.obras o join public.sectores s on s.id = o.sector_id where s.clave = 'escuela') as obras,
       (select count(*) from public.materiales o join public.sectores s on s.id = o.sector_id where s.clave = 'escuela') as materiales,
       (select count(*) from public.movimientos_panol o join public.sectores s on s.id = o.sector_id where s.clave = 'escuela') as movimientos,
       (select count(*) from public.ordenes_trabajo o join public.sectores s on s.id = o.sector_id where s.clave = 'escuela') as ordenes,
       (select count(*) from public.contratos o join public.sectores s on s.id = o.sector_id where s.clave = 'escuela') as contratos,
       (select count(*) from public.informes o join public.sectores s on s.id = o.sector_id where s.clave = 'escuela') as informes,
       (select count(*) from public.perfiles o join public.sectores s on s.id = o.sector_id where s.clave = 'escuela') as perfiles_quedan;
