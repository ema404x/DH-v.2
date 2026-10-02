'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface Base {
  etiqueta: string;
  ayuda?: string;
}

function Marco({ id, etiqueta, ayuda, children }: Base & { id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="etiqueta">
        {etiqueta}
      </label>
      {children}
      {ayuda && <p className="mt-1 text-xs text-suave">{ayuda}</p>}
    </div>
  );
}

export function Campo({ etiqueta, ayuda, className = '', ...resto }: Base & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Marco id={id} etiqueta={etiqueta} ayuda={ayuda}>
      <input id={id} className={`control ${className}`} {...resto} />
    </Marco>
  );
}

export function Area({ etiqueta, ayuda, className = '', ...resto }: Base & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Marco id={id} etiqueta={etiqueta} ayuda={ayuda}>
      <textarea id={id} rows={3} className={`control py-2 ${className}`} {...resto} />
    </Marco>
  );
}

interface PropsSelector extends Base, SelectHTMLAttributes<HTMLSelectElement> {
  opciones: Record<string, string>;
}

export function Selector({ etiqueta, ayuda, opciones, className = '', ...resto }: PropsSelector) {
  const id = useId();
  return (
    <Marco id={id} etiqueta={etiqueta} ayuda={ayuda}>
      <select id={id} className={`control ${className}`} {...resto}>
        {Object.entries(opciones).map(([valor, texto]) => (
          <option key={valor} value={valor}>
            {texto}
          </option>
        ))}
      </select>
    </Marco>
  );
}

export function Casilla({ etiqueta, ...resto }: { etiqueta: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex min-h-control cursor-pointer items-center gap-3">
      <input type="checkbox" className="h-6 w-6 shrink-0 accent-primario" {...resto} />
      <span>{etiqueta}</span>
    </label>
  );
}

// "" → null, para no guardar textos vacíos.
export const oNull = (v: string) => (v.trim() === '' ? null : v.trim());
