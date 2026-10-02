import { supabase } from './supabase/client';
import { exigir } from './errores';
import type {
  Activo, Criticidad, EstadoActivo, EstadoOT, HistorialActivo, OT, Perfil, Plantilla, Prioridad,
  ResultadoBusqueda, Rol, TareaChecklist, TipoActivo, TipoOT, Ubicacion,
} from './types';

export const POR_PAGINA = 25;

export interface Pagina<T> {
  filas: T[];
  total: number;
}

function rango(pagina: number): [number, number] {
  const desde = pagina * POR_PAGINA;
  return [desde, desde + POR_PAGINA - 1];
}

// Texto libre para un ilike: sin comodines propios.
function patron(q: string): string {
  return `%${q.trim().replace(/[%_\\]/g, '')}%`;
}

// ------------------------------------------------------------------ tablero

export interface Kpis {
  pendientes: number;
  asignadas: number;
  en_progreso: number;
  por_validar: number;
  completadas_mes: number;
  vencidas: number;
  urgentes: number;
  activos: number;
  fuera_de_servicio: number;
  preventivos_por_vencer: number;
}

// Las vistas devuelven una fila por sector visible (una sola, salvo con "ver todos"): se suman.
export async function obtenerKpis(): Promise<Kpis> {
  const sb = supabase();
  const [ots, activos] = await Promise.all([sb.from('v_kpi_ots').select('*'), sb.from('v_kpi_activos').select('*')]);
  const o = exigir(ots) as Record<string, number>[];
  const a = exigir(activos) as Record<string, number>[];
  const suma = (filas: Record<string, number>[], campo: string) => filas.reduce((t, f) => t + Number(f[campo] ?? 0), 0);
  return {
    pendientes: suma(o, 'pendientes'),
    asignadas: suma(o, 'asignadas'),
    en_progreso: suma(o, 'en_progreso'),
    por_validar: suma(o, 'por_validar'),
    completadas_mes: suma(o, 'completadas_mes'),
    vencidas: suma(o, 'vencidas'),
    urgentes: suma(o, 'urgentes'),
    activos: suma(a, 'total'),
    fuera_de_servicio: suma(a, 'fuera_de_servicio'),
    preventivos_por_vencer: suma(a, 'preventivos_por_vencer'),
  };
}

export async function generarPreventivos(dias: number): Promise<number> {
  return exigir(await supabase().rpc('generar_ots_preventivas', { p_dias: dias })) as number;
}

// ------------------------------------------------------------------ búsqueda remota (combos)

export type TablaBuscable = 'ubicaciones' | 'direcciones' | 'activos' | 'perfiles' | 'jefes' | 'empleados' | 'plantillas_ot' | 'contratos' | 'obras' | 'proveedores' | 'materiales';

export async function buscar(tabla: TablaBuscable, q: string): Promise<ResultadoBusqueda[]> {
  return exigir(await supabase().rpc('buscar', { p_tabla: tabla, p_q: q })) as ResultadoBusqueda[];
}

// ------------------------------------------------------------------ órdenes

export interface FiltroOTs {
  estado: EstadoOT | 'abiertas' | 'todas';
  q: string;
  pagina: number;
  ubicacion?: string;
}

export async function listarOTs(f: FiltroOTs): Promise<Pagina<OT>> {
  const [desde, hasta] = rango(f.pagina);
  let q = supabase().from('v_ordenes').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(desde, hasta);
  if (f.estado === 'abiertas') q = q.in('estado', ['pendiente', 'asignada', 'en_progreso', 'pendiente_validacion']);
  else if (f.estado !== 'todas') q = q.eq('estado', f.estado);
  if (f.q.trim()) q = q.ilike('titulo', patron(f.q));
  if (f.ubicacion) q = q.eq('ubicacion_id', f.ubicacion);
  const res = await q;
  return { filas: exigir(res) as OT[], total: res.count ?? 0 };
}

export interface NuevaOT {
  titulo: string;
  descripcion: string | null;
  tipo: TipoOT;
  prioridad: Prioridad;
  ubicacion_id: string | null;
  activo_id: string | null;
  asignado_a: string | null;
  fecha_programada: string | null;
  horas_estimadas: number | null;
  checklist: TareaChecklist[];
  requiere_fotos: boolean;
  obra_id?: string | null;
}

// No se manda sector: lo estampa la base con el sector activo del usuario.
export async function crearOT(ot: NuevaOT): Promise<string> {
  const fila = exigir(await supabase().from('ordenes_trabajo').insert(ot).select('id').single()) as { id: string };
  return fila.id;
}

export async function listarPlantillas(): Promise<Plantilla[]> {
  return exigir(await supabase().from('plantillas_ot').select('*').order('nombre').limit(1000)) as Plantilla[];
}

export async function guardarPlantilla(id: string | null, datos: Omit<Plantilla, 'id'>): Promise<void> {
  if (id) exigir(await supabase().from('plantillas_ot').update(datos).eq('id', id).select('id').single());
  else exigir(await supabase().from('plantillas_ot').insert(datos).select('id').single());
}

