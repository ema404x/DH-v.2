import { supabase } from './supabase/client';
import { exigir } from './errores';
import type { FilaMaterial } from './excel';
import type { Documento } from './obras';

// Pañol (tanda 4): materiales, movimientos, préstamos de herramientas, requerimientos de compra y materiales de
// cada orden. El stock lo mueve solo la base (registrar_movimiento y compañía): acá se pide y se muestra.

const sb = () => supabase();

export const CATEGORIAS: Record<string, string> = {
  electrico: 'Eléctrico', plomeria: 'Plomería', pintura: 'Pintura', construccion: 'Construcción', herreria: 'Herrería',
  herramientas: 'Herramientas', seguridad: 'Seguridad', climatizacion: 'Climatización', limpieza: 'Limpieza', otros: 'Otros',
};
export const UNIDADES: Record<string, string> = {
  unidad: 'unidad', metro: 'm', metro2: 'm²', metro3: 'm³', kg: 'kg', litro: 'l', bolsa: 'bolsa', caja: 'caja', rollo: 'rollo', par: 'par', juego: 'juego',
};
export const MOTIVOS_ENTRADA: Record<string, string> = {
  compra: 'Compra', devolucion: 'Devolución', ajuste_entrada: 'Ajuste (sobrante)',
};
export const MOTIVOS_SALIDA: Record<string, string> = {
  consumo: 'Consumo', asignacion_obra: 'Asignación a obra', perdida: 'Pérdida o rotura', ajuste_salida: 'Ajuste (faltante)',
};
export const MOTIVOS: Record<string, string> = {
  stock_inicial: 'Stock inicial', ...MOTIVOS_ENTRADA, devolucion_prestamo: 'Vuelta de préstamo', ...MOTIVOS_SALIDA, prestamo: 'Préstamo',
};

// Las abreviaturas (m, kg, l) no cambian; las palabras van en plural si la cantidad no es 1: "3 unidades", "1 bolsa".
const PLURALES: Record<string, string> = { unidad: 'unidades', bolsa: 'bolsas', caja: 'cajas', rollo: 'rollos', par: 'pares', juego: 'juegos' };
export const cant = (n: number | string | null, unidad?: string) => {
  const v = Number(n ?? 0);
  const u = unidad ? (v !== 1 && PLURALES[unidad]) || UNIDADES[unidad] || unidad : '';
  return `${v.toLocaleString('es-AR', { maximumFractionDigits: 3 })}${u ? ` ${u}` : ''}`;
};

// ------------------------------------------------------------------ materiales

export interface Material {
  id: string;
  nombre: string;
  codigo: string | null;
  categoria: string;
  unidad: string;
  stock: number;
  stock_minimo: number;
  costo_unitario: number;
  prestable: boolean;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  proveedor_texto: string | null;
  ubicacion_deposito: string | null;
  notas: string | null;
  activo: boolean;
  bajo_minimo: boolean;
  sin_stock: boolean;
  valor: number;
  prestado: number;
  ultimo_movimiento_at: string | null;
}

export type DatosMaterial = Pick<Material, 'nombre' | 'codigo' | 'categoria' | 'unidad' | 'stock_minimo' | 'costo_unitario' | 'prestable' | 'proveedor_id'
  | 'proveedor_texto' | 'ubicacion_deposito' | 'notas' | 'activo'>;

export async function listarMateriales(): Promise<Material[]> {
  return exigir(await sb().from('v_materiales').select('*').order('nombre').limit(5000)) as Material[];
}

// Alta con stock inicial: la base deja el movimiento de stock inicial.
export async function crearMaterial(datos: DatosMaterial, stockInicial: number): Promise<string> {
  return (exigir(await sb().from('materiales').insert({ ...datos, stock: stockInicial }).select('id').single()) as { id: string }).id;
}

export async function guardarMaterial(id: string, datos: DatosMaterial): Promise<void> {
  exigir(await sb().from('materiales').update(datos).eq('id', id).select('id').single());
}

export async function borrarMaterial(id: string): Promise<void> {
  exigir(await sb().from('materiales').delete().eq('id', id).select('id').single());
}

export interface NuevoMovimiento {
  material: string;
  tipo: 'entrada' | 'salida';
  motivo: string;
  cantidad: number;
  obra?: string | null;
  ot?: string | null;
  empleado?: string | null;
  responsable?: string | null;
  remito?: string | null;
  notas?: string | null;
  costo?: number | null;
}

export async function registrarMovimiento(m: NuevoMovimiento): Promise<void> {
  exigir(await sb().rpc('registrar_movimiento', {
    p_material: m.material, p_tipo: m.tipo, p_motivo: m.motivo, p_cantidad: m.cantidad, p_obra: m.obra ?? null, p_ot: m.ot ?? null,
    p_empleado: m.empleado ?? null, p_responsable: m.responsable ?? null, p_remito: m.remito ?? null, p_notas: m.notas ?? null, p_costo: m.costo ?? null,
  }));
}

