'use client';

import { useParams, useRouter } from 'next/navigation';
import { Printer } from 'lucide-react';
import { BotonEnlace } from '@/components/Boton';
import { DetalleOT } from '@/components/DetalleOT';
import { HorasOT } from '@/components/HorasOT';
import { MaterialesOT } from '@/components/MaterialesOT';
import { useSesion } from '@/lib/sesion';

// Una orden abierta por enlace directo (desde gestión). El operario la abre dentro de "Mis órdenes",
// sin cambiar de página, para que funcione sin señal. Acá, además, se cargan las horas y los materiales.
export default function PaginaOT() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { entraAGestion } = useSesion();
  return (
    // Abajo queda lugar para la barra fija con la acción de la orden.
    <main className="mx-auto max-w-xl space-y-4 p-4 pb-28">
      <DetalleOT id={id} onVolver={() => router.push('/mis-ots')} />
      <HorasOT otId={id} />
      <MaterialesOT otId={id} />
      {entraAGestion && (
        <div className="flex justify-end">
          <BotonEnlace href={`/ot/${id}/imprimir`} variante="fantasma" icono={Printer}>Imprimir la orden</BotonEnlace>
        </div>
      )}
    </main>
  );
}
