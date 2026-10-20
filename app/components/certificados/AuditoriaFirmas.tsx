'use client';

import { AlertCircle, CheckCircle2, Clock, FileText, History, PenTool, ShieldCheck, User, XCircle, type LucideIcon } from 'lucide-react';
import { Dialogo } from './Dialogo';
import { auditoriaFirmas, type CertificadoFila } from '@/lib/certificados';
import { useCarga } from '@/lib/useCarga';

const fmtFecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : null);
const ESTADO: Record<string, { label: string; cls: string }> = {
  borrador: { label: 'Borrador', cls: 'border-borde bg-elevado text-suave' },
  en_firmas: { label: 'Pend. Firmas', cls: 'border-alerta/30 bg-alerta/15 text-alerta' },
  emitido: { label: 'Emitido', cls: 'border-info/40 bg-info/15 text-info' },
  aprobado: { label: 'Aprobado', cls: 'border-exito/40 bg-exito/15 text-exito' },
};

interface Evento { icon: LucideIcon; tono: string; titulo: string; autor?: string | null; fecha: string | null; estado: 'pendiente' | 'firmado' | 'rechazado' | null; detalle?: string; comentario?: string | null; firmaUrl?: string | null }

// Auditoría de firmas (AuditoriaFirmasModal de la v1): creación → cadena (todas las rondas) → jefe → aprobación.
export function AuditoriaFirmas({ cert, onCerrar }: { cert: CertificadoFila | null; onCerrar: () => void }) {
  const carga = useCarga(() => (cert ? auditoriaFirmas(cert.id) : Promise.resolve([])), [cert?.id]);
  if (!cert) return null;
  const pasos = carga.datos ?? [];
  const rondas = new Set(pasos.map((p) => p.ronda)).size;

  const eventos: Evento[] = [{ icon: FileText, tono: 'text-suave border-borde bg-elevado', titulo: 'Certificado creado', fecha: cert.created_at, estado: null, detalle: `${cert.numero ? `Certificado N° ${cert.numero}` : 'Certificado'} · ${cert.tipo}` }];
  for (const p of pasos) {
    const total = pasos.filter((x) => x.ronda === p.ronda).length;
    const base = `Firmante ${p.orden} de ${total} en la cadena${rondas > 1 ? ` · envío ${p.ronda}` : ''}`;
    if (p.estado === 'firmado') eventos.push({ icon: CheckCircle2, tono: 'text-exito border-exito/30 bg-exito/10', titulo: `Firmado por ${p.nombre}`, fecha: p.firmado_at, estado: 'firmado', detalle: base, firmaUrl: p.firma_url });
    else if (p.estado === 'rechazado') eventos.push({ icon: XCircle, tono: 'text-peligro border-peligro/30 bg-peligro/10', titulo: `Rechazado por ${p.nombre}`, fecha: p.firmado_at, estado: 'rechazado', detalle: base, comentario: p.motivo });
    else eventos.push({ icon: Clock, tono: 'text-alerta border-alerta/30 bg-alerta/10', titulo: `Pendiente: ${p.nombre}`, fecha: null, estado: 'pendiente', detalle: base });
  }
  if (cert.firma_jefe_url || cert.firma_jefe_nombre) {
    eventos.push({ icon: PenTool, tono: 'text-info border-info/30 bg-info/10', titulo: `Firmado por ${cert.firma_jefe_nombre || 'Jefe de Sitio'}`, fecha: cert.firma_jefe_at, estado: 'firmado', detalle: 'Jefe de Sitio', firmaUrl: cert.firma_jefe_url });
  }
  if (cert.estado === 'aprobado') {
    eventos.push({ icon: ShieldCheck, tono: 'text-exito border-exito/30 bg-exito/10', titulo: `Aprobado por ${cert.aprobado_nombre || 'Gerente'}`, fecha: cert.aprobado_at, estado: 'firmado', detalle: 'Gerente de Contratos', firmaUrl: cert.firma_url });
  }
  const est = ESTADO[cert.estado] ?? ESTADO.borrador;

  return (
    <Dialogo abierto onCerrar={onCerrar} icono={History} ancho="max-w-2xl"
      titulo={<span className="flex flex-wrap items-center gap-2">Auditoría de Firmas <span className={`rounded-full border px-2 py-0.5 text-xs ${est.cls}`}>{est.label}</span></span>}>
      <p className="mb-4 text-sm text-suave">{cert.numero ? `Certificado N° ${cert.numero}` : 'Certificado'} · {cert.contratista || '—'}</p>
      {carga.cargando && !carga.datos ? <div className="py-8 text-center text-suave">Cargando...</div> : (
        <ol className="space-y-0">
          {eventos.map((ev, idx) => {
            const Icono = ev.icon;
            const ultimo = idx === eventos.length - 1;
            return (
              <li key={idx} className="flex gap-3">
                <div className="flex shrink-0 flex-col items-center">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full border ${ev.tono}`}><Icono className="h-4 w-4" aria-hidden /></div>
                  {!ultimo && <div className="my-1 min-h-[24px] w-px flex-1 bg-borde" />}
                </div>
                <div className={`flex-1 ${ultimo ? '' : 'pb-4'}`}>
                  <div className="rounded-lg border bg-superficie p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{ev.titulo}</p>
                        {ev.autor && <p className="mt-0.5 flex items-center gap-1 text-xs text-suave"><User className="h-3 w-3" aria-hidden />{ev.autor}</p>}
                      </div>
                      {ev.estado === 'pendiente' && <span className="rounded-full border border-alerta/30 bg-alerta/10 px-2 py-0.5 text-xs text-alerta">En espera</span>}
                      {ev.estado === 'firmado' && <span className="rounded-full border border-exito/30 bg-exito/10 px-2 py-0.5 text-xs text-exito">Completado</span>}
                      {ev.estado === 'rechazado' && <span className="rounded-full border border-peligro/30 bg-peligro/10 px-2 py-0.5 text-xs text-peligro">Rechazado</span>}
                    </div>
                    {ev.detalle && <p className="mt-1 text-xs text-suave">{ev.detalle}</p>}
                    {ev.fecha && <p className="mt-1.5 text-xs font-medium tabular-nums">📅 {fmtFecha(ev.fecha)}</p>}
                    {ev.comentario && (
                      <div className="mt-2 flex items-start gap-2 rounded-md border border-peligro/20 bg-peligro/10 p-2">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-peligro" aria-hidden />
                        <div><p className="text-xs font-semibold text-peligro">Motivo de rechazo</p><p className="mt-0.5 text-xs">{ev.comentario}</p></div>
                      </div>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {ev.firmaUrl && <img src={ev.firmaUrl} alt="Firma" className="mt-2 h-12 rounded border bg-papel px-2 object-contain" />}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Dialogo>
  );
}
