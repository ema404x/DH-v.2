// Pruebas de la cola sin señal del portal de operarios (app/lib/portal-cola.ts), con IndexedDB simulada.
//   npx deno test -A --unstable-sloppy-imports pruebas/portal-cola.test.ts
import 'npm:fake-indexeddb@6/auto';
import { assertEquals } from 'jsr:@std/assert@1';

// Entorno de navegador mínimo
// deno-lint-ignore no-explicit-any
const g = globalThis as any;
g.process ??= { env: {} };
g.process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
let enLinea = true;
Object.defineProperty(g.navigator, 'onLine', { get: () => enLinea, configurable: true });

// fetch simulado: cada llamada se anota; la respuesta la decide `responder`.
let llamadas: { accion: string; ot?: string; foto_id?: string }[] = [];
let responder: (c: Record<string, unknown>) => Response | 'sin_red' = () => Response.json({ ok: true });
g.fetch = async (_url: string, init: RequestInit) => {
  const c = JSON.parse(String(init.body));
  llamadas.push({ accion: c.accion, ot: c.ot, foto_id: c.foto_id });
  const r = responder(c);
  if (r === 'sin_red') throw new TypeError('Failed to fetch');
  return r;
};
const rechazo = (msg: string) => Response.json({ error: msg }, { status: 400 });

const { hacer, colaDe, enviarCola, encolar, descartar, reintentar, aplicarCola } = await import('../app/lib/portal-cola.ts');

const T = 'token-prueba';
async function limpiar() {
  for (const i of await colaDe(T)) await descartar(i.id!);
  llamadas = [];
  responder = () => Response.json({ ok: true });
  enLinea = true;
}

Deno.test('con señal y sin nada en espera, va directo', async () => {
  await limpiar();
  assertEquals(await hacer(T, 'P', { tipo: 'iniciar', ot: 'A', gps: null }), 'enviado');
  assertEquals(llamadas.map((l) => l.accion), ['iniciar']);
  assertEquals((await colaDe(T)).length, 0);
});

Deno.test('sin señal queda en la cola, y al volver se envía en orden', async () => {
  await limpiar();
  enLinea = false;
  assertEquals(await hacer(T, 'P', { tipo: 'iniciar', ot: 'A', gps: null }), 'en_cola');
  assertEquals(await hacer(T, 'P', { tipo: 'foto', ot: 'A', foto_id: 'f1', imagen: 'data:image/jpeg;base64,AA' }), 'en_cola');
  assertEquals(await hacer(T, 'P', { tipo: 'finalizar', ot: 'A', hechas: [], motivo: '', notas: '', firma_url: null, gps: null }), 'en_cola');
  assertEquals(llamadas.length, 0);
  enLinea = true;
  assertEquals(await enviarCola(T, 'P'), 'listo');
  assertEquals(llamadas.map((l) => l.accion), ['iniciar', 'foto', 'finalizar']);
  assertEquals((await colaDe(T)).length, 0);
});

Deno.test('si se corta la red a mitad de camino, lo que sigue queda guardado', async () => {
  await limpiar();
  await encolar(T, { tipo: 'iniciar', ot: 'A', gps: null });
  await encolar(T, { tipo: 'foto', ot: 'A', foto_id: 'f1', imagen: 'x' });
  responder = (c) => (c.accion === 'foto' ? 'sin_red' : Response.json({ ok: true }));
  assertEquals(await enviarCola(T, 'P'), 'sin_red');
  const quedan = await colaDe(T);
  assertEquals(quedan.map((i) => i.op.tipo), ['foto']);
  assertEquals(quedan[0].error, null);
});

Deno.test('con algo en espera de esa orden, lo nuevo también espera (no se adelanta)', async () => {
  await limpiar();
  await encolar(T, { tipo: 'iniciar', ot: 'A', gps: null });
  assertEquals(await hacer(T, 'P', { tipo: 'finalizar', ot: 'A', hechas: [], motivo: '', notas: '', firma_url: null, gps: null }), 'en_cola');
  assertEquals(llamadas.length, 0);
});

