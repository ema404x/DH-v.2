import { supabase } from './supabase/client';
import { exigir } from './errores';
import { comprimirImagen } from './imagen';
import { leer, leerTodo, pedirPersistencia, poner, ponerVarios, quitar, quitarVarios } from './offline/db';
import { clasificar, ejecutar, encolar, operaciones, operacionesDeOT, quitarOperacion, sincronizar } from './offline/cola';
import { aplicarPendientes, validarLocal, type DatosFoto, type Ejecucion, type Op, type TipoOp } from './offline/motor';
import type { FotoOT, OT, TareaChecklist } from './types';

// Portal del operario, pensado para trabajar con o sin señal.
//
//   · Leer: primero el servidor; si no hay red, lo último que quedó guardado en el teléfono.
//   · Escribir (iniciar, avance, fotos, finalizar): si hay red y nada en espera, va directo y la base
//     responde en el momento. Si no hay red (o se corta a mitad), queda en la cola del teléfono y se
//     envía sola al volver la señal. La pantalla muestra la orden como quedó, con el aviso "falta enviar".
//   · La base sigue siendo la autoridad: valida igual cuando llega, y si rechaza se le muestra al operario.
//   · Aprobar, devolver y cancelar (jefe de sitio, gerencia) se hacen con conexión.

export type { Ejecucion } from './offline/motor';

const ABIERTAS = ['pendiente', 'asignada', 'en_progreso', 'pendiente_validacion'];
const BUCKET = 'ot-fotos';
const ESPERA_LECTURA_MS = 12_000;

export interface Quien {
  id: string;
  nombre: string;
}

// Una orden como se ve en el teléfono: el dato del servidor más lo hecho y todavía no enviado.
export interface OTLocal extends OT {
  sinEnviar: number;
  rechazadas: number;
  errorEnvio?: string;
  // Checklist y notas de un envío que la base rechazó: se le devuelven al operario para que corrija y reenvíe.
  ejecucionRechazada?: Ejecucion;
}

function conLimite<T>(promesa: PromiseLike<T>, ms = ESPERA_LECTURA_MS): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('timeout')), ms);
    Promise.resolve(promesa).then(
      (v) => { clearTimeout(reloj); resolver(v); },
      (e) => { clearTimeout(reloj); rechazar(e); },
    );
  });
}

function comoLocal(ot: OT, ops: Op[], quien: Quien): OTLocal {
  const mias = ops.filter((o) => o.ot_id === ot.id && o.usuario_id === quien.id);
  const rechazadas = mias.filter((o) => o.estado === 'rechazada');
  return {
    ...aplicarPendientes(ot, mias, quien),
    sinEnviar: mias.length - rechazadas.length,
    rechazadas: rechazadas.length,
    errorEnvio: rechazadas[0]?.error,
    ejecucionRechazada: rechazadas.filter((o) => o.tipo === 'guardar' || o.tipo === 'finalizar').pop()?.datos as Ejecucion | undefined,
  };
}

// ------------------------------------------------------------------ lectura

export interface FiltroOT {
  ubicacion?: string;
  activo?: string;
  // Tablet de cuadrilla: en vez de "mis órdenes", las de los lugares de este jefe de sitio.
  jefe?: string;
}

export interface ListaOT {
  ots: OTLocal[];
  // true cuando no hubo señal y se muestra lo último que se había bajado
  guardadas: boolean;
}

const cumpleFiltro = (o: OT, f: FiltroOT) => (!f.ubicacion || o.ubicacion_id === f.ubicacion) && (!f.activo || o.activo_id === f.activo);
const porFecha = (a: OT, b: OT) => (a.fecha_programada ?? '9999').localeCompare(b.fecha_programada ?? '9999');