export async function borrarPlantilla(id: string): Promise<void> {
  exigir(await supabase().from('plantillas_ot').delete().eq('id', id).select('id').single());
}

export async function obtenerPlantilla(id: string): Promise<Plantilla> {
  return exigir(await supabase().from('plantillas_ot').select('*').eq('id', id).single()) as Plantilla;
}

// ------------------------------------------------------------------ ubicaciones

export async function listarUbicaciones(q: string, pagina: number): Promise<Pagina<Ubicacion>> {
  const [desde, hasta] = rango(pagina);
  let consulta = supabase().from('ubicaciones').select('*', { count: 'exact' }).order('nombre').range(desde, hasta);
  if (q.trim()) consulta = consulta.ilike('nombre', patron(q));
  const res = await consulta;
  return { filas: exigir(res) as Ubicacion[], total: res.count ?? 0 };
}

export interface DatosUbicacion {
  nombre: string;
  codigo: string | null;
  direccion: string | null;
  zona: string | null;
}

export async function crearUbicacion(u: DatosUbicacion): Promise<Ubicacion> {
  return exigir(await supabase().from('ubicaciones').insert(u).select('*').single()) as Ubicacion;
}

export async function guardarUbicacion(id: string, u: DatosUbicacion & { activa: boolean }): Promise<Ubicacion> {
  return exigir(await supabase().from('ubicaciones').update(u).eq('id', id).select('*').single()) as Ubicacion;
}

// ------------------------------------------------------------------ activos

export async function listarActivos(q: string, pagina: number): Promise<Pagina<Activo>> {
  const [desde, hasta] = rango(pagina);
  let consulta = supabase().from('v_expediente_activo').select('*', { count: 'exact' }).order('nombre').range(desde, hasta);
  if (q.trim()) consulta = consulta.ilike('nombre', patron(q));
  const res = await consulta;
  return { filas: exigir(res) as Activo[], total: res.count ?? 0 };
}

export interface DatosActivo {
  nombre: string;
  codigo: string | null;
  tipo: TipoActivo;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  ubicacion_id: string | null;
  padre_id: string | null;
  criticidad: Criticidad;
  frecuencia_mant_dias: number | null;
  proximo_mantenimiento: string | null;
}

export async function crearActivo(a: DatosActivo): Promise<string> {
  const fila = exigir(await supabase().from('activos').insert(a).select('id').single()) as { id: string };
  return fila.id;
}

export async function actualizarActivo(
  id: string,
  cambios: Partial<{ estado: EstadoActivo; ubicacion_id: string | null; proximo_mantenimiento: string | null; notas: string | null }>,
): Promise<void> {
  exigir(await supabase().from('activos').update(cambios).eq('id', id).select('id').single());
}

export interface Expediente {
  activo: Activo;
  historial: HistorialActivo[];
  ordenes: OT[];
  componentes: Pick<Activo, 'id' | 'nombre' | 'codigo' | 'estado'>[];
}

export async function obtenerExpediente(id: string): Promise<Expediente> {
  const sb = supabase();
  const [activo, historial, ordenes, componentes] = await Promise.all([
    sb.from('v_expediente_activo').select('*').eq('id', id).single(),
    sb.from('activo_historial').select('id,tipo,detalle,ot_id,created_at').eq('activo_id', id).order('created_at', { ascending: false }).limit(50),
    sb.from('v_ordenes').select('*').eq('activo_id', id).order('created_at', { ascending: false }).limit(20),
    sb.from('activos').select('id,nombre,codigo,estado').eq('padre_id', id).order('nombre'),
  ]);
  return {
    activo: exigir(activo) as Activo,
    historial: exigir(historial) as HistorialActivo[],
    ordenes: exigir(ordenes) as OT[],
    componentes: exigir(componentes) as Expediente['componentes'],
  };
}

// ------------------------------------------------------------------ usuarios

export async function listarUsuarios(): Promise<Perfil[]> {
  return exigir(
    await supabase().from('perfiles').select('id,email,nombre,rol,sector_id,sector_activo_id,ver_todos,activo,telefono').order('nombre'),
  ) as Perfil[];
}

export async function actualizarUsuario(id: string, cambios: Partial<{ rol: Rol; activo: boolean }>): Promise<void> {
  exigir(await supabase().from('perfiles').update(cambios).eq('id', id).select('id').single());
}

export interface Invitacion {
  email: string;
  nombre: string;
  rol: Rol;
  sector_id: string;
}

// El alta la hace la edge function (crea el usuario de Auth y su perfil). Solo responde a un admin.
export async function invitarUsuario(i: Invitacion): Promise<void> {
  const { data, error } = await supabase().functions.invoke('invitar-usuario', { body: i });
  if (error) {
    // La función devuelve el motivo en el cuerpo; supabase-js lo deja en error.context.
    const cuerpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(cuerpo?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
}

// ------------------------------------------------------------------ sector activo

export async function cambiarSectorActivo(sectorId: string): Promise<void> {
  exigir(await supabase().rpc('cambiar_sector_activo', { p_sector: sectorId }));
}

export async function setVerTodos(valor: boolean): Promise<void> {
  exigir(await supabase().rpc('set_ver_todos', { p_valor: valor }));
}