export async function ajustarStock(material: string, contado: number, notas: string | null): Promise<boolean> {
  return exigir(await sb().rpc('ajustar_stock', { p_material: material, p_contado: contado, p_notas: notas })) !== null;
}

export interface ResultadoCatalogo {
  nuevos: number;
  actualizados: number;
  ajustados: number;
  omitidos: number;
}

export async function importarMateriales(filas: FilaMaterial[], ajustar: boolean): Promise<ResultadoCatalogo> {
  return exigir(await sb().rpc('importar_materiales', { p_filas: filas, p_ajustar: ajustar })) as ResultadoCatalogo;
}

// ------------------------------------------------------------------ movimientos

export interface Movimiento {
  id: string;
  numero: number;
  material_id: string;
  material_nombre: string;
  material_codigo: string | null;
  material_unidad: string;
  tipo: 'entrada' | 'salida';
  motivo: string;
  cantidad: number;
  stock_anterior: number;
  stock_nuevo: number;
  costo_unitario: number;
  valor: number;
  obra_id: string | null;
  obra_titulo: string | null;
  ot_id: string | null;
  ot_codigo: string | null;
  requerimiento_codigo: string | null;
  empleado_nombre: string | null;
  responsable_texto: string | null;
  remito: string | null;
  notas: string | null;
  registrado_por_nombre: string | null;
  created_at: string;
}

export interface FiltroMovimientos {
  material?: string | null;
  tipo?: 'entrada' | 'salida' | null;
  desde?: string | null;
  hasta?: string | null;
}

export async function listarMovimientos(f: FiltroMovimientos): Promise<Movimiento[]> {
  let q = sb().from('v_movimientos_panol').select('*').order('numero', { ascending: false }).limit(2000);
  if (f.material) q = q.eq('material_id', f.material);
  if (f.tipo) q = q.eq('tipo', f.tipo);
  if (f.desde) q = q.gte('created_at', `${f.desde}T00:00:00-03:00`);
  if (f.hasta) q = q.lte('created_at', `${f.hasta}T23:59:59.999-03:00`);
  return exigir(await q) as Movimiento[];
}

// ------------------------------------------------------------------ préstamos

export type EstadoPrestamo = 'prestado' | 'devuelto' | 'perdido';
export const ESTADOS_PRESTAMO: Record<EstadoPrestamo, string> = { prestado: 'Prestado', devuelto: 'Devuelto', perdido: 'Perdido' };

export interface Prestamo {
  id: string;
  numero: number;
  material_id: string;
  material_nombre: string;
  material_codigo: string | null;
  material_unidad: string;
  cantidad: number;
  empleado_id: string;
  empleado_nombre: string;
  ot_id: string | null;
  ot_codigo: string | null;
  obra_titulo: string | null;
  devolver_el: string | null;
  estado: EstadoPrestamo;
  devuelto_at: string | null;
  notas: string | null;
  notas_cierre: string | null;
  vencido: boolean;
  created_at: string;
}

export async function listarPrestamos(soloAbiertos: boolean): Promise<Prestamo[]> {
  let q = sb().from('v_prestamos').select('*').order('created_at', { ascending: false }).limit(2000);
  if (soloAbiertos) q = q.eq('estado', 'prestado');
  return exigir(await q) as Prestamo[];
}

export async function prestar(p: { material: string; cantidad: number; empleado: string; devolverEl: string | null; ot: string | null; notas: string | null }): Promise<void> {
  exigir(await sb().rpc('prestar_herramienta', {
    p_material: p.material, p_cantidad: p.cantidad, p_empleado: p.empleado, p_devolver_el: p.devolverEl, p_ot: p.ot, p_notas: p.notas,
  }));
}

export async function devolver(id: string, notas: string | null): Promise<void> {
  exigir(await sb().rpc('devolver_prestamo', { p_id: id, p_notas: notas }));
}

export async function darPorPerdido(id: string, motivo: string): Promise<void> {
  exigir(await sb().rpc('perder_prestamo', { p_id: id, p_motivo: motivo }));
}

// ------------------------------------------------------------------ requerimientos de compra

export type EstadoReq = 'borrador' | 'enviado' | 'en_revision' | 'aprobado' | 'en_compra' | 'recibido' | 'rechazado' | 'cancelado';
export const ESTADOS_REQ: Record<EstadoReq, string> = {
  borrador: 'Borrador', enviado: 'Enviado', en_revision: 'En revisión', aprobado: 'Aprobado', en_compra: 'En compra',
  recibido: 'Recibido', rechazado: 'Rechazado', cancelado: 'Cancelado',
};
export const PRIORIDADES_REQ: Record<string, string> = { baja: 'Baja', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };

