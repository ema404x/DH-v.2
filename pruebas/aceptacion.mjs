// Pruebas de aceptación del SQL de DH1 v2 (§7 del briefing), sobre un Postgres embebido.
// Carga los cuatro .sql en orden, simula los roles y el auth.uid() de Supabase, y verifica
// que la base rechace lo que tiene que rechazar. No se conecta a ningún Supabase.
//
//   cd pruebas && npm install && npm test

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();

// ---------------------------------------------------------------- entorno tipo Supabase
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);

for (const f of ['dh1-v2-fundacion.sql', 'dh1-v2-fase3-gestion.sql', 'dh1-v2-fase4-certificacion.sql', 'dh1-v2-fase5-migracion.sql', 'dh1-v2-fase6-operacion.sql', 'dh1-v2-fase7-informe-ia.sql', 'dh1-v2-fase8-gente.sql', 'dh1-v2-fase9-obras.sql', 'dh1-v2-fase10-panol.sql', 'dh1-v2-fase11-control.sql', 'dh1-v2-fase12-administracion.sql', 'dh1-v2-fase13-ajustes.sql', 'dh1-v2-fase14-certificados-v1.sql', 'dh1-v2-fase15-ot-obra-firma.sql']) {
  try {
    await db.exec(readFileSync(join(raiz, f), 'utf8'));
    console.log(`cargado  ${f}`);
  } catch (e) {
    console.error(`\nERROR al cargar ${f}:\n  ${e.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- utilidades
let pasaron = 0;
const fallas = [];
let seccion = '';

function titulo(t) { seccion = t; console.log(`\n── ${t}`); }
function ok(nombre, cond, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallas.push(`${seccion} › ${nombre} ${detalle}`); console.log(`  ✗ ${nombre} ${detalle}`); }
}
async function servicio() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function como(uid) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
}
async function q(sql, params = []) { return (await db.query(sql, params)).rows; }
async function uno(sql, params = []) { return (await q(sql, params))[0]; }
async function rechaza(nombre, sql, patron, params = []) {
  try {
    await db.query(sql, params);
    ok(nombre, false, '→ la base lo aceptó y tenía que rechazarlo');
  } catch (e) {
    ok(nombre, patron.test(e.message), `→ error inesperado: ${e.message}`);
  }
}

// ---------------------------------------------------------------- datos base (como servicio)
const U = {
  adm:   '00000000-0000-0000-0000-0000000000a1',
  gg:    '00000000-0000-0000-0000-0000000000a2',
  gerE:  '00000000-0000-0000-0000-0000000000e1',
  jefeE: '00000000-0000-0000-0000-0000000000e2',
  opE:   '00000000-0000-0000-0000-0000000000e3',
  opE2:  '00000000-0000-0000-0000-0000000000e4',
  gerB:  '00000000-0000-0000-0000-0000000000b1',
  opB:   '00000000-0000-0000-0000-0000000000b2',
};
await servicio();
const escuela = (await uno(`select id from sectores where clave = 'escuela'`)).id;
const bapro = (await uno(`select id from sectores where clave = 'bapro'`)).id;
const altas = [
  [U.adm, 'admin', escuela], [U.gg, 'gerente_general', escuela],
  [U.gerE, 'gerente', escuela], [U.jefeE, 'jefe_sitio', escuela],
  [U.opE, 'operario', escuela], [U.opE2, 'operario', escuela],
  [U.gerB, 'gerente', bapro], [U.opB, 'operario', bapro],
];
for (const [id, rol, sector] of altas) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(-2)}@dh1.test`]);
  await db.query(`insert into perfiles (id, email, nombre, rol, sector_id) values ($1, $2, $3, $4, $5)`,
    [id, `${id.slice(-2)}@dh1.test`, `Usuario ${id.slice(-2)}`, rol, sector]);
}

// ================================================================ 1. AISLAMIENTO
titulo('1. Aislamiento por sector');

await como(U.gerE);
const ubiE = (await uno(`insert into ubicaciones (nombre, codigo) values ('Escuela 21', 'ESC-21') returning id, sector_id, qr_token`));
ok('una ubicación creada sin sector queda sellada con el sector del usuario', ubiE.sector_id === escuela);
const actE = (await uno(`insert into activos (nombre, ubicacion_id, frecuencia_mant_dias, proximo_mantenimiento)
  values ('Caldera Escuela 21', $1, 30, current_date + 3) returning id, qr_token`, [ubiE.id]));
const otE = (await uno(`insert into ordenes_trabajo (titulo, ubicacion_id, checklist)
  values ('Revisar tablero', $1, '[{"id":"1","tarea":"Cortar energía","hecho":false},{"id":"2","tarea":"Medir","hecho":false}]')
  returning id, estado, codigo, sector_id`, [ubiE.id]));
ok('una OT nueva nace pendiente y con código', otE.estado === 'pendiente' && /^OT-\d{6}$/.test(otE.codigo));

await como(U.gerB);
const ubiB = (await uno(`insert into ubicaciones (nombre) values ('Sucursal La Plata') returning id, sector_id`));
ok('la ubicación de bapro queda en bapro', ubiB.sector_id === bapro);
await uno(`insert into activos (nombre, ubicacion_id) values ('Aire sucursal', $1) returning id`, [ubiB.id]);
await uno(`insert into ordenes_trabajo (titulo, ubicacion_id) values ('Cambiar filtro', $1) returning id`, [ubiB.id]);
await rechaza('un usuario de bapro no puede crear un registro en escuela',
  `insert into ubicaciones (nombre, sector_id) values ('Intrusa', $1)`, /row-level security/, [escuela]);
await rechaza('un activo no puede apuntar a una ubicación de otro sector',
  `insert into activos (nombre, ubicacion_id) values ('Cruzado', $1)`, /foreign key|violates/, [ubiE.id]);

await como(U.opB);
const vistoB = await uno(`select
  (select count(*) from ubicaciones where sector_id = $1)::int as ubi,
  (select count(*) from ordenes_trabajo where sector_id = $1)::int as ots,
  (select count(*) from activos where sector_id = $1)::int as act,
  (select count(*) from v_ordenes)::int as propias`, [escuela]);
ok('operario de bapro: 0 ubicaciones, 0 OTs y 0 activos de escuela',
  vistoB.ubi === 0 && vistoB.ots === 0 && vistoB.act === 0, JSON.stringify(vistoB));
ok('operario de bapro sí ve la OT de su sector', vistoB.propias === 1);
const tocadas = await q(`update ordenes_trabajo set notas = 'hackeo' where id = $1 returning id`, [otE.id]);
ok('operario de bapro no puede modificar una OT de escuela (0 filas)', tocadas.length === 0);
await rechaza('un QR de escuela no se resuelve para un usuario de bapro',
  `select resolver_qr($1)`, /no existe o no es de tu sector/, [ubiE.qr_token]);
await rechaza('un operario no puede cambiar de sector activo',
  `select cambiar_sector_activo($1)`, /no puede cambiar de sector/, [escuela]);
await rechaza('un operario no puede prender "ver todos"',
  `select set_ver_todos(true)`, /Solo un administrador/);

await como(U.opE);
const qr = (await uno(`select resolver_qr($1) as r`, [ubiE.qr_token])).r;
ok('el QR de escuela se resuelve para un usuario de escuela', qr.tipo === 'ubicacion' && qr.id === ubiE.id);
const qrA = (await uno(`select resolver_qr($1) as r`, [actE.qr_token])).r;
ok('el mismo formato de QR resuelve activos', qrA.tipo === 'activo');

await como(U.adm);
const sectoresVistos = async () => (await q(`select distinct sector_id from ubicaciones`)).map((r) => r.sector_id);
let sv = await sectoresVistos();
ok('admin con sector activo escuela ve solo escuela', sv.length === 1 && sv[0] === escuela);
await db.query(`select cambiar_sector_activo($1)`, [bapro]);
sv = await sectoresVistos();
ok('admin cambia a bapro y ve solo bapro', sv.length === 1 && sv[0] === bapro);
await db.query(`select set_ver_todos(true)`);
sv = await sectoresVistos();
ok('admin con "ver todos" ve ambos sectores', sv.length === 2);
await db.query(`select set_ver_todos(false)`);
await db.query(`select cambiar_sector_activo($1)`, [escuela]);
sv = await sectoresVistos();
ok('admin apaga "ver todos" y vuelve a ver un solo sector', sv.length === 1 && sv[0] === escuela);

await como(U.gg);
await db.query(`select cambiar_sector_activo($1)`, [bapro]);
sv = await sectoresVistos();
ok('gerente general cambia de sector y ve solo el nuevo', sv.length === 1 && sv[0] === bapro);
await rechaza('gerente general no puede prender "ver todos"', `select set_ver_todos(true)`, /Solo un administrador/);
await db.query(`select cambiar_sector_activo($1)`, [escuela]);

await servicio();
await db.exec(`set role anon;`);
await rechaza('sin sesión (anon) no se lee ninguna tabla', `select count(*) from ubicaciones`, /permission denied/);
await rechaza('sin sesión (anon) no se ejecutan funciones', `select sector_efectivo()`, /permission denied/);

// ================================================================ 2. PERFIL PROTEGIDO
titulo('2. Nadie se cambia de sector a mano');
await como(U.opE);
await rechaza('operario: update perfiles set sector_id', `update perfiles set sector_id = $1 where id = $2`, /No podés cambiar tu sector/, [bapro, U.opE]);
await rechaza('operario: update perfiles set rol', `update perfiles set rol = 'admin' where id = $1`, /No podés cambiar tu rol/, [U.opE]);
await rechaza('operario: update perfiles set sector_activo_id', `update perfiles set sector_activo_id = $1 where id = $2`, /selector de sector/, [bapro, U.opE]);
await rechaza('operario: update perfiles set ver_todos', `update perfiles set ver_todos = true where id = $1`, /Ver todos/, [U.opE]);
const ajeno = await q(`update perfiles set nombre = 'x' where id = $1 returning id`, [U.opE2]);
ok('operario no puede editar el perfil de otro (0 filas)', ajeno.length === 0);
const propio = await q(`update perfiles set telefono = '11-5555' where id = $1 returning id`, [U.opE]);
ok('operario sí puede editar su teléfono', propio.length === 1);
await como(U.adm);
await rechaza('admin tampoco cambia su propio sector a mano', `update perfiles set sector_id = $1 where id = $2`, /No podés cambiar tu sector/, [bapro, U.adm]);
await rechaza('nadie da de alta perfiles desde la app', `insert into perfiles (id, email, nombre, rol, sector_id) values ($1, 'z@z', 'z', 'admin', $2)`, /row-level security/, [U.opB, escuela]);

// ================================================================ 3. OT
titulo('3. Máquina de estados de la OT');
await como(U.opE);
await rechaza('operario no puede crear una OT', `insert into ordenes_trabajo (titulo) values ('x')`, /Solo gerencia o un jefe de sitio pueden crear/);
await rechaza('pendiente → completada es inválido', `update ordenes_trabajo set estado = 'completada' where id = $1`, /no puede pasar a completada/, [otE.id]);
await rechaza('operario no puede cambiar el título', `update ordenes_trabajo set titulo = 'otro' where id = $1`, /cambiar los datos de la orden/, [otE.id]);
let ot = await uno(`update ordenes_trabajo set estado = 'en_progreso' where id = $1 returning estado, asignado_a, fecha_inicio_real`, [otE.id]);
ok('iniciar: pasa a en_progreso y queda asignado el que la inició (estaba libre)',
  ot.estado === 'en_progreso' && ot.asignado_a === U.opE && ot.fecha_inicio_real !== null);
await rechaza('finalizar con checklist incompleto y sin motivos', `update ordenes_trabajo set estado = 'pendiente_validacion' where id = $1`, /Faltan tareas del checklist/, [otE.id]);
ot = await uno(`update ordenes_trabajo set estado = 'pendiente_validacion',
  motivos_incompleto = '[{"id":"m1","texto":"Sin acceso al tablero"}]' where id = $1 returning estado, fecha_fin_real`, [otE.id]);
ok('finalizar con motivo de incompleto: pasa a pendiente_validacion', ot.estado === 'pendiente_validacion' && ot.fecha_fin_real !== null);
await rechaza('operario no puede aprobar', `update ordenes_trabajo set estado = 'completada' where id = $1`, /Solo gerencia o un jefe de sitio pueden aprobar/, [otE.id]);

await como(U.jefeE);
await rechaza('rechazar sin motivo', `update ordenes_trabajo set estado = 'en_progreso' where id = $1`, /escribir el motivo/, [otE.id]);
ot = await uno(`update ordenes_trabajo set estado = 'en_progreso', rechazo_comentario = 'Falta medir' where id = $1 returning estado, fecha_fin_real`, [otE.id]);
ok('jefe de sitio rechaza con motivo: vuelve a en_progreso', ot.estado === 'en_progreso' && ot.fecha_fin_real === null);

await como(U.opE);
ot = await uno(`update ordenes_trabajo set estado = 'pendiente_validacion',
  checklist = '[{"id":"1","tarea":"Cortar energía","hecho":true},{"id":"2","tarea":"Medir","hecho":true}]', motivos_incompleto = '[]'
  where id = $1 returning estado, rechazo_comentario`, [otE.id]);
ok('finalizar con checklist completo', ot.estado === 'pendiente_validacion' && ot.rechazo_comentario === null);

await como(U.jefeE);
ot = await uno(`update ordenes_trabajo set estado = 'completada' where id = $1 returning estado, validado_por, fecha_validacion`, [otE.id]);
ok('jefe de sitio aprueba: completada, con validador y fecha', ot.estado === 'completada' && ot.validado_por === U.jefeE && ot.fecha_validacion !== null);
await rechaza('una OT completada no se modifica', `update ordenes_trabajo set notas = 'x' where id = $1`, /está cerrada/, [otE.id]);
await rechaza('jefe de sitio no puede borrar una OT', `delete from ordenes_trabajo where id = $1`, /No tenés permiso/, [otE.id]);

// asignada a otro: el que inicia no la pisa
const ot2 = await uno(`insert into ordenes_trabajo (titulo, asignado_a, requiere_fotos) values ('Con fotos', $1, true) returning id, estado`, [U.opE2]);
ok('una OT creada con asignado nace asignada', ot2.estado === 'asignada');
await como(U.opE);
ot = await uno(`update ordenes_trabajo set estado = 'en_progreso' where id = $1 returning asignado_a`, [ot2.id]);
ok('iniciar una OT ya asignada respeta al asignado', ot.asignado_a === U.opE2);
await rechaza('finalizar sin fotos una OT que las pide', `update ordenes_trabajo set estado = 'pendiente_validacion' where id = $1`, /pide fotos/, [ot2.id]);
await db.query(`insert into ot_fotos (ot_id, path, url) values ($1, 'x/y.jpg', 'https://x/y.jpg')`, [ot2.id]);
ot = await uno(`update ordenes_trabajo set estado = 'pendiente_validacion' where id = $1 returning estado`, [ot2.id]);
ok('con una foto subida, finaliza', ot.estado === 'pendiente_validacion');
await como(U.gerE);
await db.query(`update ordenes_trabajo set estado = 'cancelada' where id = $1`, [ot2.id]);
await como(U.opE);
await rechaza('no se agregan fotos a una OT cerrada', `insert into ot_fotos (ot_id, path, url) values ($1, 'a', 'b')`, /está cerrada/, [ot2.id]);

titulo('3b. Activos: historial, jerarquía, preventivo, búsqueda');
await como(U.opE);
await rechaza('operario no puede crear activos', `insert into activos (nombre) values ('x')`, /No tenés permiso/);
await rechaza('el historial no se carga a mano', `insert into activo_historial (activo_id, tipo, detalle) values ($1, 'alta', 'trucho')`, /se registra solo/, [actE.id]);
await como(U.jefeE);
const hijo = await uno(`insert into activos (nombre, padre_id) values ('Quemador', $1) returning id`, [actE.id]);
await rechaza('jerarquía sin ciclos', `update activos set padre_id = $1 where id = $2`, /propios componentes/, [hijo.id, actE.id]);
await db.query(`update activos set estado = 'en_mantenimiento' where id = $1`, [actE.id]);
let creadas = (await uno(`select generar_ots_preventivas(7) as n`)).n;
ok('preventivo: genera 1 OT para el activo por vencer', creadas === 1, `(generó ${creadas})`);
creadas = (await uno(`select generar_ots_preventivas(7) as n`)).n;
ok('preventivo: correrlo de nuevo no duplica (idempotente)', creadas === 0, `(generó ${creadas})`);
const prev = await uno(`select id from ordenes_trabajo where origen = 'preventivo' and activo_id = $1`, [actE.id]);
await db.query(`update ordenes_trabajo set estado = 'en_progreso' where id = $1`, [prev.id]);
await db.query(`update ordenes_trabajo set estado = 'pendiente_validacion' where id = $1`, [prev.id]);
await db.query(`update ordenes_trabajo set estado = 'completada' where id = $1`, [prev.id]);
const exp = await uno(`select ultimo_mantenimiento = current_date as hoy, proximo_mantenimiento = current_date + 30 as reprogramado,
  ots_total from v_expediente_activo where id = $1`, [actE.id]);
ok('al completar el preventivo se reprograma el próximo mantenimiento', exp.hoy && exp.reprogramado, JSON.stringify(exp));
const hist = (await q(`select tipo from activo_historial where activo_id = $1 order by created_at`, [actE.id])).map((r) => r.tipo);
ok('historial automático: alta, cambio de estado y OT completada',
  hist.includes('alta') && hist.includes('cambio_estado') && hist.includes('ot_completada'), hist.join(','));
const busq = await q(`select * from buscar('ubicaciones', 'escu')`);
ok('buscar() devuelve resultados del sector', busq.length === 1 && busq[0].etiqueta === 'Escuela 21');
await rechaza('buscar() solo admite tablas de la lista', `select * from buscar('sectores', 'x')`, /No se puede buscar/);
await como(U.opB);
ok('buscar() desde bapro no encuentra lo de escuela', (await q(`select * from buscar('ubicaciones', 'escu')`)).length === 0);
const kpi = await q(`select * from v_kpi_ots`);
ok('los KPIs de bapro solo cuentan bapro', kpi.length === 1 && kpi[0].sector_id === bapro);

// ================================================================ 4. CERTIFICACIÓN
titulo('4. Certificación');
await como(U.jefeE);
await rechaza('jefe de sitio no puede crear contratos', `insert into contratos (contratista, obra_servicio) values ('x', 'y')`, /No tenés permiso/);
await como(U.gerE);
const k = await uno(`insert into contratos (contratista, obra_servicio, ada_numero, fondo_reparo_pct, fondo_reparo_aplicar, monto_contratado)
  values ('Colamussi', 'Mantenimiento de ascensores', '5299', 5, true, 999999) returning id, monto_contratado`);
