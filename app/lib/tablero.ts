import { supabase } from './supabase/client';
import { exigir } from './errores';
import { crearOT } from './gestion';
import { comprimirImagen } from './imagen';
import { ejecutar } from './offline/cola';
import type { EstadoOT, OT, Plantilla, Rol } from './types';

// Tablero de órdenes con la pantalla de la v1 (pages/WorkOrders.jsx) y las reglas de la v2:
// los cambios de estado los valida la base (validar_transicion_ot); acá solo se piden.

export type FilaTablero = OT & {
  updated_at: string;
  created_by: string | null;
  obra_titulo?: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_precision: number | null;
  materiales_faltantes: { material: string; cantidad: number; motivo?: string }[];
};

export const ARCHIVO_DIAS = 30;

// La v1 archiva sola las completadas a los 30 días. En la v2 no hay columna "archivada":
// se calcula igual (completada hace más de 30 días) y se muestran en el Historial.
export function estaArchivada(o: Pick<OT, 'estado' | 'fecha_validacion'> & { updated_at?: string }): boolean {
  if (o.estado !== 'completada') return false;
  const ref = o.fecha_validacion ?? o.updated_at;
  if (!ref) return false;
  return Date.now() - new Date(ref).getTime() > ARCHIVO_DIAS * 86400000;
}

export function fechaArchivo(o: Pick<OT, 'fecha_validacion'> & { updated_at?: string }): string | null {
  const ref = o.fecha_validacion ?? o.updated_at;
  return ref ? new Date(new Date(ref).getTime() + ARCHIVO_DIAS * 86400000).toISOString() : null;
}

export async function listarTablero(): Promise<FilaTablero[]> {
  return exigir(await supabase().from('v_ordenes').select('*').order('updated_at', { ascending: false }).limit(5000)) as FilaTablero[];
}

export interface PersonaSector {
  id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
}

export async function listarPersonas(): Promise<PersonaSector[]> {
  return exigir(await supabase().from('perfiles').select('id,nombre,rol,activo').order('nombre').limit(2000)) as PersonaSector[];
}

// ------------------------------------------------------------------ máquina de estados (v1 → v2)

export type Accion = 'asignar' | 'iniciar' | 'finalizar' | 'aprobar' | 'rechazar' | 'cancelar' | 'convertir_obra' | 'completar';

// Igual que lib/workorder-transitions.js de la v1 (con el estado "obra" de la fase 15).
export function getTransitionAction(from: string, to: string): Accion | null {
  if (from === 'completada' || from === 'cancelada') return null;
  if (to === 'cancelada') return 'cancelar';
  if (to === 'obra') return 'convertir_obra';
  if (to === 'completada' && from !== 'pendiente_validacion') return 'completar';
  const mapa: Record<string, Accion> = {
    'pendiente>asignada': 'asignar',
    'pendiente>en_progreso': 'iniciar',
    'asignada>en_progreso': 'iniciar',
    'en_progreso>pendiente_validacion': 'finalizar',
    'pendiente_validacion>completada': 'aprobar',
    'pendiente_validacion>en_progreso': 'rechazar',
  };
  return mapa[`${from}>${to}`] ?? null;
}

const DESTINO: Record<Accion, EstadoOT> = {
  asignar: 'asignada', iniciar: 'en_progreso', finalizar: 'pendiente_validacion', aprobar: 'completada', rechazar: 'en_progreso', cancelar: 'cancelada',
  convertir_obra: 'obra', completar: 'completada',
};

export const MENSAJE: Record<Accion, string> = {
  asignar: 'OT asignada correctamente',
  iniciar: 'OT iniciada correctamente',
  finalizar: 'OT enviada a validación',
  aprobar: 'OT aprobada y completada',
  rechazar: 'OT rechazada y devuelta al operario',
  cancelar: 'OT cancelada',
  convertir_obra: 'OT convertida a Futura Obra',
  completar: 'OT completada correctamente',
};

export interface Extra {
  asignado_a?: string | null;
  rechazo_comentario?: string;
}

