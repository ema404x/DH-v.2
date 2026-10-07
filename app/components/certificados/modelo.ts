// El certificado mientras se edita (editor, vista previa y PDF), con las cuentas de la v1 adaptadas a las reglas
// de la base: "A certificar $" por ítem, anticipo y fondo de reparo en % sobre lo certificado o en monto fijo.
import type { ContratoLeido } from '@/lib/certificacion';
import { hoyISO, type CertificadoFila, type DatosGuardar, type EstadoCert, type LineaCert, type TipoCert } from '@/lib/certificados';
import type { DatosPDF, ItemPDF } from '@/lib/pdfCertificado';

export interface ItemEd {
  clave: string;
  id: string | null;            // id del ítem del contrato (null si es nuevo)
  numero: number;
  descripcion: string;
  um: string;
  cantidad: number;
  importe_unitario: number;
  anterior: number;             // ya certificado en $ (certificados emitidos o aprobados)
  presente: number;             // "A certificar $"
  editado: boolean;             // la v1 muestra el resumen de certificación cuando se tocó la medición
  bloqueado: boolean;           // tiene certificados emitidos: no cambia cantidad, unidad ni precio
}

export interface FormCert {
  certificado_id: string | null;
  contrato_id: string | null;
  estado: EstadoCert;
  tipo: TipoCert;
  numeroPrevisto: number;
  numero: number | null;
  emprendimiento: string;
  obra_servicio: string;
  contratista: string;
  ada_numero: string;
  oc_numero: string;
  mes_periodo: string;
  fecha_inicio: string;
  plazo_obra: string;
  plazo_entrega: string;
  fecha_finalizacion: string;
  monto_obra_contratada: string;
  porcentaje_avance: number;
  fecha_certificado: string;
  numero_recepcion: string;
  condiciones_pago: string;
  base: string;
  anticipo_pct: number;
  anticipo_monto_manual: number | null;
  fondo_reparo_pct: number;
  fondo_reparo_monto_manual: number | null;
  fondo_reparo_label: string;
  fondo_reparo_aplicar: boolean;
  ada_pdf_url: string | null;
  total_documento: number | null;
  notas?: string;
  items: ItemEd[];
  // para la vista previa de uno ya emitido
  firma_jefe_url?: string | null;
  firmado_por_jefe?: string | null;
  fecha_firma_jefe?: string | null;
  firma_gerente_url?: string | null;
  aprobado_por?: string | null;
  fecha_aprobacion?: string | null;
  generado_automaticamente?: boolean;
}

const redondear = (n: number) => Math.round(n * 100) / 100;
export const totalItem = (it: Pick<ItemEd, 'cantidad' | 'importe_unitario'>) => redondear((Number(it.cantidad) || 0) * (Number(it.importe_unitario) || 0));

export function nuevoItem(numero: number, um = 'GL'): ItemEd {
  return { clave: crypto.randomUUID(), id: null, numero, descripcion: '', um, cantidad: 1, importe_unitario: 0, anterior: 0, presente: 0, editado: false, bloqueado: false };
}

export function calcular(f: FormCert) {
  const subtotal = f.items.reduce((a, it) => a + totalItem(it), 0);
  const presente = f.items.reduce((a, it) => a + (Number(it.presente) || 0), 0);
  const anterior = f.items.reduce((a, it) => a + (Number(it.anterior) || 0), 0);
  const hasMedicion = f.items.some((it) => it.editado || it.anterior > 0);
  const saldo = Math.max(0, subtotal - anterior - presente);
  const anticipo = f.anticipo_monto_manual != null ? f.anticipo_monto_manual : redondear(presente * (f.anticipo_pct || 0) / 100);
  const fondoCalculado = f.fondo_reparo_monto_manual != null ? f.fondo_reparo_monto_manual : redondear(presente * (f.fondo_reparo_pct || 0) / 100);
  const fondo = f.fondo_reparo_aplicar ? fondoCalculado : 0;
  const neto = presente - anticipo - fondo;
  const pct = subtotal > 0 ? ((anterior + presente) / subtotal) * 100 : 0;
  return { subtotal, presente, anterior, saldo, anticipo, fondoCalculado, fondo, neto, pct, hasMedicion };
}

export function formVacio(): FormCert {
  return {
    certificado_id: null, contrato_id: null, estado: 'borrador', tipo: 'abono_mensual', numeroPrevisto: 1, numero: null,
    emprendimiento: '', obra_servicio: '', contratista: '', ada_numero: '', oc_numero: '', mes_periodo: '', fecha_inicio: '',
    plazo_obra: '', plazo_entrega: '', fecha_finalizacion: '', monto_obra_contratada: '', porcentaje_avance: 0,
    fecha_certificado: hoyISO(), numero_recepcion: '', condiciones_pago: '', base: '',
    anticipo_pct: 0, anticipo_monto_manual: null, fondo_reparo_pct: 0, fondo_reparo_monto_manual: null, fondo_reparo_label: '',
    fondo_reparo_aplicar: false, ada_pdf_url: null, total_documento: null, items: [],
  };
}

