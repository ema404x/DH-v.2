// Portal de operarios sin usuario (fase 16). Todo pasa por la edge function `portal-operarios`;
// las reglas las pone la base. Acá no hay sesión de Supabase: solo un pase de 12 h guardado en el teléfono.

import type { EstadoOT, Prioridad, TareaChecklist } from './types';

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
    throw new Error('Sin conexión. El portal necesita señal: probá de nuevo cuando tengas.');
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok || datos?.error) throw new Error(datos?.error ?? 'No se pudo completar. Probá de nuevo en un rato.');
  return datos as T;
}

// ------------------------------------------------------------------ pase y nombre en el teléfono
const clavePase = (token: string) => `dh1-portal-pase:${token}`;
export function paseGuardado(token: string): Ingreso | null {
  try {
    const g = JSON.parse(sessionStorage.getItem(clavePase(token)) ?? 'null');
    return g?.pase ? g : null;
  } catch {
    return null;
  }
}
const guardarPase = (token: string, i: Ingreso | null) => {
  try {
    if (i) sessionStorage.setItem(clavePase(token), JSON.stringify(i));
    else sessionStorage.removeItem(clavePase(token));
  } catch { /* sin almacenamiento */ }
};
export const nombreGuardado = () => { try { return localStorage.getItem('dh1-portal-nombre') ?? ''; } catch { return ''; } };
const guardarNombre = (n: string) => { try { localStorage.setItem('dh1-portal-nombre', n); } catch { /* sin almacenamiento */ } };
export const salirPortal = (token: string) => guardarPase(token, null);

// ------------------------------------------------------------------ acciones
export async function entrar(token: string, clave: string, nombre: string): Promise<Ingreso> {
  const i = await llamar<Ingreso>({ accion: 'entrar', token, clave, nombre });
  guardarPase(token, i);
  guardarNombre(i.nombre);
  return i;
}

export const listarOrdenes = (pase: string) => llamar<{ ordenes: OrdenPortal[] }>({ accion: 'ordenes', pase }).then((r) => r.ordenes ?? []);

function posicion(): Promise<{ lat: number; lng: number; precision: number } | null> {
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

export async function iniciar(pase: string, ot: string) {
  return llamar({ accion: 'iniciar', pase, ot, gps: await posicion() });
}

export async function subirFoto(pase: string, ot: string, foto: Blob): Promise<string> {
  const imagen = await new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(new Error('No se pudo leer la foto.'));
    r.readAsDataURL(foto);
  });
  const { url } = await llamar<{ url: string }>({ accion: 'foto', pase, ot, foto_id: crypto.randomUUID(), imagen });
  return url;
}

export async function finalizar(pase: string, ot: string, datos: { hechas: string[]; motivo: string; notas: string; firma_url: string | null }) {
  return llamar({ accion: 'finalizar', pase, ot, ...datos, gps: await posicion() });
}
