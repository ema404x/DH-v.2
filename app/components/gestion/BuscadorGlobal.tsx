'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';
import { buscarTodo, type Hallazgo } from '@/lib/admin';
import { limpiarError } from '@/lib/errores';

const TIPOS: Record<string, string> = {
  orden: 'Orden', pendiente: 'Pendiente SAP', lugar: 'Lugar', activo: 'Activo', obra: 'Obra', empleado: 'Empleado', contrato: 'Contrato',
  material: 'Material', proveedor: 'Proveedor', emergencia: 'Emergencia', informe: 'Informe', requerimiento: 'Requerimiento',
};
// En estos tipos el detalle es el estado tal como lo guarda la base ("en_preparacion"): se muestra legible.
const DETALLE_ES_ESTADO = new Set(['emergencia', 'informe', 'requerimiento']);
const detalle = (h: Hallazgo) => {
  if (!h.detalle || !DETALLE_ES_ESTADO.has(h.tipo)) return h.detalle;
  const t = h.detalle.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Búsqueda en todo el sector (Ctrl+K o el botón del menú). Cada resultado lleva al registro o a su sección.
export function BuscadorGlobal() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Hallazgo[]>([]);
  const [estado, setEstado] = useState<'quieto' | 'buscando' | 'error'>('quieto');
  const [error, setError] = useState('');
  const [activo, setActivo] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const turno = useRef(0);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setAbierto(true); }
      if (e.key === 'Escape') setAbierto(false);
    };
    const abrir = () => setAbierto(true);
    window.addEventListener('keydown', tecla);
    window.addEventListener('dh1:buscar', abrir);
    return () => { window.removeEventListener('keydown', tecla); window.removeEventListener('dh1:buscar', abrir); };
  }, []);

  useEffect(() => { if (abierto) setTimeout(() => entrada.current?.focus(), 0); else { setQ(''); setRes([]); } }, [abierto]);

  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); setEstado('quieto'); return; }
    const mio = ++turno.current;
    setEstado('buscando');
    const t = setTimeout(async () => {
      try {
        const r = await buscarTodo(q);
        if (mio === turno.current) { setRes(r); setActivo(0); setEstado('quieto'); }
      } catch (e) {
        if (mio === turno.current) { setError(limpiarError(e)); setEstado('error'); }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function ir(h: Hallazgo) {
    setAbierto(false);
    router.push(h.enlace);
  }

  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-fondo/70 p-4 pt-[10vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Buscar en todo"
      onClick={() => setAbierto(false)}>
      <div className="w-full max-w-xl overflow-hidden rounded-lg border bg-superficie shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-5 w-5 text-suave" aria-hidden />
          <input ref={entrada} className="min-h-campo flex-1 bg-transparent text-base outline-none" placeholder="Buscar órdenes, obras, lugares, personas, materiales…"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(a + 1, res.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
              if (e.key === 'Enter' && res[activo]) ir(res[activo]);
            }} />
          {estado === 'buscando' && <Loader2 className="h-5 w-5 animate-spin text-suave" aria-hidden />}
          <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar" className="flex min-h-control min-w-control items-center justify-center rounded text-suave hover:bg-elevado"><X className="h-5 w-5" aria-hidden /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {estado === 'error' && <p className="p-4 text-peligro">{error}</p>}
          {q.trim().length < 2 ? <p className="p-4 text-sm text-suave">Escribí al menos dos letras. Atajo: Ctrl+K.</p>
            : res.length === 0 && estado === 'quieto' ? <p className="p-4 text-sm text-suave">Sin resultados.</p> : (
              <ul role="listbox">
                {res.map((h, i) => (
                  <li key={`${h.tipo}-${h.id}`} role="option" aria-selected={i === activo}>
                    <button type="button" onClick={() => ir(h)} onMouseEnter={() => setActivo(i)}
                      className={`flex w-full items-start gap-3 px-4 py-2 text-left ${i === activo ? 'bg-elevado' : ''}`}>
                      <span className="mt-0.5 w-24 shrink-0 text-xs text-suave">{TIPOS[h.tipo] ?? h.tipo}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{h.titulo}</span>
                        {h.detalle && <span className="block truncate text-sm text-suave">{detalle(h)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </div>
  );
}
