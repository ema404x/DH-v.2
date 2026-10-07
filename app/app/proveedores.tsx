'use client';

import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { SesionProvider } from '@/lib/sesion';

// Avisos como en la v1: arriba al centro, con colores fuertes y botón de cerrar.
export function Proveedores({ children }: { children: ReactNode }) {
  return (
    <SesionProvider>
      {children}
      <Toaster position="top-center" richColors closeButton />
    </SesionProvider>
  );
}