ok('el monto contratado no se escribe a mano (arranca en 0)', Number(k.monto_contratado) === 0);
const i1 = await uno(`insert into contrato_items (contrato_id, numero, descripcion, um, cantidad, importe_unitario) values ($1, 1, 'Abono mensual', 'mes', 100, 1000) returning id`, [k.id]);
const i2 = await uno(`insert into contrato_items (contrato_id, numero, descripcion, um, cantidad, importe_unitario) values ($1, 2, 'Repuestos', 'u', 10, 500) returning id`, [k.id]);
ok('el monto contratado es la suma de los ítems', Number((await uno(`select monto_contratado from contratos where id = $1`, [k.id])).monto_contratado) === 105000);

await como(U.gerB);
await rechaza('un contrato de escuela no existe para gerencia de bapro', `select crear_certificado($1, 'Sep 2026')`, /no existe o no es de tu sector/, [k.id]);

await como(U.jefeE);
await rechaza('los certificados no se insertan a mano', `insert into certificados (contrato_id, periodo) values ($1, 'x')`, /se crean con "Nuevo certificado"/, [k.id]);
const c1 = (await uno(`select crear_certificado($1, 'Septiembre 2026') as id`, [k.id])).id;
await rechaza('un solo borrador por contrato', `select crear_certificado($1, 'Octubre 2026')`, /ya tiene un certificado en borrador/, [k.id]);
await db.query(`update certificado_items set med_presente_unidad = 40, med_acum_anterior_unidad = 999, importe_unitario = 1
  where certificado_id = $1 and contrato_item_id = $2`, [c1, i1.id]);
let l = await uno(`select * from certificado_items where certificado_id = $1 and contrato_item_id = $2`, [c1, i1.id]);
ok('el cliente solo escribe la medición: anterior y precio los dispone la base',
  Number(l.med_acum_anterior_unidad) === 0 && Number(l.importe_unitario) === 1000 && Number(l.med_presente_importe) === 40000
  && Number(l.saldo_pendiente_unidad) === 60, JSON.stringify(l));
let c = await uno(`select * from certificados where id = $1`, [c1]);
ok('totales del certificado calculados por la base (subtotal, fondo de reparo 5%, neto)',
  Number(c.subtotal_presente) === 40000 && Number(c.fondo_reparo_monto) === 2000 && Number(c.total_neto) === 38000, JSON.stringify(c));
await rechaza('el estado no se cambia a mano', `update certificados set estado = 'emitido', numero = 7 where id = $1`, /no se cambian a mano/, [c1]);
await db.query(`update certificados set subtotal_presente = 1, notas = 'nota ok' where id = $1`, [c1]);
c = await uno(`select subtotal_presente, notas from certificados where id = $1`, [c1]);
ok('en borrador se edita la nota, no los totales', Number(c.subtotal_presente) === 40000 && c.notas === 'nota ok');

const n1 = (await uno(`select emitir_certificado($1) as n`, [c1])).n;
ok('emitir numera el certificado: N° 1', n1 === 1);
await rechaza('emitir dos veces el mismo certificado', `select emitir_certificado($1)`, /ya fue emitido/, [c1]);
await rechaza('un emitido no se edita (cabecera)', `update certificados set notas = 'x' where id = $1`, /Ya no se puede modificar/, [c1]);
await rechaza('un emitido no se edita (líneas)', `update certificado_items set med_presente_unidad = 1 where certificado_id = $1`, /Ya no se puede modificar/, [c1]);
await rechaza('un emitido no se borra', `delete from certificados where id = $1`, /Ya no se puede modificar ni borrar/, [c1]);
await rechaza('jefe de sitio no aprueba', `select aprobar_certificado($1)`, /Solo gerencia puede aprobar/, [c1]);

await como(U.gerE);
await rechaza('un ítem con certificados emitidos no cambia de cantidad', `update contrato_items set cantidad = 5 where id = $1`, /ya tiene certificados emitidos/, [i1.id]);
await db.query(`select aprobar_certificado($1)`, [c1]);
ok('gerencia aprueba el certificado que emitió otro', (await uno(`select estado from certificados where id = $1`, [c1])).estado === 'aprobado');

const c2 = (await uno(`select crear_certificado($1, 'Octubre 2026') as id`, [k.id])).id;
l = await uno(`select * from certificado_items where certificado_id = $1 and contrato_item_id = $2`, [c2, i1.id]);
ok('el segundo certificado trae el anterior desde lo ya certificado (40)', Number(l.med_acum_anterior_unidad) === 40 && Number(l.med_acum_anterior_importe) === 40000);
await db.query(`update certificado_items set med_presente_unidad = 70 where certificado_id = $1 and contrato_item_id = $2`, [c2, i1.id]);
await rechaza('emitir con sobre-certificación por ítem', `select emitir_certificado($1)`, /Sobre-certificación en el ítem 1/, [c2]);
await rechaza('emitir un certificado vacío', `select emitir_certificado($1)`, /Sobre-certificación|nada medido/, [c2]);
await db.query(`update certificado_items set med_presente_unidad = 60 where certificado_id = $1 and contrato_item_id = $2`, [c2, i1.id]);
const n2 = (await uno(`select emitir_certificado($1) as n`, [c2])).n;
ok('corregida la medición, emite con N° 2', n2 === 2);
await rechaza('quien emite no aprueba', `select aprobar_certificado($1)`, /Quien emite un certificado no puede aprobarlo/, [c2]);

const c3 = (await uno(`select crear_certificado($1, 'Noviembre 2026') as id`, [k.id])).id;
l = await uno(`select * from certificado_items where certificado_id = $1 and contrato_item_id = $2`, [c3, i1.id]);
ok('el tercero acumula emitido + aprobado (100, saldo 0)', Number(l.med_acum_anterior_unidad) === 100 && Number(l.saldo_pendiente_unidad) === 0);
await rechaza('emitir sin nada medido', `select emitir_certificado($1)`, /nada medido/, [c3]);

await como(U.adm);
await rechaza('rechazar sin motivo', `select rechazar_certificado($1, '')`, /escribir el motivo/, [c2]);
await rechaza('rechazar con otro borrador abierto', `select rechazar_certificado($1, 'Mal medido')`, /otro certificado en borrador/, [c2]);
await db.query(`delete from certificados where id = $1`, [c3]);
ok('un borrador sí se puede borrar (con sus líneas)', (await q(`select 1 from certificado_items where certificado_id = $1`, [c3])).length === 0);
await rechaza('solo se rechaza el último del contrato', `select rechazar_certificado($1, 'x')`, /Solo se rechaza un certificado emitido|posteriores/, [c1]);
await db.query(`select rechazar_certificado($1, 'Mal medido')`, [c2]);
c = await uno(`select estado, numero, rechazo_motivo from certificados where id = $1`, [c2]);
ok('rechazar devuelve a borrador y libera el número', c.estado === 'borrador' && c.numero === null && c.rechazo_motivo === 'Mal medido');
await como(U.gerE);
ok('re-emitido, retoma el N° 2', (await uno(`select emitir_certificado($1) as n`, [c2])).n === 2);
await como(U.adm);
await db.query(`select aprobar_certificado($1)`, [c2]);
const vk = await uno(`select certificado_importe, saldo_importe, porcentaje_certificado, certificados_total from v_contratos where id = $1`, [k.id]);
ok('v_contratos: certificado 100.000, saldo 5.000, 2 certificados',
  Number(vk.certificado_importe) === 100000 && Number(vk.saldo_importe) === 5000 && vk.certificados_total === 2, JSON.stringify(vk));

await servicio();
await rechaza('el índice único impide dos certificados con el mismo número en un contrato',
  `insert into certificados (sector_id, contrato_id, numero, estado, periodo) values ($1, $2, 2, 'emitido', 'dup')`,
  /certificados_numero_idx|duplicate key/, [escuela, k.id]);

// ================================================================ 5. MIGRACIÓN
titulo('5. Importación histórica');
const historico = {
  sector_id: escuela, id_origen: 'b44-cert-1', tipo: 'abono_mensual', estado: 'aprobado', numero: 4,
  contratista: 'Legion Preco SRL', obra_servicio: 'Fumigación', ada_numero: '4825', periodo: 'Agosto 2026',
  subtotal: 1885831, fondo_reparo_pct: 5, fondo_reparo_aplicar: false,
  items: [{ numero: 1, descripcion: 'Fumigación mensual', um: 'mes', cantidad: 12, importe_unitario: 1885831,
            importe_total: 22629972, med_acum_anterior_unidad: 3, med_acum_anterior_importe: 5657493,
            med_presente_unidad: 1, med_presente_importe: 1885831, med_acum_presente_unidad: 4,
            med_acum_presente_importe: 7543324, saldo_pendiente_unidad: 8, saldo_pendiente_importe: 15086648 }],
  original: { nota: 'tal cual venía de Base44' },
};
await como(U.gerE);
await rechaza('la importación histórica no corre desde la app', `select importar_certificado_historico($1)`, /permission denied/, [JSON.stringify(historico)]);
await servicio();
const h1 = (await uno(`select importar_certificado_historico($1) as id`, [JSON.stringify(historico)])).id;
const h2 = (await uno(`select importar_certificado_historico($1) as id`, [JSON.stringify(historico)])).id;
ok('importar dos veces el mismo certificado no lo duplica', h1 === h2);
const hc = await uno(`select numero, estado, historico, subtotal_presente, acum_presente_importe from certificados where id = $1`, [h1]);
ok('el histórico conserva número, estado y valores de origen',
  hc.numero === 4 && hc.estado === 'aprobado' && hc.historico && Number(hc.subtotal_presente) === 1885831 && Number(hc.acum_presente_importe) === 7543324, JSON.stringify(hc));
await rechaza('un certificado sin sector no se importa', `select importar_certificado_historico($1)`, /sin sector/,
  [JSON.stringify({ ...historico, sector_id: null, id_origen: 'b44-cert-2' })]);
await rechaza('número duplicado en origen se reporta', `select importar_certificado_historico($1)`, /Número duplicado en origen/,
  [JSON.stringify({ ...historico, id_origen: 'b44-cert-3' })]);
await como(U.gerE);
const kh = (await uno(`select contrato_id from certificados where id = $1`, [h1])).contrato_id;
const cn = (await uno(`select crear_certificado($1, 'Septiembre 2026') as id`, [kh])).id;
await db.query(`update certificado_items set med_presente_unidad = 1 where certificado_id = $1`, [cn]);
ok('un certificado nuevo sobre un contrato migrado numera después del histórico (N° 5)',
  (await uno(`select emitir_certificado($1) as n`, [cn])).n === 5);
await rechaza('un histórico tampoco se modifica', `update certificados set notas = 'x' where id = $1`, /Ya no se puede modificar/, [h1]);

// ================================================================ 6. COLA SIN SEÑAL
// El teléfono reenvía una operación cuando no sabe si llegó. Repetirla no puede romper ni duplicar nada,
// y lo que llega tarde sobre una orden que ya cambió tiene que ser rechazado con un mensaje claro.
titulo('6. Reenvíos de la cola sin señal');
await como(U.gerE);
const otQ = await uno(`insert into ordenes_trabajo (titulo, ubicacion_id, activo_id, checklist)
  values ('Cola sin señal', $1, $2, '[{"id":"1","tarea":"Revisar","hecho":false}]') returning id`, [ubiE.id, actE.id]);
await como(U.opE);
const vq = await uno(`select ubicacion_qr_token, activo_qr_token from v_ordenes where id = $1`, [otQ.id]);
ok('la orden trae los tokens de QR de su ubicación y su activo (para reconocerlos sin señal)',
  vq.ubicacion_qr_token === ubiE.qr_token && vq.activo_qr_token === actE.qr_token);

await db.query(`update ordenes_trabajo set estado = 'en_progreso' where id = $1`, [otQ.id]);
ot = await uno(`update ordenes_trabajo set estado = 'en_progreso' where id = $1 returning estado, asignado_a`, [otQ.id]);
ok('reenviar "iniciar" no rompe nada: sigue en curso y asignada al mismo', ot.estado === 'en_progreso' && ot.asignado_a === U.opE);

await como(U.opE2);
ot = await uno(`update ordenes_trabajo set estado = 'en_progreso' where id = $1 returning asignado_a`, [otQ.id]);
ok('si otro operario la inició sin señal y llega después, no le saca la orden al primero', ot.asignado_a === U.opE);

await como(U.opE);
const fotoId = '00000000-0000-0000-0000-00000000f001';
await db.query(`insert into ot_fotos (id, ot_id, path, url) values ($1, $2, 'p/f1.jpg', 'https://x/f1.jpg')`, [fotoId, otQ.id]);
await rechaza('reenviar la misma foto no la duplica (mismo id → clave duplicada, el teléfono lo toma como "ya estaba")',
  `insert into ot_fotos (id, ot_id, path, url) values ($1, $2, 'p/f1.jpg', 'https://x/f1.jpg')`, /duplicate key/, [fotoId, otQ.id]);
ok('queda una sola foto', (await uno(`select count(*)::int as n from ot_fotos where ot_id = $1`, [otQ.id])).n === 1);

const hecho = `'[{"id":"1","tarea":"Revisar","hecho":true}]'`;
await db.query(`update ordenes_trabajo set estado = 'pendiente_validacion', checklist = ${hecho}, notas = 'listo', motivos_incompleto = '[]' where id = $1`, [otQ.id]);
ot = await uno(`update ordenes_trabajo set estado = 'pendiente_validacion', checklist = ${hecho}, notas = 'listo', motivos_incompleto = '[]'
  where id = $1 returning estado, fecha_fin_real`, [otQ.id]);
ok('reenviar "finalizar" no rompe nada: sigue a validar', ot.estado === 'pendiente_validacion' && ot.fecha_fin_real !== null);

await como(U.jefeE);
await db.query(`update ordenes_trabajo set estado = 'completada' where id = $1`, [otQ.id]);
await como(U.opE);
await rechaza('un "finalizar" que llega tarde sobre una orden ya cerrada se rechaza',
  `update ordenes_trabajo set estado = 'pendiente_validacion', checklist = ${hecho} where id = $1`, /no puede pasar a pendiente validacion/, [otQ.id]);
await rechaza('una foto que llega tarde sobre una orden ya cerrada se rechaza',
  `insert into ot_fotos (ot_id, path, url) values ($1, 'p/f2.jpg', 'https://x/f2.jpg')`, /está cerrada/, [otQ.id]);

await como(U.gerE);
const otC = await uno(`insert into ordenes_trabajo (titulo) values ('Se cancela mientras el operario no tiene señal') returning id`);
await db.query(`update ordenes_trabajo set estado = 'cancelada' where id = $1`, [otC.id]);
await como(U.opE);
await rechaza('un "iniciar" que llega tarde sobre una orden cancelada se rechaza',
  `update ordenes_trabajo set estado = 'en_progreso' where id = $1`, /no puede pasar a en progreso/, [otC.id]);

// ================================================================ 7. OPERACIÓN (fase 6)
titulo('7a. Información general: direcciones, jefes e inspectores');
const filasDir = [
  { direccion: 'Av. Roca 1234', zona: '8A', establecimiento: 'Primaria 5', codigo: 'UT-5', m2: 1200, jefe: 'Usuario e2', inspector: 'Inspector Externo' },
  { direccion: 'Av. Roca 1234', zona: '8A', establecimiento: 'Jardín 5', codigo: 'UT-5J', m2: 300, jefe: 'Usuario e2', inspector: 'Inspector Externo' },
  { direccion: 'Larrazábal 420', zona: '8B', establecimiento: 'Técnica 9', codigo: 'UT-9', jefe: 'Nombre Sin Usuario' },
];
await como(U.opE);
await rechaza('operario no importa el directorio', `select importar_directorio($1)`, /Solo gerencia/, [JSON.stringify(filasDir)]);
await como(U.gerE);
let imp = (await uno(`select importar_directorio($1) as r`, [JSON.stringify(filasDir)])).r;
ok('importa 2 direcciones y 3 ubicaciones', imp.direcciones_nuevas === 2 && imp.ubicaciones_nuevas === 3, JSON.stringify(imp));
imp = (await uno(`select importar_directorio($1) as r`, [JSON.stringify(filasDir)])).r;
ok('reimportar el mismo archivo no duplica nada',
  imp.direcciones_nuevas === 0 && imp.ubicaciones_nuevas === 0 && imp.direcciones_actualizadas === 0 && imp.ubicaciones_actualizadas === 0, JSON.stringify(imp));
const prim5 = await uno(`select * from v_ubicaciones where nombre = 'Primaria 5'`);
ok('el jefe con usuario queda enganchado por id; el inspector sin usuario, por nombre',
  prim5.jefe_sitio_id === U.jefeE && prim5.jefe_sitio_nombre === 'Usuario e2' && prim5.inspector_id === null && prim5.inspector_nombre === 'Inspector Externo'
  && prim5.domicilio === 'Av. Roca 1234', JSON.stringify({ j: prim5.jefe_sitio_id, n: prim5.jefe_sitio_nombre, i: prim5.inspector_nombre, d: prim5.domicilio }));
const tec9 = await uno(`select jefe_sitio_id, jefe_sitio_nombre from ubicaciones where nombre = 'Técnica 9'`);
ok('un jefe importado sin usuario conserva el nombre (para engancharlo después)', tec9.jefe_sitio_id === null && tec9.jefe_sitio_nombre === 'Nombre Sin Usuario');
const dirRoca = await uno(`select id, ubicaciones_total from v_direcciones where direccion = 'Av. Roca 1234'`);
await db.query(`update direcciones set jefe_sitio_id = $1 where id = $2`, [U.gerE, dirRoca.id]);
const propagadas = await q(`select jefe_sitio_id, jefe_sitio_nombre from ubicaciones where direccion_id = $1`, [dirRoca.id]);
ok('cambiar el jefe de una dirección lo lleva a todas sus ubicaciones',
  dirRoca.ubicaciones_total === 2 && propagadas.length === 2 && propagadas.every((u) => u.jefe_sitio_id === U.gerE && u.jefe_sitio_nombre === 'Usuario e1'));
await db.query(`update direcciones set jefe_sitio_id = $1 where id = $2`, [U.jefeE, dirRoca.id]);
await como(U.opB);
ok('las direcciones de escuela no existen para bapro', (await q(`select 1 from direcciones`)).length === 0);