// Devuelve el mensaje de la v1. Los errores son los de la base (validar_transicion_ot).
export async function transicionar(ot: Pick<OT, 'id' | 'estado' | 'asignado_a'>, accion: Accion, extra: Extra = {}): Promise<string> {
  const estado = DESTINO[accion];
  // "Completar" solo vale desde una obra (la base lo controla); desde otro estado se aprueba desde Validación.
  if (accion === 'completar' && ot.estado !== 'obra') throw new Error('Para cerrar la orden, finalizala y aprobala desde Validación.');
  // "Futura Obra" crea además el pendiente de tipo obra (como el botón "Obra" de la v1).
  if (accion === 'convertir_obra') {
    exigir(await supabase().rpc('convertir_ot_en_obra', { p_ot: ot.id }));
    return MENSAJE[accion];
  }
  if (accion === 'asignar' && !(extra.asignado_a ?? ot.asignado_a)) {
    throw new Error('Debe asignar un operario antes de cambiar el estado a "Asignada"');
  }
  if (accion === 'rechazar' && !extra.rechazo_comentario?.trim()) throw new Error('Debe indicar un motivo de rechazo');
  const cambios: Record<string, unknown> = { estado };
  if (extra.asignado_a !== undefined) cambios.asignado_a = extra.asignado_a;
  if (accion === 'rechazar') cambios.rechazo_comentario = extra.rechazo_comentario!.trim();
  exigir(await supabase().from('ordenes_trabajo').update(cambios).eq('id', ot.id).select('id').single());
  return MENSAJE[accion];
}

export async function crearDesdePlantilla(t: Plantilla): Promise<string> {
  return crearOT({
    titulo: t.titulo,
    descripcion: t.descripcion,
    tipo: t.tipo,
    prioridad: t.prioridad,
    ubicacion_id: null,
    activo_id: null,
    asignado_a: null,
    fecha_programada: null,
    horas_estimadas: t.horas_estimadas,
    checklist: (t.checklist ?? []).map((c) => ({ ...c, hecho: false })),
    requiere_fotos: false,
  });
}

// ------------------------------------------------------------------ vencimiento (regla de la v1)

const AR_OFFSET_MS = -3 * 60 * 60 * 1000;

// lib/otVencimiento.js de la v1: vencida = en progreso y la fecha programada (hora Argentina) ya pasó.
export function esOtVencida(o: Pick<OT, 'estado' | 'fecha_programada'>, now = new Date()): boolean {
  if (o.estado !== 'en_progreso' || !o.fecha_programada) return false;
  const hoy = new Date(now.getTime() + AR_OFFSET_MS).toISOString().split('T')[0];
  return hoy > o.fecha_programada.slice(0, 10);
}

// ------------------------------------------------------------------ panel de detalle

// Autoguardado del panel (como actualizarOT de la v1): manda solo los campos que cambiaron.
// La base decide quién puede cambiar qué (validar_transicion_ot).
export async function actualizarOT(id: string, patch: Record<string, unknown>): Promise<void> {
  exigir(await supabase().from('ordenes_trabajo').update(patch).eq('id', id).select('id').single());
}

export async function eliminarOT(id: string): Promise<void> {
  exigir(await supabase().from('ordenes_trabajo').delete().eq('id', id).select('id').single());
}

export async function obtenerFila(id: string): Promise<FilaTablero> {
  return exigir(await supabase().from('v_ordenes').select('*').eq('id', id).single()) as FilaTablero;
}

// Sube una foto de la orden (con conexión): la comprime y la registra en ot_fotos.
export async function subirFoto(ot: Pick<OT, 'id' | 'sector_id'>, archivo: File): Promise<void> {
  const blob = await comprimirImagen(archivo);
  const foto_id = crypto.randomUUID();
  await ejecutar({ ot_id: ot.id, tipo: 'foto', datos: { foto_id, path: `${ot.sector_id}/${ot.id}/${foto_id}.jpg`, blob } });
}
