import { supabase } from './supabase/client';
import { exigir } from './errores';
import type { OT, Rol } from './types';

// Tanda 2: empleados, tablets de cuadrilla, fichajes, horas de las órdenes y mapa.
// Como siempre, acá solo se lee y se pide: quién puede qué lo decide la base (fase 8).

const sb = () => supabase();
const patron = (q: string) => `%${q.trim().replace(/[%_\\]/g, '')}%`;

// ------------------------------------------------------------------ empleados

export type EstadoEmpleado = 'activo' | 'licencia' | 'vacaciones' | 'inactivo';
export type Especialidad = 'electricidad' | 'plomeria' | 'pintura' | 'albanileria' | 'carpinteria' | 'herreria' | 'climatizacion' | 'general' | 'otro';

export const ESTADOS_EMPLEADO: Record<EstadoEmpleado, string> = {
  activo: 'Activo', licencia: 'De licencia', vacaciones: 'De vacaciones', inactivo: 'Dado de baja',
};
export const ESPECIALIDADES: Record<Especialidad, string> = {
  general: 'General', electricidad: 'Electricidad', plomeria: 'Plomería', pintura: 'Pintura', albanileria: 'Albañilería',
  carpinteria: 'Carpintería', herreria: 'Herrería', climatizacion: 'Climatización', otro: 'Otra',
};

// Fila de v_empleados. Los datos reservados llegan en null para quien no puede leerlos.
export interface Empleado {
  id: string;
  sector_id: string;
  nombre: string;
  puesto: string | null;
  especialidad: Especialidad;
  estado: EstadoEmpleado;
  email: string | null;
  telefono: string | null;
  perfil_id: string | null;
  jefe_sitio_id: string | null;
  zona: string | null;
  ubicacion_id: string | null;
  fecha_ingreso: string | null;
  certificaciones: string[];
  dni: string | null;
  costo_hora: number | null;
  contacto_emergencia: string | null;
  telefono_emergencia: string | null;
  notas: string | null;
  usuario_email: string | null;
  usuario_rol: Rol | null;
  usuario_activo: boolean | null;
  jefe_sitio_nombre: string | null;
  ubicacion_nombre: string | null;
  lugares_a_cargo: number;
  ultimo_fichaje_tipo: TipoFichaje | null;
  ultimo_fichaje_momento: string | null;
  ultimo_fichaje_lugar: string | null;
}

export interface DatosEmpleado {
  nombre: string;
  puesto: string | null;
  especialidad: Especialidad;
  estado: EstadoEmpleado;
  email: string | null;
  telefono: string | null;
  jefe_sitio_id: string | null;
  zona: string | null;
  ubicacion_id: string | null;
  fecha_ingreso: string | null;
  certificaciones: string[];
}

export interface DatosReservados {
  dni: string | null;
  costo_hora: number | null;
  contacto_emergencia: string | null;
  telefono_emergencia: string | null;
  notas: string | null;
}

export async function listarEmpleados(): Promise<Empleado[]> {
  return exigir(await sb().from('v_empleados').select('*').order('nombre').limit(2000)) as Empleado[];
}

// Guarda la ficha y, si se pasan, sus datos reservados (solo gerencia llega hasta acá).
export async function guardarEmpleado(id: string | null, datos: DatosEmpleado, reservados: DatosReservados | null): Promise<string> {
  const fila = id
    ? (exigir(await sb().from('empleados').update(datos).eq('id', id).select('id').single()) as { id: string })
    : (exigir(await sb().from('empleados').insert(datos).select('id').single()) as { id: string });
  if (reservados) {
    exigir(await sb().from('empleados_reservado').upsert({ empleado_id: fila.id, ...reservados }, { onConflict: 'empleado_id' }).select('empleado_id').single());
  }
  return fila.id;
}

export async function borrarEmpleado(id: string): Promise<void> {
  exigir(await sb().from('empleados').delete().eq('id', id).select('id').single());
}

