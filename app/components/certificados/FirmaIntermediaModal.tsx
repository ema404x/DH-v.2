'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, FileText, Loader2, PenTool, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '../Boton';
import { FirmaCanvas } from '../FirmaCanvas';
import { Dialogo } from './Dialogo';
import { TipsFirmaPanel } from './TipsFirmaPanel';
import { aPDF, formDesdeCertificado } from './modelo';
import { guardarMiFirma, miFirma } from '@/lib/certificacion';
import { fmt, firmarIntermedio, obtenerCertificado, rechazarFirmaIntermedia, type CertificadoFila } from '@/lib/certificados';
import { descargarPDFCertificado } from '@/lib/pdfCertificado';
import { limpiarError } from '@/lib/errores';
import { useSesion } from '@/lib/sesion';

// Firma de un paso de la cadena (FirmaIntermediaModal de la v1): resumen, progreso de la cadena, checklist de
// revisión, firma guardada o dibujada (queda en el perfil para la próxima), firmar o rechazar con motivo.
// La base controla que le toque firmar a esta persona; el último que firma emite el certificado.
export function FirmaIntermediaModal({ cert, onCerrar, onListo }: { cert: CertificadoFila | null; onCerrar: () => void; onListo: () => void }) {
  const { perfil } = useSesion();
  const [guardada, setGuardada] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [redibujar, setRedibujar] = useState(false);
  const [nueva, setNueva] = useState<string | null>(null);
  const [modo, setModo] = useState<'confirm' | 'rejecting'>('confirm');
  const [motivo, setMotivo] = useState('');
  const [tipsOk, setTipsOk] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const onTips = useCallback((ok: boolean) => setTipsOk(ok), []);

  useEffect(() => {
    if (!cert || !perfil) return;
    setRedibujar(false); setNueva(null); setModo('confirm'); setMotivo(''); setTipsOk(false); setCargando(true);
    miFirma(perfil.id).then(setGuardada).catch(() => setGuardada(null)).finally(() => setCargando(false));
  }, [cert, perfil]);

  if (!cert) return null;
  const cadena = cert.firmas ?? [];
  const idxActual = cadena.findIndex((f) => f.estado === 'pendiente');
  const nombre = perfil?.nombre || perfil?.email || 'Firmante';
  const mostrarCanvas = !guardada || redibujar;

  async function firmar() {
    let firma = guardada;
    if (mostrarCanvas) {
      if (!nueva) { toast.error('Dibujá tu firma antes de confirmar'); return; }
      firma = nueva;
    }
    setEnviando(true);
    try {
      if (mostrarCanvas && perfil) await guardarMiFirma(perfil.id, nueva).catch(() => undefined);
      const r = await firmarIntermedio(cert!.id, firma);
      toast.success(r.estado === 'emitido'
        ? `Firmaste el último: Certificado N° ${r.numero} emitido y enviado a aprobación gerencial`
        : 'Certificado firmado. Pasa al próximo firmante.');
      onListo();
    } catch (e) {
      toast.error('Error al firmar: ' + limpiarError(e));
    } finally {
      setEnviando(false);
    }
  }

  async function rechazar() {
    if (!motivo.trim()) { toast.error('Ingresá el motivo del rechazo'); return; }
    setEnviando(true);
    try {
      await rechazarFirmaIntermedia(cert!.id, motivo.trim());
      toast.success('Certificado rechazado y devuelto al creador');
      onListo();
    } catch (e) {
      toast.error('Error al rechazar: ' + limpiarError(e));
    } finally {
      setEnviando(false);
    }
  }

  async function pdf() {
    try {
      const { cert: c, lineas } = await obtenerCertificado(cert!.id);
      await descargarPDFCertificado(aPDF(formDesdeCertificado(c, lineas), lineas));
    } catch {
      toast.error('No se pudo generar el PDF');
    }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo="Firma de Certificado" icono={PenTool} ancho="max-w-lg" bloqueado={enviando}
      pie={modo === 'confirm' ? <>
        <Boton variante="fantasma" icono={XCircle} onClick={() => setModo('rejecting')} disabled={enviando}>Rechazar</Boton>
        <Boton variante="primario" icono={CheckCircle2} cargando={enviando} disabled={cargando || !tipsOk || (mostrarCanvas && !nueva)} onClick={firmar}>Firmar</Boton>
      </> : <>
        <Boton variante="fantasma" onClick={() => { setModo('confirm'); setMotivo(''); }} disabled={enviando}>Cancelar</Boton>
        <Boton variante="peligro" icono={XCircle} cargando={enviando} disabled={!motivo.trim()} onClick={rechazar}>Confirmar rechazo</Boton>
      </>}>
      <div className="space-y-4">
        <div className="space-y-2 rounded-lg border bg-elevado/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">{cert.numero ? `Certificado N° ${cert.numero}` : 'Certificado (se numera al firmar el último)'}</span>
            <button type="button" onClick={pdf} className="inline-flex min-h-control items-center gap-1 rounded px-2 text-xs hover:bg-elevado"><FileText className="h-3.5 w-3.5" aria-hidden /> Ver PDF</button>
          </div>
          <p className="text-sm text-suave">{cert.contratista || '—'}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-suave">
            {cert.emprendimiento && <span>{cert.emprendimiento}</span>}
            {cert.ada_numero && <span>ADA: {cert.ada_numero}</span>}
          </div>
          <div className="flex items-center justify-between border-t pt-1">
            <span className="text-xs text-suave">Monto</span>
            <span className="text-sm font-bold text-primario">{fmt(cert.subtotal_presente || cert.monto_contratado)}</span>
          </div>
        </div>

        {cadena.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {cadena.map((f, i) => (
              <Fragment key={i}>
                <div className={`flex items-center gap-1 rounded-full border px-2 py-1 ${f.estado === 'firmado' ? 'border-exito/30 bg-exito/15 text-exito' : i === idxActual ? 'border-alerta/30 bg-alerta/15 text-alerta' : 'bg-elevado text-suave'}`}>
                  {f.estado === 'firmado' ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : i === idxActual ? <PenTool className="h-3 w-3" aria-hidden /> : <Clock className="h-3 w-3" aria-hidden />}
                  <span className="max-w-[80px] truncate">{f.nombre}</span>
                </div>
                {i < cadena.length - 1 && <span className="text-suave">→</span>}
              </Fragment>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 rounded-lg border border-primario/20 bg-primario/5 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primario/15 font-bold text-primario">{nombre.charAt(0).toUpperCase()}</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{nombre}</p>
            <p className="text-xs text-suave">{idxActual + 1}° de {cadena.length} · Te toca firmar</p>
          </div>
        </div>

        {cargando ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-suave" aria-hidden /></div>
        ) : modo === 'rejecting' ? (
          <div className="space-y-2">
            <label htmlFor="motivo-rechazo-firma" className="etiqueta">Motivo del rechazo (obligatorio)</label>
            <textarea id="motivo-rechazo-firma" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Explicá por qué rechazás este certificado..."
              className="control h-20 w-full resize-none py-2 text-sm" />
          </div>
        ) : (
          <>
            <TipsFirmaPanel tipoCertificado={cert.tipo} onAllChecked={onTips} />
            {!mostrarCanvas ? (
              <div className="space-y-2">
                <p className="etiqueta">Firma registrada</p>
                <div className="flex min-h-20 items-center justify-center rounded border bg-papel p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={guardada!} alt="Firma guardada" className="max-h-16 object-contain" />
                </div>
                <p className="text-center text-xs font-semibold">{nombre}</p>
                <button type="button" onClick={() => setRedibujar(true)} className="flex min-h-control items-center gap-1.5 text-sm text-suave hover:text-texto">
                  <RefreshCw className="h-4 w-4" aria-hidden /> Usar una firma diferente
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="etiqueta">{guardada ? 'Nueva firma' : 'Dibujá tu firma'}</p>
                  {guardada && <button type="button" onClick={() => setRedibujar(false)} className="min-h-control text-sm text-suave hover:text-texto">← Usar guardada</button>}
                </div>
                <FirmaCanvas onCambio={setNueva} />
                <p className="text-xs text-suave">{guardada ? 'Esta nueva firma reemplazará la guardada.' : 'Esta firma quedará guardada para futuras veces.'}</p>
              </div>
            )}
          </>
        )}
      </div>
    </Dialogo>
  );
}
