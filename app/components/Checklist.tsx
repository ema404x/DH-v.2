'use client';

import { Check, Square } from 'lucide-react';
import type { TareaChecklist } from '@/lib/types';

interface Props {
  tareas: TareaChecklist[];
  editable: boolean;
  onCambio: (tareas: TareaChecklist[]) => void;
}

// Checklist de la orden. Cada tarea es un control de 48 px: se marca con el pulgar.
export function Checklist({ tareas, editable, onCambio }: Props) {
  if (tareas.length === 0) {
    return <p className="text-suave">Esta orden no tiene lista de tareas.</p>;
  }
  const hechas = tareas.filter((t) => t.hecho).length;

  const alternar = (id: string) => onCambio(tareas.map((t) => (t.id === id ? { ...t, hecho: !t.hecho } : t)));

  return (
    <div className="space-y-2">
      <p className="text-sm text-suave">
        {hechas} de {tareas.length} tareas hechas
      </p>
      <ul className="space-y-2">
        {tareas.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={t.hecho}
              disabled={!editable}
              onClick={() => alternar(t.id)}
              className={`flex min-h-campo w-full items-center gap-3 rounded border px-3 py-2 text-left transition-colors disabled:cursor-default ${
                t.hecho ? 'border-exito/50 bg-exito/10' : 'bg-elevado'
              }`}
            >
              {t.hecho ? (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-exito text-fondo">
                  <Check className="h-5 w-5" aria-hidden />
                </span>
              ) : (
                <Square className="h-7 w-7 shrink-0 text-suave" aria-hidden />
              )}
              <span className={t.hecho ? 'text-suave line-through' : ''}>{t.tarea}</span>
              <span className="sr-only">{t.hecho ? '(hecha)' : '(pendiente)'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
