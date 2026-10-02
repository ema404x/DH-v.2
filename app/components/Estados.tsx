'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react';
import { Boton } from './Boton';

// Los cuatro estados de toda vista: cargando, vacío, error y datos.
// Estos tres componentes cubren los primeros; los datos los pone cada pantalla.

export function Esqueleto({ filas = 3 }: { filas?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Cargando">
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="tarjeta space-y-3">
          <div className="esqueleto h-5 w-2/3" />
          <div className="esqueleto h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function Vacio({ titulo, texto, icono: Icono = Inbox, children }: { titulo: string; texto: string; icono?: LucideIcon; children?: ReactNode }) {
  return (
    <div className="tarjeta flex flex-col items-center gap-3 py-10 text-center">
      <Icono className="h-10 w-10 text-suave" aria-hidden />
      <h2>{titulo}</h2>
      <p className="max-w-md text-suave">{texto}</p>
      {children}
    </div>
  );
}

export function ErrorVista({ mensaje, onReintentar }: { mensaje: string; onReintentar?: () => void }) {
  return (
    <div className="tarjeta flex flex-col items-center gap-3 border-peligro/40 py-10 text-center" role="alert">
      <AlertTriangle className="h-10 w-10 text-peligro" aria-hidden />
      <h2>No se pudo cargar</h2>
      <p className="max-w-md text-suave">{mensaje}</p>
      {onReintentar && (
        <Boton icono={RefreshCw} onClick={onReintentar}>
          Probar de nuevo
        </Boton>
      )}
    </div>
  );
}

// Aviso fijo de "sin señal". No recarga nada: solo informa.
export function AvisoOffline({ guardadas = false }: { guardadas?: boolean }) {
  const [sinSenal, setSinSenal] = useState(false);

  useEffect(() => {
    const actualizar = () => setSinSenal(!navigator.onLine);
    actualizar();
    window.addEventListener('online', actualizar);
    window.addEventListener('offline', actualizar);
    return () => {
      window.removeEventListener('online', actualizar);
      window.removeEventListener('offline', actualizar);
    };
  }, []);

  if (!sinSenal && !guardadas) return null;
  return (
    <div className="flex items-center gap-2 rounded border border-alerta/40 bg-alerta/10 px-3 py-2 text-sm text-alerta" role="status">
      <WifiOff className="h-5 w-5 shrink-0" aria-hidden />
      <span>Sin señal. Estás viendo lo último que se había cargado; para guardar cambios hace falta conexión.</span>
    </div>
  );
}
