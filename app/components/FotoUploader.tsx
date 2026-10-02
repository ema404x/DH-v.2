'use client';

import { useRef, useState } from 'react';
import { Camera, CloudUpload, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from './Boton';
import { agregarFoto, borrarFoto, type OTLocal, type Quien } from '@/lib/ot';
import { limpiarError } from '@/lib/errores';
import type { FotoOT } from '@/lib/types';

interface Props {
  ot: OTLocal;
  quien: Quien;
  fotos: FotoOT[];
  editable: boolean;
  sinSenal: boolean;
  // vuelve a leer las fotos (enviadas + en espera) y la orden
  onCambio: () => Promise<void>;
}

// Fotos de la orden. Se sacan o eligen varias, pero se comprimen y suben DE A UNA:
// en ningún momento hay más de una foto grande en memoria.
// Sin señal, la foto comprimida queda guardada en el teléfono y sube sola después.
export function FotoUploader({ ot, quien, fotos, editable, sinSenal, onCambio }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [progreso, setProgreso] = useState<{ hecha: number; total: number } | null>(null);

  async function alElegir(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const archivos = Array.from(lista);
    let enTelefono = 0;
    let fallidas = 0;
    setProgreso({ hecha: 0, total: archivos.length });
    for (let i = 0; i < archivos.length; i++) {
      try {
        if ((await agregarFoto(quien, ot, archivos[i])) === 'guardado') enTelefono++;
        await onCambio();
      } catch (e) {
        fallidas++;
        toast.error(limpiarError(e));
      }
      setProgreso({ hecha: i + 1, total: archivos.length });
    }
    setProgreso(null);
    if (entrada.current) entrada.current.value = '';
    const bien = archivos.length - fallidas;
    if (bien === 0) return;
    if (enTelefono > 0) toast.success(bien === 1 ? 'Foto guardada en el teléfono. Sube cuando haya señal.' : `${bien} fotos guardadas en el teléfono. Suben cuando haya señal.`);
    else toast.success(bien === 1 ? 'Foto subida.' : `${bien} fotos subidas.`);
  }

  async function quitar(foto: FotoOT) {
    try {
      await borrarFoto(foto);
      await onCambio();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  return (
    <div className="space-y-3">
      {fotos.length === 0 ? (
        <p className="text-suave">{ot.requiere_fotos ? 'Esta orden pide al menos una foto para poder finalizarla.' : 'Todavía no hay fotos.'}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {fotos.map((f) => (
            <li key={f.id} className={`relative overflow-hidden rounded border ${f.enEspera ? 'border-alerta/60' : ''}`}>
              <a href={f.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt={f.enEspera ? 'Foto de la orden, falta enviar' : 'Foto de la orden'} loading="lazy" className="aspect-square w-full bg-elevado object-cover" />
              </a>
              {f.enEspera && (
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-fondo/85 py-1 text-xs font-medium text-alerta">
                  <CloudUpload className="h-4 w-4" aria-hidden />
                  Falta enviar
                </span>
              )}
              {/* Una foto ya enviada se borra con señal; una en espera, en cualquier momento. */}
              {editable && (f.enEspera || !sinSenal) && (
                <button
                  type="button"
                  onClick={() => quitar(f)}
                  aria-label="Borrar foto"
                  className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded bg-fondo/80 text-peligro"
                >
                  <Trash2 className="h-5 w-5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <>
          <input
            ref={entrada}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => alElegir(e.target.files)}
          />
          <Boton icono={Camera} campo ancho cargando={!!progreso} onClick={() => entrada.current?.click()}>
            {progreso ? `Guardando foto ${Math.min(progreso.hecha + 1, progreso.total)} de ${progreso.total}` : 'Sacar foto'}
          </Boton>
        </>
      )}
    </div>
  );
}
