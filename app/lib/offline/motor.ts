// Motor de la cola sin señal. Lógica pura: no toca el navegador ni Supabase, por eso se prueba sola
// (pruebas/offline.test.mjs). El almacenamiento y el envío real se le pasan desde lib/offline/cola.ts.
//
// Reglas:
//   · Lo que el operario hace sin señal se guarda como una operación, en orden.
//   · Al volver la señal se envían en ese mismo orden. Si se corta la red, se frena y se reintenta después.
//   · La base sigue siendo la autoridad: si rechaza una operación, queda marcada con el motivo y
//     con sus datos intactos, hasta que el operario la reintente o la descarte. Nada se pierde en silencio.
//   · Cada usuario envía solo lo suyo.

import type { EstadoOT, MotivoIncompleto, TareaChecklist } from '../types';

export type TipoOp = 'iniciar' | 'guardar' | 'finalizar' | 'foto';

export interface Ejecucion {
  checklist: TareaChecklist[];
  notas: string | null;
  motivos_incompleto: MotivoIncompleto[];
}

export interface DatosFoto {
  foto_id: string;
  path: string;
  blob: Blob;
}

export interface Op {
  id?: number;
  usuario_id: string;
  ot_id: string;
  tipo: TipoOp;
  datos: unknown;
  creado_at: string;
  estado: 'pendiente' | 'rechazada';
  error?: string;
  intentos: number;
}

export interface Almacen {
  todas(): Promise<Op[]>;
  agregar(op: Op): Promise<Op>;
  actualizar(op: Op): Promise<void>;
  borrar(id: number): Promise<void>;
}

// Lo mínimo de una orden que el motor necesita para mostrarla y validarla.
export interface OTBase {
  id: string;
  estado: EstadoOT;
  asignado_a: string | null;
  asignado_nombre: string | null;
  checklist: TareaChecklist[];
  notas: string | null;
  motivos_incompleto: MotivoIncompleto[];
  requiere_fotos: boolean;
  fecha_inicio_real: string | null;
  fecha_fin_real: string | null;
  rechazo_comentario: string | null;
  tareas_total: number;
  tareas_hechas: number;
  fotos_total: number;
}

const porOrden = (a: Op, b: Op) => (a.id ?? 0) - (b.id ?? 0);

// Agrega una operación a la cola. Dos "guardar avance" seguidos de la misma orden se funden en uno:
// solo importa el último estado del checklist y las notas.
export async function encolar(almacen: Almacen, op: Omit<Op, 'id' | 'estado' | 'intentos' | 'creado_at'>): Promise<Op> {
  const deLaOT = (await almacen.todas())
    .filter((o) => o.usuario_id === op.usuario_id && o.ot_id === op.ot_id && o.estado === 'pendiente')
    .sort(porOrden);
  const ultima = deLaOT[deLaOT.length - 1];
  if (op.tipo === 'guardar' && ultima?.tipo === 'guardar') {
    const fundida: Op = { ...ultima, datos: op.datos };
    await almacen.actualizar(fundida);
    return fundida;
  }
  return almacen.agregar({ ...op, estado: 'pendiente', intentos: 0, creado_at: new Date().toISOString() });
}

export interface ResultadoEnvio {
  enviadas: number;
  rechazadas: number;
  quedan: number;
  // true si se frenó porque no hay red (o la sesión no se pudo renovar): se reintenta más tarde
  sinRed: boolean;
}

// Envía las operaciones pendientes del usuario, en orden.
// `clasificar` decide si un error es de red ('red': se frena y se reintenta) o un rechazo de la base
// (devuelve el mensaje: la operación queda marcada y se sigue con las demás).
export async function procesar(
  almacen: Almacen,
  usuarioId: string,
  ejecutar: (op: Op) => Promise<void>,
  clasificar: (e: unknown) => 'red' | string,
): Promise<ResultadoEnvio> {
  const pendientes = (await almacen.todas())
    .filter((o) => o.usuario_id === usuarioId && o.estado === 'pendiente')
    .sort(porOrden);
  const r: ResultadoEnvio = { enviadas: 0, rechazadas: 0, quedan: pendientes.length, sinRed: false };

  for (const op of pendientes) {
    try {
      await ejecutar(op);
      await almacen.borrar(op.id!);
      r.enviadas++;
      r.quedan--;
    } catch (e) {
      const motivo = clasificar(e);
      if (motivo === 'red') {
        await almacen.actualizar({ ...op, intentos: op.intentos + 1 });
        r.sinRed = true;
        break;
      }
      await almacen.actualizar({ ...op, estado: 'rechazada', error: motivo, intentos: op.intentos + 1 });
      r.rechazadas++;
      r.quedan--;
    }
  }
  return r;
}

