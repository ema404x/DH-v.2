import Link from 'next/link';
import { CalendarClock, ChevronRight, ListChecks, MapPin, User, Wrench } from 'lucide-react';
import { EstadoOTBadge, PrioridadBadge, AvisoBadge } from './EstadoBadge';
import { TIPOS_OT, type OT } from '@/lib/types';

export const fmtFecha = (f: string | null) =>
  f ? new Date(f.length === 10 ? `${f}T12:00:00` : f).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) : null;

interface Props {
  ot: OT & { sinEnviar?: number; rechazadas?: number };
  miId?: string;
  // En el portal del operario la orden se abre sin cambiar de página (funciona sin señal).
  onAbrir?: (id: string) => void;
}

const CLASES = 'tarjeta flex min-h-campo w-full items-center gap-3 text-left transition-colors hover:border-primario/60';

// Tarjeta de una orden en el portal del operario. Toda la tarjeta es el botón.
export function OTCard({ ot, miId, onAbrir }: Props) {
  const destacaPrioridad = ot.prioridad === 'alta' || ot.prioridad === 'urgente';
  const contenido = (
    <>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <EstadoOTBadge estado={ot.estado} />
          {destacaPrioridad && <PrioridadBadge prioridad={ot.prioridad} />}
          {ot.vencida && <AvisoBadge texto="Vencida" tono="peligro" />}
          {!!ot.rechazadas && <AvisoBadge texto="No se pudo enviar" tono="peligro" />}
          {!!ot.sinEnviar && <AvisoBadge texto="Falta enviar" tono="alerta" />}
        </div>
        <p className="font-semibold">{ot.titulo}</p>
        <ul className="space-y-1 text-sm text-suave">
          {ot.ubicacion_nombre && (
            <li className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{ot.ubicacion_nombre}</span>
            </li>
          )}
          {ot.activo_nombre && (
            <li className="flex items-center gap-2">
              <Wrench className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{ot.activo_nombre}</span>
            </li>
          )}
          <li className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{ot.codigo} · {TIPOS_OT[ot.tipo]}</span>
            {ot.fecha_programada && (
              <span className="flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4" aria-hidden />
                {fmtFecha(ot.fecha_programada)}
              </span>
            )}
            {ot.tareas_total > 0 && (
              <span className="flex items-center gap-1.5">
                <ListChecks className="h-4 w-4" aria-hidden />
                {ot.tareas_hechas}/{ot.tareas_total}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <User className="h-4 w-4" aria-hidden />
              {ot.asignado_a ? (ot.asignado_a === miId ? 'Asignada a vos' : ot.asignado_nombre ?? 'Asignada') : 'Libre'}
            </span>
          </li>
        </ul>
      </div>
      <ChevronRight className="h-6 w-6 shrink-0 text-suave" aria-hidden />
    </>
  );

  if (onAbrir) {
    return (
      <button type="button" className={CLASES} onClick={() => onAbrir(ot.id)}>
        {contenido}
      </button>
    );
  }
  return (
    <Link href={`/ot/${ot.id}`} className={CLASES}>
      {contenido}
    </Link>
  );
}
