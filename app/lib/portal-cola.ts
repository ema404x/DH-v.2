// Portal de operarios sin señal (como usePortalOfflineActions de la v1, con las reglas de la v2).
// Lo que el operario hace sin señal queda en el teléfono (IndexedDB "dh1-portal", aparte de la cola del portal con
// usuario) y se envía solo, en orden, cuando vuelve la señal. La base sigue siendo la que decide: si rechaza algo,
// queda guardado con el motivo y el operario elige probar de nuevo o descartarlo. Todo es repetible: la foto lleva su
// id fijado en el teléfono; iniciar o finalizar dos veces no duplica (la base contesta que ya estaba).

import { SinRed, enviarAccion } from './portal';

export type OpPortal =
  | { tipo: 'iniciar'; ot: string; gps: unknown }
  | { tipo: 'foto'; ot: string; foto_id: string; imagen: string }
  | { tipo: 'finalizar'; ot: string; hechas: string[]; motivo: string; notas: string; firma_url: string | null; gps: unknown };

export interface ItemCola {
  id?: number;
  token: string;
  op: OpPortal;
  creado: string;
  error?: string | null;
}

// ------------------------------------------------------------------ IndexedDB propia
let abierta: Promise<IDBDatabase> | null = null;
function abrir(): Promise<IDBDatabase> {
  if (abierta) return abierta;
  abierta = new Promise<IDBDatabase>((ok, mal) => {
    if (typeof indexedDB === 'undefined') return mal(new Error('Este navegador no permite guardar datos en el teléfono.'));
    const p = indexedDB.open('dh1-portal', 1);
    p.onupgradeneeded = () => { if (!p.result.objectStoreNames.contains('cola')) p.result.createObjectStore('cola', { keyPath: 'id', autoIncrement: true }); };
    p.onsuccess = () => { p.result.onversionchange = () => { p.result.close(); abierta = null; }; ok(p.result); };
    p.onerror = () => mal(p.error ?? new Error('No se pudo abrir el almacenamiento del teléfono.'));
  });
  abierta.catch(() => { abierta = null; });
  return abierta;
}
async function tx<T>(modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await abrir();
  return new Promise<T>((ok, mal) => {
    const t = db.transaction('cola', modo);
    const r = f(t.objectStore('cola'));
    let res: T;
    if (r) r.onsuccess = () => (res = r.result);
    t.oncomplete = () => ok(res);
    t.onerror = () => mal(t.error ?? new Error('No se pudo guardar en el teléfono.'));
    t.onabort = () => mal(t.error ?? new Error('No se pudo guardar en el teléfono. Puede que no quede espacio.'));
  });
}

export async function colaDe(token: string): Promise<ItemCola[]> {
  const todo = await tx<ItemCola[]>('readonly', (s) => s.getAll()).catch(() => []);
  return todo.filter((i) => i.token === token).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}
export const encolar = (token: string, op: OpPortal) => tx<IDBValidKey>('readwrite', (s) => s.add({ token, op, creado: new Date().toISOString(), error: null }));
const guardar = (i: ItemCola) => tx<IDBValidKey>('readwrite', (s) => s.put(i));
export const descartar = (id: number) => tx<undefined>('readwrite', (s) => s.delete(id));
export async function reintentar(id: number) {
  const i = await tx<ItemCola | undefined>('readonly', (s) => s.get(id));
  if (i) await guardar({ ...i, error: null });
}

// ------------------------------------------------------------------ envío
// "Ya estaba" no es un error: el envío anterior llegó aunque se perdió la respuesta.
const yaEstaba = (op: OpPortal, msg: string) =>
  (op.tipo === 'iniciar' && /ya no está para empezar/.test(msg)) || (op.tipo === 'finalizar' && /no está en curso/.test(msg));

export type ResultadoEnvio = 'listo' | 'sin_red' | 'vencido' | 'con_rechazos';

let enviando = false;
// Envía en orden. Una orden con algo rechazado frena lo que sigue de esa orden (no de las otras).
export async function enviarCola(token: string, pase: string): Promise<ResultadoEnvio> {
  if (enviando) return 'listo';
  enviando = true;
  try {
    const trabadas = new Set<string>();
    for (const item of await colaDe(token)) {
      if (item.error || trabadas.has(item.op.ot)) { trabadas.add(item.op.ot); continue; }
      try {
        await enviarAccion(pase, item.op);
        await descartar(item.id!);
      } catch (e) {
        if (e instanceof SinRed) return 'sin_red';
        const msg = e instanceof Error ? e.message : 'No se pudo enviar.';
        if (/venció/.test(msg)) return 'vencido';
        if (yaEstaba(item.op, msg)) { await descartar(item.id!); continue; }
        await guardar({ ...item, error: msg });
        trabadas.add(item.op.ot);
      }
    }
    return (await colaDe(token)).some((i) => i.error) ? 'con_rechazos' : 'listo';
  } finally {
    enviando = false;
  }
}

// Con señal y sin nada esperando para esa orden, va directo (la base contesta al momento y el operario ve el error).
// Sin señal, o si ya hay algo de esa orden en espera, queda en la cola. Devuelve si quedó guardado sin enviar.
export async function hacer(token: string, pase: string, op: OpPortal): Promise<'enviado' | 'en_cola'> {
  const espera = (await colaDe(token)).some((i) => i.op.ot === op.ot);
  if (!espera && navigator.onLine) {
    try {
      await enviarAccion(pase, op);
      return 'enviado';
    } catch (e) {
      if (!(e instanceof SinRed)) {
        if (yaEstaba(op, e instanceof Error ? e.message : '')) return 'enviado';
        throw e;
      }
    }
  }
  await encolar(token, op);
  return 'en_cola';
}

// Cómo se ve la orden con lo que está esperando (para mostrarla bien sin señal).
export function aplicarCola<T extends { id: string; estado: string; portal_nombre: string | null }>(ordenes: T[], cola: ItemCola[], nombre: string): T[] {
  return ordenes.map((o) => {
    let r = o;
    for (const i of cola) {
      if (i.op.ot !== o.id) continue;
      if (i.op.tipo === 'iniciar') r = { ...r, estado: 'en_progreso', portal_nombre: r.portal_nombre ?? nombre };
      if (i.op.tipo === 'finalizar') r = { ...r, estado: 'pendiente_validacion' };
    }
    return r;
  });
}
