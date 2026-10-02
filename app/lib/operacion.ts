import { supabase } from './supabase/client';
import { exigir } from './errores';
import type { FilaCalefaccion, FilaDirectorio, FilaSAP } from './excel';
import type { EstadoOT, Prioridad, TipoOT, Ubicacion } from './types';

// Módulos de operación (fase 6): información general, pendientes SAP, emergencias, rutinas,
// calendario, calefacción e inspecciones. Como en el resto de la app, acá solo se pide y se muestra:
// las reglas (quién puede, qué estado sigue, qué se duplica) están en la base.

const sb = () => supabase();
const patron = (q: string) => `%${q.trim().replace(/[%_\\]/g, '')}%`;

// ------------------------------------------------------------------ información general

export interface Direccion {
  id: string;
  direccion: string;
  zona: string | null;
  jefe_sitio_id: string | null;
  jefe_sitio_nombre: string | null;
  inspector_id: string | null;
  inspector_nombre: string | null;
  m2: number | null;
  activa: boolean;
  ubicaciones_total: number;
}

export interface UbicacionDetalle extends Ubicacion {
  direccion_id: string | null;
  domicilio: string | null;
  m2: number | null;
  jefe_sitio_id: string | null;
  jefe_sitio_nombre: string | null;
  inspector_id: string | null;
  inspector_nombre: string | null;
  ots_abiertas: number;
}

export interface Directorio {
  direcciones: Direccion[];
  ubicaciones: UbicacionDetalle[];
}

// El directorio completo del sector (en escuelas son unos cientos de registros): se agrupa en pantalla.
export async function obtenerDirectorio(): Promise<Directorio> {
  const [d, u] = await Promise.all([
    sb().from('v_direcciones').select('*').order('direccion').limit(2000),
    sb().from('v_ubicaciones').select('*').order('nombre').limit(5000),
  ]);
  return { direcciones: exigir(d) as Direccion[], ubicaciones: exigir(u) as UbicacionDetalle[] };
}

// Asignar jefe de sitio o inspector a una dirección. La base lo lleva a todas sus ubicaciones.
export async function asignarResponsable(direccionId: string, campo: 'jefe_sitio' | 'inspector', perfilId: string | null): Promise<void> {
  const cambios = campo === 'jefe_sitio' ? { jefe_sitio_id: perfilId, jefe_sitio_nombre: null } : { inspector_id: perfilId, inspector_nombre: null };
  exigir(await sb().from('direcciones').update(cambios).eq('id', direccionId).select('id').single());
}

export interface ResultadoDirectorio {
  direcciones_nuevas: number;
  direcciones_actualizadas: number;
  ubicaciones_nuevas: number;
  ubicaciones_actualizadas: number;
  omitidas: number;
}

export async function importarDirectorio(filas: FilaDirectorio[]): Promise<ResultadoDirectorio> {
  return exigir(await sb().rpc('importar_directorio', { p_filas: filas })) as ResultadoDirectorio;
}

// ------------------------------------------------------------------ pendientes SAP

export type EstadoPendiente = 'pendiente' | 'asignado' | 'en_progreso' | 'resuelto' | 'cancelado';
export type TipoPendiente = 'mantenimiento' | 'obra' | 'inspeccion' | 'emergencia';

export const ESTADOS_PENDIENTE: Record<EstadoPendiente, string> = {
  pendiente: 'Sin asignar', asignado: 'Asignado', en_progreso: 'En curso', resuelto: 'Resuelto', cancelado: 'Cancelado',
};
export const TIPOS_PENDIENTE: Record<TipoPendiente, string> = {
  mantenimiento: 'Mantenimiento', obra: 'Obra', inspeccion: 'Inspección', emergencia: 'Emergencia',
};

export interface Pendiente {
  id: string;
  numero_sap: string | null;
  numero_sap_desaprobado: string | null;
  descripcion: string;
  ubicacion_id: string | null;
  ubicacion_nombre: string | null;
  establecimiento: string | null;
  sitio: string | null;
  zona: string | null;
  inspector_nombre: string | null;
  clase_orden: string | null;
  status_sap: string | null;
  tipo: TipoPendiente;
  estado: EstadoPendiente;
  prioridad: Prioridad;
  jefe_sitio_id: string | null;
  jefe_sitio_nombre: string | null;
  fecha_emision_sap: string | null;
  fecha_limite: string | null;
  fecha_asignacion: string | null;
  fecha_resolucion: string | null;
  proyecto_nombre: string | null;
  activo_nombre: string | null;
  presupuesto_estimado: number;
  materiales_necesarios: string | null;
  observaciones: string | null;
  notas_resolucion: string | null;
  vencido: boolean;
  dias_restantes: number | null;
}

