// Tipos de las tablas y vistas de DH1 v2. Reflejan el SQL de las fases 1 a 4.

export type Rol = 'admin' | 'gerente_general' | 'gerente' | 'jefe_sitio' | 'inspector' | 'operario';
export type EstadoOT = 'pendiente' | 'asignada' | 'en_progreso' | 'pendiente_validacion' | 'completada' | 'cancelada' | 'obra';
export type TipoOT =
  | 'mantenimiento_preventivo' | 'mantenimiento_correctivo' | 'instalacion' | 'inspeccion' | 'reparacion' | 'emergencia';
export type Prioridad = 'baja' | 'media' | 'alta' | 'urgente';
export type EstadoActivo = 'operativo' | 'en_mantenimiento' | 'fuera_de_servicio' | 'baja';
export type Criticidad = 'baja' | 'media' | 'alta' | 'critica';
export type TipoActivo =
  | 'equipo_electrico' | 'equipo_mecanico' | 'instalacion_hvac' | 'instalacion_sanitaria' | 'estructura'
  | 'vehiculo' | 'herramienta' | 'sistemas_informaticos' | 'mobiliario' | 'seguridad' | 'otro';
export type EstadoCertificado = 'borrador' | 'emitido' | 'aprobado';

export interface Sector {
  id: string;
  clave: string;
  nombre: string;
  activo: boolean;
  orden: number;
  // zonas: las comunas o regiones del sector. unidad: cómo se llama lo que se mantiene (Escuela, Activo).
  config: {
    zonas?: string[];
    unidad?: { singular: string; plural: string };
    directorio?: 'activos';
    fichaje_radio_m?: number;
    geocodificacion?: { sufijo?: string; viewbox?: string };
  } | null;
}

export interface Perfil {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  sector_id: string;
  sector_activo_id: string | null;
  ver_todos: boolean;
  activo: boolean;
  telefono: string | null;
}

export interface Ubicacion {
  id: string;
  sector_id: string;
  nombre: string;
  codigo: string | null;
  direccion: string | null;
  zona: string | null;
  descripcion: string | null;
  activa: boolean;
  qr_token: string;
}

export interface Activo {
  id: string;
  sector_id: string;
  nombre: string;
  codigo: string | null;
  tipo: TipoActivo;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  ubicacion_id: string | null;
  padre_id: string | null;
  area: string | null;
  estado: EstadoActivo;
  criticidad: Criticidad;
  ultimo_mantenimiento: string | null;
  proximo_mantenimiento: string | null;
  frecuencia_mant_dias: number | null;
  notas: string | null;
  qr_token: string;
  // v_expediente_activo
  ubicacion_nombre: string | null;
  padre_nombre: string | null;
  responsable_nombre: string | null;
  componentes: number;
  ots_total: number;
  ots_abiertas: number;
  mantenimiento_vencido: boolean;
}

export interface HistorialActivo {
  id: string;
  tipo: 'alta' | 'ot_completada' | 'cambio_estado' | 'movimiento';
  detalle: string;
  ot_id: string | null;
  created_at: string;
}

export interface TareaChecklist {
  id: string;
  tarea: string;
  hecho: boolean;
  nota?: string;
}

export interface MotivoIncompleto {
  id: string;
  texto: string;
}

// Fila de v_ordenes
export interface OT {
  id: string;
  sector_id: string;
  numero: number;
  codigo: string;
  titulo: string;
  descripcion: string | null;
  tipo: TipoOT;
  prioridad: Prioridad;
  estado: EstadoOT;
  ubicacion_id: string | null;
  activo_id: string | null;
  asignado_a: string | null;
  fecha_programada: string | null;
  horas_estimadas: number | null;
  checklist: TareaChecklist[];
  requiere_fotos: boolean;
  motivos_incompleto: MotivoIncompleto[];
  notas: string | null;
  rechazo_comentario: string | null;
  fecha_inicio_real: string | null;
  fecha_fin_real: string | null;
  fecha_validacion: string | null;
  origen: 'manual' | 'preventivo' | 'migracion';
  created_at: string;
  ubicacion_nombre: string | null;
  ubicacion_direccion: string | null;
  activo_nombre: string | null;
  activo_codigo: string | null;
  ubicacion_qr_token: string | null;
  activo_qr_token: string | null;
  asignado_nombre: string | null;
  validado_nombre: string | null;
  tareas_total: number;
  tareas_hechas: number;
  fotos_total: number;
  vencida: boolean;
  // Del lugar de la orden: su jefe de sitio (para la tablet de cuadrilla) y su posición (para el mapa).
  jefe_sitio_id: string | null;
  jefe_sitio_nombre: string | null;
  ubicacion_lat: number | null;
  ubicacion_lng: number | null;
  horas_cargadas: number;
  // Firma de conformidad (fase 15)
  firma_url?: string | null;
  firma_nombre?: string | null;
  firma_at?: string | null;
}