// Engancha, por email, las fichas del sector que todavía no tienen usuario. Devuelve cuántas enganchó.
export async function vincularEmpleados(): Promise<number> {
  return exigir(await sb().rpc('vincular_empleados')) as number;
}

// Cómo está el acceso al sistema de un empleado (en la v1 era el "diagnóstico de vinculación").
export type Acceso = { nivel: 'ok' | 'aviso' | 'sin'; texto: string; detalle: string };
export function accesoDe(e: Empleado): Acceso {
  if (e.perfil_id && e.usuario_activo === false) return { nivel: 'aviso', texto: 'Usuario dado de baja', detalle: 'Tiene usuario, pero está dado de baja: no puede ingresar.' };
  if (e.perfil_id) return { nivel: 'ok', texto: 'Con usuario', detalle: 'Puede ingresar al sistema.' };
  if (!e.email) return { nivel: 'sin', texto: 'Sin usuario', detalle: 'No tiene email cargado. Si tiene que ingresar, cargale el email e invitalo.' };
  return { nivel: 'aviso', texto: 'Sin invitar', detalle: 'Tiene email pero todavía no tiene usuario. Invitalo para que pueda ingresar.' };
}

// ------------------------------------------------------------------ personal asignado a un lugar

export interface Asignado {
  empleado_id: string;
  nombre: string;
  puesto: string | null;
}

