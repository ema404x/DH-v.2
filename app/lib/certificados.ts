import { supabase } from './supabase/client';
import { exigir } from './errores';

// Certificados con la pantalla y el flujo de la v1 (Base44). La base sigue siendo la autoridad (fase 14):
// numera al emitir, no deja certificar de más ni tocar lo emitido, y calcula los totales.

const sb = () => supabase();

export type TipoCert = 'abono_mensual' | 'obra' | 'informe';
export type EstadoCert = 'borrador' | 'emitido' | 'aprobado';

export const TIPO_LABEL: Record<TipoCert, string> = { abono_mensual: 'Abono Mensual', obra: 'Obra', informe: 'Informe' };
export const COMUNAS = ['8A', '8B', '10A'] as const;

// Fila de v_certificados: el certificado con los datos de su contrato.
export interface CertificadoFila {
  id: string;
  contrato_id: string;
  numero: number | null;
  estado: EstadoCert;
  periodo: string;
  fecha_certificado: string;
  numero_recepcion: string | null;
  anticipo_pct: number;
  anticipo_monto_manual: number | null;
  fondo_reparo_pct: number;
  fondo_reparo_monto_manual: number | null;
  fondo_reparo_aplicar: boolean;
  fondo_reparo_nombre: string | null;
  avance_obra_pct: number | null;
  subtotal_presente: number;
  anticipo_monto: number;
  fondo_reparo_monto: number;
  total_neto: number;
  acum_anterior_importe: number;
  acum_presente_importe: number;
  porcentaje_avance: number;
  emitido_at: string | null;
  emitido_por: string | null;
  emitido_nombre: string | null;
  aprobado_at: string | null;
  aprobado_por: string | null;
  aprobado_nombre: string | null;
  firma_url: string | null;
  firma_jefe_url: string | null;
  firma_jefe_nombre: string | null;
  firma_jefe_at: string | null;
  rechazo_motivo: string | null;
  generado_automaticamente: boolean;
  historico: boolean;
  created_at: string;
  tipo: TipoCert;
  contratista: string;
  contratista_cuit: string | null;
  obra_servicio: string;
  emprendimiento: string | null;
  ada_numero: string | null;
  oc_numero: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  plazo: string | null;
  plazo_entrega: string | null;
  condiciones_pago: string | null;
  base: string | null;
  monto_obra_contratada: number | null;
  monto_contratado: number;
  ada_pdf_url: string | null;
  comuna: string | null;
  rubro: string | null;
  ultimo_numero_contrato: number | null;
}

export interface LineaCert {
  id: string;
  contrato_item_id: string;
  numero: number;
  descripcion: string;
  um: string;
  cantidad: number;
  importe_unitario: number;
  importe_total: number;
  med_acum_anterior_unidad: number;
  med_acum_anterior_importe: number;
  med_presente_unidad: number;
  med_presente_importe: number;
  med_acum_presente_unidad: number;
  med_acum_presente_importe: number;
  saldo_pendiente_unidad: number;
  saldo_pendiente_importe: number;
}

export async function listarCertificados(): Promise<CertificadoFila[]> {
  return exigir(await sb().from('v_certificados').select('*').eq('historico', false).order('created_at', { ascending: false }).limit(500)) as CertificadoFila[];
}

export async function obtenerCertificado(id: string): Promise<{ cert: CertificadoFila; lineas: LineaCert[] }> {
  const [c, l] = await Promise.all([
    sb().from('v_certificados').select('*').eq('id', id).single(),
    sb().from('certificado_items').select('*').eq('certificado_id', id).order('numero'),
  ]);
  return { cert: exigir(c) as CertificadoFila, lineas: exigir(l) as LineaCert[] };
}

// Historial de acumulados (v1: certificados no borrador del mismo ADA, en orden de creación).
export async function historialDelContrato(contratoId: string): Promise<CertificadoFila[]> {
  return exigir(await sb().from('v_certificados').select('*').eq('contrato_id', contratoId).neq('estado', 'borrador').order('numero')) as CertificadoFila[];
}

export async function contratoPorAda(ada: string): Promise<{ id: string; ultimo_numero: number | null } | null> {
  const r = await sb().from('v_contratos').select('id, ultimo_numero').eq('estado', 'activo').ilike('ada_numero', ada.trim()).order('created_at', { ascending: false }).limit(1);
  return (exigir(r) as { id: string; ultimo_numero: number | null }[])[0] ?? null;
}

