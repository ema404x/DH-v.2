'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Boton } from '@/components/Boton';
import { FormEmergencia } from '@/components/Emergencias';

// Reportar una emergencia desde el portal de campo. Cualquier persona del sector puede hacerlo.
// Necesita conexión: el aviso tiene que llegar en el momento.
export default function ReportarEmergencia() {
  const router = useRouter();
  const volver = () => router.push('/mis-ots');
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <Boton variante="fantasma" icono={ArrowLeft} onClick={volver}>Mis órdenes</Boton>
      <FormEmergencia onListo={volver} onCancelar={volver} />
    </main>
  );
}
