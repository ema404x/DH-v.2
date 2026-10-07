'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Calendar, CheckCircle2, Download, Loader2, SkipForward, Users, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { aPDF, formDesdeCertificado } from './modelo';
import { ejecutarAutomaticos, fmt, MESES_ES, obtenerCertificado, type CertificadoFila } from '@/lib/certificados';
import { descargarPDFCertificado } from '@/lib/pdfCertificado';
import { limpiarError } from '@/lib/errores';

// Los mismos feriados fijos que usaba la v1 (y la base: ultimo_dia_habil).
const FERIADOS = [[1, 1], [3, 24], [4, 2], [5, 1], [5, 25], [6, 20], [7, 9], [8, 17], [10, 12], [11, 20], [12, 8], [12, 25]];
function ultimoDiaHabil(hoy = new Date()): Date {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  while (d.getDay() === 0 || d.getDay() === 6 || FERIADOS.some(([m, dia]) => m === d.getMonth() + 1 && dia === d.getDate())) d.setDate(d.getDate() - 1);
  return d;
}

// Solapa "Automáticos" (CertificadosAutomatizados de la v1): el último día hábil de cada mes se emiten los
// certificados de abono del mes siguiente. Desde acá se puede ejecutar o forzar.
export function CertificadosAutomatizados({ certificados, onCambio }: { certificados: CertificadoFila[]; onCambio: () => void }) {
  const [corriendo, setCorriendo] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [exportando, setExportando] = useState<string | null>(null);

  const hoy = new Date();
  const ultimo = ultimoDiaHabil(hoy);
  const esHoy = ultimo.getDate() === hoy.getDate() && ultimo.getMonth() === hoy.getMonth();
  const siguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
  const proximoMes = `${siguiente.getFullYear()}-${String(siguiente.getMonth() + 1).padStart(2, '0')}`;
  const fechaLarga = `${ultimo.getDate()} de ${MESES_ES[ultimo.getMonth()].toLowerCase()} ${ultimo.getFullYear()}`;

  const automaticos = certificados.filter((c) => c.generado_automaticamente);
  const grupos = useMemo(() => {
    const q = filtro.toLowerCase();
    const m = new Map<string, CertificadoFila[]>();
    for (const c of automaticos.filter((x) => x.contratista.toLowerCase().includes(q))) {
      const k = c.periodo || 'Sin período';
      (m.get(k) ?? m.set(k, []).get(k)!).push(c);
    }
    // Más reciente primero (por la fecha del certificado).
    return [...m.entries()].sort((a, b) => (b[1][0].fecha_certificado ?? '').localeCompare(a[1][0].fecha_certificado ?? ''));
  }, [automaticos, filtro]);

  async function ejecutar(forzar: boolean) {
    setCorriendo(true);
    try {
      const r = await ejecutarAutomaticos(forzar);
      setMensaje(r.mensaje ?? 'Proceso completado');
      onCambio();
    } catch (err) {
      setMensaje(null);
      toast.error('Error al ejecutar: ' + limpiarError(err));
    } finally {
      setCorriendo(false);
    }
  }

  async function pdf(c: CertificadoFila) {
    setExportando(c.id);
    try {
      const { cert, lineas } = await obtenerCertificado(c.id);
      await descargarPDFCertificado(aPDF(formDesdeCertificado(cert, lineas), lineas));
    } catch (err) {
      toast.error('No se pudo generar el PDF: ' + limpiarError(err));
    } finally {
      setExportando(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="tarjeta border-l-4 border-l-primario">
          <div className="flex items-center gap-2 text-sm text-suave"><Calendar className="h-4 w-4" aria-hidden />Próxima emisión automática</div>
          <p className="mt-2 text-xl font-bold">{fechaLarga}</p>
          <p className="mt-1 text-sm text-suave">Emitirá certificados para <strong>{proximoMes}</strong></p>
          {esHoy && <span className="mt-2 inline-block rounded-full bg-exito/15 px-2 py-0.5 text-xs font-semibold text-exito">¡Hoy es el día!</span>}
        </div>
        <div className="tarjeta">
          <div className="flex items-center gap-2 text-sm text-suave"><Users className="h-4 w-4 text-info" aria-hidden />Total emitidos</div>
          <p className="mt-2 text-2xl font-bold">{automaticos.length}</p>
          <p className="text-sm text-suave">certificados automáticos históricos</p>
        </div>
        <div className="tarjeta space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold"><Zap className="h-4 w-4 text-alerta" aria-hidden />Acciones</div>
          <button type="button" onClick={() => ejecutar(false)} disabled={corriendo}
            className="inline-flex min-h-control w-full items-center justify-center gap-2 rounded bg-primario px-4 text-sm font-semibold text-sobre-primario disabled:opacity-50">
            {corriendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Zap className="h-4 w-4" aria-hidden />}Ejecutar (día hábil)
          </button>
          <button type="button" onClick={() => ejecutar(true)} disabled={corriendo}
            className="inline-flex min-h-control w-full items-center justify-center gap-2 rounded border bg-elevado px-4 text-sm font-semibold disabled:opacity-50">
            <SkipForward className="h-4 w-4" aria-hidden />Forzar ahora
          </button>
        </div>
      </div>

      {mensaje && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-exito/40 bg-exito/10 p-4 text-sm">
          <span className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-exito" aria-hidden />{mensaje}</span>
          <button type="button" onClick={() => setMensaje(null)} aria-label="Cerrar" className="min-h-control min-w-control rounded hover:bg-elevado">✕</button>
        </div>
      )}

      <input type="search" className="control w-full" placeholder="Filtrar por contratista..." value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar por contratista" />

      {automaticos.length === 0 ? (
        <div className="tarjeta p-12 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-suave" aria-hidden />
          <p className="font-semibold">No hay certificados generados automáticamente</p>
          <p className="text-sm text-suave">Se emiten automáticamente el último día hábil de cada mes</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map(([periodo, lista]) => (
            <div key={periodo} className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between bg-elevado/60 px-4 py-2">
                <span className="flex items-center gap-2 font-semibold"><Calendar className="h-4 w-4" aria-hidden />{periodo}
                  <span className="rounded-full bg-superficie px-2 py-0.5 text-xs font-normal">{lista.length} certificados</span></span>
                {lista.reduce((a, c) => a + Number(c.subtotal_presente), 0) > 0 && <span className="font-semibold">{fmt(lista.reduce((a, c) => a + Number(c.subtotal_presente), 0))}</span>}
              </div>
              <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 lg:grid-cols-3">
                {lista.map((c) => (
                  <div key={c.id} className="space-y-2 rounded border bg-superficie p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><p className="truncate font-semibold">{c.contratista}</p><p className="text-xs text-suave">Cert. #{c.numero}</p></div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${c.estado === 'aprobado' ? 'bg-exito/15 text-exito' : c.estado === 'emitido' ? 'bg-info/15 text-info' : 'bg-elevado text-suave'}`}>{c.estado}</span>
                    </div>
                    {Number(c.subtotal_presente) > 0 && <p className="font-bold">{fmt(c.subtotal_presente)}</p>}
                    <p className="flex items-center gap-1 text-xs text-suave"><CheckCircle2 className="h-3 w-3 text-exito" aria-hidden />
                      {new Date(c.emitido_at ?? c.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</p>
                    <button type="button" onClick={() => pdf(c)} disabled={exportando === c.id} className="inline-flex min-h-control items-center gap-2 text-sm font-semibold text-primario disabled:opacity-50">
                      {exportando === c.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}Descargar PDF
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