export interface FotoOT {
  id: string;
  ot_id: string;
  path: string;
  url: string;
  created_at: string;
  // Foto sacada sin señal: está en el teléfono, en la cola, esperando para subir.
  enEspera?: boolean;
  opId?: number;
}

export interface Plantilla {
  id: string;
  nombre: string;
  titulo: string;
  tipo: TipoOT;
  prioridad: Prioridad;
  descripcion: string | null;
  horas_estimadas: number | null;
  checklist: TareaChecklist[];
  requiere_fotos: boolean;
}

export interface ResultadoBusqueda {
  id: string;
  etiqueta: string;
  detalle: string | null;
}

// Fila de v_contratos
export interface Contrato {
  id: string;
  sector_id: string;
  tipo: 'abono_mensual' | 'obra';
  contratista: string;
  contratista_cuit: string | null;
  obra_servicio: string;
  emprendimiento: string | null;
  ada_numero: string | null;
  oc_numero: string | null;
  // El PDF del ADA en el bucket "documentos" (o el enlace de la v1, si vino migrado).
  ada_pdf_url: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  plazo: string | null;
  condiciones_pago: string | null;
  anticipo_pct: number;
  fondo_reparo_pct: number;
  fondo_reparo_label: string;
  fondo_reparo_aplicar: boolean;
  monto_contratado: number;
  estado: 'activo' | 'cerrado';
  notas: string | null;
  ubicacion_nombre: string | null;
  certificado_importe: number;
  saldo_importe: number;
  porcentaje_certificado: number;
  certificados_total: number;
  ultimo_numero: number | null;
  por_aprobar: number;
  borrador_id: string | null;
}

export interface ItemContrato {
  id: string;
  contrato_id: string;
  numero: number;
  descripcion: string;
  um: string;
  cantidad: number;
  importe_unitario: number;
  importe_total: number;
}

// Fila de v_certificados
export interface Certificado {
  id: string;
  contrato_id: string;
  numero: number | null;
  estado: EstadoCertificado;
  periodo: string;
  fecha_certificado: string;
  numero_recepcion: string | null;
  notas: string | null;
  anticipo_pct: number;
  fondo_reparo_pct: number;
  fondo_reparo_aplicar: boolean;
  subtotal_presente: number;
  anticipo_monto: number;
  fondo_reparo_monto: number;
  total_neto: number;
  acum_anterior_importe: number;
  acum_presente_importe: number;
  porcentaje_avance: number;
  emitido_por: string | null;
  emitido_at: string | null;
  aprobado_at: string | null;
  rechazo_motivo: string | null;
  historico: boolean;
  tipo: 'abono_mensual' | 'obra';
  contratista: string;
  obra_servicio: string;
  ada_numero: string | null;
  oc_numero: string | null;
  monto_contratado: number;
  fondo_reparo_label: string;
  emitido_nombre: string | null;
  aprobado_nombre: string | null;
  // firma de quien aprobó (PNG en data URL)
  firma_url: string | null;
}

export interface LineaCertificado {
  id: string;
  certificado_id: string;
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

// ------------------------------------------------------------------ textos visibles

export const ROLES: Record<Rol, string> = {
  admin: 'Administrador',
  gerente_general: 'Gerente general',
  gerente: 'Gerente',
  jefe_sitio: 'Jefe de sitio',
  inspector: 'Inspector',
  operario: 'Operario',
};

export const TIPOS_OT: Record<TipoOT, string> = {
  mantenimiento_preventivo: 'Preventivo',
  mantenimiento_correctivo: 'Correctivo',
  instalacion: 'Instalación',
  inspeccion: 'Inspección',
  reparacion: 'Reparación',
  emergencia: 'Emergencia',
};

export const PRIORIDADES: Record<Prioridad, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
};

export const TIPOS_ACTIVO: Record<TipoActivo, string> = {
  equipo_electrico: 'Equipo eléctrico',
  equipo_mecanico: 'Equipo mecánico',
  instalacion_hvac: 'Climatización',
  instalacion_sanitaria: 'Instalación sanitaria',
  estructura: 'Estructura',
  vehiculo: 'Vehículo',
  herramienta: 'Herramienta',
  sistemas_informaticos: 'Sistemas',
  mobiliario: 'Mobiliario',
  seguridad: 'Seguridad',
  otro: 'Otro',
};

export const CRITICIDADES: Record<Criticidad, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  critica: 'Crítica',
};

export const ROLES_GERENCIA: Rol[] = ['admin', 'gerente_general', 'gerente'];
export const ROLES_VALIDAN: Rol[] = ['admin', 'gerente_general', 'gerente', 'jefe_sitio'];
// Quién entra al panel de gestión. El operario trabaja solo desde "Mis órdenes".
export const ROLES_GESTION: Rol[] = ['admin', 'gerente_general', 'gerente', 'jefe_sitio', 'inspector'];
