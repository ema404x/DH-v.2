// Pruebas del motor de la cola sin señal (app/lib/offline/motor.ts).
// Simula un teléfono: un almacén en memoria y un "servidor" que a veces no responde y a veces rechaza.
// Necesita Node 23.6 o superior (ejecuta TypeScript directamente).
//
//   cd pruebas && npm run test:offline

import {
  aplicarPendientes, descartarRechazadasOT, encolar, procesar, reintentarOT, resumir, validarLocal,
} from '../app/lib/offline/motor.ts';

let pasaron = 0;
const fallas = [];
function ok(nombre, cond, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallas.push(nombre); console.log(`  ✗ ${nombre} ${detalle}`); }
}
const titulo = (t) => console.log(`\n── ${t}`);

function almacenEnMemoria() {
  let serie = 0;
  const filas = new Map();
  return {
    todas: async () => [...filas.values()].map((o) => ({ ...o })),
    agregar: async (op) => { const nueva = { ...op, id: ++serie }; filas.set(nueva.id, nueva); return { ...nueva }; },
    actualizar: async (op) => { filas.set(op.id, { ...op }); },
    borrar: async (id) => { filas.delete(id); },
  };
}

class ErrorDeRed extends Error {}
const clasificar = (e) => (e instanceof ErrorDeRed ? 'red' : e.message);

const YO = 'u-operario';
const OTRO = 'u-otro';
const quien = { id: YO, nombre: 'Juan Pérez' };
const tareas = (a, b) => [{ id: '1', tarea: 'Cortar energía', hecho: a }, { id: '2', tarea: 'Medir', hecho: b }];
const otBase = (extra = {}) => ({
  id: 'ot-1', estado: 'pendiente', asignado_a: null, asignado_nombre: null, checklist: tareas(false, false), notas: null,
  motivos_incompleto: [], requiere_fotos: false, fecha_inicio_real: null, fecha_fin_real: null, rechazo_comentario: null,
  tareas_total: 2, tareas_hechas: 0, fotos_total: 0, ...extra,
});
const ejec = (a, b, motivos = []) => ({ checklist: tareas(a, b), notas: 'nota', motivos_incompleto: motivos });

// ================================================================ cola
titulo('Cola: orden y fusión');
{
  const a = almacenEnMemoria();
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'iniciar', datos: null });
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'guardar', datos: ejec(true, false) });
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'guardar', datos: ejec(true, true) });
  let ops = await a.todas();
  ok('dos "guardar" seguidos de la misma orden se funden en uno', ops.length === 2);
  ok('queda el último estado del checklist', ops[1].datos.checklist.every((t) => t.hecho));

  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'foto', datos: { foto_id: 'f1' } });
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'guardar', datos: ejec(true, true) });
  await encolar(a, { usuario_id: YO, ot_id: 'ot-2', tipo: 'guardar', datos: ejec(false, false) });
  ops = await a.todas();
  ok('un "guardar" después de una foto no se funde con el anterior (se respeta el orden)', ops.length === 5);
  ok('órdenes distintas no se mezclan', ops.filter((o) => o.ot_id === 'ot-2').length === 1);

  const enviadas = [];
  const r = await procesar(a, YO, async (op) => { enviadas.push(`${op.ot_id}:${op.tipo}`); }, clasificar);
  ok('se envía todo, en el orden en que se hizo',
    enviadas.join(' ') === 'ot-1:iniciar ot-1:guardar ot-1:foto ot-1:guardar ot-2:guardar', enviadas.join(' '));
  ok('la cola queda vacía', (await a.todas()).length === 0 && r.enviadas === 5 && r.quedan === 0 && !r.sinRed);
}

