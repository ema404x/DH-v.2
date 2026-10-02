'use client';

import { useState } from 'react';
import { AlertTriangle, Clock, LogIn, LogOut, X } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from './Boton';
import { limpiarError } from '@/lib/errores';
import { fichar, textoEstado, textoFichado, useFichaje, type Fichado } from '@/lib/fichaje';

// Avisa lo que pasó con una marca: registrada, guardada sin señal o registrada lejos del lugar.
export function avisarFichaje(f: Fichado) {
  const { texto, aviso } = textoFichado(f);
  if (aviso) toast.warning(`${texto} ${aviso}`, { duration: 8000 });
  else if (f.destino === 'guardado') toast.info(texto, { duration: 8000 });
  else toast.success(texto);
}

interface Props {
  usuarioId: string;
  // Cuando se llega escaneando el QR de un lugar, el fichaje queda anotado en ese lugar.
  lugar?: { id: string; nombre: string };
}

// Fichaje propio en el portal de campo: muestra si está adentro o afuera y ofrece la marca que sigue.
export function TarjetaFichaje({ usuarioId, lugar }: Props) {
  const { estado, pendientes, rechazo, descartarRechazo, refrescar } = useFichaje(usuarioId);
  const [ocupado, setOcupado] = useState(false);
  const siguiente = estado?.tipo === 'entrada' ? 'salida' : 'entrada';

  async function marcar() {
    setOcupado(true);
    try {
      avisarFichaje(await fichar(usuarioId, { tipo: siguiente, ubicacion_id: lugar?.id, ubicacion_nombre: lugar?.nombre }));
      await refrescar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta space-y-3" aria-label="Fichaje">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2">
          <Clock className={`h-5 w-5 shrink-0 ${estado?.tipo === 'entrada' ? 'text-exito' : 'text-suave'}`} aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium">{estado === null ? 'Fichaje' : textoEstado(estado)}</span>
            {pendientes > 0 && (
              <span className="block text-sm text-alerta">
                {pendientes === 1 ? '1 marca guardada en el teléfono, falta enviar.' : `${pendientes} marcas guardadas en el teléfono, falta enviar.`}
              </span>
            )}
          </span>
        </p>
        <Boton campo icono={siguiente === 'entrada' ? LogIn : LogOut} cargando={ocupado} onClick={marcar}>
          {siguiente === 'entrada' ? 'Fichar entrada' : 'Fichar salida'}{lugar ? ' acá' : ''}
        </Boton>
      </div>
      {rechazo && (
        <div className="flex items-start justify-between gap-2 rounded border border-peligro/40 bg-peligro/10 p-3 text-sm text-peligro" role="alert">
          <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{rechazo}</p>
          <button type="button" onClick={descartarRechazo} aria-label="Cerrar el aviso" className="shrink-0"><X className="h-5 w-5" aria-hidden /></button>
        </div>
      )}
    </section>
  );
}