// Lo que leyó la IA del PDF. Si el N° de ADA ya tiene contrato, se usan sus ítems y lo ya certificado.
export function formDesdePDF(d: ContratoLeido, path: string, totalDocumento: number | null,
  contrato?: { id: string; ultimo_numero: number | null; items: { id: string; numero: number; descripcion: string; um: string; cantidad: number; importe_unitario: number; importe_total: number }[]; acumulado: Record<string, number> }): FormCert {
  const f = formVacio();
  f.tipo = d.tipo === 'certificado_avance' ? 'informe' : d.tipo;
  f.contratista = d.contratista;
  f.obra_servicio = d.obra_servicio;
  f.emprendimiento = d.emprendimiento;
  f.ada_numero = d.ada_numero;
  f.oc_numero = d.oc_numero;
  f.fecha_inicio = d.fecha_inicio;
  f.fecha_finalizacion = d.fecha_fin;
  f.plazo_obra = d.plazo;
  f.condiciones_pago = d.condiciones_pago;
  f.anticipo_pct = d.anticipo_pct || 0;
  f.fondo_reparo_pct = d.fondo_reparo_pct || 0;
  f.ada_pdf_url = path;
  f.total_documento = totalDocumento;
  if (contrato) {
    f.contrato_id = contrato.id;
    f.numeroPrevisto = (contrato.ultimo_numero ?? 0) + 1;
    f.items = contrato.items.map((it) => {
      const anterior = contrato.acumulado[it.id] ?? 0;
      return {
        clave: crypto.randomUUID(), id: it.id, numero: it.numero, descripcion: it.descripcion, um: it.um, cantidad: Number(it.cantidad),
        importe_unitario: Number(it.importe_unitario), anterior, presente: Math.max(0, redondear(Number(it.importe_total) - anterior)),
        editado: false, bloqueado: anterior > 0,
      };
    });
  } else {
    // Como la v1: lo que se certifica arranca en el total de cada ítem.
    f.items = d.items.map((it, i) => ({
      clave: crypto.randomUUID(), id: null, numero: i + 1, descripcion: it.descripcion, um: it.um || 'GL', cantidad: Number(it.cantidad),
      importe_unitario: Number(it.importe_unitario), anterior: 0, presente: totalItem(it), editado: false, bloqueado: false,
    }));
  }
  return f;
}

// Un certificado guardado (borrador para seguir editando, o emitido para la vista previa).
export function formDesdeCertificado(c: CertificadoFila, lineas: LineaCert[]): FormCert {
  return {
    certificado_id: c.id, contrato_id: c.contrato_id, estado: c.estado, tipo: c.tipo, numero: c.numero,
    numeroPrevisto: c.numero ?? (c.ultimo_numero_contrato ?? 0) + 1,
    emprendimiento: c.emprendimiento ?? '', obra_servicio: c.obra_servicio, contratista: c.contratista, ada_numero: c.ada_numero ?? '',
    oc_numero: c.oc_numero ?? '', mes_periodo: c.periodo, fecha_inicio: c.fecha_inicio ?? '', plazo_obra: c.plazo ?? '',
    plazo_entrega: c.plazo_entrega ?? '', fecha_finalizacion: c.fecha_fin ?? '',
    monto_obra_contratada: c.monto_obra_contratada != null ? String(Number(c.monto_obra_contratada)) : '',
    porcentaje_avance: Number(c.avance_obra_pct ?? 0), fecha_certificado: c.fecha_certificado, numero_recepcion: c.numero_recepcion ?? '',
    condiciones_pago: c.condiciones_pago ?? '', base: c.base ?? '',
    anticipo_pct: Number(c.anticipo_pct), anticipo_monto_manual: c.anticipo_monto_manual != null ? Number(c.anticipo_monto_manual) : null,
    fondo_reparo_pct: Number(c.fondo_reparo_pct), fondo_reparo_monto_manual: c.fondo_reparo_monto_manual != null ? Number(c.fondo_reparo_monto_manual) : null,
    fondo_reparo_label: c.fondo_reparo_nombre ?? '', fondo_reparo_aplicar: c.fondo_reparo_aplicar, ada_pdf_url: c.ada_pdf_url, total_documento: null,
    items: lineas.map((l) => ({
      clave: l.id, id: l.contrato_item_id, numero: l.numero, descripcion: l.descripcion, um: l.um, cantidad: Number(l.cantidad),
      importe_unitario: Number(l.importe_unitario), anterior: Number(l.med_acum_anterior_importe), presente: Number(l.med_presente_importe),
      editado: Number(l.med_presente_importe) !== Number(l.importe_total), bloqueado: Number(l.med_acum_anterior_importe) > 0,
    })),
    firma_jefe_url: c.firma_jefe_url, firmado_por_jefe: c.firma_jefe_nombre, fecha_firma_jefe: c.firma_jefe_at,
    firma_gerente_url: c.firma_url, aprobado_por: c.aprobado_nombre, fecha_aprobacion: c.aprobado_at, generado_automaticamente: c.generado_automaticamente,
  };
}