titulo('7b. Pendientes SAP');
const filasSap = [
  { numero_sap: '4001', descripcion: 'Reparar canilla', establecimiento: 'Primaria 5', sitio: 'UT-5', inspector: 'Inspector Externo', fecha_limite: '2020-01-10', clase_orden: 'MEES', status_sap: 'AEJE' },
  { numero_sap: '4002', descripcion: 'Obra de cubierta', establecimiento: 'Escuela Desconocida', inspector: 'OTRO INSPECTOR', clase_orden: 'OBRA', status_sap: 'CIER' },
  { numero_sap: '4001', descripcion: 'Duplicada en el archivo', establecimiento: 'Primaria 5' },
  { numero_sap: '', descripcion: 'Sin número' },
];
await como(U.opE);
await rechaza('operario no importa pendientes', `select importar_pendientes_sap($1, '8A')`, /Solo gerencia o un jefe/, [JSON.stringify(filasSap)]);
await como(U.jefeE);
imp = (await uno(`select importar_pendientes_sap($1, '8A', $2) as r`, [JSON.stringify(filasSap), JSON.stringify({ 'OTRO INSPECTOR': U.gerE })])).r;
ok('importa 2, omite el duplicado y descarta la fila sin número', imp.importados === 2 && imp.omitidos === 1 && imp.invalidos === 1, JSON.stringify(imp));
imp = (await uno(`select importar_pendientes_sap($1, '8A') as r`, [JSON.stringify(filasSap)])).r;
ok('reimportar no duplica ni pisa lo cargado', imp.importados === 0 && imp.omitidos === 3, JSON.stringify(imp));
const p1 = await uno(`select * from v_pendientes where numero_sap = '4001'`);
ok('el pendiente se engancha a su ubicación, hereda el jefe y queda "asignado" con fecha',
  p1.ubicacion_nombre === 'Primaria 5' && p1.jefe_sitio_id === U.jefeE && p1.estado === 'asignado' && p1.fecha_asignacion !== null && p1.vencido === true,
  JSON.stringify({ u: p1.ubicacion_nombre, e: p1.estado, v: p1.vencido }));
const p2 = await uno(`select estado, tipo, jefe_sitio_id, fecha_resolucion from pendientes where numero_sap = '4002'`);
ok('una orden cerrada en SAP entra resuelta aunque tenga jefe asignado (la v1 la dejaba "asignado")',
  p2.estado === 'resuelto' && p2.tipo === 'obra' && p2.jefe_sitio_id === U.gerE && p2.fecha_resolucion !== null, JSON.stringify(p2));
await db.query(`update pendientes set estado = 'en_progreso', prioridad = 'alta' where id = $1`, [p1.id]);
const hp = await uno(`select estado_anterior, estado_nuevo, campos_modificados, usuario_nombre from pendiente_historial where pendiente_id = $1`, [p1.id]);
ok('cada cambio queda en el historial, con quién y qué cambió',
  hp.estado_anterior === 'asignado' && hp.estado_nuevo === 'en_progreso' && hp.campos_modificados.includes('prioridad') && hp.usuario_nombre === 'Usuario e2', JSON.stringify(hp));
await rechaza('el historial de pendientes no se carga a mano', `insert into pendiente_historial (pendiente_id, comentario) values ($1, 'x')`, /se registra solo/, [p1.id]);
await db.query(`select anotar_pendiente($1, 'Se pidió el material')`, [p1.id]);
ok('se puede dejar una nota en el historial', (await q(`select 1 from pendiente_historial where pendiente_id = $1 and comentario = 'Se pidió el material'`, [p1.id])).length === 1);
await rechaza('un número de SAP no se repite en el sector', `insert into pendientes (numero_sap, descripcion) values ('4001', 'otra')`, /duplicate key/);
await rechaza('jefe de sitio no borra pendientes', `delete from pendientes where id = $1`, /No tenés permiso/, [p1.id]);
await como(U.gerE);
await db.query(`delete from pendientes where numero_sap = '4002'`);
ok('gerencia sí borra, con su historial', (await q(`select 1 from pendientes where numero_sap = '4002'`)).length === 0);

titulo('7c. Emergencias');
await como(U.opE);
await rechaza('una emergencia no se inserta a mano', `insert into emergencias (codigo, titulo, tipo, ubicacion_id) values ('X', 'x', 'otro', $1)`, /Nueva emergencia/, [prim5.id]);
await rechaza('hay que elegir un establecimiento del sector', `select reportar_emergencia($1)`, /Elegí el establecimiento/, [JSON.stringify({ titulo: 'x', tipo: 'otro', ubicacion_id: ubiB.id })]);
const emgId = (await uno(`select reportar_emergencia($1) as id`, [JSON.stringify({ titulo: 'Pérdida de gas en cocina', tipo: 'rotura_gas', ubicacion_id: prim5.id, reportado_por: 'Portera' })])).id;
let emg = await uno(`select * from v_emergencias where id = $1`, [emgId]);
ok('cualquiera del sector reporta: nace activa, con código, a cargo del jefe del lugar',
  emg.estado === 'activa' && /^EMG-\d{6}$/.test(emg.codigo) && emg.jefe_sitio_id === U.jefeE && emg.ubicacion_nombre === 'Primaria 5', JSON.stringify({ e: emg.estado, c: emg.codigo }));
const otEmg = await uno(`select tipo, prioridad, estado, asignado_a, titulo from ordenes_trabajo where id = $1`, [emg.ot_id]);
ok('se crea en el mismo paso su orden de trabajo urgente, asignada al jefe',
  otEmg.tipo === 'emergencia' && otEmg.prioridad === 'urgente' && otEmg.estado === 'asignada' && otEmg.asignado_a === U.jefeE && otEmg.titulo.startsWith('[EMERGENCIA]'), JSON.stringify(otEmg));
await rechaza('operario no atiende la emergencia', `update emergencias set estado = 'en_atencion' where id = $1`, /Solo gerencia o un jefe/, [emgId]);
await como(U.jefeE);
emg = await uno(`update emergencias set estado = 'en_atencion' where id = $1 returning estado, fecha_atencion, minutos_atencion`, [emgId]);
ok('atender sella la hora y el tiempo de respuesta', emg.estado === 'en_atencion' && emg.fecha_atencion !== null && emg.minutos_atencion !== null);
emg = await uno(`update emergencias set estado = 'resuelta', notas_resolucion = 'Se cambió el flexible' where id = $1 returning estado, minutos_resolucion, ot_id`, [emgId]);
ok('resolver sella el tiempo de resolución', emg.estado === 'resuelta' && emg.minutos_resolucion !== null);
ok('al resolver la emergencia se completa su orden de trabajo', (await uno(`select estado from ordenes_trabajo where id = $1`, [emg.ot_id])).estado === 'completada');
await rechaza('una emergencia resuelta no se modifica', `update emergencias set titulo = 'x' where id = $1`, /ya está resuelta/, [emgId]);
await como(U.opE);
for (let i = 0; i < 2; i++) await db.query(`select reportar_emergencia($1)`, [JSON.stringify({ titulo: `Corte ${i}`, tipo: 'corte_electrico', ubicacion_id: prim5.id })]);
const patron = await q(`select * from v_patrones_emergencia`);
ok('3 emergencias en 30 días en el mismo lugar se marcan como patrón', patron.length === 1 && patron[0].cantidad === 3 && patron[0].ubicacion_nombre === 'Primaria 5', JSON.stringify(patron));
await como(U.opB);
ok('las emergencias de escuela no existen para bapro', (await q(`select 1 from emergencias`)).length === 0);

titulo('7d. Rutinas');
const mesActual = new Date().getMonth() + 1;
const mesFuera = (mesActual % 12) + 1;
await como(U.jefeE);
await rechaza('jefe de sitio no edita el catálogo', `insert into rutinas_catalogo (rubro_nombre, objeto, ciclo) values ('x', 'y', 'Mensual')`, /No tenés permiso/);
await como(U.gerE);
const rSem = await uno(`insert into rutinas_catalogo (rubro_nombre, objeto, ciclo, plazo_dias, carga_sismesc) values ('Ascensores', 'Control semanal', 'Semanal', 5, true) returning id, frecuencia_dias`);
ok('la frecuencia sale del ciclo (Semanal = 7 días)', rSem.frecuencia_dias === 7);
const rEst = await uno(`insert into rutinas_catalogo (rubro_nombre, objeto, ciclo, estacionalidad, requiere_informe_matriculado)
  values ('Calefacción', 'Puesta en marcha', 'Anual', $1, true) returning id, frecuencia_dias`, [`{${mesFuera}}`]);
let sinc = (await uno(`select sincronizar_rutinas() as r`)).r;
const ubicActivas = (await uno(`select count(*)::int as n from ubicaciones where activa`)).n;
ok('sincronizar asigna cada rutina a cada ubicación activa', sinc.asignaciones_creadas === ubicActivas * 2 && sinc.rutinas === 2, JSON.stringify(sinc));
sinc = (await uno(`select sincronizar_rutinas() as r`)).r;
ok('sincronizar de nuevo no duplica asignaciones', sinc.asignaciones_creadas === 0);
await como(U.jefeE);
let proc = (await uno(`select procesar_rutinas() as r`)).r;
ok('procesar genera una orden por ubicación para la rutina en temporada (en la v1 no generaba ninguna)', proc.ordenes_creadas === ubicActivas, JSON.stringify(proc));
proc = (await uno(`select procesar_rutinas() as r`)).r;
ok('procesar de nuevo no duplica órdenes', proc.ordenes_creadas === 0 && proc.ordenes_vencidas === 0, JSON.stringify(proc));
const fuera = await uno(`select extract(month from proxima_ejecucion)::int as mes, proxima_ejecucion > current_date as futuro
  from rutinas_ubicacion where rutina_id = $1 limit 1`, [rEst.id]);
ok('una rutina fuera de temporada espera al primer mes que corresponde', fuera.mes === mesFuera && fuera.futuro, JSON.stringify(fuera));
const ordR = await uno(`select * from v_ordenes_rutina where ubicacion_nombre = 'Primaria 5'`);
ok('la orden de rutina trae plazo, semáforo y datos del catálogo',
  ordR.estado === 'pendiente' && ordR.semaforo === 'verde' && ordR.dias_restantes === 5 && ordR.objeto === 'Control semanal' && ordR.carga_sismesc === true, JSON.stringify({ e: ordR.estado, s: ordR.semaforo, d: ordR.dias_restantes }));
await rechaza('no se da por ejecutada sin el comprobante de SISMESC', `update ordenes_rutina set estado = 'ejecutada' where id = $1`, /SISMESC/, [ordR.id]);
const otRut = (await uno(`select generar_ot_rutinas($1) as id`, [prim5.id])).id;
const otR = await uno(`select titulo, tipo, asignado_a, jsonb_array_length(checklist) as tareas from ordenes_trabajo where id = $1`, [otRut]);
ok('se genera una orden de trabajo con las rutinas como checklist, asignada al jefe del lugar',
  otR.titulo.startsWith('[Rutinas] Primaria 5') && otR.tipo === 'mantenimiento_preventivo' && otR.asignado_a === U.jefeE && otR.tareas === 1, JSON.stringify(otR));
ok('la rutina pasa a "en proceso" y queda enganchada a la orden', (await uno(`select estado, ot_id from ordenes_rutina where id = $1`, [ordR.id])).estado === 'en_proceso');
await rechaza('no se genera otra orden si ya no quedan rutinas sin orden', `select generar_ot_rutinas($1)`, /no tiene rutinas pendientes/, [prim5.id]);
await db.query(`update ordenes_rutina set estado = 'ejecutada', adjuntos = '[{"nombre":"sismesc.pdf","url":"https://x/s.pdf"}]' where id = $1`, [ordR.id]);
const asig = await uno(`select ultima_ejecucion = current_date as hoy, proxima_ejecucion = current_date + 7 as en7 from rutinas_ubicacion where id = $1`, [ordR.asignacion_id]);
ok('al ejecutarla se reprograma según su ciclo real (7 días, no siempre 30)', asig.hoy && asig.en7, JSON.stringify(asig));
await rechaza('una rutina ejecutada no se vuelve a tocar', `update ordenes_rutina set observaciones = 'x' where id = $1`, /ya fue ejecutada/, [ordR.id]);
await servicio();
await db.query(`update ordenes_rutina set fecha_limite = current_date - 2 where ubicacion_id = (select id from ubicaciones where nombre = 'Jardín 5')`);
await como(U.jefeE);
proc = (await uno(`select procesar_rutinas() as r`)).r;
ok('lo que pasó su fecha límite se marca vencido', proc.ordenes_vencidas === 1, JSON.stringify(proc));
ok('y se ve en rojo', (await uno(`select semaforo from v_ordenes_rutina where ubicacion_nombre = 'Jardín 5'`)).semaforo === 'rojo');
await como(U.opE);
await rechaza('operario no procesa rutinas', `select procesar_rutinas()`, /Solo gerencia o un jefe/);

titulo('7e. Calendario');
await como(U.gerE);
const cal = await q(`select tipo, count(*)::int as n from v_calendario group by tipo order by tipo`);
const tiposCal = Object.fromEntries(cal.map((c) => [c.tipo, c.n]));
ok('el calendario junta órdenes, mantenimientos de activos y rutinas por vencer',
  tiposCal.ot > 0 && tiposCal.mantenimiento > 0 && tiposCal.rutina > 0, JSON.stringify(tiposCal));
await como(U.opB);
ok('el calendario de bapro no trae nada de escuela', (await q(`select 1 from v_calendario where sector_id = $1`, [escuela])).length === 0);

titulo('7f. Calefacción');
const filasCal = [
  { escuela: 'Primaria 5', zona: '8A', jefe: 'Texto Planilla', tipo_equipo: 'estufas', total: 10, funciona: 4, no_funciona: 6 },
  { escuela: 'primaria 5', zona: '8A', tipo_equipo: 'estufas', total: 10, funciona: 4 },
  { escuela: 'Primaria 5', zona: '8A', tipo_equipo: 'calderas', total: 2, funciona: 2 },
  { escuela: 'Escuela Fuera Del Padrón', zona: '10A', jefe: 'Jefe De Planilla', tipo_equipo: 'radiadores', total: 8, no_funciona: 2 },
  { escuela: 'Sin equipos', tipo_equipo: 'vrv', total: 0, funciona: 0 },
];
await como(U.jefeE);
await rechaza('jefe de sitio no importa el relevamiento', `select importar_calefaccion($1, 'Mayo 2026')`, /Solo gerencia/, [JSON.stringify(filasCal)]);
await como(U.gerE);
imp = (await uno(`select importar_calefaccion($1, 'Mayo 2026') as r`, [JSON.stringify(filasCal)])).r;
ok('importa 3 registros: suma las filas repetidas y descarta las vacías', imp.importados === 3, JSON.stringify(imp));
const est = await uno(`select * from equipamiento_calefaccion where tipo_equipo = 'estufas'`);
ok('calcula fallas, porcentaje y estado (8 de 20 = 40 %, crítico) y engancha la escuela y su jefe',
  est.cantidad_total === 20 && est.cantidad_funciona === 8 && est.cantidad_no_funciona === 12 && est.porcentaje_operativo === 40 && est.estado === 'critico'
  && est.ubicacion_id === prim5.id && est.jefe_sitio_id === U.jefeE, JSON.stringify({ t: est.cantidad_total, p: est.porcentaje_operativo, e: est.estado }));
const rad = await uno(`select cantidad_funciona, estado, jefe_sitio_nombre, ubicacion_id from equipamiento_calefaccion where tipo_equipo = 'radiadores'`);
ok('si la planilla trae solo "no funciona", deduce cuántos funcionan (6 de 8 = 75 %, normal)',
  rad.cantidad_funciona === 6 && rad.estado === 'normal' && rad.jefe_sitio_nombre === 'Jefe De Planilla' && rad.ubicacion_id === null, JSON.stringify(rad));
imp = (await uno(`select importar_calefaccion($1, 'Mayo 2026') as r`, [JSON.stringify(filasCal)])).r;
ok('reimportar el mismo período lo reemplaza, no lo suma', (await uno(`select count(*)::int as n from equipamiento_calefaccion`)).n === 3);
await db.query(`update equipamiento_calefaccion set cantidad_funciona = 19 where tipo_equipo = 'estufas'`);
ok('al editar, el estado se recalcula solo (19 de 20 = óptimo)', (await uno(`select estado from equipamiento_calefaccion where tipo_equipo = 'estufas'`)).estado === 'optimo');

titulo('7g. Inspección de establecimientos');
await como(U.opE);
await rechaza('operario no carga inspecciones', `insert into inspecciones (titulo, establecimiento) values ('x', 'Primaria 5')`, /Tu rol no puede/);
await como(U.jefeE);
const insp = await uno(`insert into inspecciones (titulo, establecimiento, ubicacion_id, secciones)
  values ('Inspección Primaria 5', 'Primaria 5', $1, '[{"id":"sec_0","nombre":"Fachada y accesos","completada":false}]') returning id, estado, inspector_id`, [prim5.id]);
ok('jefe de sitio inicia una inspección: queda en progreso y a su nombre', insp.estado === 'en_progreso' && insp.inspector_id === U.jefeE);
await como(U.opB);
ok('las inspecciones de escuela no existen para bapro', (await q(`select 1 from inspecciones`)).length === 0);
await como(U.jefeE);
await db.query(`delete from inspecciones where id = $1`, [insp.id]);
ok('quien la hizo puede borrarla', (await q(`select 1 from inspecciones where id = $1`, [insp.id])).length === 0);

titulo('7h. Corrección: borrar un activo con historial');
await como(U.gerE);
const actTmp = await uno(`insert into activos (nombre) values ('Activo descartable') returning id`);
await db.query(`delete from activos where id = $1`, [actTmp.id]);
ok('el activo se borra junto con su historial (antes quedaba trabado)', (await q(`select 1 from activos where id = $1`, [actTmp.id])).length === 0);

// ================================================================ 8. INFORME CON IA EN SEGUNDO PLANO
titulo('8. Informe de inspección: redacción con IA pendiente');
await como(U.jefeE);
const inspIA = await uno(`insert into inspecciones (titulo, establecimiento) values ('Inspección con IA', 'Primaria 5') returning id, informe_ia_pendiente, informe_ia_intentos`);
ok('una inspección nueva no tiene nada pendiente de IA', inspIA.informe_ia_pendiente === false && inspIA.informe_ia_intentos === 0);
await db.query(`update inspecciones set informe_generado = 'Informe por plantilla', informe_origen = 'plantilla', estado = 'completado',
  informe_ia_pendiente = true, informe_ia_proximo = now() - interval '1 minute', informe_ia_token = gen_random_uuid() where id = $1`, [inspIA.id]);
await rechaza('un usuario no puede tomar los informes pendientes', `select * from tomar_informes_pendientes()`, /permission denied|interna del sistema/);
await rechaza('un usuario no puede programar la tarea periódica', `select programar_reintento_informes('https://abcd.supabase.co')`, /permission denied|interna del sistema/);
await rechaza('el origen del informe solo puede ser ia o plantilla', `update inspecciones set informe_origen = 'otro' where id = $1`, /informe_origen/, [inspIA.id]);

