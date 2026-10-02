'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { buscar, type TablaBuscable } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';
import type { ResultadoBusqueda } from '@/lib/types';

interface Props {
  etiqueta: string;
  tabla: TablaBuscable;
  valor: ResultadoBusqueda | null;
  onCambio: (valor: ResultadoBusqueda | null) => void;
  ayuda?: string;
}

// Combo con búsqueda en el servidor: trae 10 resultados por vez con buscar(tabla, q).
// Nunca descarga la tabla entera para elegir un registro.
export function BuscadorRemoto({ etiqueta, tabla, valor, onCambio, ayuda }: Props) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([]);
  const [estado, setEstado] = useState<'quieto' | 'buscando' | 'error'>('quieto');
  const [error, setError] = useState('');
  const turno = useRef(0);

  useEffect(() => {
    if (!abierto) return;
    const mio = ++turno.current;
    setEstado('buscando');
    const espera = setTimeout(async () => {
      try {
        const r = await buscar(tabla, texto);
        if (mio !== turno.current) return;
        setResultados(r);
        setEstado('quieto');
      } catch (e) {
        if (mio !== turno.current) return;
        setError(limpiarError(e));
        setEstado('error');
      }
    }, 250);
    return () => clearTimeout(espera);
  }, [texto, abierto, tabla]);

  if (valor) {
    return (
      <div>
        <span className="etiqueta">{etiqueta}</span>
        <div className="flex min-h-control items-center justify-between gap-2 rounded border bg-elevado pl-3">
          <span className="min-w-0 truncate">
            {valor.etiqueta}
            {valor.detalle && <span className="text-suave"> · {valor.detalle}</span>}
          </span>
          <button
            type="button"
            onClick={() => onCambio(null)}
            aria-label={`Quitar ${etiqueta.toLowerCase()}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-suave hover:text-texto"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="etiqueta">
        {etiqueta}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-suave" aria-hidden />
        <input
          id={id}
          className="control pl-10"
          placeholder="Escribí para buscar"
          autoComplete="off"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
        />
      </div>
      {/* Con la lista abierta la ayuda se oculta: la lista queda pegada al campo. */}
      {ayuda && !abierto && <p className="mt-1 text-xs text-suave">{ayuda}</p>}

      {abierto && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded border bg-superficie shadow-lg">
          {estado === 'buscando' && (
            <p className="flex items-center gap-2 p-3 text-sm text-suave">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Buscando
            </p>
          )}
          {estado === 'error' && <p className="p-3 text-sm text-peligro">{error}</p>}
          {estado === 'quieto' && resultados.length === 0 && (
            <p className="p-3 text-sm text-suave">{texto ? 'No hay resultados con ese texto.' : 'No hay nada cargado todavía.'}</p>
          )}
          {estado === 'quieto' && resultados.length > 0 && (
            <ul>
              {resultados.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex min-h-control w-full flex-col justify-center px-3 py-2 text-left hover:bg-elevado"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onCambio(r);
                      setTexto('');
                      setAbierto(false);
                    }}
                  >
                    <span>{r.etiqueta}</span>
                    {r.detalle && <span className="text-xs text-suave">{r.detalle}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