export async function asignadosA(ubicacionId: string): Promise<Asignado[]> {
  const filas = exigir(
    await sb().from('ubicacion_empleados').select('empleado_id, empleados(nombre, puesto)').eq('ubicacion_id', ubicacionId),
  ) as unknown as { empleado_id: string; empleados: { nombre: string; puesto: string | null } | null }[];
  return filas
    .map((f) => ({ empleado_id: f.empleado_id, nombre: f.empleados?.nombre ?? '', puesto: f.empleados?.puesto ?? null }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function asignarEmpleado(ubicacionId: string, empleadoId: string): Promise<void> {
  exigir(await sb().from('ubicacion_empleados').upsert({ ubicacion_id: ubicacionId, empleado_id: empleadoId }, { onConflict: 'ubicacion_id,empleado_id' }).select('empleado_id').single());
}

export async function desasignarEmpleado(ubicacionId: string, empleadoId: string): Promise<void> {
  exigir(await sb().from('ubicacion_empleados').delete().eq('ubicacion_id', ubicacionId).eq('empleado_id', empleadoId).select('empleado_id').single());
}

// ------------------------------------------------------------------ tablets de cuadrilla

export interface Tablet {
  id: string;
  nombre: string;
  jefe_sitio_id: string;
  perfil_id: string | null;
  activa: boolean;
  ultima_actividad: string | null;
  notas: string | null;
  jefe_sitio_nombre: string | null;
  usuario_nombre: string | null;
  usuario_email: string | null;
  cuadrilla: number;
}

export async function listarTablets(): Promise<Tablet[]> {
  return exigir(await sb().from('v_tablets').select('*').order('nombre')) as Tablet[];
}

export async function guardarTablet(id: string | null, d: { nombre: string; jefe_sitio_id: string; perfil_id: string | null; activa: boolean; notas: string | null }): Promise<void> {
  exigir(id ? await sb().from('tablets').update(d).eq('id', id).select('id').single() : await sb().from('tablets').insert(d).select('id').single());
}

export async function borrarTablet(id: string): Promise<void> {
  exigir(await sb().from('tablets').delete().eq('id', id).select('id').single());
}

// La tablet con la que se ingresó, o null si el usuario no es el de una tablet.
export interface MiTablet {
  id: string;
  nombre: string;
  jefe_sitio_id: string;
  jefe_sitio_nombre: string | null;
}

export async function miTablet(): Promise<MiTablet | null> {
  return (exigir(await sb().rpc('mi_tablet')) as MiTablet | null) ?? null;
}

// ------------------------------------------------------------------ fichajes

export type TipoFichaje = 'entrada' | 'salida';
export const ORIGEN_FICHAJE: Record<string, string> = {
  propio: 'Con su usuario', tablet: 'Tablet de la cuadrilla', jefe: 'Lo cargó el jefe de sitio', gerencia: 'Lo cargó gerencia', migracion: 'Traído de la v1',
};

// Fila de v_fichajes
export interface Fichaje {
  id: string;
  empleado_id: string;
  tipo: TipoFichaje;
  momento: string;
  dia: string;
  ubicacion_id: string | null;
  lat: number | null;
  lng: number | null;
  distancia_m: number | null;
  lejos: boolean;
  origen: string;
  notas: string | null;
  created_at: string;
  empleado_nombre: string;
  empleado_puesto: string | null;
  ubicacion_nombre: string | null;
  registrado_por_nombre: string | null;
}

// Fila de v_jornadas
export interface Jornada {
  id: string;
  empleado_id: string;
  empleado_nombre: string;
  empleado_puesto: string | null;
  dia: string;
  entrada: string;
  salida: string | null;
  horas: number | null;
  ubicacion_nombre: string | null;
  lejos: boolean;
}

export interface FiltroFichajes {
  desde: string;
  hasta: string;
  empleado?: string;
}

// `hasta` es un día inclusive: se pide hasta el comienzo del día siguiente.
function finDe(dia: string): string {
  const d = new Date(`${dia}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export async function listarFichajes(f: FiltroFichajes): Promise<Fichaje[]> {
  let q = sb().from('v_fichajes').select('*').gte('momento', new Date(`${f.desde}T00:00:00`).toISOString()).lt('momento', finDe(f.hasta))
    .order('momento', { ascending: false }).limit(2000);
  if (f.empleado) q = q.eq('empleado_id', f.empleado);
  return exigir(await q) as Fichaje[];
}

export async function listarJornadas(f: FiltroFichajes): Promise<Jornada[]> {
  let q = sb().from('v_jornadas').select('*').gte('entrada', new Date(`${f.desde}T00:00:00`).toISOString()).lt('entrada', finDe(f.hasta))
    .order('entrada', { ascending: false }).limit(2000);
  if (f.empleado) q = q.eq('empleado_id', f.empleado);
  return exigir(await q) as Jornada[];
}

// Carga a mano una marca de otra persona (gerencia: cualquier fecha pasada; jefe de sitio: hasta 3 días atrás).
export async function cargarFichaje(d: { empleado_id: string; tipo: TipoFichaje; momento: string; ubicacion_id: string | null; nota: string | null }): Promise<void> {
  exigir(await sb().rpc('fichar', { p_empleado: d.empleado_id, p_tipo: d.tipo, p_momento: d.momento, p_ubicacion: d.ubicacion_id, p_nota: d.nota }));
}

export async function borrarFichaje(id: string): Promise<void> {
  exigir(await sb().from('fichajes').delete().eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ horas de una orden

export type TipoHora = 'normal' | 'extra' | 'guardia';
export const TIPOS_HORA: Record<TipoHora, string> = { normal: 'Normal', extra: 'Extra', guardia: 'Guardia' };

// Fila de v_ot_horas. `costo` solo llega para quien puede leer el costo por hora.
export interface HoraOT {
  id: string;
  ot_id: string;
  empleado_id: string | null;
  empleado_nombre: string;
  fecha: string;
  horas: number;
  tipo: TipoHora;
  descripcion: string | null;
  created_by: string | null;
  costo: number | null;
}

export async function horasDeOT(otId: string): Promise<HoraOT[]> {
  return exigir(await sb().from('v_ot_horas').select('*').eq('ot_id', otId).order('fecha').order('created_at')) as HoraOT[];
}

export async function cargarHoras(d: { ot_id: string; empleado_id: string | null; empleado_nombre: string | null; fecha: string; horas: number; tipo: TipoHora; descripcion: string | null }): Promise<void> {
  exigir(await sb().from('ot_horas').insert(d).select('id').single());
}

export async function borrarHoras(id: string): Promise<void> {
  exigir(await sb().from('ot_horas').delete().eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ mapa

export type Semaforo = 'rojo' | 'amarillo' | 'verde';

// Fila de v_mapa_ubicaciones
export interface LugarMapa {
  id: string;
  nombre: string;
  codigo: string | null;
  zona: string | null;
  m2: number | null;
  lat: number | null;
  lng: number | null;
  activa: boolean;
  geo_origen: 'manual' | 'direccion' | null;
  geo_intento_at: string | null;
  domicilio: string | null;
  jefe_sitio_id: string | null;
  jefe_sitio_nombre: string | null;
  inspector_nombre: string | null;
  pendientes_abiertos: number;
  pendientes_vencidos: number;
  emergencias_activas: number;
  ots_abiertas: number;
  empleados_asignados: number;
  semaforo: Semaforo;
}

export async function lugaresDelMapa(): Promise<LugarMapa[]> {
  return exigir(await sb().from('v_mapa_ubicaciones').select('*').eq('activa', true).order('nombre').limit(3000)) as LugarMapa[];
}

// Ubica un lugar a mano (tocando el mapa o arrastrando su marca). Solo gerencia.
export async function ubicarLugar(id: string, lat: number, lng: number): Promise<void> {
  exigir(await sb().from('ubicaciones').update({ lat, lng, geo_origen: 'manual' }).eq('id', id).select('id').single());
}

export async function quitarPosicion(id: string): Promise<void> {
  exigir(await sb().from('ubicaciones').update({ lat: null, lng: null, geo_origen: null, geo_intento_at: null }).eq('id', id).select('id').single());
}

// Fichajes con posición de los últimos días, para el mapa.
export async function fichajesConPosicion(dias: number): Promise<Fichaje[]> {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  return exigir(
    await sb().from('v_fichajes').select('*').gte('momento', desde).not('lat', 'is', null).order('momento', { ascending: false }).limit(1500),
  ) as Fichaje[];
}

// Órdenes para el mapa: las abiertas (van sobre su lugar) y las completadas en los últimos días (van donde se hicieron).
export type OTMapa = Pick<OT, 'id' | 'codigo' | 'titulo' | 'estado' | 'prioridad' | 'tipo' | 'ubicacion_id' | 'ubicacion_nombre' | 'asignado_nombre' | 'fecha_programada' | 'fecha_validacion' | 'vencida'> & {
  gps_lat: number | null;
  gps_lng: number | null;
  ubicacion_lat: number | null;
  ubicacion_lng: number | null;
};

const CAMPOS_OT_MAPA = 'id,codigo,titulo,estado,prioridad,tipo,ubicacion_id,ubicacion_nombre,asignado_nombre,fecha_programada,fecha_validacion,vencida,gps_lat,gps_lng,ubicacion_lat,ubicacion_lng';

export async function otsDelMapa(dias: number): Promise<{ abiertas: OTMapa[]; completadas: OTMapa[] }> {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const [a, c] = await Promise.all([
    sb().from('v_ordenes').select(CAMPOS_OT_MAPA).in('estado', ['pendiente', 'asignada', 'en_progreso', 'pendiente_validacion']).limit(2000),
    sb().from('v_ordenes').select(CAMPOS_OT_MAPA).eq('estado', 'completada').gte('fecha_validacion', desde).limit(2000),
  ]);
  return { abiertas: exigir(a) as unknown as OTMapa[], completadas: exigir(c) as unknown as OTMapa[] };
}

export async function buscarEmpleadosPorNombre(q: string): Promise<{ id: string; nombre: string }[]> {
  return exigir(await sb().from('empleados').select('id,nombre').ilike('nombre', patron(q)).neq('estado', 'inactivo').order('nombre').limit(20)) as { id: string; nombre: string }[];
}