titulo('Cola: sin red');
{
  const a = almacenEnMemoria();
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'iniciar', datos: null });
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'finalizar', datos: ejec(true, true) });
  let llamadas = 0;
  let r = await procesar(a, YO, async () => { llamadas++; throw new ErrorDeRed(); }, clasificar);
  ok('si no hay red se frena en la primera y no intenta las siguientes', llamadas === 1 && r.sinRed && r.enviadas === 0);
  let ops = await a.todas();
  ok('nada se pierde ni se marca como rechazado', ops.length === 2 && ops.every((o) => o.estado === 'pendiente'));
  ok('queda anotado el intento', ops[0].intentos === 1);

  // Se corta a mitad: la primera llega, la segunda no.
  llamadas = 0;
  r = await procesar(a, YO, async () => { if (++llamadas === 2) throw new ErrorDeRed(); }, clasificar);
  ops = await a.todas();
  ok('si se corta a mitad, lo enviado sale de la cola y el resto espera', r.enviadas === 1 && r.sinRed && ops.length === 1 && ops[0].tipo === 'finalizar');

  r = await procesar(a, YO, async () => {}, clasificar);
  ok('al volver la red se completa', r.enviadas === 1 && (await a.todas()).length === 0);
}

titulo('Cola: rechazo de la base');
{
  const a = almacenEnMemoria();
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'iniciar', datos: null });
  await encolar(a, { usuario_id: YO, ot_id: 'ot-2', tipo: 'iniciar', datos: null });
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'finalizar', datos: ejec(true, true) });
  const servidor = async (op) => { if (op.ot_id === 'ot-1') throw new Error('La orden está cerrada. No se puede modificar.'); };
  let r = await procesar(a, YO, servidor, clasificar);
  let ops = await a.todas();
  ok('un rechazo no frena la cola: las otras órdenes se envían', r.enviadas === 1 && r.rechazadas === 2 && !r.sinRed);
  ok('lo rechazado queda guardado, con el motivo que dio la base',
    ops.length === 2 && ops.every((o) => o.estado === 'rechazada' && o.error === 'La orden está cerrada. No se puede modificar.'));
  ok('lo rechazado conserva los datos que cargó el operario', ops[1].datos.checklist.every((t) => t.hecho) && ops[1].datos.notas === 'nota');

  r = await procesar(a, YO, servidor, clasificar);
  ok('lo rechazado no se reenvía solo', r.enviadas === 0 && r.rechazadas === 0 && r.quedan === 0);

  const res = resumir(await a.todas(), YO);
  ok('el resumen marca la orden con su error', res.rechazadas === 2 && res.porOT['ot-1'].rechazadas === 2 && /cerrada/.test(res.porOT['ot-1'].error));

  await reintentarOT(a, YO, 'ot-1');
  const orden = [];
  r = await procesar(a, YO, async (op) => { orden.push(op.tipo); }, clasificar);
  ok('"Probar de nuevo" reenvía todo lo de esa orden, en el orden original', r.enviadas === 2 && orden.join(' ') === 'iniciar finalizar');

  await encolar(a, { usuario_id: YO, ot_id: 'ot-3', tipo: 'iniciar', datos: null });
  await procesar(a, YO, async () => { throw new Error('No se puede.'); }, clasificar);
  await descartarRechazadasOT(a, YO, 'ot-3');
  ok('"Descartar" saca lo rechazado de esa orden', (await a.todas()).length === 0);
}

titulo('Cola: cada usuario envía lo suyo');
{
  const a = almacenEnMemoria();
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'iniciar', datos: null });
  await encolar(a, { usuario_id: OTRO, ot_id: 'ot-9', tipo: 'iniciar', datos: null });
  const r = await procesar(a, YO, async () => {}, clasificar);
  const ops = await a.todas();
  ok('no se envía con mi sesión lo que dejó otro usuario en el teléfono', r.enviadas === 1 && ops.length === 1 && ops[0].usuario_id === OTRO);
  ok('el resumen avisa que hay cambios de otro usuario', resumir(ops, YO).deOtros === 1 && resumir(ops, YO).pendientes === 0);
}

