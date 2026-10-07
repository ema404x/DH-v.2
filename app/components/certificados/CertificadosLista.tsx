'use client';

import { useState } from 'react';
import { CheckCircle2, Clock, Eye, FileText, Loader2, PenTool, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { aPDF, formDesdeCertificado } from './modelo';
import { fmt, obtenerCertificado, type CertificadoFila } from '@/lib/certificados';
import { descargarPDFCertificado } from '@/lib/pdfCertificado';
import { limpiarError } from '@/lib/errores';

const ESTADO: Record<string, { label: string; cls: string }> = {
  borrador: { label: 'Borrador', cls: 'border-borde bg-elevado text-suave' },
  emitido: { label: 'Emitido', cls: 'border-info/40 bg-info/15 text-info' },
  aprobado: { label: 'Aprobado', cls: 'border-exito/40 bg-exito/15 text-exito' },
};
const TIPO: Record<string, { label: string; cls: string }> = {
  abono_mensual: { label: 'Abono Mensual', cls: 'border-primario/40 bg-primario/15 text-primario' },
  obra: { label: 'Obra', cls: 'border-alerta/40 bg-alerta/15 text-alerta' },
  informe: { label: 'Informe', cls: 'border-info/40 bg-info/15 text-info' },
};

// Lista de certificados de una solapa (CertificadosLista de la v1).
export function CertificadosLista({ certificados, cargando, onNuevo, onVer, onBorrar, vacio }: {
  certificados: CertificadoFila[];
  cargando: boolean;
  onNuevo: () => void;
  onVer: (c: CertificadoFila) => void;
  onBorrar: (c: CertificadoFila) => void;
  vacio: string;
}) {
  const [exportando, setExportando] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');

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

  const q = busqueda.toLowerCase();
  const filtrados = certificados.filter((c) =>
    String(c.numero ?? '').includes(busqueda) || c.contratista?.toLowerCase().includes(q) || (c.emprendimiento ?? '').toLowerCase().includes(q) || (c.ada_numero ?? '').toLowerCase().includes(q));

  if (cargando) return <div className="py-20 text-center text-suave">Cargando...</div>;
  if (certificados.length === 0) {
    return (
      <div className="py-20 text-center">
        <FileText className="mx-auto mb-4 h-12 w-12 text-suave/40" aria-hidden />
        <h3 className="mb-1 text-lg font-semibold">{vacio || 'No hay certificados aún'}</h3>
        <p className="mb-6 text-sm text-suave">Subí un ADA y la IA generará el certificado automáticamente</p>
        <button type="button" onClick={onNuevo} className="inline-flex min-h-control items-center gap-2 rounded bg-primario px-4 text-sm font-semibold text-sobre-primario"><Plus className="h-4 w-4" aria-hidden />Nuevo Certificado</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input type="search" placeholder="Buscar por N°, contratista, ADA..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="control flex-1" aria-label="Buscar certificados" />
        <button type="button" onClick={onNuevo} className="inline-flex min-h-control shrink-0 items-center gap-2 rounded bg-primario px-4 text-sm font-semibold text-sobre-primario"><Plus className="h-4 w-4" aria-hidden />Nuevo</button>
      </div>

      <div className="space-y-3">
        {filtrados.map((c) => {
          const est = ESTADO[c.estado] ?? ESTADO.borrador;
          return (
            <div key={c.id} className="group rounded-lg border bg-superficie p-4 transition-colors hover:border-primario/30">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primario/10"><FileText className="h-4 w-4 text-primario" aria-hidden /></div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{c.numero ? `Certificado N° ${c.numero}` : 'Certificado (borrador)'}</h3>
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${est.cls}`}>{est.label}</span>
                      {TIPO[c.tipo] && <span className={`rounded-full border px-2 py-0.5 text-xs ${TIPO[c.tipo].cls}`}>{TIPO[c.tipo].label}</span>}
                      {c.generado_automaticamente && <span className="rounded-full bg-elevado px-2 py-0.5 text-xs">⚡ Auto</span>}
                    </div>
                    <p className="truncate text-sm text-suave">{c.contratista}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-suave">
                      {c.emprendimiento && <span className="max-w-[140px] truncate">{c.emprendimiento}</span>}
                      {c.ada_numero && <span>ADA: {c.ada_numero}</span>}
                      {c.periodo && <span>{c.periodo}</span>}
                    </div>
                    {c.estado === 'aprobado' && c.aprobado_nombre && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-exito"><CheckCircle2 className="h-3 w-3" aria-hidden /><span>Aprobado por {c.aprobado_nombre}</span></div>
                    )}
                    {c.estado === 'emitido' && c.tipo === 'obra' && !c.firma_jefe_url && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-alerta"><PenTool className="h-3 w-3" aria-hidden /><span>Pendiente firma del jefe de sitio</span></div>
                    )}
                    {c.estado === 'emitido' && c.tipo === 'obra' && c.firma_jefe_url && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-info"><Clock className="h-3 w-3" aria-hidden /><span>Firmado por jefe — pendiente aprobación gerencial</span></div>
                    )}
                    {c.estado === 'emitido' && c.tipo !== 'obra' && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-info"><Clock className="h-3 w-3" aria-hidden /><span>Pendiente de aprobación</span></div>
                    )}
                    <div className="mt-2 flex gap-1 sm:hidden">
                      <button type="button" className="inline-flex min-h-control items-center gap-1 rounded px-2 text-xs hover:bg-elevado" onClick={() => onVer(c)}><Eye className="h-3.5 w-3.5" aria-hidden /> Ver</button>
                      <button type="button" className="inline-flex min-h-control items-center gap-1 rounded px-2 text-xs text-exito hover:bg-elevado" onClick={() => pdf(c)} disabled={exportando === c.id}>
                        {exportando === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />} PDF
                      </button>
                      {c.estado === 'borrador' && (
                        <button type="button" className="inline-flex min-h-control items-center rounded px-2 text-xs text-peligro hover:bg-elevado" onClick={() => onBorrar(c)} aria-label="Eliminar"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-base font-bold text-primario sm:text-lg">{fmt(c.subtotal_presente || c.monto_contratado)}</div>
                  <div className="mt-0.5 text-xs text-suave">{new Date(c.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</div>
                </div>

                <div className="hidden items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 sm:flex">
                  {c.estado === 'aprobado' && c.firma_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.firma_url} alt="Firma" className="h-8 rounded border bg-papel px-1 object-contain" title={`Aprobado por ${c.aprobado_nombre ?? ''}`} />
                  )}
                  <button type="button" className="flex h-9 w-9 items-center justify-center rounded hover:bg-elevado" onClick={() => onVer(c)} title={c.estado === 'borrador' ? 'Editar' : 'Ver'} aria-label="Ver"><Eye className="h-4 w-4" aria-hidden /></button>
                  <button type="button" className="flex h-9 w-9 items-center justify-center rounded text-exito hover:bg-elevado" onClick={() => pdf(c)} disabled={exportando === c.id} title="Descargar PDF" aria-label="Descargar PDF">
                    {exportando === c.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
                  </button>
                  <button type="button" className="flex h-9 w-9 items-center justify-center rounded text-peligro hover:bg-elevado disabled:opacity-30" onClick={() => onBorrar(c)} disabled={c.estado !== 'borrador'}
                    title={c.estado === 'borrador' ? 'Eliminar' : 'Un certificado emitido no se borra: se rechaza.'} aria-label="Eliminar">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtrados.length === 0 && (
        <div className="py-12 text-center text-suave">
          <FileText className="mx-auto mb-2 h-8 w-8 opacity-20" aria-hidden />
          <p className="text-sm">No hay certificados que coincidan con tu búsqueda</p>
        </div>
      )}
    </div>
  );
}
