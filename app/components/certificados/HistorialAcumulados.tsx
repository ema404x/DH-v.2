'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { fmt, historialDelContrato, type CertificadoFila } from '@/lib/certificados';

// "Histórico de Certificaciones" de la v1: los certificados ya emitidos o aprobados del mismo contrato (mismo ADA).
export function HistorialAcumulados({ contratoId, montoContratado }: { contratoId: string | null; montoContratado: number }) {
  const [certs, setCerts] = useState<CertificadoFila[]>([]);

  useEffect(() => {
    if (!contratoId) { setCerts([]); return; }
    historialDelContrato(contratoId).then(setCerts).catch(() => setCerts([]));
  }, [contratoId]);

  if (!certs.length) return null;
  const totalCertificado = certs.reduce((a, c) => a + Number(c.subtotal_presente || 0), 0);
  const pct = montoContratado > 0 ? (totalCertificado / montoContratado) * 100 : 0;

  return (
    <div className="space-y-3 rounded-lg border border-exito/40 bg-exito/10 p-4">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-exito" aria-hidden />
        <div className="flex-1">
          <div className="mb-2 text-sm font-semibold">Histórico de Certificaciones</div>
          <div className="space-y-1.5">
            {certs.map((c) => (
              <div key={c.id} className="flex justify-between rounded bg-superficie/60 px-2 py-1 text-xs">
                <span><strong>Cert. {c.numero}</strong> ({new Date(c.emitido_at ?? c.created_at).toLocaleDateString('es-AR')})</span>
                <span className="font-semibold">{fmt(c.subtotal_presente)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-exito/30 pt-1 text-xs font-bold"><span>Total acumulado:</span><span>{fmt(totalCertificado)}</span></div>
            <div className="flex justify-between text-xs"><span>Falta certificar:</span><span>{fmt(Math.max(0, montoContratado - totalCertificado))}</span></div>
            <div className="flex justify-between text-xs font-semibold"><span>% certificado:</span><span>{pct.toFixed(1)}%</span></div>
          </div>
          {pct >= 100 && <div className="mt-2 rounded bg-exito/20 px-2 py-1 text-xs font-semibold">✓ OC completamente certificada</div>}
        </div>
      </div>
    </div>
  );
}
