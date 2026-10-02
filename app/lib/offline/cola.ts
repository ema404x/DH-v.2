import { supabase } from '../supabase/client';
import { limpiarError } from '../errores';
import { leerTodo, poner, quitar } from './db';
import {
  descartarRechazadasOT, encolar as encolarEnMotor, procesar, reintentarOT, resumir,
  type Almacen, type DatosFoto, type Ejecucion, type Op, type ResultadoEnvio, type ResumenCola, type TipoOp,
} from './motor';

// Cola sin señal, del lado del navegador: guarda las operaciones en IndexedDB y las envía a Supabase.
// La lógica (orden, fusión, rechazos) está en motor.ts.

const BUCKET = 'ot-fotos';
const ESPERA_MS = 20_000;
const ESPERA_FOTO_MS = 90_000;

const almacen: Almacen = {
  todas: () => leerTodo<Op>('cola'),
  agregar: async (op) => {
    const { id: _sinId, ...resto } = op;
    const id = (await poner('cola', resto)) as number;
    return { ...resto, id };
  },
  actualizar: async (op) => {
    await poner('cola', op);
  },
  borrar: async (id) => {
    await quitar('cola', id);
  },
};

// ------------------------------------------------------------------ avisos a la pantalla
type Oyente = () => void;
const oyentes = new Set<Oyente>();
let enviando = false;

export function suscribir(oyente: Oyente): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}
const avisar = () => oyentes.forEach((o) => o());
export const estaEnviando = () => enviando;
// Sube cada vez que un envío cambió algo en el servidor: las pantallas lo miran para recargar.
let envios = 0;
export const versionDeEnvios = () => envios;

// ------------------------------------------------------------------ errores: ¿red o rechazo?
class SinRespuesta extends Error {}

function conLimite<T>(promesa: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new SinRespuesta('El servidor no respondió a tiempo.')), ms);
    Promise.resolve(promesa).then(
      (v) => {
        clearTimeout(reloj);
        resolver(v);
      },
      (e) => {
        clearTimeout(reloj);
        rechazar(e);
      },
    );
  });
}

// 'red' = no llegó o no se sabe si llegó: se reintenta (todas las operaciones se pueden repetir sin duplicar).
// Cualquier otra cosa es una respuesta de la base: se muestra su mensaje.
export function clasificar(e: unknown): 'red' | string {
  if (e instanceof SinRespuesta) return 'red';
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'red';
  const err = (e ?? {}) as { message?: string; code?: string; status?: number; statusCode?: string | number; name?: string };
  const mensaje = err.message ?? '';
  const estado = Number(err.status ?? err.statusCode ?? 0);
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout|aborted/i.test(mensaje)) return 'red';
  if (err.name === 'AuthRetryableFetchError' || err.name === 'AbortError') return 'red';
  // Sesión vencida: no es un rechazo del trabajo. Se reintenta cuando se renueve el ingreso.
  if (estado === 401 || err.code === 'PGRST301' || err.code === 'PGRST303' || /jwt expired|invalid jwt/i.test(mensaje)) return 'red';
  if (estado >= 500 || estado === 408 || estado === 429) return 'red';
  return limpiarError(e);
}

// ------------------------------------------------------------------ envío de una operación
// Todas son repetibles: si la respuesta se perdió y se manda de nuevo, el resultado es el mismo.
export async function ejecutar(op: Pick<Op, 'ot_id' | 'tipo' | 'datos'>): Promise<void> {
  const sb = supabase();

  if (op.tipo === 'foto') {
    const { foto_id, path, blob } = op.datos as DatosFoto;
    const subida = await conLimite(sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }), ESPERA_FOTO_MS);
    // "Ya existe" quiere decir que un intento anterior sí había llegado.
    if (subida.error && !/exists|duplicate/i.test(subida.error.message)) throw subida.error;
    const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const alta = await conLimite(sb.from('ot_fotos').insert({ id: foto_id, ot_id: op.ot_id, path, url }), ESPERA_MS);
    if (alta.error && alta.error.code !== '23505') {
      // La base no aceptó la foto (por ejemplo, orden cerrada): no queda el archivo huérfano.
      if (clasificar(alta.error) !== 'red') await sb.storage.from(BUCKET).remove([path]);
      throw alta.error;
    }
    return;
  }

  const cambios: Record<string, unknown> =
    op.tipo === 'iniciar'
      ? { estado: 'en_progreso', ...((op.datos as Record<string, unknown> | null) ?? {}) }
      : op.tipo === 'finalizar'
        ? { ...(op.datos as Ejecucion), estado: 'pendiente_validacion' }
        : { ...(op.datos as Ejecucion) };

  const res = await conLimite(sb.from('ordenes_trabajo').update(cambios).eq('id', op.ot_id).select('id').single(), ESPERA_MS);
  if (res.error) throw res.error;
}

// ------------------------------------------------------------------ cola
export async function encolar(usuarioId: string, otId: string, tipo: TipoOp, datos: unknown): Promise<void> {
  await encolarEnMotor(almacen, { usuario_id: usuarioId, ot_id: otId, tipo, datos });
  avisar();
}

export const operaciones = () => almacen.todas();

export async function operacionesDeOT(otId: string): Promise<Op[]> {
  return (await almacen.todas()).filter((o) => o.ot_id === otId);
}

export async function resumen(usuarioId: string): Promise<ResumenCola> {
  return resumir(await almacen.todas(), usuarioId);
}

export async function reintentar(usuarioId: string, otId: string): Promise<void> {
  await reintentarOT(almacen, usuarioId, otId);
  avisar();
  void sincronizar();
}

export async function descartar(usuarioId: string, otId: string): Promise<void> {
  await descartarRechazadasOT(almacen, usuarioId, otId);
  avisar();
}

export async function quitarOperacion(id: number): Promise<void> {
  await almacen.borrar(id);
  avisar();
}

async function enviarTodo(): Promise<ResultadoEnvio | null> {
  // Solo con sesión vigente, y solo las operaciones de ese usuario.
  const { data, error } = await supabase().auth.getSession();
  if (error || !data.session) return null;
  return procesar(almacen, data.session.user.id, ejecutar, clasificar);
}

// Envía lo pendiente. Un solo envío a la vez, aunque haya varias pestañas abiertas.
export async function sincronizar(): Promise<ResultadoEnvio | null> {
  if (enviando || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;
  if ((await almacen.todas()).every((o) => o.estado !== 'pendiente')) return null;

  enviando = true;
  avisar();
  try {
    const r: ResultadoEnvio | null =
      typeof navigator !== 'undefined' && navigator.locks
        ? await navigator.locks.request('dh1-cola', { ifAvailable: true }, (candado) => (candado ? enviarTodo() : null))
        : await enviarTodo();
    if (r && (r.enviadas > 0 || r.rechazadas > 0)) envios++;
    return r;
  } catch {
    return null;
  } finally {
    enviando = false;
    avisar();
  }
}