export interface FiltroPendientes {
  zona: string | null;
  estado: EstadoPendiente | 'abiertos' | 'todos';
  q: string;
}

export async function listarPendientes(f: FiltroPendientes): Promise<Pendiente[]> {
  let q = sb().from('v_pendientes').select('*').order('fecha_limite', { ascending: true, nullsFirst: false }).limit(2000);
  if (f.zona === '') q = q.is('zona', null);
  else if (f.zona) q = q.eq('zona', f.zona);
  if (f.estado === 'abiertos') q = q.in('estado', ['pendiente', 'asignado', 'en_progreso']);
  else if (f.estado !== 'todos') q = q.eq('estado', f.estado);
  if (f.q.trim()) {
    // Entre comillas para que una coma o un paréntesis en lo que se busca no rompa el filtro.
    const p = `"${patron(f.q).replace(/"/g, '')}"`;
    q = q.or(['descripcion', 'numero_sap', 'sitio', 'establecimiento', 'inspector_nombre', 'jefe_sitio_nombre'].map((c) => `${c}.ilike.${p}`).join(','));
  }
  return exigir(await q) as Pendiente[];
}

export interface ResumenZona {
  zona: string;
  total: number;
  vencidos: number;
}

export async function resumenPendientesPorZona(): Promise<ResumenZona[]> {
  const filas = exigir(await sb().from('v_pendientes').select('zona,vencido').limit(10000)) as { zona: string | null; vencido: boolean }[];
  const mapa = new Map<string, ResumenZona>();
  for (const f of filas) {
    const z = f.zona ?? '';
    const r = mapa.get(z) ?? { zona: z, total: 0, vencidos: 0 };
    r.total++;
    if (f.vencido) r.vencidos++;
    mapa.set(z, r);
  }
  return [...mapa.values()].sort((a, b) => a.zona.localeCompare(b.zona));
}

export type DatosPendiente = Partial<Omit<Pendiente, 'id' | 'vencido' | 'dias_restantes' | 'ubicacion_nombre' | 'fecha_asignacion'>> & { descripcion: string };

export async function guardarPendiente(id: string | null, datos: DatosPendiente): Promise<void> {
  const tabla = sb().from('pendientes');
  exigir(await (id ? tabla.update(datos).eq('id', id) : tabla.insert(datos)).select('id').single());
}

export async function borrarPendientes(ids: string[]): Promise<void> {
  exigir(await sb().from('pendientes').delete().in('id', ids).select('id'));
}

export interface HistorialPendiente {
  id: string;
  usuario_nombre: string | null;
  estado_anterior: EstadoPendiente | null;
  estado_nuevo: EstadoPendiente | null;
  jefe_anterior: string | null;
  jefe_nuevo: string | null;
  campos_modificados: string[];
  comentario: string | null;
  created_at: string;
}

export async function historialPendiente(id: string): Promise<HistorialPendiente[]> {
  return exigir(await sb().from('pendiente_historial').select('*').eq('pendiente_id', id).order('created_at', { ascending: false })) as HistorialPendiente[];
}

export async function anotarPendiente(id: string, comentario: string): Promise<void> {
  exigir(await sb().rpc('anotar_pendiente', { p_id: id, p_comentario: comentario }));
}

export interface ResultadoSAP {
  importados: number;
  omitidos: number;
  invalidos: number;
}

export async function importarPendientesSAP(filas: FilaSAP[], zona: string, jefes: Record<string, string>): Promise<ResultadoSAP> {
  return exigir(await sb().rpc('importar_pendientes_sap', { p_filas: filas, p_zona: zona, p_jefes: jefes })) as ResultadoSAP;
}

// ------------------------------------------------------------------ emergencias