export interface Requerimiento {
  id: string;
  codigo: string;
  titulo: string;
  solicitante_id: string | null;
  solicitante_nombre: string | null;
  revisor_nombre: string | null;
  ubicacion_id: string | null;
  ubicacion_nombre: string | null;
  establecimiento: string | null;
  obra_id: string | null;
  obra_titulo: string | null;
  prioridad: string;
  fecha_necesidad: string | null;
  estado: EstadoReq;
  observaciones: string | null;
  motivo_rechazo: string | null;
  numero_orden_compra: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  proveedor_texto: string | null;
  fecha_entrega_estimada: string | null;
  adjuntos: Documento[];
  historial: { fecha: string; estado: EstadoReq; usuario: string | null; comentario: string | null }[];
  total_estimado: number;
  items_total: number;
  atrasado: boolean;
  created_at: string;
}

export interface ItemReq {
  id: string;
  requerimiento_id: string;
  material_id: string | null;
  descripcion: string;
  unidad: string;
  cantidad_solicitada: number;
  cantidad_aprobada: number | null;
  cantidad_recibida: number;
  costo_estimado: number;
  notas: string | null;
  orden: number;
}

export async function listarRequerimientos(): Promise<Requerimiento[]> {
  return exigir(await sb().from('v_requerimientos').select('*').order('created_at', { ascending: false }).limit(2000)) as Requerimiento[];
}

export async function obtenerRequerimiento(id: string): Promise<{ req: Requerimiento; items: ItemReq[] }> {
  const [r, i] = await Promise.all([
    sb().from('v_requerimientos').select('*').eq('id', id).single(),
    sb().from('requerimiento_items').select('*').eq('requerimiento_id', id).order('orden').order('created_at'),
  ]);
  return { req: exigir(r) as Requerimiento, items: exigir(i) as ItemReq[] };
}

export type DatosReq = Pick<Requerimiento, 'titulo' | 'ubicacion_id' | 'establecimiento' | 'obra_id' | 'prioridad' | 'fecha_necesidad' | 'observaciones' | 'adjuntos'>;

export async function crearRequerimiento(datos: DatosReq): Promise<string> {
  return (exigir(await sb().from('requerimientos_compra').insert(datos).select('id').single()) as { id: string }).id;
}

export async function guardarRequerimiento(id: string, datos: Partial<Requerimiento>): Promise<void> {
  exigir(await sb().from('requerimientos_compra').update(datos).eq('id', id).select('id').single());
}

export async function cambiarEstadoReq(id: string, estado: EstadoReq, extra: Partial<Requerimiento> = {}): Promise<void> {
  exigir(await sb().from('requerimientos_compra').update({ estado, ...extra }).eq('id', id).select('id').single());
}

export async function borrarRequerimiento(id: string): Promise<void> {
  exigir(await sb().from('requerimientos_compra').delete().eq('id', id).select('id').single());
}

export async function agregarItem(item: { requerimiento_id: string; material_id: string | null; descripcion: string; unidad: string; cantidad_solicitada: number; costo_estimado: number; notas: string | null; orden: number }): Promise<void> {
  exigir(await sb().from('requerimiento_items').insert(item).select('id').single());
}

export async function guardarItem(id: string, datos: Partial<ItemReq>): Promise<void> {
  exigir(await sb().from('requerimiento_items').update(datos).eq('id', id).select('id').single());
}

export async function quitarItem(id: string): Promise<void> {
  exigir(await sb().from('requerimiento_items').delete().eq('id', id).select('id').single());
}

export async function recibir(id: string, items: { item_id: string; cantidad: number; costo: number | null }[], remito: string | null, cerrar: boolean): Promise<{ entradas: number; completo: boolean; estado: EstadoReq }> {
  return exigir(await sb().rpc('recibir_requerimiento', { p_id: id, p_items: items, p_remito: remito, p_cerrar: cerrar })) as { entradas: number; completo: boolean; estado: EstadoReq };
}

// ------------------------------------------------------------------ materiales de la orden

export interface MaterialOT {
  id: string;
  ot_id: string;
  material_id: string | null;
  material_codigo: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  costo_unitario: number;
  total: number;
  descontar: boolean;
  created_by: string | null;
  cargado_por_nombre: string | null;
  created_at: string;
}

export async function materialesDeOT(otId: string): Promise<MaterialOT[]> {
  return exigir(await sb().from('v_ot_materiales').select('*').eq('ot_id', otId).order('created_at')) as MaterialOT[];
}

export async function cargarMaterialOT(m: { ot_id: string; material_id: string | null; descripcion: string; cantidad: number; costo_unitario: number; descontar: boolean; unidad?: string }): Promise<void> {
  exigir(await sb().from('ot_materiales').insert(m).select('id').single());
}

export async function quitarMaterialOT(id: string): Promise<void> {
  exigir(await sb().from('ot_materiales').delete().eq('id', id).select('id').single());
}