await servicio();
await db.exec(`set role service_role`);
let tomados = await q(`select id, informe_ia_intentos, informe_ia_proximo > now() + interval '9 minutes' and informe_ia_proximo < now() + interval '11 minutes' as en_10 from tomar_informes_pendientes()`);
ok('el servicio toma el informe pendiente, cuenta el intento y agenda el próximo a 10 minutos',
  tomados.length === 1 && tomados[0].id === inspIA.id && tomados[0].informe_ia_intentos === 1 && tomados[0].en_10 === true, JSON.stringify(tomados));
ok('si todavía no le toca, no lo vuelve a tomar', (await q(`select 1 from tomar_informes_pendientes()`)).length === 0);
await db.query(`update inspecciones set informe_ia_proximo = now() - interval '1 minute' where id = $1`, [inspIA.id]);
tomados = await q(`select informe_ia_proximo > now() + interval '19 minutes' and informe_ia_proximo < now() + interval '21 minutes' as en_20 from tomar_informes_pendientes()`);
ok('el segundo intento agenda el próximo a 20 minutos (cada vez más espaciado)', tomados.length === 1 && tomados[0].en_20 === true, JSON.stringify(tomados));
await db.query(`update inspecciones set informe_ia_intentos = 8, informe_ia_proximo = now() - interval '1 minute' where id = $1`, [inspIA.id]);
tomados = await q(`select informe_ia_proximo > now() + interval '359 minutes' and informe_ia_proximo < now() + interval '361 minutes' as en_6h from tomar_informes_pendientes()`);
ok('el espaciado tiene tope de 6 horas', tomados.length === 1 && tomados[0].en_6h === true, JSON.stringify(tomados));
await db.query(`update inspecciones set informe_ia_intentos = 12, informe_ia_proximo = now() - interval '1 minute' where id = $1`, [inspIA.id]);
ok('a los 12 intentos deja de insistir', (await q(`select 1 from tomar_informes_pendientes()`)).length === 0);
const agotada = await uno(`select informe_ia_pendiente, informe_generado, informe_ia_motivo from inspecciones where id = $1`, [inspIA.id]);
ok('y el informe queda con la plantilla, sin pendiente', agotada.informe_ia_pendiente === false && agotada.informe_generado === 'Informe por plantilla' && /12 veces/.test(agotada.informe_ia_motivo));
await rechaza('programar la tarea exige una dirección de proyecto válida', `select programar_reintento_informes('http://otro-sitio.com')`, /no es válida/);
await rechaza('y las extensiones de tareas periódicas', `select programar_reintento_informes('https://abcd.supabase.co')`, /Faltan las extensiones/);

// ================================================================ 9. GENTE Y CAMPO (tanda 2)
titulo('9a. Empleados');
await como(U.opE);
await rechaza('operario no da de alta empleados', `insert into empleados (nombre) values ('X')`, /No tenés permiso/);
await como(U.gerE);
const emp1 = await uno(`insert into empleados (nombre, puesto, email, jefe_sitio_id) values ('  Juan   Pérez ', 'Oficial', ' E3@DH1.test ', $1) returning *`, [U.jefeE]);
ok('el alta ordena nombre y email, sella el sector y engancha al usuario que tiene ese email',
  emp1.nombre === 'Juan Pérez' && emp1.email === 'e3@dh1.test' && emp1.perfil_id === U.opE && emp1.sector_id === escuela, JSON.stringify(emp1));
const emp2 = await uno(`insert into empleados (nombre, puesto, jefe_sitio_id) values ('Pedro Sin Usuario', 'Ayudante', $1) returning id, perfil_id`, [U.jefeE]);
ok('un empleado sin email queda sin usuario', emp2.perfil_id === null);
await rechaza('dos fichas vigentes no comparten email', `insert into empleados (nombre, email) values ('Otro', 'e3@dh1.test')`, /duplicate key/);
await rechaza('el jefe de sitio tiene que ser del sector', `insert into empleados (nombre, jefe_sitio_id) values ('X', $1)`, /jefe de sitio tiene que ser/, [U.gerB]);
const emp3 = await uno(`insert into empleados (nombre, email) values ('Nueva Persona', 'nueva@dh1.test') returning id, perfil_id`);
ok('una ficha con email sin usuario espera sin vincular', emp3.perfil_id === null);
await servicio();
const uNueva = '00000000-0000-0000-0000-0000000000e9';
await db.query(`insert into auth.users (id, email) values ($1, 'nueva@dh1.test')`, [uNueva]);
await db.query(`insert into perfiles (id, email, nombre, rol, sector_id) values ($1, 'Nueva@dh1.test', 'Nueva Persona', 'operario', $2)`, [uNueva, escuela]);
ok('al dar de alta el usuario, su ficha se engancha sola', (await uno(`select perfil_id from empleados where id = $1`, [emp3.id])).perfil_id === uNueva);
await como(U.opE);
await rechaza('vincular en lote es de gerencia', `select vincular_empleados()`, /Solo gerencia/);

await como(U.gerE);
await db.query(`insert into empleados_reservado (empleado_id, dni, costo_hora, notas) values ($1, '30111222', 5000, 'Nota interna')`, [emp1.id]);
let ficha = await uno(`select dni, costo_hora, notas from v_empleados where id = $1`, [emp1.id]);
ok('gerencia lee los datos reservados', ficha.dni === '30111222' && Number(ficha.costo_hora) === 5000 && ficha.notas === 'Nota interna');
await como(U.jefeE);
ficha = await uno(`select nombre, dni, costo_hora, notas from v_empleados where id = $1`, [emp1.id]);
ok('un jefe de sitio ve la ficha pero no los datos reservados', ficha.nombre === 'Juan Pérez' && ficha.dni === null && ficha.costo_hora === null && ficha.notas === null, JSON.stringify(ficha));
ok('ni leyendo la tabla directamente', (await q(`select 1 from empleados_reservado`)).length === 0);
await rechaza('y tampoco puede escribirlos', `insert into empleados_reservado (empleado_id, dni) values ($1, '1')`, /row-level security/, [emp2.id]);
await como(U.opE);
ok('el propio empleado sí ve sus datos reservados', (await uno(`select dni from v_empleados where id = $1`, [emp1.id])).dni === '30111222');
await db.query(`update empleados_reservado set costo_hora = 99999 where empleado_id = $1`, [emp1.id]);
ok('pero no los cambia', Number((await uno(`select costo_hora from empleados_reservado where empleado_id = $1`, [emp1.id])).costo_hora) === 5000);
await como(U.opE2);
ok('otro operario ve los nombres pero no lo reservado', (await uno(`select dni from v_empleados where id = $1`, [emp1.id])).dni === null);
await como(U.opB);
ok('los empleados de escuela no existen para bapro', (await q(`select 1 from empleados`)).length === 0);
await como(U.gerE);
ok('el buscador encuentra empleados', (await q(`select * from buscar('empleados', 'juan')`)).length === 1);

titulo('9b. Personal asignado y tablets de cuadrilla');
await como(U.opE);
await rechaza('operario no asigna personal a un lugar', `insert into ubicacion_empleados (ubicacion_id, empleado_id) values ($1, $2)`, /No tenés permiso/, [prim5.id, emp1.id]);
await como(U.jefeE);
await db.query(`insert into ubicacion_empleados (ubicacion_id, empleado_id) values ($1, $2), ($1, $3)`, [prim5.id, emp1.id, emp2.id]);
ok('el jefe de sitio asigna personal a su lugar', (await uno(`select empleados_asignados from v_mapa_ubicaciones where id = $1`, [prim5.id])).empleados_asignados === 2);
await db.query(`delete from ubicacion_empleados where ubicacion_id = $1 and empleado_id = $2`, [prim5.id, emp2.id]);
ok('y lo desasigna', (await q(`select 1 from ubicacion_empleados where ubicacion_id = $1`, [prim5.id])).length === 1);
await rechaza('jefe de sitio no crea tablets', `insert into tablets (nombre, jefe_sitio_id) values ('T', $1)`, /No tenés permiso/, [U.jefeE]);
await como(U.gerE);
await rechaza('la tablet no usa el usuario del jefe', `insert into tablets (nombre, jefe_sitio_id, perfil_id) values ('T2', $1, $1)`, /usuario propio/, [U.jefeE]);
const tablet = await uno(`insert into tablets (nombre, jefe_sitio_id, perfil_id) values ('Tablet 1', $1, $2) returning id, ultima_actividad`, [U.jefeE, U.opE2]);
await como(U.opE2);
const miTablet = (await uno(`select mi_tablet() as r`)).r;
ok('el usuario de la tablet sabe de qué jefe es', miTablet?.nombre === 'Tablet 1' && miTablet.jefe_sitio_id === U.jefeE && miTablet.jefe_sitio_nombre === 'Usuario e2', JSON.stringify(miTablet));
ok('y queda anotada su actividad', (await uno(`select ultima_actividad from tablets where id = $1`, [tablet.id])).ultima_actividad !== null);
await como(U.opE);
ok('un usuario común no es una tablet', (await uno(`select mi_tablet() as r`)).r === null);

titulo('9c. Fichaje');
await como(U.gerE);
await db.query(`update ubicaciones set lat = -34.6000, lng = -58.4000 where id = $1`, [prim5.id]);
const qrPrim5 = (await uno(`select qr_token from ubicaciones where id = $1`, [prim5.id])).qr_token;
const qrBapro = await (async () => { await como(U.gerB); const t = (await uno(`select qr_token from ubicaciones where id = $1`, [ubiB.id])).qr_token; return t; })();
await como(U.opE);
await rechaza('un fichaje no se inserta a mano', `insert into fichajes (empleado_id, tipo) values ($1, 'entrada')`, /botón Fichar/, [emp1.id]);
let fi = (await uno(`select fichar(p_tipo => 'entrada', p_momento => now() - interval '8 hours', p_qr => $1, p_lat => -34.6001, p_lng => -58.4001) as r`, [qrPrim5])).r;
ok('fichar con el QR del lugar: entrada, en el lugar, a pocos metros',
  fi.tipo === 'entrada' && fi.empleado_id === emp1.id && fi.ubicacion_id === prim5.id && fi.distancia_m < 50 && fi.lejos === false, JSON.stringify(fi));
fi = (await uno(`select fichar() as r`)).r;
ok('sin indicar el tipo, después de una entrada viene la salida', fi.tipo === 'salida' && fi.repetido === false, JSON.stringify(fi));
const repetido = (await uno(`select fichar() as r`)).r;
ok('un doble toque no deja dos marcas', repetido.repetido === true && repetido.id === fi.id && (await uno(`select count(*)::int as n from fichajes where empleado_id = $1`, [emp1.id])).n === 2);
const jornada = await uno(`select horas, ubicacion_nombre, salida from v_jornadas where empleado_id = $1`, [emp1.id]);
ok('la jornada junta la entrada con su salida y calcula las horas', Math.abs(Number(jornada.horas) - 8) < 0.05 && jornada.ubicacion_nombre === 'Primaria 5' && jornada.salida !== null, JSON.stringify(jornada));
const idTel = '11111111-1111-4111-8111-111111111111';
fi = (await uno(`select fichar(p_tipo => 'entrada', p_id => $1, p_lat => -34.6002, p_lng => -58.4002, p_momento => now() - interval '30 minutes') as r`, [idTel])).r;
ok('sin QR, con posición: toma el lugar más cercano dentro del radio', fi.ubicacion_id === prim5.id && fi.lejos === false, JSON.stringify(fi));
const reenvio = (await uno(`select fichar(p_tipo => 'entrada', p_id => $1) as r`, [idTel])).r;
ok('reenviar el mismo fichaje (cola sin señal) no lo duplica', reenvio.repetido === true && reenvio.id === idTel && (await uno(`select count(*)::int as n from fichajes where id = $1`, [idTel])).n === 1);
fi = (await uno(`select fichar(p_tipo => 'salida', p_qr => $1, p_lat => -34.7000, p_lng => -58.4000, p_momento => now() - interval '20 minutes') as r`, [qrPrim5])).r;
ok('fichar lejos del lugar queda registrado y marcado como lejos', fi.lejos === true && fi.distancia_m > 10000, JSON.stringify(fi));
fi = (await uno(`select fichar(p_tipo => 'entrada', p_lat => -34.9000, p_lng => -58.9000, p_momento => now() - interval '10 minutes') as r`)).r;
ok('lejos de todo y sin QR: se registra sin lugar', fi.ubicacion_id === null && fi.lejos === false, JSON.stringify(fi));
await rechaza('el QR de otro sector no sirve para fichar', `select fichar(p_tipo => 'entrada', p_qr => $1)`, /no es de un lugar de tu sector/, [qrBapro]);
await rechaza('no se ficha a futuro', `select fichar(p_momento => now() + interval '1 hour')`, /no puede ser futura/);
await rechaza('ni con más de 3 días de atraso', `select fichar(p_momento => now() - interval '5 days')`, /más de 3 días/);
await rechaza('un operario no ficha a otro', `select fichar(p_empleado => $1)`, /Solo podés fichar por vos/, [emp2.id]);
ok('un operario ve solo sus fichajes', (await q(`select 1 from fichajes where empleado_id <> $1`, [emp1.id])).length === 0);
await rechaza('y no los borra', `delete from fichajes where empleado_id = $1`, /Solo gerencia/, [emp1.id]);

await como(U.opE2);
fi = (await uno(`select fichar(p_empleado => $1, p_tipo => 'entrada') as r`, [emp2.id])).r;
ok('la tablet ficha a la gente de su cuadrilla', fi.tipo === 'entrada' && (await uno(`select origen, registrado_por from fichajes where id = $1`, [fi.id])).origen === 'tablet', JSON.stringify(fi));
ok('y ve los fichajes de su cuadrilla', (await q(`select 1 from fichajes where empleado_id = $1`, [emp1.id])).length > 0);
await rechaza('pero no a alguien de otra cuadrilla', `select fichar(p_empleado => $1)`, /Solo podés fichar por vos/, [emp3.id]);
await como(U.jefeE);
fi = (await uno(`select fichar() as r`)).r;
const fichaJefe = await uno(`select nombre, perfil_id from empleados where perfil_id = $1`, [U.jefeE]);
ok('quien ficha sin tener ficha de empleado recibe una mínima', fi.tipo === 'entrada' && fichaJefe?.nombre === 'Usuario e2', JSON.stringify(fichaJefe));
fi = (await uno(`select fichar(p_empleado => $1, p_tipo => 'salida', p_momento => now() - interval '0 minutes') as r`, [emp2.id])).r;
ok('un jefe de sitio ficha a otra persona y queda anotado quién lo cargó', (await uno(`select origen, registrado_por from fichajes where id = $1`, [fi.id])).origen === 'jefe');
ok('el jefe de sitio ve los fichajes del sector', (await uno(`select count(distinct empleado_id)::int as n from fichajes`)).n >= 3);
await db.query(`update fichajes set tipo = 'entrada' where id = $1`, [fi.id]);
ok('un fichaje no se modifica', (await uno(`select tipo from fichajes where id = $1`, [fi.id])).tipo === 'salida');
await como(U.gerE);
fi = (await uno(`select fichar(p_empleado => $1, p_tipo => 'entrada', p_momento => now() - interval '5 days', p_nota => 'Carga atrasada') as r`, [emp2.id])).r;
ok('gerencia carga un fichaje atrasado', (await uno(`select origen, notas from fichajes where id = $1`, [fi.id])).origen === 'gerencia');
await db.query(`delete from fichajes where id = $1`, [fi.id]);
ok('y gerencia puede borrar un fichaje', (await q(`select 1 from fichajes where id = $1`, [fi.id])).length === 0);
const vista = await uno(`select ultimo_fichaje_tipo, ultimo_fichaje_lugar, lugares_a_cargo from v_empleados where id = $1`, [emp1.id]);
ok('la ficha muestra el último fichaje', vista.ultimo_fichaje_tipo === 'salida', JSON.stringify(vista));
ok('y cuántos lugares tiene a cargo un jefe', (await uno(`select lugares_a_cargo from v_empleados where perfil_id = $1`, [U.jefeE])).lugares_a_cargo >= 1);
await db.query(`update empleados set estado = 'inactivo' where id = $1`, [emp2.id]);
await rechaza('un empleado dado de baja no ficha', `select fichar(p_empleado => $1)`, /dado de baja/, [emp2.id]);
await como(U.opB);
ok('los fichajes de escuela no existen para bapro', (await q(`select 1 from fichajes`)).length === 0);

titulo('9d. Horas de una orden y mapa');
await como(U.opE);
const hora = await uno(`insert into ot_horas (ot_id, empleado_id, horas, tipo) values ($1, $2, 2.5, 'extra') returning id, empleado_nombre, sector_id`, [otE.id, emp1.id]);
ok('cargar horas a una orden: toma el nombre de la ficha y sella el sector', hora.empleado_nombre === 'Juan Pérez' && hora.sector_id === escuela);
await rechaza('las horas necesitan a quién', `insert into ot_horas (ot_id, horas) values ($1, 1)`, /Indicá quién/, [otE.id]);
await rechaza('y una cantidad válida', `insert into ot_horas (ot_id, empleado_nombre, horas) values ($1, 'Contratista', 0)`, /check constraint|violates check/, [otE.id]);
await db.query(`insert into ot_horas (ot_id, empleado_nombre, horas) values ($1, 'Contratista SRL', 3)`, [otE.id]);
ok('el costo de sus propias horas lo ve el empleado', Number((await uno(`select costo from v_ot_horas where id = $1`, [hora.id])).costo) === 12500);
await como(U.opE2);
ok('otro operario ve las horas pero no el costo', (await uno(`select horas, costo from v_ot_horas where id = $1`, [hora.id])).costo === null);
await rechaza('y no toca horas que cargó otro', `update ot_horas set horas = 9 where id = $1`, /cargó otra persona/, [hora.id]);
await como(U.jefeE);
await db.query(`update ot_horas set horas = 3 where id = $1`, [hora.id]);
const otConHoras = await uno(`select horas_cargadas, jefe_sitio_id, ubicacion_lat from v_ordenes where id = $1`, [otE.id]);
ok('el jefe de sitio las corrige, y la orden suma sus horas', Number(otConHoras.horas_cargadas) === 6, JSON.stringify(otConHoras));
await como(U.gerE);
ok('gerencia ve el costo', Number((await uno(`select costo from v_ot_horas where id = $1`, [hora.id])).costo) === 15000);
const otTablet = await uno(`select jefe_sitio_id, ubicacion_lat from v_ordenes where ubicacion_id = $1 limit 1`, [prim5.id]);
ok('cada orden trae el jefe y la posición de su lugar (tablet y mapa)', otTablet.jefe_sitio_id === U.jefeE && otTablet.ubicacion_lat === -34.6, JSON.stringify(otTablet));
const enMapa = await uno(`select semaforo, emergencias_activas, pendientes_abiertos, domicilio from v_mapa_ubicaciones where id = $1`, [prim5.id]);
ok('el mapa marca en rojo el lugar con una emergencia abierta', enMapa.semaforo === 'rojo' && enMapa.emergencias_activas >= 1, JSON.stringify(enMapa));
ok('y en verde el que no tiene nada pendiente', (await uno(`select semaforo from v_mapa_ubicaciones where id = $1`, [ubiE.id])).semaforo === 'verde');
const dist = await uno(`select distancia_m(0, 0, 1, 0) as un_grado, distancia_m(-34.6, -58.4, -34.6, -58.4) as cero`);
ok('la distancia entre dos puntos se calcula bien (1° de latitud ≈ 111 km)', dist.un_grado > 111000 && dist.un_grado < 111400 && dist.cero === 0, JSON.stringify(dist));

