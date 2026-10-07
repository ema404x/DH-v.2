'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PenTool, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '../Boton';
import { FirmaCanvas } from '../FirmaCanvas';
import { Dialogo } from './Dialogo';
import { guardarMiFirma, miFirma } from '@/lib/certificacion';
import { useSesion } from '@/lib/sesion';

// Firma del jefe de sitio al emitir un certificado de obra (FirmaJefeSitioModal de la v1): usa la firma guardada en
// el perfil o se dibuja una nueva, que queda guardada para la próxima.
export function FirmaJefeSitioModal({ abierto, onCerrar, onFirmado, titulo = 'Firma Digital', cargo = 'Jefe de Sitio · Certificado de Obra' }: {
  abierto: boolean;
  onCerrar: () => void;
  onFirmado: (firma: string) => void;
  titulo?: string;
  cargo?: string;
}) {
  const { perfil } = useSesion();
  const [guardada, setGuardada] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [redibujar, setRedibujar] = useState(false);
  const [nueva, setNueva] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const nombre = perfil?.nombre || perfil?.email || 'Jefe de Sitio';

  useEffect(() => {
    if (!abierto || !perfil) return;
    setCargando(true);
    setRedibujar(false);
    setNueva(null);
    miFirma(perfil.id).then(setGuardada).catch(() => setGuardada(null)).finally(() => setCargando(false));
  }, [abierto, perfil]);

  const mostrarCanvas = !guardada || redibujar;

  async function confirmar() {
    let firma = guardada;
    if (mostrarCanvas) {
      if (!nueva) {
        toast.error('Dibujá tu firma antes de confirmar');
        return;
      }
      firma = nueva;
      setConfirmando(true);
      // Queda como firma del perfil para la próxima (si falla, igual se firma este certificado).
      if (perfil) await guardarMiFirma(perfil.id, nueva).catch(() => undefined);
      setConfirmando(false);
    }
    if (firma) onFirmado(firma);
  }

  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo={titulo} icono={PenTool} ancho="max-w-md" bloqueado={confirmando}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar} disabled={confirmando}>Cancelar</Boton>
        <Boton variante="primario" icono={CheckCircle2} cargando={confirmando} disabled={cargando} onClick={confirmar}>Firmar y emitir</Boton>
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded border bg-elevado/60 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primario/15 font-bold text-primario">{nombre.charAt(0).toUpperCase()}</div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{nombre}</p>
            <p className="text-xs text-suave">{cargo}</p>
          </div>
        </div>
        {cargando ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-suave" aria-hidden /></div>
        ) : !mostrarCanvas ? (
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
              {guardada && (
                <button type="button" onClick={() => setRedibujar(false)} className="min-h-control text-sm text-suave hover:text-texto">← Usar guardada</button>
              )}
            </div>
            <FirmaCanvas onCambio={setNueva} />
          </div>
        )}
      </div>
    </Dialogo>
  );
}
