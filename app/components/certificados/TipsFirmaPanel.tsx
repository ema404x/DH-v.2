'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, ChevronDown, ClipboardCheck } from 'lucide-react';
import { getTips } from './tipsCertificado';

// Checklist de revisión antes de firmar (TipsFirmaPanel de la v1). El firmante tilda todos los puntos de la sección
// de su tipo de informe; al completar una, las demás se anulan solas ("No corresponde") y se habilita la firma.
// Si el tipo de certificado no tiene tips, no se muestra (y no bloquea). Es solo de pantalla: no se guarda.
export function TipsFirmaPanel({ tipoCertificado, onAllChecked }: { tipoCertificado: string; onAllChecked: (ok: boolean) => void }) {
  const grupos = useMemo(() => getTips(tipoCertificado), [tipoCertificado]);
  const [expanded, setExpanded] = useState(true);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [annulled, setAnnulled] = useState<Set<number>>(new Set());

  useEffect(() => { setChecked({}); setAnnulled(new Set()); setExpanded(true); }, [tipoCertificado]);

  const total = grupos.reduce((acc, g) => acc + g.tips.length, 0);
  const checkedCount = Object.values(checked).filter(Boolean).length;
  const allChecked = total === 0 || checkedCount === total;
  useEffect(() => { onAllChecked(allChecked); }, [allChecked, onAllChecked]);

  if (grupos.length === 0) return null;

  const toggle = (gi: number, ti: number) => {
    const key = `${gi}-${ti}`;
    if (annulled.has(gi) && checked[key]) return;
    setChecked((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (next[key]) {
        // Sección completa → las demás no corresponden a este informe.
        if (grupos[gi].tips.every((_, t) => next[`${gi}-${t}`])) {
          const anuladas = new Set<number>();
          grupos.forEach((g, ogi) => {
            if (ogi === gi) return;
            anuladas.add(ogi);
            g.tips.forEach((_, oti) => { next[`${ogi}-${oti}`] = true; });
          });
          setAnnulled((a) => new Set([...a, ...anuladas]));
        }
        return next;
      }
      if (annulled.size > 0) setAnnulled(new Set());
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-alerta/30 bg-alerta/5">
      <button type="button" onClick={() => setExpanded((e) => !e)} className="flex min-h-control w-full items-center justify-between gap-2 px-4 py-3 hover:bg-alerta/10">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardCheck className="h-4 w-4 shrink-0 text-alerta" aria-hidden />
          <span className="text-sm font-semibold">Checklist de revisión</span>
          {allChecked
            ? <span className="rounded-full bg-exito/15 px-1.5 py-0.5 text-[0.7rem] font-bold text-exito">Completo</span>
            : <span className="rounded-full bg-alerta/15 px-1.5 py-0.5 text-[0.7rem] font-bold text-alerta">{checkedCount}/{total}</span>}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-suave transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {expanded && (
        <div className="max-h-[280px] space-y-3 overflow-y-auto px-4 pb-3">
          {!allChecked && (
            <div className="mb-1 flex items-start gap-1.5 rounded-md bg-alerta/10 px-2 py-1.5 text-xs text-alerta">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>Tildá los puntos de la sección que corresponde a tu informe. Las demás se anularán automáticamente.</span>
            </div>
          )}
          {grupos.map((grupo, gi) => {
            const anulada = annulled.has(gi);
            return (
              <div key={gi} className={`space-y-1.5 ${anulada ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-2 pt-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-suave">{grupo.categoria}</p>
                  {anulada && <span className="flex items-center gap-0.5 rounded-full bg-elevado px-1.5 py-0.5 text-[0.65rem] font-bold text-suave"><Ban className="h-2.5 w-2.5" aria-hidden /> No corresponde</span>}
                </div>
                {grupo.tips.map((tip, ti) => {
                  const marcado = !!checked[`${gi}-${ti}`];
                  return (
                    <button key={ti} type="button" onClick={() => toggle(gi, ti)} disabled={anulada} aria-pressed={marcado}
                      className={`flex w-full items-start gap-2 text-left ${anulada ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${anulada ? 'border-borde bg-elevado text-suave' : marcado ? 'border-exito bg-exito text-white' : 'border-borde bg-fondo'}`}>
                        {marcado && (anulada ? <Ban className="h-2.5 w-2.5" aria-hidden /> : <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>)}
                      </span>
                      <span className={`text-xs leading-snug ${marcado ? 'text-suave line-through' : ''}`}>{tip}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