// ================================================================ 10. OBRAS (tanda 3)
titulo('10a. Proveedores');
await como(U.jefeE);
await rechaza('el directorio de proveedores lo maneja gerencia', `insert into proveedores (nombre) values ('Corralón')`, /No tenés permiso/);
await como(U.gerE);
const prov = await uno(`insert into proveedores (nombre, rubro, cuit) values ('Corralón Sur', 'materiales', '30-1') returning id, sector_id`);
ok('gerencia da de alta un proveedor en su sector', prov.sector_id === escuela);
await rechaza('un proveedor necesita nombre', `insert into proveedores (nombre) values ('  ')`, /check constraint|violates check/);

titulo('10b. Obras y planilla de SAP');
await como(U.opE);
await rechaza('un operario no crea obras', `insert into obras (titulo) values ('x')`, /No tenés permiso/);
await como(U.jefeE);
const obra1 = await uno(`insert into obras (titulo, codigo_sap, ubicacion_id, monto_base, fecha_inicio, fecha_fin, avance, proveedor_id)
  values ('  Cambio   de cubierta ', '4500001', $1, 1000000, current_date - 90, current_date + 10, 10, $2)
  returning id, titulo, establecimiento`, [ubiE.id, prov.id]);
ok('una obra toma el establecimiento de su lugar y limpia el título', obra1.establecimiento === 'Escuela 21' && obra1.titulo === 'Cambio de cubierta', JSON.stringify(obra1));
await rechaza('el código SAP no se repite en el sector', `insert into obras (titulo, codigo_sap) values ('Otra', '4500001')`, /obras_codigo_idx|duplicate key/);
let vo = await uno(`select alerta_plazo, avance_esperado, proveedor_nombre from v_obras where id = $1`, [obra1.id]);
ok('una obra atrasada y por vencer marca peligro de plazo', vo.alerta_plazo === 'peligro' && vo.proveedor_nombre === 'Corralón Sur', JSON.stringify(vo));
const planilla = await uno(`select importar_planilla_obras($1) as r`, [JSON.stringify([
  { codigo_sap: '4500001', titulo: 'Cambio de cubierta (SAP)', estado_sap: 'AEJE', avance: 30 },
  { codigo_sap: '4500002', titulo: 'Pintura general', establecimiento: 'Escuela 21', monto_base: 500000, detalle: 'CERTIFICADO', jefe: 'usuario E2' },
  { titulo: 'Rampa de acceso', monto_base: 90000 },
  { titulo: '   ' },
])]);
ok('la planilla crea 2, actualiza 1 y omite la fila sin título', planilla.r.nuevas === 2 && planilla.r.actualizadas === 1 && planilla.r.omitidas === 1, JSON.stringify(planilla.r));
vo = await uno(`select titulo, estado, avance, monto_base from obras where id = $1`, [obra1.id]);
ok('reimportar actualiza por código SAP: título, estado y avance, sin borrar el monto',
  vo.titulo === 'Cambio de cubierta (SAP)' && vo.estado === 'en_progreso' && Number(vo.avance) === 30 && Number(vo.monto_base) === 1000000, JSON.stringify(vo));
const pintura = await uno(`select id, estado, jefe_sitio_id, ubicacion_id from obras where codigo_sap = '4500002'`);
ok('estado por el detalle (CERTIFICADO → completado), jefe y lugar enganchados por nombre',
  pintura.estado === 'completado' && pintura.jefe_sitio_id === U.jefeE && pintura.ubicacion_id === ubiE.id, JSON.stringify(pintura));
await db.query(`select importar_planilla_obras($1)`, [JSON.stringify([{ titulo: 'rampa  de ACCESO', monto_base: 95000 }])]);
ok('sin código SAP, la clave es el título normalizado (no duplica)',
  (await q(`select monto_base from obras where titulo ilike 'rampa%'`)).map((r) => Number(r.monto_base)).join() === '95000');
const otObra = await uno(`insert into ordenes_trabajo (titulo, ubicacion_id, obra_id) values ('Replanteo', $1, $2) returning id`, [ubiE.id, obra1.id]);
ok('una orden se cuelga de una obra y la obra cuenta sus órdenes',
  (await uno(`select obra_titulo from v_ordenes where id = $1`, [otObra.id])).obra_titulo === 'Cambio de cubierta (SAP)'
  && (await uno(`select ots_abiertas from v_obras where id = $1`, [obra1.id])).ots_abiertas === 1);
ok('la búsqueda remota encuentra obras por código', (await q(`select etiqueta from buscar('obras', '45000')`)).length === 2);
await rechaza('el jefe de sitio no borra obras', `delete from obras where id = $1`, /No tenés permiso/, [pintura.id]);
await como(U.gerB);
ok('las obras de escuela no existen para bapro', (await q(`select 1 from obras`)).length === 0);

titulo('10c. Cobro de obras por ciclo');
await como(U.opE);
await rechaza('sin ciclo abierto, un operario no lo abre', `select sumar_obra_al_ciclo($1)`, /no hay un ciclo de cobro abierto|Lo abre gerencia/, [obra1.id]);
await como(U.jefeE);
const cob1 = (await uno(`select sumar_obra_al_ciclo($1) as id`, [obra1.id])).id;
ok('sumar una obra abre el ciclo del mes y copia monto y avance',
  Number((await uno(`select monto_a_cobrar, avance from obra_cobros where id = $1`, [cob1])).monto_a_cobrar) === 1000000);
ok('sumarla de nuevo no duplica', (await uno(`select sumar_obra_al_ciclo($1) as id`, [obra1.id])).id === cob1);
await rechaza('observada sin motivo', `update obra_cobros set estado_cobro = 'observado' where id = $1`, /escribí el motivo/, [cob1]);
await db.query(`update obra_cobros set estado_cobro = 'observado', motivo_observacion = 'Falta firma del inspector', avance = 60 where id = $1`, [cob1]);
let vc = await uno(`select tramo, color, jefe_sitio_nombre from v_obra_cobros where id = $1`, [cob1]);
ok('con 60 % de avance: segundo tramo, naranja', vc.tramo === 'segundo_50' && vc.color === 'naranja', JSON.stringify(vc));
const histC = await q(`select descripcion, usuario_nombre from obra_cobro_historial where cobro_id = $1 order by created_at, descripcion`, [cob1]);
ok('el historial se escribe solo, con quién', histC.length === 2 && histC.some((h) => /Estado: pendiente → observado/.test(h.descripcion) && /Avance: 30 % → 60 %/.test(h.descripcion))
  && histC.every((h) => h.usuario_nombre === 'Usuario e2'), JSON.stringify(histC));
await rechaza('y no se carga a mano', `insert into obra_cobro_historial (cobro_id, descripcion) values ($1, 'x')`, /se registra solo/, [cob1]);
await db.query(`update obra_cobros set estado_cobro = 'pendiente' where id = $1`, [cob1]);
ok('al salir de observado se limpia el motivo', (await uno(`select motivo_observacion from obra_cobros where id = $1`, [cob1])).motivo_observacion === null);
await como(U.opE);
await rechaza('un operario no cambia el cobro', `update obra_cobros set estado_cobro = 'listo_certificar' where id = $1`, /Solo gerencia o un jefe de sitio/, [cob1]);
await como(U.jefeE);
const impC = await uno(`select importar_cobros($1) as r`, [JSON.stringify([
  { titulo: 'Cubierta', mtom: '4500001', mein: '9001', avance: 100, observaciones: 'LISTO PARA CERTIFICAR' },
  { titulo: 'Pintura general', mtom: '4500002', monto_base: 500000, avance: 40, observaciones: 'Falta cargar actas' },
  { titulo: 'Baños planta alta', mtom: '4500009', monto_base: 250000, avance: 0, observaciones: 'Observado por el inspector' },
])]);
ok('la planilla de cobro: 1 actualizada, 2 nuevas en el ciclo y 1 obra creada',
  impC.r.obras_nuevas === 1 && impC.r.nuevas === 2 && impC.r.actualizadas === 1 && impC.r.omitidas === 0, JSON.stringify(impC.r));
vc = await uno(`select estado_cobro, prioridad, tramo, color, mein from v_obra_cobros where id = $1`, [cob1]);
ok('por MTOM: listo para certificar, prioridad alta, completa y en verde',
  vc.estado_cobro === 'listo_certificar' && vc.prioridad === 'alta' && vc.tramo === null && vc.color === 'verde' && vc.mein === '9001', JSON.stringify(vc));
ok('la observada importada guarda el motivo', (await uno(`select motivo_observacion from v_obra_cobros where mtom = '4500009'`)).motivo_observacion === 'Observado por el inspector');
await rechaza('el jefe de sitio no cierra el ciclo', `select cerrar_ciclo_cobro('Próximo')`, /Solo gerencia/);
const cicloViejo = (await uno(`select ciclo_id from obra_cobros where id = $1`, [cob1])).ciclo_id;
await como(U.gerE);
await rechaza('el ciclo nuevo necesita nombre', `select cerrar_ciclo_cobro(' ')`, /nombre del ciclo nuevo/);
const cicloNuevo = (await uno(`select cerrar_ciclo_cobro('Próximo') as id`)).id;
const pasaron10 = await q(`select mtom, estado_cobro from v_obra_cobros where ciclo_id = $1 order by mtom`, [cicloNuevo]);
ok('al cerrar, pasan al ciclo nuevo las que siguen en curso (la cobrada al 100 % no)',
  pasaron10.map((r) => `${r.mtom}:${r.estado_cobro}`).join() === '4500002:faltan_actas,4500009:observado', JSON.stringify(pasaron10));
await rechaza('el ciclo cerrado queda de solo lectura', `update obra_cobros set avance = 1 where id = $1`, /ciclo está cerrado/, [cob1]);
ok('un solo ciclo abierto', (await uno(`select count(*)::int as n from ciclos_cobro where abierto`)).n === 1
  && (await uno(`select abierto from ciclos_cobro where id = $1`, [cicloViejo])).abierto === false);
await rechaza('no hay dos ciclos abiertos a la vez (ni se abren a mano)', `insert into ciclos_cobro (nombre) values ('Otro')`, /ciclos_cobro_abierto_idx|duplicate key|se abren solos/);

titulo('10d. Solicitudes de certificado');
await como(U.opE);
await rechaza('un operario no pide certificados', `insert into solicitudes_certificado (titulo) values ('x')`, /no puede pedir certificados/);
await como(U.jefeE);
const sol = await uno(`insert into solicitudes_certificado (titulo, obra_id, monto_solicitado, estado, revisor_id)
  values ('Certificado cubierta', $1, 300000, 'borrador', $2) returning id, codigo, solicitante_id, revisor_id`, [obra1.id, U.gerE]);
ok('nace en borrador, con código, a nombre de quien la pide y sin revisor', /^SOL-\d{6}$/.test(sol.codigo) && sol.solicitante_id === U.jefeE && sol.revisor_id === null, JSON.stringify(sol));
await db.query(`update solicitudes_certificado set monto_solicitado = 350000 where id = $1`, [sol.id]);
await db.query(`update solicitudes_certificado set estado = 'enviada' where id = $1`, [sol.id]);
await rechaza('enviada, quien la pidió ya no la edita', `update solicitudes_certificado set monto_solicitado = 1 where id = $1`, /No podés modificar/, [sol.id]);
await rechaza('y no se la aprueba a sí mismo', `update solicitudes_certificado set estado = 'aprobada' where id = $1`, /Solo gerencia aprueba/, [sol.id]);
await como(U.gerE);
await db.query(`update solicitudes_certificado set estado = 'en_revision' where id = $1`, [sol.id]);
await db.query(`update solicitudes_certificado set comentarios = 'Revisando actas', monto_solicitado = 1 where id = $1`, [sol.id]);
let vs = await uno(`select comentarios, monto_solicitado, revisor_id from solicitudes_certificado where id = $1`, [sol.id]);
ok('gerencia la toma y comenta, pero no cambia lo pedido', vs.comentarios === 'Revisando actas' && Number(vs.monto_solicitado) === 350000 && vs.revisor_id === U.gerE, JSON.stringify(vs));
await rechaza('rechazar pide el motivo', `update solicitudes_certificado set estado = 'rechazada' where id = $1`, /escribí el motivo/, [sol.id]);
await db.query(`update solicitudes_certificado set estado = 'rechazada', motivo_rechazo = 'Falta el acta' where id = $1`, [sol.id]);
await rechaza('rechazada no vuelve a aprobada', `update solicitudes_certificado set estado = 'aprobada' where id = $1`, /no puede pasar a aprobada/, [sol.id]);
await como(U.jefeE);
await db.query(`update solicitudes_certificado set estado = 'borrador' where id = $1`, [sol.id]);
await db.query(`update solicitudes_certificado set estado = 'enviada' where id = $1`, [sol.id]);
await como(U.gerE);
await db.query(`update solicitudes_certificado set estado = 'aprobada', monto_solicitado = 1 where id = $1`, [sol.id]);
ok('aprobar no cambia el monto pedido', Number((await uno(`select monto_solicitado from solicitudes_certificado where id = $1`, [sol.id])).monto_solicitado) === 350000);
vs = await uno(`select estado, resuelto_at, historial, motivo_rechazo from v_solicitudes_certificado where id = $1`, [sol.id]);
ok('corregida y reenviada, gerencia la aprueba; el historial guarda los 7 pasos',
  vs.estado === 'aprobada' && vs.resuelto_at !== null && vs.historial.length === 7 && vs.motivo_rechazo === null, JSON.stringify(vs.historial.map((h) => h.estado)));
await rechaza('aprobada no se toca', `update solicitudes_certificado set comentarios = 'x' where id = $1`, /ya está aprobada/, [sol.id]);
await rechaza('ni se borra', `delete from solicitudes_certificado where id = $1`, /aprobada no se borra/, [sol.id]);
const solG = await uno(`insert into solicitudes_certificado (titulo, estado) values ('La pide gerencia', 'enviada') returning id`);
await rechaza('gerencia no aprueba la que pidió ella misma', `update solicitudes_certificado set estado = 'aprobada' where id = $1`, /pediste vos/, [solG.id]);

titulo('10e. Abonos del mes');
const kAb = await uno(`insert into contratos (contratista, obra_servicio, fecha_inicio, fecha_fin)
  values ('Limpiezas SA', 'Limpieza', (date_trunc('month', current_date) - interval '2 months')::date,
          (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date) returning id`);
await db.query(`insert into contrato_items (contrato_id, numero, descripcion, um, cantidad, importe_unitario) values ($1, 1, 'Limpieza', 'mes', 2, 900)`, [kAb.id]);
await como(U.jefeE);
await rechaza('no se certifica un mes que no empezó', `select certificar_abonos_del_mes((current_date + interval '1 month')::date)`, /todavía no empezó/);
let ab = (await uno(`select certificar_abonos_del_mes((current_date - interval '2 months')::date, $1) as r`, [kAb.id])).r;
let cAb = await uno(`select c.numero, c.estado, ci.med_presente_unidad from certificados c join certificado_items ci on ci.certificado_id = c.id
  where c.contrato_id = $1 order by c.created_at desc limit 1`, [kAb.id]);
ok('el primer mes: emite el certificado N° 1 con la parte del mes (2 ÷ 3)',
  ab.contratos[0].resultado === 'emitido' && cAb.numero === 1 && Number(cAb.med_presente_unidad) === 0.6667, JSON.stringify({ ab, cAb }));
ab = (await uno(`select certificar_abonos_del_mes((current_date - interval '2 months')::date, $1) as r`, [kAb.id])).r;
ok('repetir el mes no duplica', ab.contratos[0].resultado === 'ya_certificado', JSON.stringify(ab));
await db.query(`select certificar_abonos_del_mes((current_date - interval '1 month')::date, $1)`, [kAb.id]);
ab = (await uno(`select certificar_abonos_del_mes(current_date, $1) as r`, [kAb.id])).r;
cAb = await uno(`select sum(ci.med_presente_unidad) as total from certificados c join certificado_items ci on ci.certificado_id = c.id where c.contrato_id = $1`, [kAb.id]);
ok('el último mes completa justo lo contratado, sin pasarse por redondeo', ab.contratos[0].resultado === 'emitido' && Number(cAb.total) === 2, JSON.stringify({ ab, cAb }));
ab = (await uno(`select certificar_abonos_del_mes(current_date) as r`)).r;
ok('de a todos: cada contrato informa su resultado sin frenar a los demás',
  ab.contratos.length === 3 && ab.contratos.filter((x) => x.resultado === 'sin_fechas').length === 2 && ab.contratos.some((x) => x.resultado === 'ya_certificado'), JSON.stringify(ab));

titulo('10f. Presupuestos de obra');
await como(U.opE);
await rechaza('un operario no sube presupuestos', `insert into presupuestos (nombre, archivo_path, archivo_nombre) values ('x', 'a', 'b')`, /No tenés permiso/);
await como(U.jefeE);
const pres = await uno(`insert into presupuestos (nombre, obra_id, archivo_path, archivo_nombre) values ('Presupuesto cubierta', $1, $2, 'cubierta.xlsx') returning id`,
  [obra1.id, `${escuela}/presupuestos/x-cubierta.xlsx`]);
await db.query(`update presupuestos set estado = 'enviado' where id = $1`, [pres.id]);
ok('el jefe lo sube y lo marca enviado; la vista trae la obra',
  (await uno(`select estado, obra_titulo from v_presupuestos where id = $1`, [pres.id])).obra_titulo === 'Cambio de cubierta (SAP)');
await rechaza('un estado inventado no entra', `update presupuestos set estado = 'pagado' where id = $1`, /check constraint|violates check/, [pres.id]);