// Mis órdenes: las que tengo asignadas y las libres del sector. Con filtro (vengo de un QR),
// todas las abiertas de esa ubicación o activo. Cada vez que se cargan con señal quedan guardadas en el teléfono.
export async function listarMisOTs(quien: Quien, filtro: FiltroOT = {}): Promise<ListaOT> {
  const conFiltro = !!(filtro.ubicacion || filtro.activo);
  const ops = await operaciones();
  let ots: OT[];
  let guardadas = false;

  try {
    let q = supabase()
      .from('v_ordenes')
      .select('*')
      .in('estado', ABIERTAS)
      .order('fecha_programada', { ascending: true, nullsFirst: false })
      .limit(200);
    if (filtro.ubicacion) q = q.eq('ubicacion_id', filtro.ubicacion);
    if (filtro.activo) q = q.eq('activo_id', filtro.activo);
    if (!conFiltro) q = filtro.jefe ? q.eq('jefe_sitio_id', filtro.jefe) : q.or(`asignado_a.eq.${quien.id},asignado_a.is.null`);
    ots = exigir(await conLimite(q)) as OT[];

    await ponerVarios('ots', ots);
    if (!conFiltro) {
      // Lo que ya no está en mi lista (cerrado, reasignado) se saca del teléfono, salvo que tenga algo sin enviar.
      const vigentes = new Set(ots.map((o) => o.id));
      const conCola = new Set(ops.map((o) => o.ot_id));
      const viejas = (await leerTodo<OT>('ots')).filter((o) => !vigentes.has(o.id) && !conCola.has(o.id)).map((o) => o.id);
      await quitarVarios('ots', viejas);
      await quitarVarios('fotos', viejas);
      await quitarVarios('borradores', viejas);
      void pedirPersistencia();
    }
  } catch (e) {
    if (clasificar(e) !== 'red') throw e;
    ots = (await leerTodo<OT>('ots')).filter((o) => cumpleFiltro(o, filtro));
    guardadas = true;
  }

  // Órdenes con trabajo mío sin enviar: siempre a la vista, aunque el servidor ya no las liste.
  const presentes = new Set(ots.map((o) => o.id));
  for (const otId of new Set(ops.filter((o) => o.usuario_id === quien.id).map((o) => o.ot_id))) {
    if (presentes.has(otId)) continue;
    const guardada = await leer<OT>('ots', otId);
    if (guardada && cumpleFiltro(guardada, filtro)) ots.push(guardada);
  }

  const locales = ots
    .map((o) => comoLocal(o, ops, quien))
    .filter((o) => o.sinEnviar > 0 || o.rechazadas > 0 || ABIERTAS.includes(o.estado))
    .filter((o) => conFiltro || o.sinEnviar > 0 || o.rechazadas > 0
      || (filtro.jefe ? o.jefe_sitio_id === filtro.jefe : o.asignado_a === quien.id || o.asignado_a === null))
    .sort(porFecha);
  return { ots: locales, guardadas };
}

export async function obtenerOT(id: string, quien: Quien): Promise<{ ot: OTLocal; guardada: boolean }> {
  let ot: OT | undefined;
  let guardada = false;
  try {
    ot = exigir(await conLimite(supabase().from('v_ordenes').select('*').eq('id', id).single())) as OT;
    await poner('ots', ot);
  } catch (e) {
    if (clasificar(e) !== 'red') throw e;
    ot = await leer<OT>('ots', id);
    guardada = true;
    if (!ot) throw new Error('Esta orden no está guardada en el teléfono. Hace falta señal para abrirla.');
  }
  return { ot: comoLocal(ot, await operacionesDeOT(id), quien), guardada };
}

// Busca en las órdenes guardadas a qué ubicación o activo corresponde un QR. Sirve sin señal.
export async function resolverQRLocal(token: string): Promise<{ tipo: 'ubicacion' | 'activo'; id: string; nombre: string } | null> {
  for (const o of await leerTodo<OT>('ots')) {
    if (o.ubicacion_qr_token === token && o.ubicacion_id) return { tipo: 'ubicacion', id: o.ubicacion_id, nombre: o.ubicacion_nombre ?? '' };
    if (o.activo_qr_token === token && o.activo_id) return { tipo: 'activo', id: o.activo_id, nombre: o.activo_nombre ?? '' };
  }
  return null;
}

// ------------------------------------------------------------------ escritura del operario

export type Destino = 'enviado' | 'guardado';

// Un solo camino para todo lo que hace el operario. Devuelve si llegó al servidor o quedó en el teléfono.
async function escribir(quien: Quien, ot: OTLocal, tipo: TipoOp, datos: unknown): Promise<Destino> {
  const motivo = validarLocal(ot, tipo, datos);
  if (motivo) throw new Error(motivo);

  // Si ya hay algo de esta orden en espera, lo nuevo va detrás: el orden se respeta siempre.
  const enEspera = (await operacionesDeOT(ot.id)).length > 0;
  if (navigator.onLine && !enEspera) {
    try {
      await ejecutar({ ot_id: ot.id, tipo, datos });
      return 'enviado';
    } catch (e) {
      // Un rechazo de la base se muestra ya. Si fue la red, se guarda en el teléfono.
      if (clasificar(e) !== 'red') throw e;
    }
  }
  await encolar(quien.id, ot.id, tipo, datos);
  void sincronizar();
  return 'guardado';
}

export interface Posicion {
  gps_lat: number;
  gps_lng: number;
  gps_precision: number;
}

export function iniciarOT(quien: Quien, ot: OTLocal, posicion: Posicion | null): Promise<Destino> {
  return escribir(quien, ot, 'iniciar', posicion);
}

export async function guardarEjecucion(quien: Quien, ot: OTLocal, e: Ejecucion): Promise<Destino> {
  const destino = await escribir(quien, ot, 'guardar', e);
  await borrarBorrador(ot.id);
  return destino;
}

export async function finalizarOT(quien: Quien, ot: OTLocal, e: Ejecucion): Promise<Destino> {
  const destino = await escribir(quien, ot, 'finalizar', e);
  await borrarBorrador(ot.id);
  return destino;
}