Deno.test('un rechazo de la base queda guardado con el motivo y frena solo esa orden', async () => {
  await limpiar();
  await encolar(T, { tipo: 'finalizar', ot: 'A', hechas: [], motivo: '', notas: '', firma_url: null, gps: null });
  await encolar(T, { tipo: 'foto', ot: 'A', foto_id: 'f2', imagen: 'x' });
  await encolar(T, { tipo: 'iniciar', ot: 'B', gps: null });
  responder = (c) => (c.ot === 'A' ? rechazo('Faltan tareas del checklist.') : Response.json({ ok: true }));
  assertEquals(await enviarCola(T, 'P'), 'con_rechazos');
  assertEquals(llamadas.map((l) => `${l.accion}:${l.ot}`), ['finalizar:A', 'iniciar:B']);
  const quedan = await colaDe(T);
  assertEquals(quedan.map((i) => [i.op.tipo, i.error]), [['finalizar', 'Faltan tareas del checklist.'], ['foto', null]]);
  // Probar de nuevo (ahora la base acepta) y se envía lo que quedaba de esa orden.
  responder = () => Response.json({ ok: true });
  await reintentar(quedan[0].id!);
  assertEquals(await enviarCola(T, 'P'), 'listo');
  assertEquals((await colaDe(T)).length, 0);
});

Deno.test('"ya estaba" no es un error: el envío anterior había llegado', async () => {
  await limpiar();
  await encolar(T, { tipo: 'iniciar', ot: 'A', gps: null });
  await encolar(T, { tipo: 'finalizar', ot: 'A', hechas: [], motivo: '', notas: '', firma_url: null, gps: null });
  responder = (c) => rechazo(c.accion === 'iniciar' ? 'Esta orden ya no está para empezar.' : 'Esta orden no está en curso.');
  assertEquals(await enviarCola(T, 'P'), 'listo');
  assertEquals((await colaDe(T)).length, 0);
  // y directo, con señal
  assertEquals(await hacer(T, 'P', { tipo: 'iniciar', ot: 'C', gps: null }), 'enviado');
});

Deno.test('pase vencido: no se envía nada y no se pierde nada', async () => {
  await limpiar();
  await encolar(T, { tipo: 'iniciar', ot: 'A', gps: null });
  responder = () => rechazo('Tu ingreso venció. Escaneá el QR y poné la clave de nuevo.');
  assertEquals(await enviarCola(T, 'P'), 'vencido');
  const quedan = await colaDe(T);
  assertEquals(quedan.length, 1);
  assertEquals(quedan[0].error, null);
});

Deno.test('el servidor caído (500) cuenta como sin señal, no como rechazo', async () => {
  await limpiar();
  await encolar(T, { tipo: 'iniciar', ot: 'A', gps: null });
  responder = () => new Response('caído', { status: 503 });
  assertEquals(await enviarCola(T, 'P'), 'sin_red');
  assertEquals((await colaDe(T))[0].error, null);
});

Deno.test('la foto reenviada lleva el mismo id (la base no la duplica)', async () => {
  await limpiar();
  await encolar(T, { tipo: 'foto', ot: 'A', foto_id: 'fija', imagen: 'x' });
  responder = () => 'sin_red';
  await enviarCola(T, 'P');
  responder = () => Response.json({ ok: true });
  await enviarCola(T, 'P');
  assertEquals(llamadas.map((l) => l.foto_id), ['fija', 'fija']);
});

Deno.test('cada lugar (token) tiene su propia cola', async () => {
  await limpiar();
  await encolar('otro-lugar', { tipo: 'iniciar', ot: 'Z', gps: null });
  assertEquals((await colaDe(T)).length, 0);
  assertEquals((await colaDe('otro-lugar')).length, 1);
  for (const i of await colaDe('otro-lugar')) await descartar(i.id!);
});

Deno.test('la lista se ve con lo que está esperando aplicado', () => {
  const ordenes = [
    { id: 'A', estado: 'pendiente', portal_nombre: null },
    { id: 'B', estado: 'en_progreso', portal_nombre: 'Juan' },
    { id: 'C', estado: 'asignada', portal_nombre: null },
  ];
  const cola = [
    { token: T, creado: '', op: { tipo: 'iniciar' as const, ot: 'A', gps: null } },
    { token: T, creado: '', op: { tipo: 'finalizar' as const, ot: 'B', hechas: [], motivo: '', notas: '', firma_url: null, gps: null } },
  ];
  assertEquals(aplicarCola(ordenes, cola, 'Pedro').map((o) => [o.id, o.estado, o.portal_nombre]),
    [['A', 'en_progreso', 'Pedro'], ['B', 'pendiente_validacion', 'Juan'], ['C', 'asignada', null]]);
});
