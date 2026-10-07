'use client';

import { useEffect, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';

// Diálogo modal simple (los de la v1 eran de shadcn): título con ícono, contenido con scroll y pie opcional.
export function Dialogo({ abierto, onCerrar, titulo, icono: Icono, ancho = 'max-w-xl', bloqueado = false, children, pie }: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: ReactNode;
  icono?: LucideIcon;
  ancho?: string;
  bloqueado?: boolean;
  children: ReactNode;
  pie?: ReactNode;
}) {
  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !bloqueado) onCerrar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [abierto, bloqueado, onCerrar]);

  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fondo/70 p-4 pt-[6vh] backdrop-blur-sm"
      role="dialog" aria-modal="true" onClick={() => { if (!bloqueado) onCerrar(); }}>
      <div className={`flex max-h-[90vh] w-full ${ancho} flex-col overflow-hidden rounded-lg border bg-superficie shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">{Icono && <Icono className="h-5 w-5 text-primario" aria-hidden />}{titulo}</h2>
          <button type="button" onClick={onCerrar} disabled={bloqueado} aria-label="Cerrar"
            className="flex min-h-control min-w-control items-center justify-center rounded text-suave hover:bg-elevado disabled:opacity-40">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pie && <footer className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{pie}</footer>}
      </div>
    </div>
  );
}