export function aGuardar(f: FormCert, gerencia: boolean): DatosGuardar {
  const d: DatosGuardar = {
    certificado_id: f.certificado_id,
    contrato_id: f.contrato_id,
    items: f.items.map((it) => ({
      id: it.id, descripcion: it.descripcion, um: it.um, cantidad: Number(it.cantidad), importe_unitario: Number(it.importe_unitario),
      presente_importe: redondear(Number(it.presente) || 0),
    })),
    cabecera: {
      periodo: f.mes_periodo, fecha_certificado: f.fecha_certificado, numero_recepcion: f.numero_recepcion,
      anticipo_pct: f.anticipo_pct || 0, anticipo_monto_manual: f.anticipo_monto_manual, fondo_reparo_pct: f.fondo_reparo_pct || 0,
      fondo_reparo_monto_manual: f.fondo_reparo_monto_manual, fondo_reparo_label: f.fondo_reparo_label, fondo_reparo_aplicar: f.fondo_reparo_aplicar,
      avance_obra_pct: f.porcentaje_avance || null,
      ...(f.notas !== undefined ? { notas: f.notas } : {}),
    },
  };
  if (gerencia) {
    d.contrato = {
      tipo: f.tipo, contratista: f.contratista, obra_servicio: f.obra_servicio, emprendimiento: f.emprendimiento, ada_numero: f.ada_numero,
      oc_numero: f.oc_numero, fecha_inicio: f.fecha_inicio, fecha_fin: f.fecha_finalizacion, plazo: f.plazo_obra, plazo_entrega: f.plazo_entrega,
      condiciones_pago: f.condiciones_pago, base: f.base, monto_obra_contratada: f.monto_obra_contratada ? Number(f.monto_obra_contratada) : null,
      ada_pdf_url: f.ada_pdf_url,
    };
  }
  return d;
}

// Para el PDF: cada fila con sus 13 columnas (unidades y pesos), como la v1.
export function aPDF(f: FormCert, lineas?: LineaCert[]): DatosPDF {
  const c = calcular(f);
  const items: ItemPDF[] = lineas
    ? lineas.map((l) => ({ ...l }))
    : f.items.map((it) => {
      const total = totalItem(it);
      const pu = Number(it.importe_unitario) || 0;
      const u = (pesos: number) => (pu > 0 ? redondear(pesos / pu) : 0);
      const acum = it.anterior + it.presente;
      return {
        numero: it.numero, descripcion: it.descripcion, um: it.um, cantidad: Number(it.cantidad), importe_unitario: pu, importe_total: total,
        med_acum_anterior_unidad: u(it.anterior), med_acum_anterior_importe: it.anterior,
        med_presente_unidad: u(it.presente), med_presente_importe: it.presente,
        med_acum_presente_unidad: u(acum), med_acum_presente_importe: acum,
        saldo_pendiente_unidad: Math.max(0, redondear(Number(it.cantidad) - u(acum))), saldo_pendiente_importe: Math.max(0, total - acum),
      };
    });
  return {
    numero: f.numero ?? f.numeroPrevisto, tipo: f.tipo, estado: f.estado, fecha_certificado: f.fecha_certificado,
    emprendimiento: f.emprendimiento, obra_servicio: f.obra_servicio, contratista: f.contratista, base: f.base, ada_numero: f.ada_numero,
    oc_numero: f.oc_numero, mes_periodo: f.mes_periodo, fecha_inicio: f.fecha_inicio, plazo_obra: f.plazo_obra, fecha_finalizacion: f.fecha_finalizacion,
    monto_contratado: c.subtotal, items,
    anticipo_pct: f.anticipo_pct, anticipo_monto: c.anticipo, anticipo_fijo: f.anticipo_monto_manual != null,
    fondo_reparo_pct: f.fondo_reparo_pct, fondo_reparo_monto: c.fondo, fondo_reparo_fijo: f.fondo_reparo_monto_manual != null,
    fondo_reparo_label: f.fondo_reparo_label || null,
    firma_jefe_url: f.firma_jefe_url ?? null, firmado_por_jefe: f.firmado_por_jefe ?? null, fecha_firma_jefe: f.fecha_firma_jefe ?? null,
    firma_gerente_url: f.firma_gerente_url ?? null, aprobado_por: f.aprobado_por ?? null, fecha_aprobacion: f.fecha_aprobacion ?? null,
  };
}
