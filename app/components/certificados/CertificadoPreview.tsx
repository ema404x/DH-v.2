'use client';

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Download, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { aPDF, calcular, totalItem, type FormCert } from './modelo';
import { fmt, fmtFecha, type LineaCert } from '@/lib/certificados';
import { descargarPDFCertificado } from '@/lib/pdfCertificado';
import { limpiarError } from '@/lib/errores';

function Dato({ k, v, clase = '' }: { k: string; v: ReactNode; clase?: string }) {
  return (
    <div className={`flex justify-between gap-3 ${clase}`}>
      <span className="font-medium text-suave">{k}</span>
      <span className="text-right font-semibold">{v || '—'}</span>
    </div>
  );
}

// Vista previa del certificado (CertificadoPreview de la v1), con "Descargar PDF" y, si todavía no se emitió, "Emitir".
export function CertificadoPreview({ form, lineas, onVolver, textoVolver = 'Volver al editor', onEmitir, emitiendo, acciones }: {
  form: FormCert;
  lineas?: LineaCert[];
  onVolver: () => void;
  textoVolver?: string;
  onEmitir?: (f: FormCert) => void;
  emitiendo?: boolean;
  acciones?: ReactNode;
}) {
  const [exportando, setExportando] = useState(false);
  const c = calcular(form);
  const hasMedicion = form.items.some((it) => Math.round(it.presente) !== Math.round(totalItem(it)) || it.anterior > 0);
  const subtotalPDF = hasMedicion ? c.presente : c.subtotal;

  async function exportar() {
    setExportando(true);
    try {
      await descargarPDFCertificado(aPDF(form, lineas));
    } catch (err) {
      toast.error('No se pudo generar el PDF: ' + limpiarError(err));
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button type="button" onClick={onVolver} className="inline-flex min-h-control items-center gap-2 rounded px-3 text-sm font-semibold text-suave hover:bg-elevado hover:text-texto">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {textoVolver}
        </button>
        <div className="flex flex-wrap gap-2">
          {acciones}
          <button type="button" onClick={exportar} disabled={exportando} className="inline-flex min-h-control items-center gap-2 rounded border bg-elevado px-4 text-sm font-semibold hover:bg-borde disabled:opacity-50">
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            Descargar PDF
          </button>
          {onEmitir && (
            <button type="button" onClick={() => onEmitir(form)} disabled={emitiendo} className="inline-flex min-h-control items-center gap-2 rounded bg-exito px-4 text-sm font-semibold text-sobre-primario hover:bg-exito/90 disabled:opacity-50">
              {emitiendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              Emitir certificado
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 rounded-xl border bg-superficie p-8">
        <div className="border-b pb-6">
          <h1 className="mb-2 text-3xl font-bold">Certificado N° {form.numero ?? form.numeroPrevisto}</h1>
          <p className="text-sm capitalize text-suave">{form.tipo.replace(/_/g, ' ')} · {fmtFecha(form.fecha_certificado)}</p>
          {form.estado === 'borrador' && !form.numero && <p className="mt-1 text-xs text-suave">El número definitivo lo asigna la base al emitir.</p>}
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm md:grid-cols-2">
          <Dato k="Emprendimiento:" v={form.emprendimiento} />
          <Dato k="ADA N°:" v={form.ada_numero} />
          <Dato k="Obra / Servicio:" v={form.obra_servicio} />
          <Dato k="OC N°:" v={form.oc_numero} />
          <Dato k="Contratista:" v={form.contratista} />
          <Dato k="Mes / Período:" v={form.mes_periodo} />
          <Dato k="Fecha inicio:" v={fmtFecha(form.fecha_inicio)} />
          <Dato k="Fecha finalización:" v={fmtFecha(form.fecha_finalizacion)} />
          <Dato k="Plazo:" v={form.plazo_obra} />
          <Dato k="Monto contratado:" v={<span className="text-primario">{fmt(c.subtotal)}</span>} />
          {form.base && <Dato k="Base:" v={form.base} clase="md:col-span-2" />}
        </div>

        {form.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-primario text-sobre-primario">
                  <th className="px-2 py-2 text-left">N°</th>
                  <th className="px-2 py-2 text-left">Descripción</th>
                  <th className="px-2 py-2 text-left">UM</th>
                  <th className="px-2 py-2 text-right">Cant.</th>
                  <th className="px-2 py-2 text-right">Imp. Unit.</th>
                  <th className="px-2 py-2 text-right">Imp. Total</th>
                  {hasMedicion && <><th className="px-2 py-2 text-right">A.Ant $</th><th className="px-2 py-2 text-right">Pres. $</th><th className="px-2 py-2 text-right">Saldo $</th></>}
                </tr>
              </thead>
              <tbody>
                {form.items.map((it, i) => (
                  <tr key={it.clave} className={i % 2 === 0 ? '' : 'bg-elevado/40'}>
                    <td className="px-2 py-1.5 text-suave">{it.numero || i + 1}</td>
                    <td className="px-2 py-1.5">{it.descripcion}</td>
                    <td className="px-2 py-1.5">{it.um}</td>
                    <td className="num px-2 py-1.5 text-right">{it.cantidad}</td>
                    <td className="num px-2 py-1.5 text-right">{fmt(it.importe_unitario)}</td>
                    <td className="num px-2 py-1.5 text-right font-semibold">{fmt(totalItem(it))}</td>
                    {hasMedicion && <>
                      <td className="num px-2 py-1.5 text-right">{fmt(it.anterior)}</td>
                      <td className="num px-2 py-1.5 text-right text-primario">{fmt(it.presente)}</td>
                      <td className="num px-2 py-1.5 text-right">{fmt(Math.max(0, totalItem(it) - it.anterior - it.presente))}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(form.firma_jefe_url || form.firma_gerente_url) && (
          <div className="mt-4 border-t pt-6">
            <p className="mb-5 text-center text-xs font-semibold uppercase tracking-widest text-suave">Firmas y Aprobación</p>
            <div className="mx-auto grid max-w-lg grid-cols-2 gap-4">
              {form.firma_jefe_url && (
                <Firma src={form.firma_jefe_url} nombre={form.firmado_por_jefe || 'Jefe de Sitio'} cargo="Jefe de Sitio" fecha={form.fecha_firma_jefe} tono="text-info" />
              )}
              {form.firma_gerente_url && (
                <Firma src={form.firma_gerente_url} nombre={form.aprobado_por || 'Gerencia'} cargo="Gerente de Contratos" fecha={form.fecha_aprobacion} tono="text-exito" />
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <div className="min-w-64 space-y-2 text-sm">
            <div className="flex justify-between gap-8 text-suave"><span>{hasMedicion ? 'Imp. Certificado:' : 'Subtotal:'}</span><span className="font-semibold text-texto">{fmt(subtotalPDF)}</span></div>
            {c.anticipo > 0 && (
              <div className="flex justify-between gap-8 text-suave">
                <span>{form.anticipo_monto_manual != null ? 'Anticipo/Desacopio (fijo):' : `Anticipo (${form.anticipo_pct}%):`}</span><span>-{fmt(c.anticipo)}</span>
              </div>
            )}
            {c.fondo > 0 && (
              <div className="flex justify-between gap-8 text-suave">
                <span>{form.fondo_reparo_label || 'Fondo de Reparo'}{form.fondo_reparo_monto_manual != null ? ' (fijo):' : ` (${form.fondo_reparo_pct}%):`}</span><span>-{fmt(c.fondo)}</span>
              </div>
            )}
            <div className="flex justify-between gap-8 rounded-lg bg-primario px-3 py-2 text-base font-bold text-sobre-primario"><span>Total Neto:</span><span>{fmt(subtotalPDF - c.anticipo - c.fondo)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Firma({ src, nombre, cargo, fecha, tono }: { src: string; nombre: string; cargo: string; fecha?: string | null; tono: string }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-superficie shadow-sm">
      <div className="flex min-h-[88px] items-center justify-center bg-papel px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Firma ${cargo}`} className="max-h-16 max-w-full object-contain" />
      </div>
      <div className="border-t px-3 py-2.5 text-center">
        <p className="text-xs font-bold leading-tight">{nombre}</p>
        <p className="mt-0.5 text-xs text-suave">{cargo}</p>
        {fecha && <p className={`mt-1 text-xs font-semibold ${tono}`}>● {new Date(fecha).toLocaleDateString('es-AR')}</p>}
      </div>
    </div>
  );
}