export async function itemsDelContrato(contratoId: string) {
  return exigir(await sb().from('contrato_items').select('id, numero, descripcion, um, cantidad, importe_unitario, importe_total').eq('contrato_id', contratoId).order('numero')) as
    { id: string; numero: number; descripcion: string; um: string; cantidad: number; importe_unitario: number; importe_total: number }[];
}

// Lo ya certificado por ítem (emitidos y aprobados), para el "acumulado anterior" del editor.
export async function acumuladoPorItem(contratoId: string): Promise<Record<string, number>> {
  const r = await sb().from('certificado_items').select('contrato_item_id, med_presente_importe, certificados!inner(estado, contrato_id)')
    .eq('certificados.contrato_id', contratoId).in('certificados.estado', ['emitido', 'aprobado']);
  const filas = exigir(r) as { contrato_item_id: string; med_presente_importe: number }[];
  const acc: Record<string, number> = {};
  for (const f of filas) acc[f.contrato_item_id] = (acc[f.contrato_item_id] ?? 0) + Number(f.med_presente_importe);
  return acc;
}

// ------------------------------------------------------------------ guardar, emitir, aprobar

export interface ItemGuardar {
  id?: string | null;
  descripcion: string;
  um: string;
  cantidad: number;
  importe_unitario: number;
  presente_importe: number;
}

export interface DatosGuardar {
  certificado_id?: string | null;
  contrato_id?: string | null;
  contrato?: Record<string, string | number | null>;
  items?: ItemGuardar[];
  cabecera?: Record<string, string | number | boolean | null>;
}

export async function guardarCertificado(d: DatosGuardar): Promise<string> {
  return exigir(await sb().rpc('guardar_certificado', { p: d })) as string;
}

export async function emitirCertificado(id: string, firmaJefe: string | null, solicitud = true): Promise<number> {
  return exigir(await sb().rpc('emitir_certificado', { p_id: id, p_firma_jefe: firmaJefe, p_solicitud: solicitud })) as number;
}

export async function aprobarCertificado(id: string, firma: string | null): Promise<void> {
  exigir(await sb().rpc('aprobar_certificado', { p_id: id, p_firma_url: firma }));
}

export async function rechazarCertificado(id: string, motivo: string): Promise<void> {
  exigir(await sb().rpc('rechazar_certificado', { p_id: id, p_motivo: motivo }));
}

export async function borrarCertificado(id: string): Promise<void> {
  const r = await sb().from('certificados').delete().eq('id', id).select('id');
  const filas = exigir(r) as { id: string }[];
  if (!filas.length) throw new Error('No se pudo borrar el certificado.');
}

// ------------------------------------------------------------------ abonos maestros

export interface Abono {
  id: string;
  rubro: string | null;
  comuna: string | null;
  contratista: string;
  oc_numero: string | null;
  ada_numero: string | null;
  obra_servicio: string;
  emprendimiento: string | null;
  fecha_oc_emision: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  plazo: string | null;
  plazo_entrega: string | null;
  condiciones_pago: string | null;
  anticipo_pct: number;
  fondo_reparo_pct: number;
  estado: 'activo' | 'pausado' | 'cerrado';
  notas: string | null;
  monto_contratado: number;
  certificados_total: number;
  ada_pdf_url: string | null;
  created_at: string;
}

export interface AbonoItem {
  id: string;
  descripcion: string;
  um: string;
  cantidad: number;
  importe_unitario: number;
  importe_total: number;
}

// Meses de vigencia (inclusive) entre el inicio y el fin del contrato.
export function mesesDe(a: Pick<Abono, 'fecha_inicio' | 'fecha_fin'>): number {
  if (!a.fecha_inicio || !a.fecha_fin) return 0;
  const [yi, mi] = a.fecha_inicio.split('-').map(Number);
  const [yf, mf] = a.fecha_fin.split('-').map(Number);
  return (yf - yi) * 12 + (mf - mi) + 1;
}

