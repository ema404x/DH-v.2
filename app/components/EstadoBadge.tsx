import {
  AlertTriangle, Ban, CheckCircle2, CircleDashed, ClipboardCheck, FileCheck2, FilePen, Flame, PlayCircle,
  Power, Send, UserCheck, Wrench, XCircle, type LucideIcon,
} from 'lucide-react';
import type { EstadoActivo, EstadoCertificado, EstadoOT, Prioridad } from '@/lib/types';

// Todo estado se muestra con icono + texto. El color acompaña, nunca es el único aviso.
type Tono = 'neutro' | 'info' | 'exito' | 'alerta' | 'peligro';

const TONOS: Record<Tono, string> = {
  neutro: 'border-borde bg-elevado text-suave',
  info: 'border-info/40 bg-info/10 text-info',
  exito: 'border-exito/40 bg-exito/10 text-exito',
  alerta: 'border-alerta/40 bg-alerta/10 text-alerta',
  peligro: 'border-peligro/40 bg-peligro/10 text-peligro',
};

interface Definicion {
  texto: string;
  tono: Tono;
  icono: LucideIcon;
}

const OT: Record<EstadoOT, Definicion> = {
  pendiente: { texto: 'Pendiente', tono: 'neutro', icono: CircleDashed },
  asignada: { texto: 'Asignada', tono: 'info', icono: UserCheck },
  en_progreso: { texto: 'En curso', tono: 'alerta', icono: PlayCircle },
  pendiente_validacion: { texto: 'A validar', tono: 'info', icono: ClipboardCheck },
  completada: { texto: 'Completada', tono: 'exito', icono: CheckCircle2 },
  cancelada: { texto: 'Cancelada', tono: 'peligro', icono: Ban },
};

const PRIORIDAD: Record<Prioridad, Definicion> = {
  baja: { texto: 'Prioridad baja', tono: 'neutro', icono: CircleDashed },
  media: { texto: 'Prioridad media', tono: 'neutro', icono: CircleDashed },
  alta: { texto: 'Prioridad alta', tono: 'alerta', icono: AlertTriangle },
  urgente: { texto: 'Urgente', tono: 'peligro', icono: Flame },
};

const ACTIVO: Record<EstadoActivo, Definicion> = {
  operativo: { texto: 'Operativo', tono: 'exito', icono: Power },
  en_mantenimiento: { texto: 'En mantenimiento', tono: 'alerta', icono: Wrench },
  fuera_de_servicio: { texto: 'Fuera de servicio', tono: 'peligro', icono: XCircle },
  baja: { texto: 'Dado de baja', tono: 'neutro', icono: Ban },
};

const CERTIFICADO: Record<EstadoCertificado, Definicion> = {
  borrador: { texto: 'Borrador', tono: 'neutro', icono: FilePen },
  emitido: { texto: 'Emitido, falta aprobar', tono: 'alerta', icono: Send },
  aprobado: { texto: 'Aprobado', tono: 'exito', icono: FileCheck2 },
};

function Badge({ texto, tono, icono: Icono }: Definicion) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${TONOS[tono]}`}>
      <Icono className="h-4 w-4" aria-hidden />
      {texto}
    </span>
  );
}

export const EstadoOTBadge = ({ estado }: { estado: EstadoOT }) => <Badge {...OT[estado]} />;
export const PrioridadBadge = ({ prioridad }: { prioridad: Prioridad }) => <Badge {...PRIORIDAD[prioridad]} />;
export const EstadoActivoBadge = ({ estado }: { estado: EstadoActivo }) => <Badge {...ACTIVO[estado]} />;
export const EstadoCertificadoBadge = ({ estado }: { estado: EstadoCertificado }) => <Badge {...CERTIFICADO[estado]} />;

export function AvisoBadge({ texto, tono = 'alerta' }: { texto: string; tono?: Tono }) {
  return <Badge texto={texto} tono={tono} icono={AlertTriangle} />;
}

export const TEXTO_ESTADO_OT: Record<EstadoOT, string> = Object.fromEntries(
  Object.entries(OT).map(([k, v]) => [k, v.texto]),
) as Record<EstadoOT, string>;
