'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { estaEnviando, resumen, sincronizar, suscribir, versionDeEnvios } from './cola';
import type { ResumenCola } from './motor';

const VACIA: ResumenCola = { pendientes: 0, rechazadas: 0, porOT: {}, deOtros: 0 };
const CADA_MS = 30_000;

export interface EstadoCola extends ResumenCola {
  enviando: boolean;
  enviarAhora: () => void;
  // sube cada vez que un envío cambió algo en el servidor: las pantallas lo usan para recargar
  version: number;
}

// Estado de la cola sin señal para la pantalla, y los disparadores del envío:
// al abrir, al volver la señal, al volver a la app, y cada 30 segundos mientras quede algo pendiente.
export function useCola(usuarioId: string | undefined): EstadoCola {
  const [estado, setEstado] = useState<ResumenCola>(VACIA);
  const [enviando, setEnviando] = useState(false);
  const [version, setVersion] = useState(0);
  const pendientes = useRef(0);

  const enviar = useCallback(() => {
    void sincronizar();
  }, []);

  useEffect(() => {
    if (!usuarioId) return;
    let vigente = true;
    const refrescar = () => {
      setEnviando(estaEnviando());
      setVersion(versionDeEnvios());
      resumen(usuarioId)
        .then((r) => {
          if (!vigente) return;
          pendientes.current = r.pendientes;
          setEstado(r);
        })
        .catch(() => undefined);
    };
    refrescar();
    const soltar = suscribir(refrescar);

    const alVolver = () => document.visibilityState === 'visible' && enviar();
    window.addEventListener('online', enviar);
    document.addEventListener('visibilitychange', alVolver);
    const reloj = setInterval(() => pendientes.current > 0 && enviar(), CADA_MS);
    enviar();

    return () => {
      vigente = false;
      soltar();
      window.removeEventListener('online', enviar);
      document.removeEventListener('visibilitychange', alVolver);
      clearInterval(reloj);
    };
  }, [usuarioId, enviar]);

  return { ...estado, enviando, enviarAhora: enviar, version };
}