// La posición es un dato de apoyo: si el teléfono no la da rápido, la orden se inicia igual.
export function posicionActual(): Promise<Posicion | null> {
  return new Promise((resolver) => {
    if (!('geolocation' in navigator)) return resolver(null);
    // Tope propio de 4 segundos: el "timeout" del navegador no corre mientras el cartel de permiso
    // de ubicación está sin contestar, y el operario quedaría esperando sin poder iniciar.
    setTimeout(() => resolver(null), 4000);
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({ gps_lat: p.coords.latitude, gps_lng: p.coords.longitude, gps_precision: p.coords.accuracy }),
      () => resolver(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 },
    );
  });
}

// ------------------------------------------------------------------ borrador (lo que se está escribiendo)

export interface Borrador {
  ot_id: string;
  checklist: TareaChecklist[];
  notas: string;
  motivo: string;
}

// Se guarda en el teléfono a medida que el operario marca tareas o escribe: si se cierra la app o
// se apaga el teléfono, al volver a abrir la orden está todo como lo dejó.
export const guardarBorrador = (b: Borrador) => poner('borradores', b).then(() => undefined);
export const leerBorrador = (otId: string) => leer<Borrador>('borradores', otId);
export const borrarBorrador = (otId: string) => quitar('borradores', otId).then(() => undefined);

// ------------------------------------------------------------------ acciones con conexión (validación)

async function actualizar(id: string, cambios: Record<string, unknown>): Promise<void> {
  exigir(await supabase().from('ordenes_trabajo').update(cambios).eq('id', id).select('id').single());
}

export const aprobarOT = (id: string) => actualizar(id, { estado: 'completada' });
export const rechazarOT = (id: string, comentario: string) => actualizar(id, { estado: 'en_progreso', rechazo_comentario: comentario });
export const cancelarOT = (id: string) => actualizar(id, { estado: 'cancelada' });

// ------------------------------------------------------------------ fotos

interface FotosGuardadas {
  ot_id: string;
  fotos: FotoOT[];
}

// Fotos de la orden: las ya enviadas (con señal; sin señal, la última lista conocida) y, al final,
// las que están en el teléfono esperando para subir.
export async function listarFotos(otId: string): Promise<FotoOT[]> {
  let enviadas: FotoOT[];
  try {
    enviadas = exigir(
      await conLimite(supabase().from('ot_fotos').select('id,ot_id,path,url,created_at').eq('ot_id', otId).order('created_at')),
    ) as FotoOT[];
    await poner<FotosGuardadas>('fotos', { ot_id: otId, fotos: enviadas });
  } catch (e) {
    if (clasificar(e) !== 'red') throw e;
    enviadas = (await leer<FotosGuardadas>('fotos', otId))?.fotos ?? [];
  }
  const yaEstan = new Set(enviadas.map((f) => f.id));
  const enEspera = (await operacionesDeOT(otId))
    .filter((o) => o.tipo === 'foto' && !yaEstan.has((o.datos as DatosFoto).foto_id))
    .map((o): FotoOT => {
      const d = o.datos as DatosFoto;
      return { id: d.foto_id, ot_id: otId, path: d.path, url: URL.createObjectURL(d.blob), created_at: o.creado_at, enEspera: true, opId: o.id };
    });
  return [...enviadas, ...enEspera];
}

// Agrega UNA foto: la comprime en el teléfono y la sube; si no hay señal queda guardada para subir después.
export async function agregarFoto(quien: Quien, ot: OTLocal, archivo: File): Promise<Destino> {
  const blob = await comprimirImagen(archivo);
  // Id y ruta se deciden acá, una sola vez: reintentar la subida nunca duplica la foto.
  const foto_id = crypto.randomUUID();
  const datos: DatosFoto = { foto_id, path: `${ot.sector_id}/${ot.id}/${foto_id}.jpg`, blob };
  return escribir(quien, ot, 'foto', datos);
}

export async function borrarFoto(foto: FotoOT): Promise<void> {
  if (foto.enEspera && foto.opId !== undefined) {
    await quitarOperacion(foto.opId);
    URL.revokeObjectURL(foto.url);
    return;
  }
  const sb = supabase();
  exigir(await sb.from('ot_fotos').delete().eq('id', foto.id).select('id').single());
  await sb.storage.from(BUCKET).remove([foto.path]);
}

// Historial del operario (pantalla de la v1): sus órdenes completadas o canceladas. Necesita señal.
export async function listarHistorialMio(quien: Quien): Promise<OT[]> {
  return exigir(
    await conLimite(
      supabase().from('v_ordenes').select('*').eq('asignado_a', quien.id).in('estado', ['completada', 'cancelada'])
        .order('updated_at', { ascending: false }).limit(100),
    ),
  ) as OT[];
}
