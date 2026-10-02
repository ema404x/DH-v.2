'use client';

import { useEffect, useState } from 'react';
import { miTablet, type MiTablet } from './gente';

// ¿El usuario que ingresó es el de una tablet de cuadrilla? Lo dice la base; el teléfono guarda la última
// respuesta para que el portal abra igual sin señal.

const CACHE = 'dh1:tablet';

function guardada(usuarioId: string): MiTablet | null | undefined {
  try {
    const g = JSON.parse(localStorage.getItem(CACHE) ?? 'null') as { usuario_id: string; tablet: MiTablet | null } | null;
    return g && g.usuario_id === usuarioId ? g.tablet : undefined;
  } catch {
    return undefined;
  }
}

// `lista` pasa a true cuando ya se sabe (por la base o por lo guardado) si es una tablet o no.
export function useTablet(usuarioId: string | undefined): { tablet: MiTablet | null; lista: boolean } {
  const [tablet, setTablet] = useState<MiTablet | null>(null);
  const [lista, setLista] = useState(false);

  useEffect(() => {
    if (!usuarioId) return;
    let vigente = true;
    const previa = guardada(usuarioId);
    if (previa !== undefined) {
      setTablet(previa);
      setLista(true);
    }
    miTablet()
      .then((t) => {
        if (!vigente) return;
        localStorage.setItem(CACHE, JSON.stringify({ usuario_id: usuarioId, tablet: t }));
        setTablet(t);
      })
      .catch(() => undefined)
      .finally(() => vigente && setLista(true));
    return () => {
      vigente = false;
    };
  }, [usuarioId]);

  return { tablet, lista };
}