export async function listarAbonos(): Promise<{ abonos: Abono[]; items: Record<string, AbonoItem[]> }> {
  const abonos = exigir(await sb().from('v_contratos').select('*').eq('tipo', 'abono_mensual').order('created_at', { ascending: false })) as Abono[];
  const ids = abonos.map((a) => a.id);
  const items: Record<string, AbonoItem[]> = {};
  if (ids.length) {
    const r = exigir(await sb().from('contrato_items').select('id, contrato_id, descripcion, um, cantidad, importe_unitario, importe_total').in('contrato_id', ids).order('numero')) as (AbonoItem & { contrato_id: string })[];
    for (const it of r) (items[it.contrato_id] ??= []).push(it);
  }
  return { abonos, items };
}

export async function guardarAbono(p: Record<string, unknown>): Promise<string> {
  return exigir(await sb().rpc('guardar_abono', { p })) as string;
}

export async function borrarAbono(id: string): Promise<void> {
  const r = await sb().from('contratos').delete().eq('id', id).select('id');
  if (!(exigir(r) as { id: string }[]).length) throw new Error('No se pudo eliminar el abono.');
}

export interface ResultadoMes {
  periodo: string;
  mes: string;
  contratos: { contrato: string; contrato_id: string; comuna: string; mes: string; resultado: string; detalle: string; numero?: number; monto?: number; certificado_id?: string }[];
  ejecutado?: boolean;
  mensaje?: string;
  proxima?: string;
}

export async function certificarMes(mes: string, comunas: string[], regenerar: boolean): Promise<ResultadoMes> {
  return exigir(await sb().rpc('certificar_abonos_del_mes', {
    p_mes: `${mes}-01`, p_contrato: null, p_comunas: comunas.length ? comunas : null, p_regenerar: regenerar,
  })) as ResultadoMes;
}

export async function ejecutarAutomaticos(forzar: boolean): Promise<ResultadoMes> {
  return exigir(await sb().rpc('certificados_automaticos', { p_forzar: forzar })) as ResultadoMes;
}

// ------------------------------------------------------------------ utilidades de la v1

export const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Pesos con centavos, como los certificados que emite hoy la v1 ("$ 60.165,28").
export const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.round(Number(n ?? 0) * 100) / 100 || 0);

export const fmtFecha = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, dia] = d.slice(0, 10).split('-');
  return y && m && dia ? `${dia}/${m}/${y}` : d;
};

// Montos escritos a mano: "1.098.000", "1.098.000,50", "1500,5", "1500.5".
export function parseMonto(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/[^\d.,-]/g, '');
  const puntos = (s.match(/\./g) || []).length;
  const comas = (s.match(/,/g) || []).length;
  let norm = s;
  if (puntos > 1) norm = s.replace(/\./g, '').replace(',', '.');
  else if (puntos === 1 && comas === 0) norm = (s.split('.')[1] ?? '').length === 3 ? s.replace('.', '') : s;
  else if (comas >= 1) norm = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : 0;
}

// "Abril 2026", "abril de 2026", "04/2026" → "2026-04-01".
export function parseMesPeriodo(str: string): string | null {
  const t = str.toLowerCase().trim();
  const nombre = t.match(/([a-záéíóú]+)\s+(?:de\s+)?(\d{4})/);
  if (nombre) {
    const i = MESES_ES.findIndex((m) => m.toLowerCase() === nombre[1]);
    if (i >= 0) return `${nombre[2]}-${String(i + 1).padStart(2, '0')}-01`;
  }
  const num = t.match(/(\d{1,2})[/-](\d{4})/);
  if (num) return `${num[2]}-${num[1].padStart(2, '0')}-01`;
  return null;
}

// Comuna del certificado: la del contrato o, si no tiene, la que figure como palabra suelta en el texto (v1).
export function comunaDe(c: { comuna?: string | null; emprendimiento?: string | null; obra_servicio?: string | null }): string | null {
  if (c.comuna) return c.comuna;
  const t = ` ${c.emprendimiento ?? ''} ${c.obra_servicio ?? ''} `.toUpperCase().replace(/\s+/g, ' ').replace(/(\d+)\s+(A|B)(?=\s|$)/g, '$1$2');
  for (const k of COMUNAS) if (t.includes(` ${k} `)) return k;
  return null;
}

export const hoyISO = () => new Date().toLocaleDateString('sv-SE');
