import { supabase } from './supabase/client';
import { exigir } from './errores';
import type { Sector } from './types';

// Administración (tanda 6): riesgos, foro, sugerencias, búsqueda global, sectores y perfil propio.

const sb = () => supabase();

// ------------------------------------------------------------------ riesgos

export const PROBABILIDADES: Record<number, string> = { 5: 'Muy alta', 4: 'Alta', 3: 'Media', 2: 'Baja', 1: 'Muy baja' };
export const CONSECUENCIAS: Record<number, string> = { 1: 'Mínima', 2: 'Menor', 4: 'Moderada', 8: 'Mayor', 16: 'Máxima' };
export type ClaseRiesgo = 'aceptable' | 'tolerable' | 'alto' | 'extremo';
export const CLASES: Record<ClaseRiesgo, string> = { aceptable: 'Aceptable', tolerable: 'Tolerable', alto: 'Alto', extremo: 'Extremo' };
export const clase = (nivel: number): ClaseRiesgo => (nivel < 4 ? 'aceptable' : nivel < 16 ? 'tolerable' : nivel < 32 ? 'alto' : 'extremo');
export const ESTADOS_RIESGO: Record<string, string> = { activo: 'Activo', en_control: 'En control', resuelto: 'Resuelto' };

export interface Riesgo {
  id: string;
  numero: number | null;
  evento: string;
  probabilidad: number;
  consecuencia: number;
  nivel: number;
  clase: ClaseRiesgo;
  metodo_control: string | null;
  frecuencia: string | null;
  en_alcance: boolean;
  estado: string;
  responsable_id: string | null;
  responsable_nombre: string | null;
  comentarios: string | null;
}

export type DatosRiesgo = Omit<Riesgo, 'id' | 'nivel' | 'clase' | 'responsable_nombre'>;

export async function listarRiesgos(): Promise<Riesgo[]> {
  return exigir(await sb().from('v_riesgos').select('*').order('nivel', { ascending: false }).order('numero').limit(2000)) as Riesgo[];
}

export async function guardarRiesgo(id: string | null, datos: DatosRiesgo): Promise<void> {
  if (id) exigir(await sb().from('riesgos').update(datos).eq('id', id).select('id').single());
  else exigir(await sb().from('riesgos').insert(datos).select('id').single());
}