export type TipoEmergencia = 'incendio' | 'inundacion' | 'corte_electrico' | 'derrumbe' | 'rotura_gas' | 'vandalismo' | 'accidente' | 'otro';
export type EstadoEmergencia = 'activa' | 'en_atencion' | 'resuelta' | 'cancelada';

export const TIPOS_EMERGENCIA: Record<TipoEmergencia, string> = {
  incendio: 'Incendio', inundacion: 'Inundación', corte_electrico: 'Corte eléctrico', derrumbe: 'Derrumbe',
  rotura_gas: 'Pérdida de gas', vandalismo: 'Vandalismo', accidente: 'Accidente', otro: 'Otro',
};
export const ESTADOS_EMERGENCIA: Record<EstadoEmergencia, string> = {
  activa: 'Activa', en_atencion: 'En atención', resuelta: 'Resuelta', cancelada: 'Cancelada',
};

export interface Emergencia {
  id: string;
  codigo: string;
  titulo: string;
  descripcion: string | null;
  tipo: TipoEmergencia;
  estado: EstadoEmergencia;
  ubicacion_id: string;
  ubicacion_nombre: string;
  domicilio: string | null;
  zona: string | null;
  jefe_sitio_nombre: string | null;
  reportado_por: string | null;
  telefono_contacto: string | null;
  fotos: string[];
  ot_id: string | null;
  ot_codigo: string | null;
  notas_resolucion: string | null;
  minutos_atencion: number | null;
  minutos_resolucion: number | null;
  created_at: string;
}

export interface PatronEmergencia {
  ubicacion_id: string;
  ubicacion_nombre: string;
  cantidad: number;
  tipo_mas_frecuente: TipoEmergencia;
}

export async function listarEmergencias(): Promise<{ emergencias: Emergencia[]; patrones: PatronEmergencia[] }> {
  const [e, p] = await Promise.all([
    sb().from('v_emergencias').select('*').order('created_at', { ascending: false }).limit(300),
    sb().from('v_patrones_emergencia').select('*').order('cantidad', { ascending: false }),
  ]);
  return { emergencias: exigir(e) as Emergencia[], patrones: exigir(p) as PatronEmergencia[] };
}

export interface NuevaEmergencia {
  titulo: string;
  descripcion: string | null;
  tipo: TipoEmergencia;
  ubicacion_id: string;
  jefe_sitio_id: string | null;
  reportado_por: string | null;
  telefono_contacto: string | null;
  fotos: string[];
}

export async function reportarEmergencia(e: NuevaEmergencia): Promise<string> {
  return exigir(await sb().rpc('reportar_emergencia', { p: e })) as string;
}

export async function cambiarEmergencia(id: string, estado: EstadoEmergencia, notas?: string): Promise<void> {
  exigir(await sb().from('emergencias').update({ estado, ...(notas !== undefined ? { notas_resolucion: notas || null } : {}) }).eq('id', id).select('id').single());
}

export async function borrarEmergencia(id: string): Promise<void> {
  exigir(await sb().from('emergencias').delete().eq('id', id).select('id').single());
}

