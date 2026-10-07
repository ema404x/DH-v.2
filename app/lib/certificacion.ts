import { supabase } from './supabase/client';
import { exigir } from './errores';
import type { Certificado, Contrato, ItemContrato, LineaCertificado } from './types';

// Certificación: la base es la autoridad. Desde acá solo se escribe la medición del período
// y se piden las acciones (crear, emitir, aprobar, rechazar). Totales, acumulados, numeración
// y bloqueos los resuelve Postgres.

export async function listarContratos(): Promise<Contrato[]> {
  return exigir(await supabase().from('v_contratos').select('*').order('contratista').limit(200)) as Contrato[];
}

export interface DetalleContrato {
  contrato: Contrato;
  items: ItemContrato[];
  certificados: Certificado[];
}

export async function obtenerContrato(id: string): Promise<DetalleContrato> {
  const sb = supabase();
  const [contrato, items, certificados] = await Promise.all([
    sb.from('v_contratos').select('*').eq('id', id).single(),
    sb.from('contrato_items').select('*').eq('contrato_id', id).order('numero'),
    sb.from('v_certificados').select('*').eq('contrato_id', id).order('numero', { ascending: false, nullsFirst: true }),
  ]);
  return {
    contrato: exigir(contrato) as Contrato,
    items: exigir(items) as ItemContrato[],
    certificados: exigir(certificados) as Certificado[],
  };
}

export interface NuevoItem {
  descripcion: string;
  um: string;
  cantidad: number;
  importe_unitario: number;
}

export interface NuevoContrato {
  tipo: 'abono_mensual' | 'obra';
  contratista: string;
  contratista_cuit: string | null;
  obra_servicio: string;
  ada_numero: string | null;
  oc_numero: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  anticipo_pct: number;
  fondo_reparo_pct: number;
  fondo_reparo_aplicar: boolean;
  emprendimiento?: string | null;
  plazo?: string | null;
  condiciones_pago?: string | null;
  // El PDF del ADA en el bucket "documentos", si el contrato se cargó desde el PDF.
  ada_pdf_url?: string | null;
  items: NuevoItem[];
}

// ------------------------------------------------------------------ lectura del ADA con IA

export interface ItemLeido extends NuevoItem {
  subtotal_sospechoso: boolean;
}

export interface ControlSuma {
  total_items: number;
  total_documento: number | null;
  coincide: boolean | null;
  diferencia: number | null;
}

export interface ContratoLeido {
  tipo: 'abono_mensual' | 'obra' | 'certificado_avance';
  contratista: string;
  contratista_cuit: string;
  obra_servicio: string;
  emprendimiento: string;
  ada_numero: string;
  oc_numero: string;
  fecha_inicio: string;
  fecha_fin: string;
  plazo: string;
  condiciones_pago: string;
  anticipo_pct: number;
  fondo_reparo_pct: number;
  items: ItemLeido[];
}

