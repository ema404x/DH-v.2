'use client';

import { AlertTriangle, CloudUpload, Loader2, Users } from 'lucide-react';
import { Boton } from './Boton';
import type { EstadoCola as Cola } from '@/lib/offline/useCola';

const cambios = (n: number) => (n === 1 ? '1 cambio' : `${n} cambios`);

// Aviso de lo que está guardado en el teléfono y todavía no llegó al servidor.
// Si no hay nada en espera, no ocupa lugar.
export function EstadoCola({ cola }: { cola: Cola }) {
  if (cola.pendientes === 0 && cola.rechazadas === 0 && cola.deOtros === 0) return null;
  return (
    <div className="space-y-2">
      {cola.pendientes > 0 && (
        <div className="flex items-center justify-between gap-3 rounded border border-alerta/40 bg-alerta/10 py-1 pl-3 pr-1 text-alerta" role="status">
          <p className="flex items-center gap-2 py-1">
            {cola.enviando ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden /> : <CloudUpload className="h-5 w-5 shrink-0" aria-hidden />}
            <span>
              {cola.enviando
                ? `Enviando ${cambios(cola.pendientes)}`
                : `${cambios(cola.pendientes)} ${cola.pendientes === 1 ? 'guardado' : 'guardados'} en el teléfono. Se ${cola.pendientes === 1 ? 'envía solo' : 'envían solos'} cuando haya señal.`}
            </span>
          </p>
          {!cola.enviando && (
            <Boton variante="fantasma" onClick={cola.enviarAhora}>
              Enviar ahora
            </Boton>
          )}
        </div>
      )}
      {cola.rechazadas > 0 && (
        <p className="flex items-center gap-2 rounded border border-peligro/50 bg-peligro/10 px-3 py-2 text-peligro" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            {cambios(cola.rechazadas)} no {cola.rechazadas === 1 ? 'se pudo' : 'se pudieron'} aplicar. Abrí la orden marcada para ver el motivo: lo que cargaste sigue guardado.
          </span>
        </p>
      )}
      {cola.deOtros > 0 && (
        <p className="flex items-center gap-2 rounded border px-3 py-2 text-sm text-suave" role="status">
          <Users className="h-5 w-5 shrink-0" aria-hidden />
          <span>En este teléfono hay {cambios(cola.deOtros)} sin enviar de otro usuario. Se envían cuando esa persona vuelva a ingresar.</span>
        </p>
      )}
    </div>
  );
}
