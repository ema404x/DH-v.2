'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase/client';
import { exigir, limpiarError } from './errores';
import { clasificar } from './offline/cola';
import { posicionActual } from './ot';
import type { TipoFichaje } from './gente';

// Fichar entrada y salida, con o sin señal.
//
//   · Con señal: va directo a la base (fichar()), que decide el lugar, la distancia y si se puede.
//   · Sin señal: la marca queda guardada en el teléfono con su hora y se envía sola al volver la conexión.
//     Cada marca lleva un id propio: reenviarla no la duplica.
//   · La base acepta marcas de hasta 3 días para atrás; más viejas las carga gerencia.

export interface Marca {
  id: string;
  usuario_id: string;
  empleado_id: string | null; // null: ficha quien está usando el teléfono
  empleado_nombre?: string;
  tipo: TipoFichaje;
  momento: string;
  qr: string | null;
  ubicacion_id: string | null;
  ubicacion_nombre?: string;
  lat: number | null;
  lng: number | null;
  precision: number | null;
}

export interface ResultadoFichaje {
  id: string;
  tipo: TipoFichaje;
  momento: string;
  empleado_id: string;
  empleado?: string;
  ubicacion_id: string | null;
  ubicacion?: string | null;
  distancia_m: number | null;
  lejos: boolean;
  repetido: boolean;
}

// Lo último que se sabe del propio fichaje, para mostrar "estás adentro desde..." aun sin señal.
export interface EstadoFichaje {
  tipo: TipoFichaje | null;
  momento: string | null;
  lugar: string | null;
}

const COLA = 'dh1:fichajes';
const ESTADO = 'dh1:fichaje-estado';

function leerCola(): Marca[] {
  try {
    return JSON.parse(localStorage.getItem(COLA) ?? '[]') as Marca[];
  } catch {
    return [];
  }
}
function guardarCola(c: Marca[]) {
  localStorage.setItem(COLA, JSON.stringify(c));
  window.dispatchEvent(new Event('dh1:fichajes'));
}

export const pendientesDe = (usuarioId: string) => leerCola().filter((m) => m.usuario_id === usuarioId);

function enviar(m: Marca) {
  return supabase().rpc('fichar', {
    p_empleado: m.empleado_id,
    p_tipo: m.tipo,
    p_qr: m.qr,
    p_ubicacion: m.ubicacion_id,
    p_lat: m.lat,
    p_lng: m.lng,
    p_precision: m.precision,
    p_dispositivo: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 160) : null,
    p_id: m.id,
    p_momento: m.momento,
  });
}

export interface PedidoFichaje {
  tipo: TipoFichaje;
  empleado_id?: string;
  empleado_nombre?: string;
  qr?: string;
  ubicacion_id?: string;
  ubicacion_nombre?: string;
}

export type Fichado = { destino: 'enviado'; resultado: ResultadoFichaje } | { destino: 'guardado'; marca: Marca };

// Registra la marca. Si no hay señal (o se corta), queda en el teléfono y se envía después.
export async function fichar(usuarioId: string, p: PedidoFichaje): Promise<Fichado> {
  const pos = await posicionActual();
  const marca: Marca = {
    id: crypto.randomUUID(),
    usuario_id: usuarioId,
    empleado_id: p.empleado_id ?? null,
    empleado_nombre: p.empleado_nombre,
    tipo: p.tipo,
    momento: new Date().toISOString(),
    qr: p.qr ?? null,
    ubicacion_id: p.ubicacion_id ?? null,
    ubicacion_nombre: p.ubicacion_nombre,
    lat: pos?.gps_lat ?? null,
    lng: pos?.gps_lng ?? null,
    precision: pos?.gps_precision ?? null,
  };
  if (navigator.onLine) {
    try {
      const resultado = exigir(await enviar(marca)) as ResultadoFichaje;
      if (!marca.empleado_id) recordar(usuarioId, { tipo: resultado.tipo, momento: resultado.momento, lugar: resultado.ubicacion ?? null });
      return { destino: 'enviado', resultado };
    } catch (e) {
      // Un rechazo de la base se muestra ya. Si fue la red, se guarda en el teléfono.
      if (clasificar(e) !== 'red') throw e;
    }
  }
  guardarCola([...leerCola(), marca]);
  if (!marca.empleado_id) recordar(usuarioId, { tipo: marca.tipo, momento: marca.momento, lugar: marca.ubicacion_nombre ?? null });
  return { destino: 'guardado', marca };
}

// Envía las marcas guardadas de este usuario, en orden. Las que la base rechaza se sacan y se devuelven con el motivo.
let enviando = false;
export async function enviarPendientes(usuarioId: string): Promise<{ enviadas: number; rechazadas: { marca: Marca; motivo: string }[] }> {
  const rechazadas: { marca: Marca; motivo: string }[] = [];
  let enviadas = 0;
  if (enviando || !navigator.onLine) return { enviadas, rechazadas };
  enviando = true;
  try {
    for (const m of pendientesDe(usuarioId)) {
      try {
        exigir(await enviar(m));
        enviadas++;
      } catch (e) {
        if (clasificar(e) === 'red') break;
        rechazadas.push({ marca: m, motivo: limpiarError(e) });
      }
      guardarCola(leerCola().filter((x) => x.id !== m.id));
    }
  } finally {
    enviando = false;
  }
  return { enviadas, rechazadas };
}