// ================================================================ 11. PAÑOL (tanda 4)
titulo('11a. Materiales y stock');
await como(U.opE);
await rechaza('un operario no da de alta materiales', `insert into materiales (nombre) values ('Cable')`, /No tenés permiso/);
await como(U.jefeE);
const cable = await uno(`insert into materiales (nombre, codigo, unidad, stock, stock_minimo, costo_unitario) values ('Cable 2,5 mm', 'CAB-25', 'metro', 10, 4, 100) returning id, stock`);
let movs = await q(`select tipo, motivo, cantidad, stock_anterior, stock_nuevo from movimientos_panol where material_id = $1`, [cable.id]);
ok('el alta con stock deja su movimiento de stock inicial', movs.length === 1 && movs[0].motivo === 'stock_inicial' && Number(movs[0].stock_nuevo) === 10, JSON.stringify(movs));
await rechaza('el stock no se cambia a mano', `update materiales set stock = 99 where id = $1`, /no se cambia a mano/, [cable.id]);
await rechaza('el código no se repite (sin importar mayúsculas)', `insert into materiales (nombre, codigo) values ('Otro', 'cab-25')`, /materiales_codigo_idx|duplicate key/);
await rechaza('los movimientos no se cargan a mano',
  `insert into movimientos_panol (material_id, tipo, motivo, cantidad, stock_anterior, stock_nuevo) values ($1, 'entrada', 'compra', 1, 0, 1)`, /se registran desde el pañol/, [cable.id]);

titulo('11b. Entradas y salidas');
await db.query(`select registrar_movimiento($1, 'salida', 'consumo', 3)`, [cable.id]);
ok('una salida descuenta', Number((await uno(`select stock from materiales where id = $1`, [cable.id])).stock) === 7);
await rechaza('no se saca más de lo que hay (no queda negativo)', `select registrar_movimiento($1, 'salida', 'consumo', 20)`, /No alcanza el stock de Cable 2,5 mm: hay 7 m y querés sacar 20 m/, [cable.id]);
await rechaza('el motivo tiene que corresponder al tipo', `select registrar_movimiento($1, 'entrada', 'consumo', 1)`, /no corresponde a una entrada/, [cable.id]);
await rechaza('asignar a obra pide la obra', `select registrar_movimiento($1, 'salida', 'asignacion_obra', 1)`, /elegí la obra/, [cable.id]);
await db.query(`select registrar_movimiento($1, 'entrada', 'compra', 10, p_costo => 200, p_remito => 'R-001')`, [cable.id]);
let mat = await uno(`select stock, costo_unitario from materiales where id = $1`, [cable.id]);
ok('una compra suma y deja el costo promedio ponderado ((7×100 + 10×200) ÷ 17)', Number(mat.stock) === 17 && Number(mat.costo_unitario) === 158.82, JSON.stringify(mat));
const movOt = (await uno(`select registrar_movimiento($1, 'salida', 'consumo', 2, p_ot => $2) as id`, [cable.id, otObra.id])).id;
ok('una salida para una orden toma la obra de la orden', (await uno(`select obra_id from movimientos_panol where id = $1`, [movOt])).obra_id === obra1.id);
await rechaza('un movimiento no se modifica', `update movimientos_panol set cantidad = 1 where id = $1`, /no se modifica/, [movOt]);
await rechaza('ni se borra', `delete from movimientos_panol where id = $1`, /no se borra/, [movOt]);
await como(U.opE);
await rechaza('un operario no mueve stock', `select registrar_movimiento($1, 'salida', 'consumo', 1)`, /Mueven stock gerencia y los jefes/, [cable.id]);
await como(U.jefeE);
ok('ajustar al contado deja un ajuste por la diferencia', (await uno(`select ajustar_stock($1, 12) as id`, [cable.id])).id !== null
  && Number((await uno(`select stock from materiales where id = $1`, [cable.id])).stock) === 12
  && (await uno(`select motivo, cantidad from movimientos_panol where material_id = $1 order by numero desc limit 1`, [cable.id])).motivo === 'ajuste_salida');
ok('si ya coincide, no registra nada', (await uno(`select ajustar_stock($1, 12) as id`, [cable.id])).id === null);
const vm = await uno(`select bajo_minimo, valor from v_materiales where id = $1`, [cable.id]);
ok('la vista calcula el valor del stock', vm.bajo_minimo === false && Number(vm.valor) === 1905.84, JSON.stringify(vm));

titulo('11c. Préstamo de herramientas');
const taladro = await uno(`insert into materiales (nombre, categoria, stock, prestable) values ('Taladro', 'herramientas', 2, true) returning id`);
await rechaza('lo que no se presta no sale como préstamo', `select prestar_herramienta($1, 1, $2)`, /no está marcado como herramienta que se presta/, [cable.id, emp1.id]);
await rechaza('el préstamo no se carga como movimiento suelto', `select registrar_movimiento($1, 'salida', 'prestamo', 1)`, /se registran desde Préstamos/, [taladro.id]);
const prest = (await uno(`select prestar_herramienta($1, 1, $2, current_date + 3) as id`, [taladro.id, emp1.id])).id;
ok('prestar saca la herramienta del stock con el nombre de quien la lleva',
  Number((await uno(`select stock from materiales where id = $1`, [taladro.id])).stock) === 1
  && (await uno(`select empleado_nombre, vencido from v_prestamos where id = $1`, [prest])).empleado_nombre === 'Juan Pérez');
ok('la vista cuenta lo prestado', Number((await uno(`select prestado from v_materiales where id = $1`, [taladro.id])).prestado) === 1);
await rechaza('no se presta más de lo que hay', `select prestar_herramienta($1, 2, $2)`, /No alcanza el stock/, [taladro.id, emp1.id]);
await rechaza('los préstamos no se tocan a mano', `update prestamos set estado = 'devuelto' where id = $1`, /se registran y se cierran desde el pañol/, [prest]);
await db.query(`select devolver_prestamo($1, 'Vuelve bien')`, [prest]);
ok('devolverla la vuelve al stock', Number((await uno(`select stock from materiales where id = $1`, [taladro.id])).stock) === 2
  && (await uno(`select estado from prestamos where id = $1`, [prest])).estado === 'devuelto');
await rechaza('no se devuelve dos veces', `select devolver_prestamo($1)`, /ya está cerrado/, [prest]);
const prest2 = (await uno(`select prestar_herramienta($1, 1, $2) as id`, [taladro.id, emp1.id])).id;
await rechaza('darla por perdida lo decide gerencia', `select perder_prestamo($1, 'Se rompió')`, /lo decide gerencia/, [prest2]);
await como(U.gerE);
await rechaza('y pide qué pasó', `select perder_prestamo($1, ' ')`, /Escribí qué pasó/, [prest2]);
await db.query(`select perder_prestamo($1, 'Se cayó del andamio')`, [prest2]);
ok('perdida: el préstamo se cierra y el stock no vuelve', (await uno(`select estado from prestamos where id = $1`, [prest2])).estado === 'perdido'
  && Number((await uno(`select stock from materiales where id = $1`, [taladro.id])).stock) === 1);

titulo('11d. Requerimientos de compra');
await como(U.opE);
await rechaza('un requerimiento nace en borrador', `insert into requerimientos_compra (titulo, estado) values ('x', 'enviado')`, /nace en borrador/);
const req = await uno(`insert into requerimientos_compra (titulo, obra_id) values ('Materiales cubierta', $1) returning id, codigo, solicitante_id`, [obra1.id]);
ok('cualquiera del sector lo pide; nace con código y a su nombre', /^REQ-\d{6}$/.test(req.codigo) && req.solicitante_id === U.opE, JSON.stringify(req));
await rechaza('no se envía vacío', `update requerimientos_compra set estado = 'enviado' where id = $1`, /al menos un ítem/, [req.id]);
const it1 = await uno(`insert into requerimiento_items (requerimiento_id, material_id, descripcion, cantidad_solicitada) values ($1, $2, '', 20) returning id, descripcion, unidad, costo_estimado`, [req.id, cable.id]);
ok('un ítem del catálogo toma nombre, unidad y costo', it1.descripcion === 'Cable 2,5 mm' && it1.unidad === 'metro' && Number(it1.costo_estimado) === 158.82, JSON.stringify(it1));
const it2 = await uno(`insert into requerimiento_items (requerimiento_id, descripcion, cantidad_solicitada, costo_estimado) values ($1, 'Membrana asfáltica', 5, 1000) returning id`, [req.id]);
ok('el total estimado lo calcula la base', Number((await uno(`select total_estimado from requerimientos_compra where id = $1`, [req.id])).total_estimado) === 8176.4);
await db.query(`update requerimientos_compra set estado = 'enviado' where id = $1`, [req.id]);
await rechaza('enviado, ya no se cambian los ítems', `update requerimiento_items set cantidad_solicitada = 1 where id = $1`, /mientras el requerimiento está en borrador/, [it2.id]);
await como(U.jefeE);
await rechaza('el jefe de sitio no aprueba', `update requerimientos_compra set estado = 'aprobado' where id = $1`, /Solo gerencia aprueba/, [req.id]);
await como(U.gerE);
await db.query(`update requerimientos_compra set estado = 'en_revision' where id = $1`, [req.id]);
await db.query(`update requerimiento_items set cantidad_aprobada = 15, descripcion = 'cambiado' where id = $1`, [it1.id]);
ok('en revisión, gerencia ajusta solo la cantidad aprobada', (await uno(`select cantidad_aprobada, descripcion from requerimiento_items where id = $1`, [it1.id])).descripcion === 'Cable 2,5 mm');
await db.query(`update requerimientos_compra set estado = 'aprobado' where id = $1`, [req.id]);
ok('al aprobar, lo no ajustado toma lo pedido', Number((await uno(`select cantidad_aprobada from requerimiento_items where id = $1`, [it2.id])).cantidad_aprobada) === 5);
await rechaza('a compra sin orden de compra, no', `update requerimientos_compra set estado = 'en_compra' where id = $1`, /cargá el N° de orden de compra/, [req.id]);
await db.query(`update requerimientos_compra set estado = 'en_compra', numero_orden_compra = 'OC-77', proveedor_id = $2 where id = $1`, [req.id, prov.id]);
await rechaza('recibido no se marca a mano', `update requerimientos_compra set estado = 'recibido' where id = $1`, /al recibir la mercadería/, [req.id]);
await como(U.jefeE);
let rec = (await uno(`select recibir_requerimiento($1, $2, 'R-900') as r`, [req.id, JSON.stringify([{ item_id: it1.id, cantidad: 10, costo: 160 }])])).r;
ok('una recepción parcial suma al stock y queda en compra', rec.entradas === 1 && rec.estado === 'en_compra'
  && Number((await uno(`select stock from materiales where id = $1`, [cable.id])).stock) === 22, JSON.stringify(rec));
rec = (await uno(`select recibir_requerimiento($1, $2) as r`, [req.id, JSON.stringify([{ item_id: it1.id, cantidad: 5 }, { item_id: it2.id, cantidad: 5 }])])).r;
ok('cuando llega todo lo aprobado, queda recibido', rec.estado === 'recibido' && rec.completo === true, JSON.stringify(rec));
const vr = await uno(`select historial, proveedor_nombre, obra_titulo from v_requerimientos where id = $1`, [req.id]);
ok('el historial guarda el circuito completo', vr.historial.map((h) => h.estado).join() === 'borrador,enviado,en_revision,aprobado,en_compra,recibido'
  && vr.proveedor_nombre === 'Corralón Sur', JSON.stringify(vr.historial.map((h) => h.estado)));
ok('las entradas de la compra quedan atadas al requerimiento y a su obra',
  (await uno(`select count(*)::int as n from movimientos_panol where requerimiento_id = $1 and obra_id = $2 and motivo = 'compra'`, [req.id, obra1.id])).n === 2);
await rechaza('recibido, no se recibe más', `select recibir_requerimiento($1, '[]')`, /Solo se recibe un requerimiento en compra/, [req.id]);
await como(U.gerE);
const reqG = await uno(`insert into requerimientos_compra (titulo) values ('Lo pide gerencia') returning id`);
await db.query(`insert into requerimiento_items (requerimiento_id, descripcion, cantidad_solicitada) values ($1, 'Guantes', 10)`, [reqG.id]);
await db.query(`update requerimientos_compra set estado = 'enviado' where id = $1`, [reqG.id]);
await rechaza('gerencia no aprueba lo que pidió', `update requerimientos_compra set estado = 'aprobado' where id = $1`, /que pediste vos/, [reqG.id]);
await db.query(`update requerimientos_compra set estado = 'cancelado' where id = $1`, [reqG.id]);
ok('quien lo pidió lo cancela', (await uno(`select estado from requerimientos_compra where id = $1`, [reqG.id])).estado === 'cancelado');

titulo('11e. Materiales de la orden');
await como(U.opE);
await db.query(`insert into ot_materiales (ot_id, descripcion, cantidad, costo_unitario) values ($1, 'Tornillos comprados en la ferretería', 50, 10)`, [otObra.id]);
await rechaza('un operario anota, pero no saca del pañol', `insert into ot_materiales (ot_id, material_id, descripcion, cantidad, descontar) values ($1, $2, '', 1, true)`, /lo hacen gerencia y los jefes de sitio/, [otObra.id, cable.id]);
await como(U.jefeE);
const om = await uno(`insert into ot_materiales (ot_id, material_id, descripcion, cantidad, descontar) values ($1, $2, '', 4, true) returning id, movimiento_id, descripcion, costo_unitario`, [otObra.id, cable.id]);
ok('el jefe lo saca del pañol: descuenta y queda el movimiento', om.movimiento_id !== null && om.descripcion === 'Cable 2,5 mm'
  && Number((await uno(`select stock from materiales where id = $1`, [cable.id])).stock) === 23, JSON.stringify(om));
await rechaza('lo que salió del pañol no se modifica', `update ot_materiales set cantidad = 1 where id = $1`, /no se modifica/, [om.id]);
let consumo = await uno(`select costo_materiales from v_consumo_obra where obra_id = $1`, [obra1.id]);
const antes = Number(consumo.costo_materiales);
await db.query(`delete from ot_materiales where id = $1`, [om.id]);
ok('quitarlo lo devuelve al stock', Number((await uno(`select stock from materiales where id = $1`, [cable.id])).stock) === 27);
consumo = await uno(`select costo_materiales from v_consumo_obra where obra_id = $1`, [obra1.id]);
ok('y el costo de la obra descuenta la devolución', Number(consumo.costo_materiales) < antes, JSON.stringify({ antes, ahora: consumo }));
ok('la orden suma lo anotado', Number((await uno(`select sum(total) as t from v_ot_materiales where ot_id = $1`, [otObra.id])).t) === 500);

titulo('11f. Importación del catálogo y aislamiento');
const impM = (await uno(`select importar_materiales($1, true) as r`, [JSON.stringify([
  { nombre: 'Cable 2,5 mm (planilla)', codigo: 'cab-25', stock: 30, costo_unitario: 170 },
  { nombre: 'Pintura látex', codigo: 'PIN-1', categoria: 'pintura', unidad: 'litro', stock: 40, stock_minimo: 10 },
  { nombre: 'Escalera', categoria: 'herramientas', stock: 2 },
  { nombre: ' ' },
])])).r;
ok('la planilla crea 2, actualiza 1 (por código) y omite la vacía', impM.nuevos === 2 && impM.actualizados === 1 && impM.omitidos === 1 && impM.ajustados === 1, JSON.stringify(impM));
ok('con ajuste, lo existente queda en lo contado', Number((await uno(`select stock from materiales where id = $1`, [cable.id])).stock) === 30);
ok('una herramienta importada queda como prestable', (await uno(`select prestable from materiales where nombre = 'Escalera'`)).prestable === true);
ok('la búsqueda remota encuentra materiales', (await q(`select etiqueta from buscar('materiales', 'pin')`)).length === 1);
await como(U.opB);
ok('el pañol de escuela no existe para bapro', (await q(`select 1 from materiales`)).length === 0 && (await q(`select 1 from movimientos_panol`)).length === 0);
await rechaza('ni se mueve su stock desde bapro', `select registrar_movimiento($1, 'salida', 'consumo', 1)`, /Mueven stock|no existe o no es de tu sector/, [cable.id]);

// ================================================================ 12. CONTROL Y REPORTES (tanda 5)
titulo('12a. Auditoría');
await como(U.jefeE);
await db.query(`update ordenes_trabajo set prioridad = 'alta', descripcion = 'Revisión auditada' where id = $1`, [otObra.id]);
await rechaza('nadie escribe la auditoría a mano', `insert into auditoria (sector_id, tabla, accion) values ($1, 'x', 'alta')`, /la escribe el sistema|row-level security/, [escuela]);
ok('el jefe de sitio no lee la auditoría', (await q(`select 1 from auditoria`)).length === 0);
await como(U.gerE);
const aud = await uno(`select accion, usuario_nombre, usuario_rol, cambios, etiqueta from auditoria where tabla = 'ordenes_trabajo' and registro_id = $1 order by id desc limit 1`, [otObra.id]);
ok('el cambio queda con quién, su rol y el antes y después de cada campo', aud?.accion === 'cambio' && aud.usuario_nombre === 'Usuario e2' && aud.usuario_rol === 'jefe_sitio'
  && aud.cambios.prioridad.despues === 'alta' && aud.cambios.descripcion.despues === 'Revisión auditada' && !('updated_at' in aud.cambios), JSON.stringify(aud));
ok('las altas también quedan (con el registro completo)', (await uno(`select count(*)::int as n from auditoria where tabla = 'materiales' and accion = 'alta'`)).n >= 3);
const idAud = (await uno(`select id from auditoria order by id desc limit 1`)).id;
await rechaza('ni gerencia la modifica', `update auditoria set usuario_nombre = 'otro' where id = $1`, /la escribe el sistema|permission denied/, [idAud]);
await rechaza('ni la borra', `delete from auditoria where id = $1`, /la escribe el sistema|permission denied/, [idAud]);
await como(U.gerB);
ok('la auditoría de escuela no existe para bapro', (await q(`select 1 from auditoria where sector_id = $1`, [escuela])).length === 0);

titulo('12b. Informes');
await como(U.opE);
await rechaza('un operario no carga informes', `insert into informes (titulo) values ('x')`, /los cargan gerencia y los jefes/);
await como(U.jefeE);
const inf = await uno(`insert into informes (titulo, tipo, obra_id, responsable_id, fecha_limite, requiere_firma) values ('Avance de cubierta', 'avance_obra', $1, $2, current_date - 2, true)
  returning id, codigo, responsable_texto`, [obra1.id, U.opE]);
