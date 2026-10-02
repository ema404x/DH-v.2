import { supabase } from './supabase/client';
import { exigir } from './errores';
import type { FilaCobro, FilaObra } from './excel';
import type { Prioridad } from './types';

// Obras (tanda 3): proveedores, planilla de obras, cobro por ciclo, presupuestos, solicitudes de certificado
// y abonos del mes. Como en el resto de la app, las reglas están en la base: acá se pide y se muestra.

const sb = () => supabase();
const patron = (q: string) => `"%${q.trim().replace(/[%_\\"]/g, '')}%"`;

// ------------------------------------------------------------------ documentos (bucket privado)

export interface Documento {
  nombre: string;
  path: string;
  tipo: string;
  tamano: number;
  subido_at?: string;
}

// Los documentos van al bucket privado "documentos", en la carpeta del sector. Se abren con un enlace firmado.
export async function subirDocumento(sectorId: string, carpeta: string, archivo: File): Promise<Documento> {
  const limpio = archivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${sectorId}/${carpeta}/${crypto.randomUUID()}-${limpio}`;
  const r = await sb().storage.from('documentos').upload(path, archivo, { contentType: archivo.type || 'application/octet-stream', upsert: false });
  if (r.error) throw r.error;
  return { nombre: archivo.name, path, tipo: archivo.type, tamano: archivo.size, subido_at: new Date().toISOString() };
}

export async function abrirDocumento(path: string): Promise<void> {
  // Los documentos traídos de la v1 siguen en Base44: se guardaron con su enlace completo.
  if (/^https?:\/\//.test(path)) {
    window.open(path, '_blank', 'noopener');
    return;
  }
  // La pestaña se abre antes de pedir el enlace: si no, el navegador la bloquea por no venir de un clic.
  const ventana = window.open('', '_blank');
  const r = await sb().storage.from('documentos').createSignedUrl(path, 300);
  if (r.error || !r.data) {
    ventana?.close();
    throw r.error ?? new Error('No se pudo abrir el documento.');
  }
  if (ventana) ventana.location.href = r.data.signedUrl;
  else window.location.href = r.data.signedUrl;
}

export async function borrarArchivo(path: string): Promise<void> {
  if (/^https?:\/\//.test(path)) return;
  await sb().storage.from('documentos').remove([path]);
}

// ------------------------------------------------------------------ proveedores

export const RUBROS: Record<string, string> = {
  construccion: 'Construcción', electricidad: 'Electricidad', plomeria: 'Plomería', pintura: 'Pintura', carpinteria: 'Carpintería',
  herreria: 'Herrería', climatizacion: 'Climatización', albanileria: 'Albañilería', impermeabilizacion: 'Impermeabilización',
  materiales: 'Materiales', equipos: 'Equipos', limpieza: 'Limpieza', seguridad: 'Seguridad', transporte: 'Transporte',
  tecnologia: 'Tecnología', otro: 'Otro',
};
export type EstadoProveedor = 'activo' | 'inactivo' | 'suspendido';
export const ESTADOS_PROVEEDOR: Record<EstadoProveedor, string> = { activo: 'Activo', inactivo: 'Inactivo', suspendido: 'Suspendido' };

export interface Proveedor {
  id: string;
  nombre: string;
  rubro: string;
  zona: string | null;
  cuit: string | null;
  contacto: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  localidad: string | null;
  estado: EstadoProveedor;
  valoracion: number | null;
  notas_valoracion: string | null;
  notas: string | null;
}

export type DatosProveedor = Omit<Proveedor, 'id'>;

export async function listarProveedores(): Promise<Proveedor[]> {
  return exigir(await sb().from('proveedores').select('*').order('nombre').limit(2000)) as Proveedor[];
}

export async function guardarProveedor(id: string | null, datos: DatosProveedor): Promise<void> {
  if (id) exigir(await sb().from('proveedores').update(datos).eq('id', id).select('id').single());
  else exigir(await sb().from('proveedores').insert(datos).select('id').single());
}

export async function borrarProveedor(id: string): Promise<void> {
  exigir(await sb().from('proveedores').delete().eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ obras

export type EstadoObra = 'pendiente' | 'en_progreso' | 'pausado' | 'completado' | 'cancelado';
export const ESTADOS_OBRA: Record<EstadoObra, string> = {
  pendiente: 'Pendiente', en_progreso: 'En ejecución', pausado: 'Pausada', completado: 'Terminada', cancelado: 'Cancelada',
};
export const TIPOS_OBRA: Record<string, string> = {
  obra_nueva: 'Obra nueva', remodelacion: 'Remodelación', mantenimiento_preventivo: 'Mantenimiento preventivo',
  mantenimiento_correctivo: 'Mantenimiento correctivo', emergencia: 'Emergencia', inspeccion: 'Inspección',
};
export type AlertaPlazo = 'aviso' | 'alerta' | 'peligro';

export interface Obra {
  id: string;
  titulo: string;
  codigo_sap: string | null;
  mein: string | null;
  ubicacion_id: string | null;
  ubicacion_nombre: string | null;
  establecimiento: string | null;
  direccion: string | null;
  zona: string | null;
  tipo: string;
  estado: EstadoObra;
  prioridad: Prioridad;
  estado_sap: string | null;
  detalle: string | null;
  monto_base: number;
  costo_real: number;
  avance: number;
  avance_esperado: number;
  plazo_dias: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  jefe_sitio_id: string | null;
  jefe_sitio_nombre: string | null;
  inspector_id: string | null;
  inspector_nombre: string | null;
  supervisor: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  descripcion: string | null;
  notas: string | null;
  documentos: Documento[];
  ots_abiertas: number;
  ots_total: number;
  alerta_plazo: AlertaPlazo | null;
  dias_restantes: number | null;
}

export interface FiltroObras {
  zona: string | null;
  estado: EstadoObra | 'activas' | 'todas';
  q: string;
}

export async function listarObras(f: FiltroObras): Promise<Obra[]> {
  let q = sb().from('v_obras').select('*').order('titulo').limit(3000);
  if (f.zona === '') q = q.is('zona', null);
  else if (f.zona) q = q.eq('zona', f.zona);
  if (f.estado === 'activas') q = q.in('estado', ['pendiente', 'en_progreso', 'pausado']);
  else if (f.estado !== 'todas') q = q.eq('estado', f.estado);
  if (f.q.trim()) {
    const p = patron(f.q);
    q = q.or(['titulo', 'codigo_sap', 'mein', 'establecimiento', 'direccion', 'jefe_sitio_nombre', 'inspector_nombre'].map((c) => `${c}.ilike.${p}`).join(','));
  }
  return exigir(await q) as Obra[];
}

export async function obtenerObra(id: string): Promise<Obra> {
  return exigir(await sb().from('v_obras').select('*').eq('id', id).single()) as Obra;
}

export type DatosObra = Pick<Obra,
  'titulo' | 'codigo_sap' | 'mein' | 'ubicacion_id' | 'establecimiento' | 'direccion' | 'zona' | 'tipo' | 'estado' | 'prioridad' | 'estado_sap' | 'detalle'
  | 'monto_base' | 'costo_real' | 'avance' | 'plazo_dias' | 'fecha_inicio' | 'fecha_fin' | 'jefe_sitio_id' | 'jefe_sitio_nombre' | 'inspector_id'
  | 'inspector_nombre' | 'supervisor' | 'proveedor_id' | 'descripcion' | 'notas'>;

export async function guardarObra(id: string | null, datos: DatosObra): Promise<string> {
  if (id) {
    exigir(await sb().from('obras').update(datos).eq('id', id).select('id').single());
    return id;
  }
  return (exigir(await sb().from('obras').insert(datos).select('id').single()) as { id: string }).id;
}

export async function guardarDocumentosObra(id: string, documentos: Documento[]): Promise<void> {
  exigir(await sb().from('obras').update({ documentos }).eq('id', id).select('id').single());
}

export async function borrarObra(id: string): Promise<void> {
  exigir(await sb().from('obras').delete().eq('id', id).select('id').single());
}

export interface ResultadoPlanillaObras {
  nuevas: number;
  actualizadas: number;
  omitidas: number;
}

export async function importarPlanillaObras(filas: FilaObra[]): Promise<ResultadoPlanillaObras> {
  return exigir(await sb().rpc('importar_planilla_obras', { p_filas: filas })) as ResultadoPlanillaObras;
}

export interface OTDeObra {
  id: string;
  codigo: string;
  titulo: string;
  estado: string;
  fecha_programada: string | null;
  asignado_nombre: string | null;
}

export async function ordenesDeObra(obraId: string): Promise<OTDeObra[]> {
  return exigir(await sb().from('v_ordenes').select('id, codigo, titulo, estado, fecha_programada, asignado_nombre').eq('obra_id', obraId).order('created_at', { ascending: false }).limit(200)) as OTDeObra[];
}

// ------------------------------------------------------------------ cobro de obras por ciclo

export type EstadoCobro = 'listo_certificar' | 'faltan_actas' | 'pendiente' | 'observado' | 'falta_aprobar_mein';
export const ESTADOS_COBRO: Record<EstadoCobro, string> = {
  listo_certificar: 'Listo para certificar', faltan_actas: 'Faltan actas', pendiente: 'Pendiente',
  observado: 'Observado', falta_aprobar_mein: 'Falta aprobar MEIN',
};
export const TONO_COBRO: Record<EstadoCobro, 'exito' | 'alerta' | 'neutro' | 'peligro' | 'info'> = {
  listo_certificar: 'exito', faltan_actas: 'alerta', pendiente: 'neutro', observado: 'peligro', falta_aprobar_mein: 'info',
};
export const PRIORIDADES_COBRO: Record<string, string> = { normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
export const COLORES_AVANCE: Record<string, string> = {
  auto: 'Según el avance', rojo: 'Rojo', amarillo: 'Amarillo', naranja: 'Naranja', verde: 'Verde', azul: 'Azul', gris: 'Gris',
};
export const TRAMOS: Record<string, string> = { primer_50: 'Primer 50 %', segundo_50: 'Segundo 50 %' };

export interface Ciclo {
  id: string;
  nombre: string;
  abierto: boolean;
  cerrado_at: string | null;
  created_at: string;
}

export interface Cobro {
  id: string;
  ciclo_id: string;
  ciclo_nombre: string;
  ciclo_abierto: boolean;
  obra_id: string;
  titulo: string;
  mtom: string | null;
  mein: string | null;
  establecimiento: string | null;
  direccion: string | null;
  zona: string | null;
  monto_base: number;
  jefe_sitio_nombre: string | null;
  inspector_nombre: string | null;
  plazo_dias: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  estado_cobro: EstadoCobro;
  prioridad: 'normal' | 'alta' | 'urgente';
  monto_a_cobrar: number;
  avance: number;
  tramo_manual: string | null;
  color_avance: string;
  tramo: string | null;
  color: string;
  motivo_observacion: string | null;
  periodo: string | null;
  notas: string | null;
  updated_at: string;
}

export interface HistorialCobro {
  id: string;
  descripcion: string;
  usuario_nombre: string | null;
  created_at: string;
}

export async function listarCiclos(): Promise<Ciclo[]> {
  return exigir(await sb().from('ciclos_cobro').select('*').order('created_at', { ascending: false }).limit(200)) as Ciclo[];
}

export async function listarCobros(cicloId: string): Promise<Cobro[]> {
  return exigir(await sb().from('v_obra_cobros').select('*').eq('ciclo_id', cicloId).order('zona').order('titulo').limit(3000)) as Cobro[];
}

export async function cobrosDeObra(obraId: string): Promise<Cobro[]> {
  return exigir(await sb().from('v_obra_cobros').select('*').eq('obra_id', obraId).order('created_at', { ascending: false }).limit(60)) as Cobro[];
}

export async function historialCobro(cobroId: string): Promise<HistorialCobro[]> {
  return exigir(await sb().from('obra_cobro_historial').select('id, descripcion, usuario_nombre, created_at').eq('cobro_id', cobroId).order('created_at', { ascending: false }).limit(200)) as HistorialCobro[];
}

export type DatosCobro = Pick<Cobro, 'estado_cobro' | 'prioridad' | 'monto_a_cobrar' | 'avance' | 'tramo_manual' | 'color_avance' | 'motivo_observacion' | 'periodo' | 'notas'>;

export async function guardarCobro(id: string, datos: Partial<DatosCobro>): Promise<void> {
  exigir(await sb().from('obra_cobros').update(datos).eq('id', id).select('id').single());
}

export async function sacarDelCiclo(id: string): Promise<void> {
  exigir(await sb().from('obra_cobros').delete().eq('id', id).select('id').single());
}

export async function sumarObraAlCiclo(obraId: string): Promise<string> {
  return exigir(await sb().rpc('sumar_obra_al_ciclo', { p_obra: obraId })) as string;
}

export async function abrirCiclo(): Promise<string> {
  return exigir(await sb().rpc('ciclo_cobro_abierto')) as string;
}

export async function cerrarCiclo(nuevo: string): Promise<string> {
  return exigir(await sb().rpc('cerrar_ciclo_cobro', { p_nuevo: nuevo })) as string;
}

export interface ResultadoCobros {
  obras_nuevas: number;
  nuevas: number;
  actualizadas: number;
  omitidas: number;
}

export async function importarCobros(filas: FilaCobro[]): Promise<ResultadoCobros> {
  return exigir(await sb().rpc('importar_cobros', { p_filas: filas })) as ResultadoCobros;
}

// ------------------------------------------------------------------ presupuestos

export type EstadoPresupuesto = 'borrador' | 'enviado' | 'aprobado' | 'rechazado';
export const ESTADOS_PRESUPUESTO: Record<EstadoPresupuesto, string> = {
  borrador: 'Borrador', enviado: 'Enviado', aprobado: 'Aprobado', rechazado: 'Rechazado',
};

export interface Presupuesto {
  id: string;
  nombre: string;
  obra_id: string | null;
  obra_titulo: string | null;
  obra_texto: string | null;
  descripcion: string | null;
  estado: EstadoPresupuesto;
  archivo_path: string;
  archivo_nombre: string;
  archivo_tamano: number | null;
  creado_por_nombre: string | null;
  created_at: string;
}

export async function listarPresupuestos(): Promise<Presupuesto[]> {
  return exigir(await sb().from('v_presupuestos').select('*').order('created_at', { ascending: false }).limit(1000)) as Presupuesto[];
}

export async function crearPresupuesto(datos: { nombre: string; obra_id: string | null; obra_texto: string | null; descripcion: string | null; archivo: Documento }): Promise<void> {
  const { archivo, ...resto } = datos;
  try {
    exigir(await sb().from('presupuestos').insert({ ...resto, archivo_path: archivo.path, archivo_nombre: archivo.nombre, archivo_tamano: archivo.tamano }).select('id').single());
  } catch (e) {
    // Si la base no lo acepta, el archivo no queda suelto en el bucket.
    await borrarArchivo(archivo.path);
    throw e;
  }
}

export async function cambiarEstadoPresupuesto(id: string, estado: EstadoPresupuesto): Promise<void> {
  exigir(await sb().from('presupuestos').update({ estado }).eq('id', id).select('id').single());
}

export async function borrarPresupuesto(p: Presupuesto): Promise<void> {
  exigir(await sb().from('presupuestos').delete().eq('id', p.id).select('id').single());
  await borrarArchivo(p.archivo_path);
}

// ------------------------------------------------------------------ solicitudes de certificado

export type EstadoSolicitud = 'borrador' | 'enviada' | 'en_revision' | 'aprobada' | 'rechazada';
export const ESTADOS_SOLICITUD: Record<EstadoSolicitud, string> = {
  borrador: 'Borrador', enviada: 'Enviada', en_revision: 'En revisión', aprobada: 'Aprobada', rechazada: 'Rechazada',
};

export interface PasoSolicitud {
  fecha: string;
  estado: EstadoSolicitud;
  usuario: string | null;
  comentario: string | null;
}

export interface Solicitud {
  id: string;
  codigo: string;
  titulo: string;
  obra_id: string | null;
  obra_titulo: string | null;
  contrato_id: string | null;
  contrato_contratista: string | null;
  certificado_id: string | null;
  certificado_numero: number | null;
  certificado_estado: string | null;
  establecimiento: string | null;
  descripcion: string | null;
  monto_solicitado: number;
  avance: number;
  periodo: string | null;
  prioridad: 'normal' | 'alta' | 'urgente';
  adjuntos: Documento[];
  estado: EstadoSolicitud;
  solicitante_id: string | null;
  solicitante_nombre: string | null;
  revisor_nombre: string | null;
  comentarios: string | null;
  motivo_rechazo: string | null;
  resuelto_at: string | null;
  historial: PasoSolicitud[];
  created_at: string;
}

export async function listarSolicitudes(): Promise<Solicitud[]> {
  return exigir(await sb().from('v_solicitudes_certificado').select('*').order('created_at', { ascending: false }).limit(1000)) as Solicitud[];
}

export type DatosSolicitud = Pick<Solicitud, 'titulo' | 'obra_id' | 'contrato_id' | 'establecimiento' | 'descripcion' | 'monto_solicitado' | 'avance' | 'periodo' | 'prioridad' | 'adjuntos'>;

export async function guardarSolicitud(id: string | null, datos: DatosSolicitud, enviar: boolean): Promise<void> {
  if (id) {
    exigir(await sb().from('solicitudes_certificado').update(datos).eq('id', id).select('id').single());
    if (enviar) await cambiarEstadoSolicitud(id, 'enviada');
  } else {
    exigir(await sb().from('solicitudes_certificado').insert({ ...datos, estado: enviar ? 'enviada' : 'borrador' }).select('id').single());
  }
}

export async function cambiarEstadoSolicitud(id: string, estado: EstadoSolicitud, extra: { motivo_rechazo?: string; comentarios?: string } = {}): Promise<void> {
  exigir(await sb().from('solicitudes_certificado').update({ estado, ...extra }).eq('id', id).select('id').single());
}

export async function comentarSolicitud(id: string, comentarios: string, certificadoId?: string | null): Promise<void> {
  exigir(await sb().from('solicitudes_certificado').update({ comentarios, ...(certificadoId !== undefined ? { certificado_id: certificadoId } : {}) }).eq('id', id).select('id').single());
}

export async function borrarSolicitud(id: string): Promise<void> {
  exigir(await sb().from('solicitudes_certificado').delete().eq('id', id).select('id').single());
}

// ------------------------------------------------------------------ abonos del mes

export interface ResultadoAbono {
  contrato: string;
  resultado: 'emitido' | 'ya_certificado' | 'con_borrador' | 'sin_fechas' | 'fuera_de_plazo' | 'error';
  detalle: string;
  numero?: number;
  certificado_id?: string;
}

export async function certificarAbonosDelMes(mes: string): Promise<{ periodo: string; contratos: ResultadoAbono[] }> {
  return exigir(await sb().rpc('certificar_abonos_del_mes', { p_mes: mes })) as { periodo: string; contratos: ResultadoAbono[] };
}

// ------------------------------------------------------------------ formato

export const fmtPct = (n: number | string | null) => `${Number(n ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
export const fmtTamano = (b: number | null) => (b === null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`);