function recordar(usuarioId: string, e: EstadoFichaje) {
  localStorage.setItem(ESTADO, JSON.stringify({ usuario_id: usuarioId, ...e }));
}
function recordado(usuarioId: string): EstadoFichaje | null {
  try {
    const g = JSON.parse(localStorage.getItem(ESTADO) ?? 'null') as (EstadoFichaje & { usuario_id: string }) | null;
    return g && g.usuario_id === usuarioId ? { tipo: g.tipo, momento: g.momento, lugar: g.lugar } : null;
  } catch {
    return null;
  }
}

// El último fichaje propio: primero el de la base; sin señal, lo último que se supo en este teléfono.
export async function miEstado(usuarioId: string): Promise<EstadoFichaje> {
  const pendiente = pendientesDe(usuarioId).filter((m) => !m.empleado_id).pop();
  if (pendiente) return { tipo: pendiente.tipo, momento: pendiente.momento, lugar: pendiente.ubicacion_nombre ?? null };
  try {
    const fila = exigir(
      await supabase().from('v_empleados').select('ultimo_fichaje_tipo,ultimo_fichaje_momento,ultimo_fichaje_lugar').eq('perfil_id', usuarioId).maybeSingle(),
    ) as { ultimo_fichaje_tipo: TipoFichaje | null; ultimo_fichaje_momento: string | null; ultimo_fichaje_lugar: string | null } | null;
    const e = { tipo: fila?.ultimo_fichaje_tipo ?? null, momento: fila?.ultimo_fichaje_momento ?? null, lugar: fila?.ultimo_fichaje_lugar ?? null };
    recordar(usuarioId, e);
    return e;
  } catch (e) {
    if (clasificar(e) !== 'red') throw e;
    return recordado(usuarioId) ?? { tipo: null, momento: null, lugar: null };
  }
}

// Estado del fichaje propio y de la cola de marcas sin enviar. Envía solo: al montar, al volver la señal y cada 30 s.
export function useFichaje(usuarioId: string | undefined) {
  const [estado, setEstado] = useState<EstadoFichaje | null>(null);
  const [pendientes, setPendientes] = useState(0);
  const [rechazo, setRechazo] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    if (!usuarioId) return;
    const r = await enviarPendientes(usuarioId);
    if (r.rechazadas.length > 0) setRechazo(`No se pudo registrar un fichaje guardado sin señal: ${r.rechazadas[0].motivo}`);
    setPendientes(pendientesDe(usuarioId).length);
    try {
      setEstado(await miEstado(usuarioId));
    } catch {
      // se reintenta en la próxima vuelta
    }
  }, [usuarioId]);

  useEffect(() => {
    if (!usuarioId) return;
    void refrescar();
    const alCambiar = () => setPendientes(pendientesDe(usuarioId).length);
    const reloj = setInterval(() => { if (pendientesDe(usuarioId).length > 0) void refrescar(); }, 30000);
    window.addEventListener('online', refrescar);
    window.addEventListener('dh1:fichajes', alCambiar);
    return () => {
      clearInterval(reloj);
      window.removeEventListener('online', refrescar);
      window.removeEventListener('dh1:fichajes', alCambiar);
    };
  }, [usuarioId, refrescar]);

  return { estado, pendientes, rechazo, descartarRechazo: () => setRechazo(null), refrescar };
}

// Hora de 24 h ("14:19"): es como se lee en obra, y evita el "p. m." que choca con el punto final.
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const esHoy = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

// "Adentro desde las 08:03 · Primaria 5" / "Salida a las 17:10" / "Sin fichar"
export function textoEstado(e: EstadoFichaje | null): string {
  if (!e?.tipo || !e.momento) return 'Todavía no fichaste.';
  const cuando = esHoy(e.momento) ? `las ${hora(e.momento)}` : `el ${new Date(e.momento).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} a las ${hora(e.momento)}`;
  const lugar = e.lugar ? ` · ${e.lugar}` : '';
  return e.tipo === 'entrada' ? `Adentro desde ${cuando}${lugar}` : `Última salida: ${cuando}${lugar}`;
}

// Texto para avisar lo que pasó con una marca.
export function textoFichado(f: Fichado): { texto: string; aviso?: string } {
  if (f.destino === 'guardado') {
    return { texto: `${f.marca.tipo === 'entrada' ? 'Entrada' : 'Salida'} guardada en el teléfono a las ${hora(f.marca.momento)}. Se envía sola cuando vuelva la señal.` };
  }
  const r = f.resultado;
  const base = `${r.tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada a las ${hora(r.momento)}${r.ubicacion ? ` en ${r.ubicacion}` : ''}.`;
  if (r.repetido) return { texto: `Ya estaba registrada: ${base}` };
  if (r.lejos && r.distancia_m !== null) {
    const d = r.distancia_m >= 1000 ? `${(r.distancia_m / 1000).toFixed(1).replace('.', ',')} km` : `${r.distancia_m} m`;
    return { texto: base, aviso: `Quedó anotado que estabas a ${d} del lugar.` };
  }
  return { texto: base };
}