// ================================================================ vista local
titulo('Cómo se ve la orden en el teléfono');
{
  const a = almacenEnMemoria();
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'iniciar', datos: null });
  let v = aplicarPendientes(otBase(), await a.todas(), quien);
  ok('iniciar sin señal: se ve en curso y a mi nombre (estaba libre)', v.estado === 'en_progreso' && v.asignado_a === YO && v.asignado_nombre === 'Juan Pérez' && v.fecha_inicio_real);

  v = aplicarPendientes(otBase({ asignado_a: OTRO, asignado_nombre: 'Otra persona', estado: 'asignada' }), await a.todas(), quien);
  ok('iniciar una orden ya asignada respeta al asignado', v.estado === 'en_progreso' && v.asignado_a === OTRO && v.asignado_nombre === 'Otra persona');

  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'foto', datos: { foto_id: 'f1' } });
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'guardar', datos: ejec(true, false) });
  v = aplicarPendientes(otBase(), await a.todas(), quien);
  ok('avance y fotos sin enviar se reflejan en la orden', v.tareas_hechas === 1 && v.fotos_total === 1 && v.notas === 'nota');

  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'finalizar', datos: ejec(true, true) });
  v = aplicarPendientes(otBase(), await a.todas(), quien);
  ok('finalizar sin señal: se ve "a validar"', v.estado === 'pendiente_validacion' && v.tareas_hechas === 2 && v.fecha_fin_real);

  const original = otBase();
  aplicarPendientes(original, await a.todas(), quien);
  ok('la orden guardada no se modifica (la vista es una copia)', original.estado === 'pendiente' && original.tareas_hechas === 0);

  await procesar(a, YO, async () => { throw new Error('rechazo'); }, clasificar);
  v = aplicarPendientes(otBase(), await a.todas(), quien);
  ok('lo rechazado no se aplica: la pantalla muestra el estado real', v.estado === 'pendiente' && v.fotos_total === 0);
}

// ================================================================ validación adelantada
titulo('Validación en el teléfono (mismas reglas que la base)');
{
  ok('iniciar una orden pendiente: se puede', validarLocal(otBase(), 'iniciar', null) === null);
  ok('iniciar una orden ya en curso: no', /ya está iniciada/.test(validarLocal(otBase({ estado: 'en_progreso' }), 'iniciar', null)));
  ok('cargar avance en una orden sin iniciar: no', /Primero hay que iniciarla/.test(validarLocal(otBase(), 'guardar', ejec(true, true))));
  ok('cualquier cosa en una orden cerrada: no', /está cerrada/.test(validarLocal(otBase({ estado: 'completada' }), 'foto', {})));
  const enCurso = otBase({ estado: 'en_progreso' });
  ok('finalizar con tareas sin marcar y sin motivo: no', /Faltan tareas del checklist/.test(validarLocal(enCurso, 'finalizar', ejec(true, false))));
  ok('finalizar con tareas sin marcar y con motivo: se puede', validarLocal(enCurso, 'finalizar', ejec(true, false, [{ id: 'm1', texto: 'Sin acceso' }])) === null);
  ok('finalizar con todo marcado: se puede', validarLocal(enCurso, 'finalizar', ejec(true, true)) === null);
  const pideFotos = otBase({ estado: 'en_progreso', requiere_fotos: true });
  ok('finalizar sin fotos una orden que las pide: no', /pide fotos/.test(validarLocal(pideFotos, 'finalizar', ejec(true, true))));

  // Una foto sacada sin señal cuenta: está en la cola y la vista local la suma.
  const a = almacenEnMemoria();
  await encolar(a, { usuario_id: YO, ot_id: 'ot-1', tipo: 'foto', datos: { foto_id: 'f1' } });
  const conFoto = aplicarPendientes(pideFotos, await a.todas(), quien);
  ok('con una foto guardada en el teléfono, se puede finalizar sin señal', validarLocal(conFoto, 'finalizar', ejec(true, true)) === null);
}

console.log(`\n${pasaron} pruebas pasaron, ${fallas.length} fallaron.`);
if (fallas.length) {
  console.log('\nFallas:');
  for (const f of fallas) console.log(`  - ${f}`);
  process.exit(1);
}
