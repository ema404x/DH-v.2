'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { SesionProvider } from '@/lib/sesion';

export function Proveedores({ children }: { children: ReactNode }) {
  // En pantalla grande los avisos van abajo a la derecha: arriba taparían las pestañas y los botones del
  // encabezado. En el teléfono van arriba, porque abajo está el botón principal de la orden.
  const [grande, setGrande] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const medir = () => setGrande(mq.matches);
    medir();
    mq.addEventListener('change', medir);
    return () => mq.removeEventListener('change', medir);
  }, []);

  return (
    <SesionProvider>
      {children}
      <Toaster
        position={grande ? 'bottom-right' : 'top-center'}
        closeButton
        theme="dark"
        toastOptions={{
          classNames: {
            toast: '!bg-superficie !text-texto !border-borde !text-base',
            error: '!border-peligro/60',
            success: '!border-exito/60',
          },
        }}
      />
    </SesionProvider>
  );
}
