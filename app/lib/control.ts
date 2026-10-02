import { supabase } from './supabase/client';
import { exigir } from './errores';
import type { Documento } from './obras';

// Control y reportes (tanda 5): alertas, bandeja, auditoría, informes y el reporte de operación.
// Los números se calculan en la base: acá solo se piden y se muestran.

const sb = () => supabase();

// ------------------------------------------------------------------ alertas y bandeja

export type NivelAlerta = 'critica' | 'aviso' | 'info';
export const TIPOS_ALERTA: Record<string, string> = {
  ot_vencida: 'Órdenes vencidas', pendiente_vencido: 'Pendientes vencidos', garantia: 'Garantías por vencer', mantenimiento: 'Mantenimiento vencido',
  stock: 'Stock', prestamo: 'Herramientas sin devolver', obra_plazo: 'Obras con el plazo en riesgo', emergencia: 'Emergencias abiertas',
  patron_emergencias: 'Emergencias repetidas', informe: 'Informes vencidos', requerimiento: 'Compras atrasadas',
};

export interface Alerta {
  clave: string;
  tipo: string;
  nivel: NivelAlerta;
  titulo: string;
  detalle: string | null;
  enlace: string;
  fecha: string | null;
  zona: string | null;
  jefe_sitio_id: string | null;
}

export async function listarAlertas(): Promise<Alerta[]> {
  return exigir(await sb().from('v_mis_alertas').select('*').limit(2000)) as Alerta[];
}

// "Ya la vi": deja de aparecer por unos días (vuelve si sigue vigente).
export async function marcarVista(clave: string, dias = 7): Promise<void> {
  const hasta = new Date(Date.now() + dias * 86400000).toLocaleDateString('sv-SE');
  exigir(await sb().from('alertas_vistas').upsert({ clave, hasta }, { onConflict: 'perfil_id,clave' }).select('id'));
}

export interface Bandeja {
  ots_por_validar: number;
  certificados_por_aprobar: number;
  solicitudes_por_revisar: number;
  requerimientos_por_revisar: number;
  requerimientos_en_compra: number;
  informes_por_vencer: number;
  alertas_criticas: number;
  alertas: number;
}

export async function obtenerBandeja(): Promise<Bandeja> {
  return exigir(await sb().rpc('bandeja')) as Bandeja;
}

export interface Umbrales {
  dias_garantia: number;
  dias_pendiente: number;
  dias_ot: number;
  dias_mantenimiento: number;
  umbral_stock_pct: number;
}

// Los umbrales viven en la configuración del sector (la cambia un admin).
export async function guardarUmbrales(sectorId: string, configActual: Record<string, unknown>, umbrales: Umbrales): Promise<void> {
  exigir(await sb().from('sectores').update({ config: { ...configActual, alertas: umbrales } }).eq('id', sectorId).select('id').single());
}

// ------------------------------------------------------------------ auditoría

export interface RegistroAuditoria {
  id: number;
  tabla: string;
  registro_id: string | null;
  accion: 'alta' | 'cambio' | 'baja';
  usuario_nombre: string | null;
  usuario_rol: string | null;
  cambios: Record<string, unknown>;
  etiqueta: string | null;
  created_at: string;
}

export const TABLAS_AUDITADAS: Record<string, string> = {
  ordenes_trabajo: 'Órdenes', certificados: 'Certificados', contratos: 'Contratos', contrato_items: 'Ítems de contrato', obras: 'Obras',
  perfiles: 'Usuarios', empleados: 'Empleados', empleados_reservado: 'Datos reservados', ubicaciones: 'Ubicaciones', direcciones: 'Direcciones',
  activos: 'Activos', emergencias: 'Emergencias', proveedores: 'Proveedores', presupuestos: 'Presupuestos', materiales: 'Materiales',
  plantillas_ot: 'Plantillas', tablets: 'Tablets', rutinas_catalogo: 'Rutinas', informes: 'Informes',
};

export interface FiltroAuditoria {
  tabla: string;
  accion: string;
  usuario: string;
  desde: string;
  hasta: string;
  registro?: string | null;
}

export async function listarAuditoria(f: FiltroAuditoria): Promise<RegistroAuditoria[]> {
  let q = sb().from('auditoria').select('id, tabla, registro_id, accion, usuario_nombre, usuario_rol, cambios, etiqueta, created_at')
    .order('id', { ascending: false }).limit(1000);
  if (f.tabla) q = q.eq('tabla', f.tabla);
  if (f.accion) q = q.eq('accion', f.accion);
  if (f.usuario.trim()) q = q.ilike('usuario_nombre', `%${f.usuario.trim().replace(/[%_\\]/g, '')}%`);
  if (f.desde) q = q.gte('created_at', `${f.desde}T00:00:00-03:00`);
  if (f.hasta) q = q.lte('created_at', `${f.hasta}T23:59:59.999-03:00`);
  if (f.registro) q = q.eq('registro_id', f.registro);
  return exigir(await q) as RegistroAuditoria[];
}