// Foto suelta (emergencias, inspecciones): se guarda en la carpeta del sector dentro del bucket de fotos.
export async function subirImagen(sectorId: string, carpeta: string, blob: Blob): Promise<string> {
  const path = `${sectorId}/${carpeta}/${crypto.randomUUID()}.jpg`;
  const r = await sb().storage.from('ot-fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (r.error) throw r.error;
  return sb().storage.from('ot-fotos').getPublicUrl(path).data.publicUrl;
}

export async function subirAdjunto(sectorId: string, carpeta: string, archivo: File): Promise<{ nombre: string; url: string; tipo: string }> {
  const ext = (archivo.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${sectorId}/${carpeta}/${crypto.randomUUID()}.${ext}`;
  const r = await sb().storage.from('ot-fotos').upload(path, archivo, { contentType: archivo.type || 'application/octet-stream', upsert: false });
  if (r.error) throw r.error;
  return { nombre: archivo.name, url: sb().storage.from('ot-fotos').getPublicUrl(path).data.publicUrl, tipo: archivo.type };
}

// ------------------------------------------------------------------ rutinas

export type Ciclo = 'Semanal' | 'Quincenal' | 'Mensual' | 'Bimestral' | 'Trimestral' | 'Cuatrimestral' | 'Semestral' | 'Anual' | 'Bienal';
export type EstadoRutina = 'pendiente' | 'en_proceso' | 'ejecutada' | 'vencida' | 'derivada_tom';
export const CICLOS: Ciclo[] = ['Semanal', 'Quincenal', 'Mensual', 'Bimestral', 'Trimestral', 'Cuatrimestral', 'Semestral', 'Anual', 'Bienal'];
export const ESTADOS_RUTINA: Record<EstadoRutina, string> = {
  pendiente: 'Pendiente', en_proceso: 'En proceso', ejecutada: 'Ejecutada', vencida: 'Vencida', derivada_tom: 'Derivada a TOM',
};

export interface Rutina {
  id: string;
  rubro_id: string | null;
  rubro_nombre: string;
  item: string | null;
  objeto: string;
  acciones: string | null;
  observaciones_tom: string | null;
  tipo: 'mantenimiento' | 'informe';
  ciclo: Ciclo;
  frecuencia_dias: number;
  estacionalidad: number[];
  plazo_dias: number;
  requiere_informe_matriculado: boolean;
  carga_sismesc: boolean;
  activa: boolean;
}

export interface OrdenRutina {
  id: string;
  asignacion_id: string;
  ubicacion_id: string;
  ubicacion_nombre: string;
  zona: string | null;
  jefe_sitio_nombre: string | null;
  estado: EstadoRutina;
  fecha_generada: string;
  fecha_limite: string;
  fecha_ejecucion: string | null;
  plazo_dias: number;
  matricula_profesional: string | null;
  observaciones: string | null;
  adjuntos: { nombre: string; url: string; tipo?: string }[];
  ot_id: string | null;
  ot_codigo: string | null;
  rubro_nombre: string;
  item: string | null;
  objeto: string;
  ciclo: Ciclo;
  acciones: string | null;
  observaciones_tom: string | null;
  requiere_informe_matriculado: boolean;
  carga_sismesc: boolean;
  dias_restantes: number;
  semaforo: 'rojo' | 'amarillo' | 'verde' | null;
}

export async function listarOrdenesRutina(estado: EstadoRutina | 'abiertas' | 'todas'): Promise<OrdenRutina[]> {
  let q = sb().from('v_ordenes_rutina').select('*').order('fecha_limite').limit(3000);
  if (estado === 'abiertas') q = q.in('estado', ['pendiente', 'en_proceso', 'vencida']);
  else if (estado !== 'todas') q = q.eq('estado', estado);
  return exigir(await q) as OrdenRutina[];
}

export async function listarCatalogo(): Promise<Rutina[]> {
  return exigir(await sb().from('rutinas_catalogo').select('*').order('rubro_nombre').order('objeto').limit(1000)) as Rutina[];
}

export type DatosRutina = Omit<Rutina, 'id' | 'frecuencia_dias'>;

export async function guardarRutina(id: string | null, r: DatosRutina): Promise<void> {
  const tabla = sb().from('rutinas_catalogo');
  exigir(await (id ? tabla.update(r).eq('id', id) : tabla.insert(r)).select('id').single());
}

export interface Asignacion {
  id: string;
  ubicacion_id: string;
  rutina_id: string;
  activa: boolean;
  ultima_ejecucion: string | null;
  proxima_ejecucion: string;
}

export async function asignacionesDe(ubicacionId: string): Promise<Asignacion[]> {
  return exigir(await sb().from('rutinas_ubicacion').select('*').eq('ubicacion_id', ubicacionId)) as Asignacion[];
}

export async function activarRutina(ubicacionId: string, rutinaId: string, asignacionId: string | null, activa: boolean): Promise<void> {
  if (asignacionId) {
    exigir(await sb().from('rutinas_ubicacion').update({ activa }).eq('id', asignacionId).select('id').single());
  } else {
    exigir(await sb().from('rutinas_ubicacion').insert({ ubicacion_id: ubicacionId, rutina_id: rutinaId, activa }).select('id').single());
  }
}

export interface ResumenRutinas {
  asignaciones_creadas: number;
  ubicaciones: number;
  rutinas: number;
  asignaciones: number;
}

export const sincronizarRutinas = async () => exigir(await sb().rpc('sincronizar_rutinas')) as ResumenRutinas;
export const procesarRutinas = async () => exigir(await sb().rpc('procesar_rutinas')) as { ordenes_creadas: number; ordenes_vencidas: number };
export const generarOTRutinas = async (ubicacionId: string) => exigir(await sb().rpc('generar_ot_rutinas', { p_ubicacion: ubicacionId })) as string;

export interface DatosOTRutina {
  titulo: string;
  descripcion: string | null;
  tipo: TipoOT;
  prioridad: Prioridad;
  asignado_a: string | null;
  fecha_programada: string | null;
  notas: string | null;
}

export const generarOTRutina = async (ordenId: string, d: DatosOTRutina) => exigir(await sb().rpc('generar_ot_rutina', { p_orden: ordenId, p: d })) as string;

export async function actualizarOrdenRutina(
  id: string,
  cambios: Partial<Pick<OrdenRutina, 'estado' | 'matricula_profesional' | 'observaciones' | 'adjuntos'>>,
): Promise<void> {
  exigir(await sb().from('ordenes_rutina').update(cambios).eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ calendario

export interface EventoCalendario {
  tipo: 'ot' | 'mantenimiento' | 'rutina' | 'informe' | 'prestamo';
  id: string;
  fecha: string;
  titulo: string;
  estado: EstadoOT | EstadoRutina | 'pendiente' | string;
  prioridad: Prioridad;
  responsable: string | null;
  ubicacion: string | null;
  descripcion: string | null;
  vencido: boolean;
}

// Solo el rango que se está mirando: no hay recortes fijos que dejen eventos afuera.
export async function eventosEntre(desde: string, hasta: string): Promise<EventoCalendario[]> {
  return exigir(await sb().from('v_calendario').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha').limit(5000)) as EventoCalendario[];
}

export async function reprogramarOT(id: string, fecha: string): Promise<void> {
  exigir(await sb().from('ordenes_trabajo').update({ fecha_programada: fecha }).eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ calefacción

export type TipoEquipo = 'estufas' | 'radiadores' | 'conductos' | 'calderas' | 'vrv' | 'vrv_bajo_silueta' | 'aire_acondicionado_calor' | 'otros';
export type EstadoOperativo = 'critico' | 'alerta' | 'normal' | 'optimo';
export const TIPOS_EQUIPO: Record<TipoEquipo, string> = {
  estufas: 'Estufas', radiadores: 'Radiadores', conductos: 'Conductos', calderas: 'Calderas', vrv: 'VRV',
  vrv_bajo_silueta: 'VRV bajo silueta', aire_acondicionado_calor: 'Aire acondicionado', otros: 'Otros',
};
export const ESTADOS_OPERATIVOS: Record<EstadoOperativo, string> = { critico: 'Crítico', alerta: 'Alerta', normal: 'Normal', optimo: 'Óptimo' };

export interface Equipamiento {
  id: string;
  ubicacion_id: string | null;
  escuela: string;
  zona: string | null;
  jefe_sitio_nombre: string | null;
  tipo_equipo: TipoEquipo;
  periodo: string;
  cantidad_total: number;
  cantidad_funciona: number;
  cantidad_no_funciona: number;
  porcentaje_operativo: number;
  estado: EstadoOperativo;
  observaciones: string | null;
  created_at: string;
}

export async function periodosCalefaccion(): Promise<string[]> {
  const filas = exigir(await sb().from('equipamiento_calefaccion').select('periodo,created_at').order('created_at', { ascending: false }).limit(10000)) as { periodo: string }[];
  return [...new Set(filas.map((f) => f.periodo))];
}

export async function equipamientoDe(periodo: string): Promise<Equipamiento[]> {
  return exigir(await sb().from('equipamiento_calefaccion').select('*').eq('periodo', periodo).order('escuela').limit(10000)) as Equipamiento[];
}

export async function importarCalefaccion(filas: FilaCalefaccion[], periodo: string): Promise<{ importados: number; por_estado: Partial<Record<EstadoOperativo, number>> }> {
  return exigir(await sb().rpc('importar_calefaccion', { p_filas: filas, p_periodo: periodo })) as { importados: number; por_estado: Partial<Record<EstadoOperativo, number>> };
}

export async function guardarEquipamiento(id: string, cambios: { tipo_equipo: TipoEquipo; cantidad_total: number; cantidad_funciona: number; observaciones: string | null }): Promise<void> {
  exigir(await sb().from('equipamiento_calefaccion').update(cambios).eq('id', id).select('id').single());
}

export async function borrarEquipamiento(id: string): Promise<void> {
  exigir(await sb().from('equipamiento_calefaccion').delete().eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ inspecciones

export type Urgencia = 'urgente' | 'importante' | 'leve' | 'sin_issues';
export const URGENCIAS: Record<Urgencia, string> = { urgente: 'Urgente', importante: 'Importante', leve: 'Leve', sin_issues: 'Sin problemas' };

export interface SeccionInspeccion {
  id: string;
  nombre: string;
  urgencia: Urgencia | null;
  transcripcion: string;
  notas_libres: string;
  fotos: string[];
  completada: boolean;
}

export const SECCIONES_INICIALES = [
  'Fachada y accesos', 'Aulas', 'Baños', 'Cocina / Comedor', 'Patio / Espacios exteriores', 'Instalaciones eléctricas',
  'Instalaciones de agua / Plomería', 'Instalaciones de gas', 'Techo / Cubierta', 'Sala de dirección / Administración',
  'Observaciones generales', 'Otro',
];

export interface Inspeccion {
  id: string;
  sector_id: string;
  titulo: string;
  ubicacion_id: string | null;
  establecimiento: string;
  direccion: string | null;
  zona: string | null;
  estado: 'en_progreso' | 'generando' | 'completado';
  fecha_inspeccion: string;
  secciones: SeccionInspeccion[];
  informe_generado: string | null;
  // De dónde salió el informe que se ve, y si hay una redacción con IA en camino que lo va a reemplazar.
  informe_origen: 'ia' | 'plantilla' | null;
  informe_ia_pendiente: boolean;
  informe_ia_motivo: string | null;
  created_at: string;
}

export async function listarInspecciones(): Promise<Inspeccion[]> {
  return exigir(await sb().from('inspecciones').select('*').order('created_at', { ascending: false }).limit(300)) as Inspeccion[];
}

export async function obtenerInspeccion(id: string): Promise<Inspeccion> {
  return exigir(await sb().from('inspecciones').select('*').eq('id', id).single()) as Inspeccion;
}

export async function crearInspeccion(d: { titulo: string; ubicacion_id: string | null; establecimiento: string; direccion: string | null; zona: string | null; fecha_inspeccion: string }): Promise<string> {
  const secciones: SeccionInspeccion[] = SECCIONES_INICIALES.map((nombre, i) => ({
    id: `sec_${i}`, nombre, urgencia: null, transcripcion: '', notas_libres: '', fotos: [], completada: false,
  }));
  const fila = exigir(await sb().from('inspecciones').insert({ ...d, secciones }).select('id').single()) as { id: string };
  return fila.id;
}

export async function guardarSecciones(id: string, secciones: SeccionInspeccion[]): Promise<void> {
  exigir(await sb().from('inspecciones').update({ secciones }).eq('id', id).select('id').single());
}

export async function borrarInspeccion(id: string): Promise<void> {
  exigir(await sb().from('inspecciones').delete().eq('id', id).select('id').single());
}

export interface OTPropuesta {
  titulo: string;
  descripcion: string;
  tipo: TipoOT;
  prioridad: Prioridad;
  lugar: string;
}

// El informe y las órdenes propuestas los arma la edge function "informe-inspeccion".
// El informe sale al instante por plantilla; si hay IA, queda `pendiente` y la redacción lo reemplaza sola después.
// Las órdenes salen con IA si responde en el momento, y si no por plantilla, con un aviso que explica por qué.
interface OrigenInforme {
  origen: 'ia' | 'plantilla';
  aviso?: string;
}
async function llamarInforme<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().functions.invoke('informe-inspeccion', { body: cuerpo });
  if (error) {
    const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detalle?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const generarInforme = (id: string) => llamarInforme<{ informe: string; pendiente: boolean } & OrigenInforme>({ accion: 'informe', inspeccion_id: id });
export const proponerOTs = (id: string) => llamarInforme<{ ordenes: OTPropuesta[] } & OrigenInforme>({ accion: 'ordenes', inspeccion_id: id });
