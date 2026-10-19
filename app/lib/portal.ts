// Portal de operarios sin usuario (fase 16). Todo pasa por la edge function `portal-operarios`;
// las reglas las pone la base. Acá no hay sesión de Supabase: solo un pase de 12 h guardado en el teléfono.
// Sin señal, lo que se hace queda en la cola del teléfono (lib/portal-cola.ts) y se envía al volver.

import type { EstadoOT, Prioridad, TareaChecklist } from './types';
import type { OpPortal } from './portal-cola';

export interface OrdenPortal {
  id: string;
  codigo: string;
  titulo: string;
  descripcion: string | null;
  tipo: string;
  prioridad: Prioridad;
  estado: EstadoOT;
  checklist: TareaChecklist[];
  requiere_fotos: boolean;
  portal_nombre: string | null;
  asignado_nombre: string | null;
  fecha_programada: string | null;
  fotos: string[];
}

export interface Ingreso {
  pase: string;
  nombre: string;
  lugar: { tipo: 'ubicacion' | 'activo'; nombre: string; direccion: string | null };
}

// Sin señal (o el servidor no contesta): se reintenta más tarde. Distinto de un rechazo de la base.
export class SinRed extends Error {
  constructor() { super('Sin conexión. Lo que hagas queda guardado en el teléfono y se envía cuando vuelva la señal.'); }
}

async function llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/portal-operarios`;
  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new SinRed();
  }
  if (r.status >= 500 || r.status === 408 || r.status === 429) throw new SinRed();
  const datos = await r.json().catch(() => ({}));
  if (!r.ok || datos?.error) throw new Error(datos?.error ?? 'No se pudo completar. Probá de nuevo en un rato.');
  return datos as T;
}

// ------------------------------------------------------------------ lo guardado en el teléfono
// El pase va en localStorage (sobrevive a cerrar la app; igual vence a las 12 h en la base).
const clavePase = (token: string) => `dh1-portal-pase:${token}`;
const claveOrdenes = (token: string) => `dh1-portal-ordenes:${token}`;
const leerLS = <T>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } };
const ponerLS = (k: string, v: unknown) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

export function paseGuardado(token: string): Ingreso | null {
  const g = leerLS<Ingreso>(clavePase(token));
  return g?.pase ? g : null;
}
export const nombreGuardado = () => { try { return localStorage.getItem('dh1-portal-nombre') ?? ''; } catch { return ''; } };
const guardarNombre = (n: string) => { try { localStorage.setItem('dh1-portal-nombre', n); } catch { /* sin almacenamiento */ } };
export const ordenesGuardadas = (token: string) => leerLS<OrdenPortal[]>(claveOrdenes(token));
// Salir borra el pase y la lista guardada (no la cola: lo que no se envió no se pierde).
export const salirPortal = (token: string) => { ponerLS(clavePase(token), null); ponerLS(claveOrdenes(token), null); };
export const olvidarPase = (token: string) => ponerLS(clavePase(token), null);

// ------------------------------------------------------------------ acciones
export async function entrar(token: string, clave: string, nombre: string): Promise<Ingreso> {
  const i = await llamar<Ingreso>({ accion: 'entrar', token, clave, nombre });
  ponerLS(clavePase(token), i);
  guardarNombre(i.nombre);
  return i;
}

export async function listarOrdenes(token: string, pase: string): Promise<OrdenPortal[]> {
  const r = await llamar<{ ordenes: OrdenPortal[] }>({ accion: 'ordenes', pase });
  ponerLS(claveOrdenes(token), r.ordenes ?? []);
  return r.ordenes ?? [];
}

export function posicion(): Promise<{ lat: number; lng: number; precision: number } | null> {
  return new Promise((ok) => {
    if (!('geolocation' in navigator)) return ok(null);
    setTimeout(() => ok(null), 4000);
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 },
    );
  });
}

export function aDataURL(foto: Blob): Promise<string> {
  return new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(new Error('No se pudo leer la foto.'));
    r.readAsDataURL(foto);
  });
}

// Una acción de la cola (o directa): la arma tal cual la espera la edge function.
export function enviarAccion(pase: string, op: OpPortal): Promise<unknown> {
  if (op.tipo === 'iniciar') return llamar({ accion: 'iniciar', pase, ot: op.ot, gps: op.gps });
  if (op.tipo === 'foto') return llamar({ accion: 'foto', pase, ot: op.ot, foto_id: op.foto_id, imagen: op.imagen });
  return llamar({ accion: 'finalizar', pase, ot: op.ot, hechas: op.hechas, motivo: op.motivo, notas: op.notas, firma_url: op.firma_url, gps: op.gps });
}