ok('nace con código y el nombre de su responsable', /^INF-\d{6}$/.test(inf.codigo) && inf.responsable_texto === 'Usuario e3', JSON.stringify(inf));
let vi = await uno(`select vencido, dias_restantes, obra_titulo from v_informes where id = $1`, [inf.id]);
ok('vencido y con su obra', vi.vencido === true && vi.dias_restantes === -2 && vi.obra_titulo === 'Cambio de cubierta (SAP)', JSON.stringify(vi));
ok('aparece en el calendario como vencido', (await uno(`select vencido from v_calendario where tipo = 'informe' and id = $1`, [inf.id])).vencido === true);
await como(U.opE);
await db.query(`update informes set estado = 'enviado' where id = $1`, [inf.id]);
vi = await uno(`select estado, fecha_envio, vencido, falta_firma from v_informes where id = $1`, [inf.id]);
ok('su responsable lo marca enviado: sella la fecha, deja de estar vencido y avisa que falta la firma',
  vi.estado === 'enviado' && vi.fecha_envio !== null && vi.vencido === false && vi.falta_firma === true, JSON.stringify(vi));
await como(U.jefeE);
await rechaza('un informe lo borra gerencia', `delete from informes where id = $1`, /lo borra gerencia/, [inf.id]);

titulo('12c. Alertas');
await como(U.jefeE);
const otVieja = await uno(`insert into ordenes_trabajo (titulo, ubicacion_id, fecha_programada) values ('Vencida hace 10 días', $1, current_date - 10) returning id`, [ubiE.id]);
await db.query(`insert into materiales (nombre, stock, stock_minimo) values ('Guantes', 2, 10)`);
let al = await q(`select tipo, nivel, titulo, enlace from v_alertas`);
ok('una orden vencida hace 10 días es alerta crítica', al.some((a) => a.tipo === 'ot_vencida' && a.nivel === 'critica' && a.enlace === `/ot/${otVieja.id}`), JSON.stringify(al.map((a) => a.tipo)));
ok('el stock bajo el mínimo es aviso', al.some((a) => a.tipo === 'stock' && a.nivel === 'aviso' && /Guantes/.test(a.titulo)));
ok('el informe vencido no aparece si ya se envió', !al.some((a) => a.tipo === 'informe'));
const clave = `ot_vencida:${otVieja.id}`;
await db.query(`insert into alertas_vistas (clave) values ($1)`, [clave]);
ok('marcada como vista, deja de aparecer para quien la marcó', !(await q(`select 1 from v_mis_alertas where clave = $1`, [clave])).length);
await como(U.gerE);
ok('pero no para los demás', (await q(`select 1 from v_mis_alertas where clave = $1`, [clave])).length === 1);
const band = (await uno(`select bandeja() as b`)).b;
ok('la bandeja cuenta lo que espera una acción', typeof band.alertas === 'number' && band.alertas > 0 && typeof band.ots_por_validar === 'number', JSON.stringify(band));
await como(U.adm);
await db.query(`update sectores set config = jsonb_set(config, '{alertas,dias_ot}', '30') where id = $1`, [escuela]);
await como(U.gerE);
ok('los umbrales se ajustan por sector (con 30 días, la orden de 10 días ya no es alerta)', !(await q(`select 1 from v_alertas where clave = $1`, [clave])).length);
await como(U.adm);
await db.query(`update sectores set config = jsonb_set(config, '{alertas,dias_ot}', '1') where id = $1`, [escuela]);
await como(U.opB);
ok('las alertas de escuela no existen para bapro', !(await q(`select 1 from v_alertas where sector_id = $1`, [escuela])).length);

titulo('12d. Reportes');
await como(U.gerE);
await rechaza('el período tiene que ser válido', `select reporte_operacion(current_date, current_date - 1)`, /período válido/);
const rep = (await uno(`select reporte_operacion(current_date - 60, current_date) as r`)).r;
const ref = await uno(`select count(*)::int as total, count(*) filter (where estado = 'completada')::int as c, count(*) filter (where estado = 'cancelada')::int as k
  from ordenes_trabajo where (created_at at time zone 'America/Argentina/Buenos_Aires')::date between current_date - 60 and current_date`);
ok('las órdenes del período coinciden con la base', rep.ots.total === ref.total && rep.ots.completadas === ref.c, JSON.stringify({ rep: rep.ots.total, ref }));
const efRef = ref.total - ref.k === 0 ? null : Math.round(1000 * ref.c / (ref.total - ref.k)) / 10;
ok('eficiencia = completadas ÷ (todas − canceladas)', Number(rep.ots.eficiencia) === efRef, JSON.stringify({ ef: rep.ots.eficiencia, efRef }));
ok('trae un renglón por mes del período', rep.ots.por_mes.length >= 2 && rep.ots.por_mes.length <= 4, JSON.stringify(rep.ots.por_mes.map((m) => m.mes)));
ok('ranking de jefes con puntaje', rep.jefes.some((j) => j.id === U.jefeE && typeof j.puntaje === 'number'), JSON.stringify(rep.jefes));
ok('horas y materiales del período', Number(rep.horas.total) > 0 && Number(rep.materiales.salidas_valor) > 0, JSON.stringify({ h: rep.horas.total, m: rep.materiales.salidas_valor }));
const repZona = (await uno(`select reporte_operacion(current_date - 60, current_date, 'ZZZ') as r`)).r;
ok('el filtro de zona filtra', repZona.ots.total === 0 && repZona.pendientes.total === 0);
await como(U.opB);
ok('el reporte de bapro no cuenta lo de escuela', (await uno(`select reporte_operacion(current_date - 60, current_date) as r`)).r.ots.total < rep.ots.total);

// ================================================================ 13. HALLAZGOS DE LA REVISIÓN DE SEGURIDAD (fases 9 a 11)
titulo('13a. Banderas internas');
await como(U.opE);
await rechaza('el ayudante de la bandera del pañol no se llama suelto', `select panol_on()`, /Uso interno/);
await rechaza('ni el que la restaura', `select panol_restore('1')`, /Uso interno/);
await rechaza('ni el de certificación', `select cert_fn_on()`, /Uso interno/);
await rechaza('ni su restaurador', `select cert_fn_restore('1')`, /Uso interno/);

titulo('13b. Movimientos y préstamos no se reescriben');
const movConOt = (await uno(`select id from movimientos_panol where ot_id is not null limit 1`)).id;
await rechaza('un operario no reescribe un movimiento "limpiando" la orden', `update movimientos_panol set ot_id = null, costo_unitario = 0 where id = $1`, /no se modifica/, [movConOt]);
await como(U.jefeE);
const taladro2 = await uno(`insert into materiales (nombre, stock, prestable) values ('Amoladora', 3, true) returning id`);
const prestOt = (await uno(`select prestar_herramienta($1, 1, $2, null, $3) as id`, [taladro2.id, emp1.id, otObra.id])).id;
await como(U.opE);
await rechaza('ni un préstamo para inflar la devolución', `update prestamos set ot_id = null, cantidad = 500 where id = $1`, /se registran y se cierran desde el pañol/, [prestOt]);
await como(U.jefeE);
await rechaza('el requerimiento de un movimiento lo pone el sistema', `select registrar_movimiento($1, 'entrada', 'compra', 1, p_requerimiento => $2)`, /los pone el sistema/, [cable.id, req.id]);

titulo('13c. Borrar una obra limpia las referencias (cascadas) y respeta el cobro');
const obra2 = await uno(`insert into obras (titulo) values ('Obra a borrar') returning id`);
await db.query(`select registrar_movimiento($1, 'salida', 'asignacion_obra', 1, p_obra => $2)`, [cable.id, obra2.id]);
const solO2 = await uno(`insert into solicitudes_certificado (titulo, obra_id, estado) values ('Sol obra 2', $1, 'enviada') returning id`, [obra2.id]);
const reqO2 = await uno(`insert into requerimientos_compra (titulo, obra_id) values ('Req obra 2', $1) returning id`, [obra2.id]);
await como(U.gerE);
await db.query(`delete from obras where id = $1`, [obra2.id]);
ok('se borra y movimientos, solicitudes y requerimientos quedan sin la obra',
  (await uno(`select count(*)::int as n from movimientos_panol where obra_id = $1`, [obra2.id])).n === 0
  && (await uno(`select obra_id from solicitudes_certificado where id = $1`, [solO2.id])).obra_id === null
  && (await uno(`select obra_id from requerimientos_compra where id = $1`, [reqO2.id])).obra_id === null);
await rechaza('una obra con seguimiento de cobro no se borra', `delete from obras where id = $1`, /seguimiento de cobro/, [obra1.id]);
await rechaza('un ciclo cerrado no se reabre a mano', `update ciclos_cobro set abierto = true where id = $1`, /no se vuelve a abrir|ciclos_cobro_abierto_idx/, [cicloViejo]);
await rechaza('ni se borra', `delete from ciclos_cobro where id = $1`, /no se borra/, [cicloViejo]);

titulo('13d. Órdenes, informes, alertas y números');
await como(U.opE);
await rechaza('un operario no cambia la obra de una orden', `update ordenes_trabajo set obra_id = null where id = $1`, /la cambian gerencia y los jefes/, [otObra.id]);
const infR = await uno(`select id from informes where responsable_id = $1 limit 1`, [U.opE]);
await rechaza('el responsable no se aprueba su informe', `update informes set estado = 'aprobado' where id = $1`, /Aprobar o rechazar un informe/, [infR.id]);
await rechaza('ni corre la fecha límite', `update informes set fecha_limite = current_date + 30 where id = $1`, /La fecha límite/, [infR.id]);
await rechaza('ni marca vistas las alertas de otro', `update alertas_vistas set hasta = current_date + 30`, /lo marcó otra persona/);
await db.query(`update ordenes_trabajo set estado = 'cancelada' where id = $1`, [otVieja.id]).catch(() => {});
await como(U.gerE);
await db.query(`update ordenes_trabajo set estado = 'cancelada' where id = $1`, [otVieja.id]).catch(() => {});
await como(U.opE);
if ((await uno(`select estado from ordenes_trabajo where id = $1`, [otVieja.id])).estado === 'cancelada') {
  await rechaza('en una orden cerrada el operario no carga materiales', `insert into ot_materiales (ot_id, descripcion, cantidad) values ($1, 'x', 1)`, /ya está cerrada/, [otVieja.id]);
}
await como(U.jefeE);
const forz = await uno(`insert into informes (titulo, numero) values ('Número forzado', 999999) returning numero`);
ok('el número no lo elige quien carga', Number(forz.numero) !== 999999, JSON.stringify(forz));

titulo('13e. Recepción con tope y abonos en cualquier orden');
const reqT = await uno(`insert into requerimientos_compra (titulo) values ('Tope') returning id`);
await db.query(`insert into requerimiento_items (requerimiento_id, descripcion, cantidad_solicitada) values ($1, 'Clavos', 10)`, [reqT.id]);
await db.query(`update requerimientos_compra set estado = 'enviado' where id = $1`, [reqT.id]);
await como(U.gerE);
await db.query(`update requerimientos_compra set estado = 'aprobado' where id = $1`, [reqT.id]);
await db.query(`update requerimientos_compra set estado = 'en_compra', numero_orden_compra = 'OC-T' where id = $1`, [reqT.id]);
const itT = (await uno(`select id from requerimiento_items where requerimiento_id = $1`, [reqT.id])).id;
await rechaza('no se recibe más de lo aprobado', `select recibir_requerimiento($1, $2)`, /se aprobaron 10/, [reqT.id, JSON.stringify([{ item_id: itT, cantidad: 11 }])]);
const kOrden = await uno(`insert into contratos (contratista, obra_servicio, fecha_inicio, fecha_fin)
  values ('Orden Libre SA', 'Seguridad', (date_trunc('month', current_date) - interval '2 months')::date,
          (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date) returning id`);
await db.query(`insert into contrato_items (contrato_id, numero, descripcion, um, cantidad, importe_unitario) values ($1, 1, 'Vigilancia', 'mes', 3, 1000)`, [kOrden.id]);
await como(U.jefeE);
await db.query(`select certificar_abonos_del_mes(current_date, $1)`, [kOrden.id]);
const primero = await uno(`select ci.med_presente_unidad as p from certificados c join certificado_items ci on ci.certificado_id = c.id where c.contrato_id = $1`, [kOrden.id]);
ok('certificar primero el último mes no se lleva todo el saldo', Number(primero.p) === 1, JSON.stringify(primero));
const otro = (await uno(`select certificar_abonos_del_mes((current_date - interval '2 months')::date, $1) as r`, [kOrden.id])).r;
ok('y después se puede certificar un mes anterior', otro.contratos[0].resultado === 'emitido', JSON.stringify(otro));

// ================================================================ 14. ADMINISTRACIÓN (tanda 6)
titulo('14a. Control de riesgos');
await como(U.opE);
await rechaza('un operario no carga riesgos', `insert into riesgos (evento, probabilidad, consecuencia) values ('x', 1, 1)`, /No tenés permiso/);
await como(U.jefeE);
await rechaza('la consecuencia va en la escala 1-2-4-8-16', `insert into riesgos (evento, probabilidad, consecuencia) values ('x', 3, 3)`, /check constraint|violates check/);
const rg = await uno(`insert into riesgos (evento, probabilidad, consecuencia, metodo_control, frecuencia) values ('Electrocución en tableros', 4, 8, 'MP', 'Mensual') returning id, nivel`);
ok('el nivel es probabilidad × consecuencia', rg.nivel === 32);
ok('y la clase sale de la planilla de la v1 (32 o más: extremo)', (await uno(`select clase from v_riesgos where id = $1`, [rg.id])).clase === 'extremo');
await db.query(`update riesgos set consecuencia = 2 where id = $1`, [rg.id]);
ok('al bajar la consecuencia baja la clase (8: tolerable)', (await uno(`select nivel, clase from v_riesgos where id = $1`, [rg.id])).clase === 'tolerable');

titulo('14b. Foro');
await como(U.opE);
await rechaza('un operario no publica anuncios', `insert into foro_hilos (titulo, cuerpo, tipo) values ('A', 'B', 'anuncio')`, /de gerencia/);
const hilo = await uno(`insert into foro_hilos (titulo, cuerpo, autor_id) values ('¿Alguien tiene llave de paso 1/2?', 'Se me rompió', $1) returning id, autor_id`, [U.gerE]);
ok('el autor es quien escribe (no se puede firmar por otro)', hilo.autor_id === U.opE);
await como(U.opE2);
await db.query(`insert into foro_respuestas (hilo_id, cuerpo) values ($1, 'En el pañol hay dos')`, [hilo.id]);
ok('otro operario lo ve y responde', (await uno(`select respuestas from v_foro_hilos where id = $1`, [hilo.id])).respuestas === 1);
await rechaza('pero no edita el hilo ajeno', `update foro_hilos set titulo = 'otra cosa' where id = $1`, /lo edita quien lo escribió/, [hilo.id]);
await como(U.opE);
ok('el autor lo ve como no leído (hubo una respuesta)', (await uno(`select no_leido from v_foro_hilos where id = $1`, [hilo.id])).no_leido === true);
await db.query(`insert into foro_lecturas (hilo_id) values ($1)`, [hilo.id]);
ok('al leerlo deja de estar como nuevo', (await uno(`select no_leido from v_foro_hilos where id = $1`, [hilo.id])).no_leido === false);
await como(U.gerE);
await db.query(`update foro_hilos set cerrado = true where id = $1`, [hilo.id]);
await como(U.opE2);
await rechaza('en un hilo cerrado no se responde', `insert into foro_respuestas (hilo_id, cuerpo) values ($1, 'x')`, /está cerrado/, [hilo.id]);
await como(U.opB);
ok('el foro de escuela no existe para bapro', (await q(`select 1 from foro_hilos`)).length === 0);

titulo('14c. Sugerencias, búsqueda y resumen');
await como(U.opE);
const sug = await uno(`insert into sugerencias (tipo, titulo, descripcion, estado) values ('problema', 'No carga el mapa', 'Desde el celular', 'resuelta') returning id, estado`);
ok('una sugerencia nueva entra como nueva', sug.estado === 'nueva');
await rechaza('y la atiende un admin', `update sugerencias set estado = 'resuelta' where id = $1`, /las atiende un admin/, [sug.id]);
await como(U.opE2);
ok('otro operario no ve la sugerencia ajena', (await q(`select 1 from v_sugerencias where id = $1`, [sug.id])).length === 0);
await como(U.adm);
await db.query(`update sugerencias set estado = 'resuelta', respuesta = 'Arreglado' where id = $1`, [sug.id]);
ok('el admin la ve y la responde', (await uno(`select estado, respuesta from v_sugerencias where id = $1`, [sug.id])).respuesta === 'Arreglado');
const res = await q(`select tipo, titulo, enlace from buscar_todo('cubierta')`);
ok('la búsqueda global encuentra en varias secciones con su enlace', res.some((x) => x.tipo === 'obra') && res.some((x) => x.tipo === 'requerimiento'), JSON.stringify(res.map((x) => x.tipo)));
ok('con menos de dos letras no busca', (await q(`select 1 from buscar_todo('c')`)).length === 0);
const resu = (await uno(`select resumen_sector() as r`)).r;
ok('el resumen del sector cuenta lo cargado', resu.ordenes > 0 && resu.usuarios > 0, JSON.stringify(resu));
await como(U.gerE);
await rechaza('el resumen de sectores es del admin', `select resumen_sector()`, /para el admin/);
await como(U.opB);
ok('la búsqueda no cruza sectores', !(await q(`select 1 from buscar_todo('cubierta')`)).length);

titulo('15. Ajustes de la fase 13');
await como(U.gerE);
const inf1 = await uno(`insert into informes (titulo) values ('Numeración 1') returning numero, codigo`);
const inf2 = await uno(`insert into informes (titulo) values ('Numeración 2') returning numero, codigo`);
ok('los informes se numeran de a uno (no gastan dos números)', Number(inf2.numero) === Number(inf1.numero) + 1 && inf2.codigo === `INF-${String(inf2.numero).padStart(6, '0')}`, JSON.stringify([inf1, inf2]));
const req1 = await uno(`insert into requerimientos_compra (titulo) values ('Numeración 1') returning numero`);
const req2 = await uno(`insert into requerimientos_compra (titulo) values ('Numeración 2') returning numero`);
ok('los requerimientos también', Number(req2.numero) === Number(req1.numero) + 1, JSON.stringify([req1, req2]));
const sol1 = await uno(`insert into solicitudes_certificado (titulo) values ('Numeración 1') returning numero`);
const sol2 = await uno(`insert into solicitudes_certificado (titulo) values ('Numeración 2') returning numero`);
ok('y las solicitudes de certificado', Number(sol2.numero) === Number(sol1.numero) + 1, JSON.stringify([sol1, sol2]));
const inf3 = await uno(`insert into informes (titulo, numero) values ('Número elegido', 999999) returning numero`);
ok('un usuario no elige el número', Number(inf3.numero) === Number(inf2.numero) + 1, JSON.stringify(inf3));
await servicio();
const sectorE = (await uno(`select sector_id from informes where numero = $1`, [inf1.numero])).sector_id;
const infS = await uno(`insert into informes (sector_id, titulo) values ($1, 'Migrado') returning numero, codigo`, [sectorE]);
ok('el servicio (migración) también recibe número y código', Number(infS.numero) > 0 && infS.codigo === `INF-${String(infS.numero).padStart(6, '0')}`, JSON.stringify(infS));
const solS = await uno(`insert into solicitudes_certificado (sector_id, titulo) values ($1, 'Migrada') returning numero, codigo`, [sectorE]);
ok('y la solicitud migrada lleva código', solS.codigo === `SOL-${String(solS.numero).padStart(6, '0')}`, JSON.stringify(solS));
const txt = await uno(`select cantidad_txt(3, 'unidad') a, cantidad_txt(1, 'bolsa') b, cantidad_txt(8, 'litro') c, cantidad_txt(2.5, 'metro') d, cantidad_txt(1, 'unidad') e`);
ok('las cantidades se leen con su unidad y en plural', txt.a === '3 unidades' && txt.b === '1 bolsa' && txt.c === '8 l' && txt.d === '2,5 m' && txt.e === '1 unidad', JSON.stringify(txt));
await como(U.gerE);
const alStock = await q(`select detalle from v_alertas where tipo = 'stock'`);
ok('la alerta de stock muestra la unidad legible', alStock.every((a) => !/ (metro|litro|unidad)( |$)/.test(a.detalle)), JSON.stringify(alStock));