// ------------------------------------------------------------------ informes

export type EstadoInforme = 'pendiente' | 'en_preparacion' | 'enviado' | 'aprobado' | 'rechazado';
export const ESTADOS_INFORME: Record<EstadoInforme, string> = {
  pendiente: 'Pendiente', en_preparacion: 'En preparación', enviado: 'Enviado', aprobado: 'Aprobado', rechazado: 'Rechazado',
};
export const TIPOS_INFORME: Record<string, string> = {
  avance_obra: 'Avance de obra', inspeccion: 'Inspección', mantenimiento: 'Mantenimiento', financiero: 'Financiero', seguridad: 'Seguridad',
  final: 'Final', otro: 'Otro',
};

export interface Informe {
  id: string;
  codigo: string;
  titulo: string;
  tipo: string;
  estado: EstadoInforme;
  prioridad: string;
  obra_id: string | null;
  obra_titulo: string | null;
  ubicacion_id: string | null;
  ubicacion_nombre: string | null;
  destinatario: string | null;
  responsable_id: string | null;
  responsable_texto: string | null;
  fecha_limite: string | null;
  fecha_envio: string | null;
  fecha_aprobacion: string | null;
  descripcion: string | null;
  observaciones: string | null;
  requiere_firma: boolean;
  firma_obtenida: boolean;
  documentos: Documento[];
  vencido: boolean;
  dias_restantes: number | null;
  falta_firma: boolean;
  created_at: string;
}

export type DatosInforme = Pick<Informe, 'titulo' | 'tipo' | 'estado' | 'prioridad' | 'obra_id' | 'ubicacion_id' | 'destinatario' | 'responsable_id' | 'responsable_texto'
  | 'fecha_limite' | 'fecha_envio' | 'fecha_aprobacion' | 'descripcion' | 'observaciones' | 'requiere_firma' | 'firma_obtenida'>;

export async function listarInformes(): Promise<Informe[]> {
  return exigir(await sb().from('v_informes').select('*').order('fecha_limite', { ascending: true, nullsFirst: false }).limit(2000)) as Informe[];
}

export async function guardarInforme(id: string | null, datos: DatosInforme): Promise<string> {
  if (id) {
    exigir(await sb().from('informes').update(datos).eq('id', id).select('id').single());
    return id;
  }
  return (exigir(await sb().from('informes').insert(datos).select('id').single()) as { id: string }).id;
}

export async function guardarDocumentosInforme(id: string, documentos: Documento[]): Promise<void> {
  exigir(await sb().from('informes').update({ documentos }).eq('id', id).select('id').single());
}

export async function borrarInforme(id: string): Promise<void> {
  exigir(await sb().from('informes').delete().eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ reporte de operación

export interface Conteo { clave: string; cantidad: number; completadas?: number; total?: number; resueltos?: number }

export interface Reporte {
  periodo: { desde: string; hasta: string; zona: string | null; jefe: string | null };
  ots: {
    total: number; completadas: number; canceladas: number; abiertas: number; vencidas: number; eficiencia: number | null; dias_promedio_cierre: number | null;
    por_mes: { mes: string; total: number; completadas: number; abiertas: number }[];
    por_tipo: Conteo[];
    por_prioridad: Conteo[];
    por_operario: { nombre: string; total: number; completadas: number; eficiencia: number | null }[];
    por_zona: { zona: string; total: number; completadas: number; vencidas: number }[];
  };
  pendientes: {
    total: number; activos: number; resueltos: number; vencidos: number; sin_asignar: number; tasa_resolucion: number | null; mttr_dias: number | null;
    backlog: number | null;
    antiguedad: { hasta_7: number; de_8_a_30: number; de_31_a_60: number; mas_de_60: number };
    por_estado: Conteo[];
    por_zona: { zona: string; total: number; resueltos: number; activos: number; vencidos: number }[];
    por_prioridad: Conteo[];
  };
  jefes: { id: string; nombre: string; pendientes: number; resueltos: number; vencidos: number; ots: number; ots_completadas: number; mttr_dias: number | null; puntaje: number }[];
  horas: { total: number; extra: number; por_persona: { nombre: string; horas: number; ordenes: number }[] };
  materiales: { salidas_valor: number; compras_valor: number; por_obra: { obra: string; valor: number }[]; mas_usados: { material: string; cantidad: number; unidad: string; valor: number }[]; bajo_minimo: number };
  emergencias: { total: number; abiertas: number; minutos_atencion: number | null; minutos_resolucion: number | null; por_tipo: Conteo[] };
}

export async function obtenerReporte(desde: string, hasta: string, zona: string | null, jefe: string | null): Promise<Reporte> {
  return exigir(await sb().rpc('reporte_operacion', { p_desde: desde, p_hasta: hasta, p_zona: zona, p_jefe: jefe })) as Reporte;
}
