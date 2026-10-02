'use client';

import type { ReactNode } from 'react';

// Gráficos livianos (barras con CSS): alcanzan para comparar cantidades y se imprimen bien, sin sumar librerías.

export interface Barra {
  etiqueta: string;
  valor: number;
  // parte destacada dentro de la barra (por ejemplo, las completadas dentro del total)
  parte?: number;
  detalle?: ReactNode;
}

export function BarrasHorizontales({ barras, formato = (n) => n.toLocaleString('es-AR'), vacio = 'Sin datos en el período.' }: {
  barras: Barra[];
  formato?: (n: number) => string;
  vacio?: string;
}) {
  const max = Math.max(1, ...barras.map((b) => b.valor));
  if (barras.length === 0) return <p className="text-suave">{vacio}</p>;
  return (
    <ul className="space-y-2">
      {barras.map((b) => (
        <li key={b.etiqueta} className="grid grid-cols-[minmax(6rem,12rem)_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate" title={b.etiqueta}>{b.etiqueta}</span>
          <span className="relative h-4 overflow-hidden rounded bg-elevado" aria-hidden>
            <span className="absolute inset-y-0 left-0 rounded bg-primario/35" style={{ width: `${(b.valor / max) * 100}%` }} />
            {b.parte !== undefined && <span className="absolute inset-y-0 left-0 rounded bg-primario" style={{ width: `${(b.parte / max) * 100}%` }} />}
          </span>
          <span className="num whitespace-nowrap">{b.detalle ?? formato(b.valor)}</span>
        </li>
      ))}
    </ul>
  );
}

// Columnas por período (mes): total en claro y la parte destacada adentro.
export function Columnas({ datos, leyenda }: { datos: { etiqueta: string; total: number; parte: number }[]; leyenda: [string, string] }) {
  const max = Math.max(1, ...datos.map((d) => d.total));
  return (
    <div className="space-y-2">
      <div className="flex h-40 items-end gap-2" role="img" aria-label={datos.map((d) => `${d.etiqueta}: ${d.total} (${d.parte} ${leyenda[1].toLowerCase()})`).join('; ')}>
        {datos.map((d) => (
          <div key={d.etiqueta} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="num text-xs text-suave">{d.total}</span>
            <div className="relative w-full max-w-12 overflow-hidden rounded-t bg-primario/35" style={{ height: `${(d.total / max) * 100}%`, minHeight: d.total ? 2 : 0 }}>
              <div className="absolute inset-x-0 bottom-0 bg-primario" style={{ height: d.total ? `${(d.parte / d.total) * 100}%` : 0 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {datos.map((d) => <span key={d.etiqueta} className="min-w-0 flex-1 truncate text-center text-xs text-suave">{d.etiqueta}</span>)}
      </div>
      <p className="flex flex-wrap gap-4 text-xs text-suave">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-primario/35" />{leyenda[0]}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-primario" />{leyenda[1]}</span>
      </p>
    </div>
  );
}
