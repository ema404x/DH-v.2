'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { limpiarError } from './errores';

export interface Carga<T> {
  datos: T | null;
  cargando: boolean;
  error: string | null;
  recargar: () => Promise<void>;
  setDatos: (d: T | null) => void;
}

// Una carga de datos con sus cuatro estados: cargando, error, vacío (lo decide la vista) y datos.
export function useCarga<T>(cargar: () => Promise<T>, deps: unknown[]): Carga<T> {
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const turno = useRef(0);

  const recargar = useCallback(async () => {
    const mio = ++turno.current;
    setCargando(true);
    setError(null);
    try {
      const d = await cargar();
      if (mio === turno.current) setDatos(d);
    } catch (e) {
      if (mio === turno.current) setError(limpiarError(e));
    } finally {
      if (mio === turno.current) setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return { datos, cargando, error, recargar, setDatos };
}