export async function reintentarOT(almacen: Almacen, usuarioId: string, otId: string): Promise<void> {
  for (const op of await almacen.todas()) {
    if (op.usuario_id === usuarioId && op.ot_id === otId && op.estado === 'rechazada') {
      await almacen.actualizar({ ...op, estado: 'pendiente', error: undefined });
    }
  }
}

export async function descartarRechazadasOT(almacen: Almacen, usuarioId: string, otId: string): Promise<void> {
  for (const op of await almacen.todas()) {
    if (op.usuario_id === usuarioId && op.ot_id === otId && op.estado === 'rechazada') {
      await almacen.borrar(op.id!);
    }
  }
}

// Cómo se ve la orden en el teléfono: lo último que se supo del servidor + lo hecho y todavía no enviado.
// Las operaciones rechazadas no se aplican: la pantalla muestra el estado real y el aviso del rechazo.
export function aplicarPendientes<T extends OTBase>(ot: T, ops: Op[], quien: { id: string; nombre: string }): T {
  let v: T = { ...ot };
  for (const op of ops.filter((o) => o.ot_id === ot.id && o.estado === 'pendiente').sort(porOrden)) {
    if (op.tipo === 'iniciar') {
      if (v.estado === 'pendiente' || v.estado === 'asignada') {
        v = {
          ...v,
          estado: 'en_progreso',
          asignado_a: v.asignado_a ?? quien.id,
          asignado_nombre: v.asignado_a ? v.asignado_nombre : quien.nombre,
          fecha_inicio_real: v.fecha_inicio_real ?? op.creado_at,
        };
      }
    } else if (op.tipo === 'guardar' || op.tipo === 'finalizar') {
      const e = op.datos as Ejecucion;
      v = {
        ...v,
        checklist: e.checklist,
        notas: e.notas,
        motivos_incompleto: e.motivos_incompleto,
        tareas_total: e.checklist.length,
        tareas_hechas: e.checklist.filter((t) => t.hecho).length,
      };
      if (op.tipo === 'finalizar' && v.estado === 'en_progreso') {
        v = { ...v, estado: 'pendiente_validacion', fecha_fin_real: op.creado_at, rechazo_comentario: null };
      }
    } else if (op.tipo === 'foto') {
      v = { ...v, fotos_total: v.fotos_total + 1 };
    }
  }
  return v;
}

// Las mismas reglas que aplica la base (validar_transicion_ot), adelantadas en el teléfono para que
// sin señal no se encole algo que ya se sabe que va a ser rechazado. Los mensajes son los de la base.
// Devuelve el mensaje de error, o null si se puede.
export function validarLocal(ot: OTBase, tipo: TipoOp, datos: unknown): string | null {
  if (ot.estado === 'completada' || ot.estado === 'cancelada') {
    return 'La orden está cerrada. No se puede modificar.';
  }
  if (tipo === 'iniciar') {
    return ot.estado === 'pendiente' || ot.estado === 'asignada' ? null : 'La orden ya está iniciada.';
  }
  if (ot.estado !== 'en_progreso') {
    return 'La orden no está en curso. Primero hay que iniciarla.';
  }
  if (tipo === 'finalizar') {
    const e = datos as Ejecucion;
    if (e.checklist.some((t) => !t.hecho) && e.motivos_incompleto.length === 0) {
      return 'Faltan tareas del checklist. Marcalas o indicá por qué no se pudieron hacer.';
    }
    if (ot.requiere_fotos && ot.fotos_total === 0) {
      return 'Esta orden pide fotos. Subí al menos una antes de finalizar.';
    }
  }
  return null;
}

export interface ResumenCola {
  pendientes: number;
  rechazadas: number;
  // órdenes con algo sin enviar o rechazado, para marcar cada tarjeta
  porOT: Record<string, { pendientes: number; rechazadas: number; error?: string }>;
  // operaciones que dejó otro usuario en este teléfono: no se envían con esta sesión
  deOtros: number;
}

export function resumir(ops: Op[], usuarioId: string): ResumenCola {
  const r: ResumenCola = { pendientes: 0, rechazadas: 0, porOT: {}, deOtros: 0 };
  for (const op of [...ops].sort(porOrden)) {
    if (op.usuario_id !== usuarioId) {
      r.deOtros++;
      continue;
    }
    const o = (r.porOT[op.ot_id] ??= { pendientes: 0, rechazadas: 0 });
    if (op.estado === 'pendiente') {
      r.pendientes++;
      o.pendientes++;
    } else {
      r.rechazadas++;
      o.rechazadas++;
      o.error ??= op.error;
    }
  }
  return r;
}