titulo('16. Certificados como la v1 (fase 14)');
await como(U.gerE);
const x16pdfObra = {
  contrato: { tipo: 'obra', contratista: 'Constructora Sur', obra_servicio: 'Refacción baños', emprendimiento: 'EDUCACION COMUNA 8A',
              ada_numero: 'ADA-777', oc_numero: 'OC-9', base: 'Base Norte', plazo: '90 días', ada_pdf_url: 'x/contratos/ada.pdf' },
  items: [
    { descripcion: 'Demolición', um: 'gl', cantidad: 1, importe_unitario: 1000000, presente_importe: 1000000 },
    { descripcion: 'Revoque', um: 'm2', cantidad: 3, importe_unitario: 333.33, presente_importe: 333.33 },
  ],
  cabecera: { periodo: 'Octubre 2026', numero_recepcion: 'R-1', anticipo_monto_manual: 50000, fondo_reparo_pct: 5,
              fondo_reparo_aplicar: true, fondo_reparo_label: 'Garantía', avance_obra_pct: 40 },
};
const x16c1 = (await uno(`select guardar_certificado($1::jsonb) as id`, [JSON.stringify(x16pdfObra)])).id;
const x16vc1 = await uno(`select * from v_certificados where id = $1`, [x16c1]);
ok('desde el PDF se crea el contrato con sus datos y un borrador sin número', x16vc1.estado === 'borrador' && x16vc1.numero === null
  && x16vc1.contratista === 'Constructora Sur' && x16vc1.base === 'Base Norte' && x16vc1.ada_pdf_url === 'x/contratos/ada.pdf' && x16vc1.tipo === 'obra', JSON.stringify(x16vc1));
const x16lin1 = await q(`select numero, med_presente_unidad::float u, med_presente_importe::float i, presente_por_importe from certificado_items where certificado_id = $1 order by numero`, [x16c1]);
ok('"A certificar $" se guarda en pesos y la base deriva las unidades', x16lin1[1].i === 333.33 && x16lin1[1].u === 1 && x16lin1[1].presente_por_importe, JSON.stringify(x16lin1));
ok('anticipo en monto fijo y fondo de reparo con su nombre', Number(x16vc1.anticipo_monto) === 50000 && Number(x16vc1.fondo_reparo_monto) === Math.round(1000333.33 * 5) / 100
  && x16vc1.fondo_reparo_nombre === 'Garantía' && Math.abs(Number(x16vc1.total_neto) - (Number(x16vc1.subtotal_presente) - 50000 - Number(x16vc1.fondo_reparo_monto))) < 0.005, JSON.stringify({ a: x16vc1.anticipo_monto, f: x16vc1.fondo_reparo_monto, n: x16vc1.total_neto }));
await db.query(`update certificados set anticipo_monto_manual = null, anticipo_pct = 10 where id = $1`, [x16c1]);
ok('cambiar las deducciones de la cabecera rehace los totales', Number((await uno(`select anticipo_monto from certificados where id = $1`, [x16c1])).anticipo_monto) === 100033.33);
await rechaza('un certificado de obra se emite con la firma del jefe de sitio', `select emitir_certificado($1)`, /firma el jefe de sitio/, [x16c1]);
await como(U.jefeE);
const x16n1 = (await uno(`select emitir_certificado($1, 'data:image/png;base64,AAA') as n`, [x16c1])).n;
const x16e1 = await uno(`select estado, numero, firma_jefe_url, firma_jefe_nombre from certificados where id = $1`, [x16c1]);
ok('al emitir se numera y queda la firma del jefe con su nombre', x16n1 === 1 && x16e1.estado === 'emitido' && x16e1.firma_jefe_url && x16e1.firma_jefe_nombre, JSON.stringify(x16e1));
const x16sol1 = await uno(`select estado, monto_solicitado::float m, certificado_id from solicitudes_certificado where certificado_id = $1`, [x16c1]);
ok('la solicitud de aprobación sale sola, enviada y con el monto', x16sol1 && x16sol1.estado === 'enviada' && x16sol1.m === 1000333.33, JSON.stringify(x16sol1));
await rechaza('un jefe no crea un contrato nuevo desde el PDF', `select guardar_certificado($1::jsonb)`, /lo carga gerencia/,
  [JSON.stringify({ ...x16pdfObra, contrato: { ...x16pdfObra.contrato, ada_numero: 'ADA-NUEVA' } })]);
await como(U.gg);
await db.query(`update perfiles set firma_url = 'data:image/png;base64,FIRMAGG' where id = $1`, [U.gg]);
await db.query(`select aprobar_certificado($1)`, [x16c1]);
const x16a1 = await uno(`select c.estado, c.firma_url, s.estado as sol from certificados c join solicitudes_certificado s on s.certificado_id = c.id where c.id = $1`, [x16c1]);
ok('aprobar usa la firma del perfil y aprueba la solicitud vinculada', x16a1.estado === 'aprobado' && x16a1.firma_url === 'data:image/png;base64,FIRMAGG' && x16a1.sol === 'aprobada', JSON.stringify(x16a1));
await como(U.gerE);
const x16c2 = (await uno(`select guardar_certificado($1::jsonb) as id`, [JSON.stringify({ ...x16pdfObra, items: undefined, cabecera: { periodo: 'Noviembre 2026' } })])).id;
const x16vc2 = await uno(`select contrato_id, acum_anterior_importe::float ant from v_certificados where id = $1`, [x16c2]);
ok('un PDF con el mismo N° de ADA usa el mismo contrato y arrastra lo certificado', x16vc2.contrato_id === x16vc1.contrato_id && x16vc2.ant === 1000333.33, JSON.stringify(x16vc2));
const x16it2 = await q(`select contrato_item_id as id, importe_total::float t, med_acum_anterior_importe::float a from certificado_items where certificado_id = $1 order by numero`, [x16c2]);
ok('el segundo certificado parte con el acumulado anterior por ítem', x16it2[0].a === 1000000 && x16it2[1].a === 333.33, JSON.stringify(x16it2));
await db.query(`select guardar_certificado($1::jsonb)`, [JSON.stringify({ certificado_id: x16c2,
  items: [{ id: x16it2[0].id, descripcion: 'Demolición', um: 'gl', cantidad: 1, importe_unitario: 1000000, presente_importe: 1 },
          { id: x16it2[1].id, descripcion: 'Revoque', um: 'm2', cantidad: 3, importe_unitario: 333.33, presente_importe: 0 }] })]);
await rechaza('no se certifica más que el importe del ítem (en pesos)', `select emitir_certificado($1, 'data:image/png;base64,AAA')`, /Sobre-certificación en el ítem 1/, [x16c2]);
await rechaza('los ítems ya certificados no cambian de precio', `select guardar_certificado($1::jsonb)`, /ya tiene certificados emitidos/, [JSON.stringify({ certificado_id: x16c2,
  items: [{ id: x16it2[0].id, descripcion: 'Demolición', um: 'gl', cantidad: 1, importe_unitario: 2000000, presente_importe: 0 },
          { id: x16it2[1].id, descripcion: 'Revoque', um: 'm2', cantidad: 3, importe_unitario: 333.33, presente_importe: 0 }] })]);
await db.query(`delete from certificados where id = $1`, [x16c2]);
ok('un borrador se puede borrar', !(await q(`select 1 from certificados where id = $1`, [x16c2])).length);

// abonos maestros
const x16ab = (await uno(`select guardar_abono($1::jsonb) as id`, [JSON.stringify({
  rubro: 'CORTE_DE_PASTO', comuna: '8B', contratista: 'Verde SRL', ada_numero: 'ADA-PASTO', obra_servicio: 'Corte de pasto',
  fecha_oc_emision: '2026-03-15', duracion_meses: 12, items: [{ descripcion: 'Corte mensual', um: 'MES', cantidad: 1, importe_unitario: 250000 }] })])).id;
const x16kab = await uno(`select fecha_inicio::text fi, fecha_fin::text ff, monto_contratado::float m, rubro, comuna, (select cantidad::float from contrato_items where contrato_id = c.id) cant from contratos c where id = $1`, [x16ab]);
ok('el abono arranca el mes siguiente a la OC, dura lo indicado y guarda toda la vigencia', x16kab.fi === '2026-04-01' && x16kab.ff === '2027-03-31' && x16kab.m === 3000000 && x16kab.cant === 12 && x16kab.rubro === 'CORTE_DE_PASTO', JSON.stringify(x16kab));
const x16otroAbono = (await uno(`select guardar_abono($1::jsonb) as id`, [JSON.stringify({
  rubro: 'ASCENSORES', comuna: '10A', contratista: 'Elevar SA', fecha_oc_emision: '2026-01-10', duracion_meses: 6,
  items: [{ descripcion: 'Mantenimiento', um: 'MES', cantidad: 1, importe_unitario: 100000 }] })])).id;
await como(U.jefeE);
await rechaza('los abonos los carga gerencia', `select guardar_abono($1::jsonb)`, /los carga gerencia/, [JSON.stringify({ contratista: 'x', fecha_oc_emision: '2026-01-01', duracion_meses: 1, items: [] })]);
const x16rMes = (await uno(`select certificar_abonos_del_mes('2026-05-01', null, array['8B']) as r`)).r;
const x16deAb = x16rMes.contratos.find((x) => x.contrato_id === x16ab);
ok('certificar el mes filtra por comuna y emite la parte del mes', x16rMes.contratos.every((x) => x.comuna === '8B') && x16deAb?.resultado === 'emitido' && Number(x16deAb.monto) === 250000, JSON.stringify(x16rMes));
const x16cAb = await uno(`select generado_automaticamente, (select count(*)::int from solicitudes_certificado s where s.certificado_id = c.id) sols from certificados c where id = $1`, [x16deAb.certificado_id]);
ok('queda marcado como automático y sin solicitud (como la v1)', x16cAb.generado_automaticamente === true && x16cAb.sols === 0, JSON.stringify(x16cAb));
ok('el mismo mes no se certifica dos veces', (await uno(`select certificar_abonos_del_mes('2026-05-01', $1) as r`, [x16ab])).r.contratos[0].resultado === 'ya_certificado');
await rechaza('no se certifica un mes que no empezó', `select certificar_abonos_del_mes((date_trunc('month', now()) + interval '2 month')::date)`, /todavía no empezó/);
ok('el último día hábil saltea fines de semana y feriados', (await uno(`select ultimo_dia_habil('2026-10-05')::text a, ultimo_dia_habil('2026-08-03')::text b, ultimo_dia_habil('2026-01-20')::text c`)).a === '2026-10-30');
const x16auto = (await uno(`select certificados_automaticos(true) as r`)).r;
ok('la emisión automática forzada emite el mes siguiente', x16auto.ejecutado === true && x16auto.mes === new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 7) && /certificados generados/.test(x16auto.mensaje), JSON.stringify(x16auto).slice(0, 300));
await como(U.gerE);
await db.query(`select guardar_abono($1::jsonb)`, [JSON.stringify({ id: x16otroAbono, contratista: 'Elevar SA', fecha_oc_emision: '2026-01-10', duracion_meses: 6, estado: 'pausado',
  items: [{ id: (await uno(`select id from contrato_items where contrato_id = $1`, [x16otroAbono])).id, descripcion: 'Mantenimiento', um: 'MES', cantidad: 1, importe_unitario: 100000 }] })]);
ok('un abono pausado no se certifica', !(await uno(`select certificar_abonos_del_mes('2026-05-01', $1) as r`, [x16otroAbono])).r.contratos.length);
await servicio();
const x16srv = (await uno(`select certificar_abonos_del_mes('2026-06-01', $1) as r`, [x16ab])).r.contratos[0];
const x16srvC = await uno(`select c.estado, c.subtotal_presente::float s, c.acum_anterior_importe::float a, c.emitido_por, c.generado_automaticamente g
  from certificados c where c.id = $1`, [x16srv?.certificado_id]);
ok('la tarea sin usuario emite el mes con la misma cuenta (parte del mes y acumulado anterior)', x16srv?.resultado === 'emitido'
  && x16srvC.s === 250000 && x16srvC.a > 0 && x16srvC.emitido_por === null && x16srvC.g === true, JSON.stringify({ x16srv, x16srvC }));
const x16autoSrv = (await uno(`select certificados_automaticos(false) as r`)).r;
ok('la emisión automática sin usuario solo corre el último día hábil', typeof x16autoSrv.ejecutado === 'boolean' && /hábil|Emisión/.test(x16autoSrv.mensaje), JSON.stringify(x16autoSrv).slice(0, 200));


// ---------------------------------------------------------------- 17. fase 15: estado obra y firma
titulo('17. Órdenes: estado Obra (Futura Obra) y firma de conformidad');
await como(U.gerE);
const x17u = (await uno(`insert into ubicaciones (nombre, direccion) values ('Escuela 99', 'Calle 1 234') returning id`)).id;
const x17ot = (await uno(`insert into ordenes_trabajo (titulo, ubicacion_id, checklist, prioridad)
  values ('Techo con filtraciones', $1, '[{"id":"1","tarea":"Revisar","hecho":false}]', 'alta') returning id`, [x17u])).id;
await como(U.opE);
await rechaza('un operario no convierte una orden en obra', `select convertir_ot_en_obra($1)`, /convertir la orden en obra/, [x17ot]);
await rechaza('un operario no la pasa a obra con un update', `update ordenes_trabajo set estado = 'obra' where id = $1`, /convertir la orden en obra/, [x17ot]);
await como(U.gerE);
const x17p = (await uno(`select convertir_ot_en_obra($1) as id`, [x17ot])).id;
const x17pd = await uno(`select tipo, estado, descripcion, prioridad, sitio, ubicacion_id from pendientes where id = $1`, [x17p]);
const x17o = await uno(`select estado::text from ordenes_trabajo where id = $1`, [x17ot]);
ok('convertir en obra crea el pendiente de tipo obra y deja la orden en "obra"',
  x17o.estado === 'obra' && x17pd.tipo === 'obra' && x17pd.descripcion === 'Techo con filtraciones' && x17pd.prioridad === 'alta'
  && x17pd.ubicacion_id === x17u && /Escuela 99/.test(x17pd.sitio), JSON.stringify({ x17o, x17pd }));
await rechaza('no se convierte dos veces', `select convertir_ot_en_obra($1)`, /No se puede convertir/, [x17ot]);
await rechaza('una obra no vuelve a pendiente', `update ordenes_trabajo set estado = 'pendiente' where id = $1`, /no puede pasar a pendiente/, [x17ot]);
await rechaza('completar la obra con el checklist incompleto pide el motivo', `update ordenes_trabajo set estado = 'completada' where id = $1`, /Faltan tareas del checklist/, [x17ot]);
const x17c = await uno(`update ordenes_trabajo set estado = 'completada', motivos_incompleto = '[{"id":"m","texto":"Se hace como obra"}]'
  where id = $1 returning estado::text, validado_por, fecha_validacion`, [x17ot]);
ok('la obra se completa con el motivo y queda validada por quien la cerró', x17c.estado === 'completada' && x17c.validado_por === U.gerE && !!x17c.fecha_validacion, JSON.stringify(x17c));
const x17ot2 = (await uno(`insert into ordenes_trabajo (titulo) values ('Obra a cancelar') returning id`)).id;
await db.query(`select convertir_ot_en_obra($1)`, [x17ot2]);
ok('una obra se puede cancelar', (await uno(`update ordenes_trabajo set estado = 'cancelada' where id = $1 returning estado::text`, [x17ot2])).estado === 'cancelada');
ok('v_ordenes muestra el estado obra', (await uno(`select count(*)::int n from v_ordenes where id = $1 and estado::text = 'cancelada'`, [x17ot2])).n === 1);

// firma
const x17ot3 = (await uno(`insert into ordenes_trabajo (titulo, asignado_a) values ('Para firmar', $1) returning id`, [U.opE])).id;
await como(U.opE);
await db.query(`update ordenes_trabajo set estado = 'en_progreso' where id = $1`, [x17ot3]);
const x17f = await uno(`update ordenes_trabajo set firma_url = 'data:image/png;base64,FIRMA', firma_nombre = 'Juan Pérez', firma_at = '2000-01-01'
  where id = $1 returning firma_nombre, firma_at`, [x17ot3]);
ok('el operario firma la orden y la fecha la pone la base', x17f.firma_nombre === 'Juan Pérez' && new Date(x17f.firma_at).getFullYear() > 2020, JSON.stringify(x17f));
await rechaza('la firma tiene que ser una imagen', `update ordenes_trabajo set firma_url = 'http://x' where id = $1`, /firma_chk/, [x17ot3]);
const x17v = await uno(`select firma_url, firma_nombre from v_ordenes where id = $1`, [x17ot3]);
ok('v_ordenes trae la firma', x17v.firma_url === 'data:image/png;base64,FIRMA' && x17v.firma_nombre === 'Juan Pérez');
const x17b = await uno(`update ordenes_trabajo set firma_url = null where id = $1 returning firma_nombre, firma_at`, [x17ot3]);
ok('borrar la firma limpia el nombre y la fecha', x17b.firma_nombre === null && x17b.firma_at === null);
await servicio();

// ---------------------------------------------------------------- resultado
await servicio();
console.log(`\n${pasaron} pruebas pasaron, ${fallas.length} fallaron.`);
if (fallas.length) {
  console.log('\nFallas:');
  for (const f of fallas) console.log(`  - ${f}`);
  process.exit(1);
}