async function llamarLector<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().functions.invoke('leer-contrato-pdf', { body: cuerpo });
  if (error) {
    const respuesta = (error as { context?: Response }).context;
    const detalle = await respuesta?.json?.().catch(() => null);
    if (detalle?.error) throw new Error(detalle.error);
    if (respuesta?.status === 404) throw new Error('La lectura de PDF todavía no está publicada en Supabase (función leer-contrato-pdf). Cargá el contrato a mano por ahora.');
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('No hay conexión: el PDF se lee en el servidor. Probá cuando vuelva la señal.');
    throw new Error(`No se pudo leer el PDF (${respuesta?.status ? `error ${respuesta.status}` : error.message}). Probá de nuevo en un rato o cargá el contrato a mano.`);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

// `path`: el PDF ya subido al bucket "documentos" (subirDocumento). La IA no guarda nada: devuelve los datos
// para que una persona los revise en el formulario.
export const leerContratoPDF = (path: string, tipo: 'auto' | 'abono_mensual' | 'obra') =>
  llamarLector<{ datos: ContratoLeido; validacion: ControlSuma; aviso?: string }>({ accion: 'leer', path, tipo: tipo === 'auto' ? null : tipo });

export const corregirItemsPDF = (path: string, totalDocumento: number, totalItems: number) =>
  llamarLector<{ items: ItemLeido[]; validacion: ControlSuma }>({ accion: 'corregir', path, total_documento: totalDocumento, total_items: totalItems });

export async function crearContrato(c: NuevoContrato): Promise<string> {
  const sb = supabase();
  const { items, ...cabecera } = c;
  const contrato = exigir(await sb.from('contratos').insert(cabecera).select('id').single()) as { id: string };
  try {
    exigir(
      await sb.from('contrato_items').insert(items.map((i, n) => ({ ...i, contrato_id: contrato.id, numero: n + 1 }))).select('id'),
    );
  } catch (e) {
    // Sin ítems el contrato no sirve: no se deja a medio cargar.
    await sb.from('contratos').delete().eq('id', contrato.id);
    throw e;
  }
  return contrato.id;
}

export type DatosContrato = Omit<NuevoContrato, 'items' | 'tipo'> & { tipo: NuevoContrato['tipo']; estado: 'activo' | 'cerrado'; condiciones_pago: string | null; notas: string | null };

// El monto contratado no se manda: lo recalcula la base con los ítems.
export async function guardarContrato(id: string, datos: DatosContrato): Promise<void> {
  exigir(await supabase().from('contratos').update(datos).eq('id', id).select('id').single());
}

export async function agregarItemContrato(contratoId: string, numero: number, item: NuevoItem): Promise<void> {
  exigir(await supabase().from('contrato_items').insert({ ...item, contrato_id: contratoId, numero }).select('id').single());
}

// Un ítem con certificados emitidos no cambia cantidad, unidad ni precio (lo frena la base), pero sí su descripción.
export async function guardarItemContrato(id: string, item: NuevoItem): Promise<void> {
  exigir(await supabase().from('contrato_items').update(item).eq('id', id).select('id').single());
}

export async function borrarItemContrato(id: string): Promise<void> {
  exigir(await supabase().from('contrato_items').delete().eq('id', id).select('id').single());
}

export async function crearCertificado(contratoId: string, periodo: string): Promise<string> {
  return exigir(await supabase().rpc('crear_certificado', { p_contrato: contratoId, p_periodo: periodo })) as string;
}

export interface DetalleCertificado {
  certificado: Certificado;
  lineas: LineaCertificado[];
}

export async function obtenerCertificado(id: string): Promise<DetalleCertificado> {
  const sb = supabase();
  const [certificado, lineas] = await Promise.all([
    sb.from('v_certificados').select('*').eq('id', id).single(),
    sb.from('certificado_items').select('*').eq('certificado_id', id).order('numero'),
  ]);
  return { certificado: exigir(certificado) as Certificado, lineas: exigir(lineas) as LineaCertificado[] };
}

// Lo único que escribe el cliente en una línea. La fila vuelve ya calculada por la base.
export async function guardarMedicion(lineaId: string, presente: number): Promise<LineaCertificado> {
  return exigir(
    await supabase().from('certificado_items').update({ med_presente_unidad: presente }).eq('id', lineaId).select('*').single(),
  ) as LineaCertificado;
}

export async function guardarCabecera(
  id: string,
  datos: { periodo: string; fecha_certificado: string; numero_recepcion: string | null; notas: string | null },
): Promise<void> {
  exigir(await supabase().from('certificados').update(datos).eq('id', id).select('id').single());
}

export async function emitirCertificado(id: string): Promise<number> {
  return exigir(await supabase().rpc('emitir_certificado', { p_id: id })) as number;
}

export async function aprobarCertificado(id: string, firma: string | null = null): Promise<void> {
  exigir(await supabase().rpc('aprobar_certificado', { p_id: id, p_firma_url: firma }));
}

export async function miFirma(perfilId: string): Promise<string | null> {
  const r = exigir(await supabase().from('perfiles').select('firma_url').eq('id', perfilId).single()) as { firma_url: string | null };
  return r.firma_url;
}

// La firma de cada uno queda en su perfil, para no dibujarla cada vez.
export async function guardarMiFirma(perfilId: string, firma: string | null): Promise<void> {
  exigir(await supabase().from('perfiles').update({ firma_url: firma }).eq('id', perfilId).select('id').single());
}

export async function rechazarCertificado(id: string, motivo: string): Promise<void> {
  exigir(await supabase().rpc('rechazar_certificado', { p_id: id, p_motivo: motivo }));
}

export async function borrarBorrador(id: string): Promise<void> {
  exigir(await supabase().from('certificados').delete().eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ formato

const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
const cantidad = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 });

export const fmtPesos = (n: number | string | null) => pesos.format(Number(n ?? 0));
export const fmtCantidad = (n: number | string | null) => cantidad.format(Number(n ?? 0));
