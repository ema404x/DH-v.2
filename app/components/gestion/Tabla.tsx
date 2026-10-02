'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Boton } from '../Boton';
import { POR_PAGINA } from '@/lib/gestion';

export interface Columna<T> {
  titulo: string;
  celda: (fila: T) => ReactNode;
  numerica?: boolean;
  // se oculta en pantallas angostas
  secundaria?: boolean;
}

interface Props<T> {
  columnas: Columna<T>[];
  filas: T[];
  clave: (fila: T) => string;
  total?: number;
  pagina?: number;
  onPagina?: (pagina: number) => void;
}

// Tabla de gestión. En el teléfono se esconden las columnas secundarias en vez de achicar la letra.
export function Tabla<T>({ columnas, filas, clave, total, pagina = 0, onPagina }: Props<T>) {
  const paginas = total !== undefined ? Math.max(1, Math.ceil(total / POR_PAGINA)) : 1;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border bg-superficie">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-suave">
              {columnas.map((c) => (
                <th key={c.titulo} scope="col" className={`px-3 py-3 font-medium ${c.numerica ? 'num' : ''} ${c.secundaria ? 'hidden md:table-cell' : ''}`}>
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={clave(f)} className="border-b last:border-b-0 hover:bg-elevado/60">
                {columnas.map((c) => (
                  <td key={c.titulo} className={`px-3 py-3 align-middle ${c.numerica ? 'num' : ''} ${c.secundaria ? 'hidden md:table-cell' : ''}`}>
                    {c.celda(f)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total !== undefined && onPagina && paginas > 1 && (
        <div className="flex items-center justify-between gap-3">
          <Boton variante="fantasma" icono={ChevronLeft} disabled={pagina === 0} onClick={() => onPagina(pagina - 1)}>
            Anterior
          </Boton>
          <p className="text-sm text-suave">
            Página {pagina + 1} de {paginas} · {total} en total
          </p>
          <Boton variante="fantasma" icono={ChevronRight} disabled={pagina + 1 >= paginas} onClick={() => onPagina(pagina + 1)}>
            Siguiente
          </Boton>
        </div>
      )}
    </div>
  );
}