export async function borrarRiesgo(id: string): Promise<void> {
  exigir(await sb().from('riesgos').delete().eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ foro

export interface Hilo {
  id: string;
  titulo: string;
  cuerpo: string;
  categoria: string;
  tipo: 'hilo' | 'anuncio';
  fijado: boolean;
  cerrado: boolean;
  autor_id: string | null;
  autor_nombre: string | null;
  respuestas: number;
  ultima_actividad: string;
  no_leido: boolean;
  created_at: string;
}

export interface Respuesta {
  id: string;
  hilo_id: string;
  cuerpo: string;
  autor_id: string | null;
  autor_nombre: string | null;
  autor_rol: string | null;
  editado: boolean;
  created_at: string;
}

export const CATEGORIAS_FORO: Record<string, string> = { general: 'General', consultas: 'Consultas', avisos: 'Avisos', seguridad: 'Seguridad', ideas: 'Ideas' };

export async function listarHilos(): Promise<Hilo[]> {
  return exigir(await sb().from('v_foro_hilos').select('*').order('fijado', { ascending: false }).order('ultima_actividad', { ascending: false }).limit(500)) as Hilo[];
}

export async function respuestasDe(hiloId: string): Promise<Respuesta[]> {
  return exigir(await sb().from('v_foro_respuestas').select('*').eq('hilo_id', hiloId).order('created_at')) as Respuesta[];
}

export async function crearHilo(h: { titulo: string; cuerpo: string; categoria: string; tipo: 'hilo' | 'anuncio' }): Promise<string> {
  return (exigir(await sb().from('foro_hilos').insert(h).select('id').single()) as { id: string }).id;
}

export async function cambiarHilo(id: string, cambios: Partial<Pick<Hilo, 'titulo' | 'cuerpo' | 'categoria' | 'fijado' | 'cerrado' | 'tipo'>>): Promise<void> {
  exigir(await sb().from('foro_hilos').update(cambios).eq('id', id).select('id').single());
}

export async function borrarHilo(id: string): Promise<void> {
  exigir(await sb().from('foro_hilos').delete().eq('id', id).select('id').single());
}

export async function responder(hiloId: string, cuerpo: string): Promise<void> {
  exigir(await sb().from('foro_respuestas').insert({ hilo_id: hiloId, cuerpo }).select('id').single());
}

export async function editarRespuesta(id: string, cuerpo: string): Promise<void> {
  exigir(await sb().from('foro_respuestas').update({ cuerpo }).eq('id', id).select('id').single());
}

export async function borrarRespuesta(id: string): Promise<void> {
  exigir(await sb().from('foro_respuestas').delete().eq('id', id).select('id').single());
}

export async function marcarLeido(hiloId: string): Promise<void> {
  await sb().from('foro_lecturas').upsert({ hilo_id: hiloId, leido_at: new Date().toISOString() }, { onConflict: 'perfil_id,hilo_id' });
}

// ------------------------------------------------------------------ sugerencias

export const TIPOS_SUGERENCIA: Record<string, string> = { problema: 'Algo no funciona', sugerencia: 'Una idea', pregunta: 'Una pregunta', otro: 'Otro' };
export const ESTADOS_SUGERENCIA: Record<string, string> = { nueva: 'Nueva', vista: 'Vista', resuelta: 'Resuelta', descartada: 'Descartada' };

export interface Sugerencia {
  id: string;
  tipo: string;
  titulo: string;
  descripcion: string;
  pagina: string | null;
  navegador: string | null;
  estado: string;
  respuesta: string | null;
  autor_id: string | null;
  autor_nombre: string | null;
  created_at: string;
}

export async function listarSugerencias(): Promise<Sugerencia[]> {
  return exigir(await sb().from('v_sugerencias').select('*').order('created_at', { ascending: false }).limit(1000)) as Sugerencia[];
}

export async function enviarSugerencia(s: { tipo: string; titulo: string; descripcion: string; pagina: string | null }): Promise<void> {
  const navegador = typeof navigator !== 'undefined' ? `${navigator.userAgent.slice(0, 200)} · ${window.innerWidth}×${window.innerHeight}` : null;
  exigir(await sb().from('sugerencias').insert({ ...s, navegador }).select('id').single());
}

export async function atenderSugerencia(id: string, estado: string, respuesta: string | null): Promise<void> {
  exigir(await sb().from('sugerencias').update({ estado, respuesta }).eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ búsqueda global

export interface Hallazgo {
  tipo: string;
  id: string;
  titulo: string;
  detalle: string | null;
  enlace: string;
}

export async function buscarTodo(q: string): Promise<Hallazgo[]> {
  return exigir(await sb().rpc('buscar_todo', { p_q: q })) as Hallazgo[];
}

// ------------------------------------------------------------------ sectores (admin)

export interface SectorCompleto extends Sector {
  clave: string;
  descripcion: string | null;
  color: string | null;
  icono: string | null;
  activo: boolean;
  orden: number;
}

export async function listarSectores(): Promise<SectorCompleto[]> {
  return exigir(await sb().from('sectores').select('*').order('orden').order('nombre')) as SectorCompleto[];
}

export async function guardarSector(id: string | null, datos: Partial<SectorCompleto>): Promise<void> {
  if (id) exigir(await sb().from('sectores').update(datos).eq('id', id).select('id').single());
  else exigir(await sb().from('sectores').insert(datos).select('id').single());
}

export async function resumenSector(): Promise<Record<string, number>> {
  return exigir(await sb().rpc('resumen_sector')) as Record<string, number>;
}

// ------------------------------------------------------------------ perfil propio

export interface MiPerfil {
  id: string;
  nombre: string;
  email: string;
  telefono: string | null;
  especialidad: string | null;
  firma_url: string | null;
}

export async function obtenerMiPerfil(id: string): Promise<MiPerfil> {
  return exigir(await sb().from('perfiles').select('id, nombre, email, telefono, especialidad, firma_url').eq('id', id).single()) as MiPerfil;
}

export async function guardarMiPerfil(id: string, datos: Pick<MiPerfil, 'nombre' | 'telefono' | 'especialidad' | 'firma_url'>): Promise<void> {
  exigir(await sb().from('perfiles').update(datos).eq('id', id).select('id').single());
}

// La contraseña la cambia cada uno con su sesión (Supabase Auth); nunca pasa por la base de la app.
export async function cambiarMiClave(nueva: string): Promise<void> {
  const { error } = await sb().auth.updateUser({ password: nueva });
  if (error) throw error;
}
