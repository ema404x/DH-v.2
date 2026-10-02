'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Esqueleto, ErrorVista } from '@/components/Estados';
import { BotonEnlace } from '@/components/Boton';
import { resolverQR } from '@/lib/qr';
import { limpiarError } from '@/lib/errores';
import { useSesion } from '@/lib/sesion';

// Destino de todo QR de DH1: /q?t=<token>. La base dice qué es (ubicación o activo) y solo si
// es del sector del usuario. Desde acá se lo lleva a la pantalla que corresponde.
function Resolver() {
  const router = useRouter();
  const token = useSearchParams().get('t');
  const { perfil, cargando, entraAGestion } = useSesion();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cargando || !perfil) return;
    if (!token) {
      setError('El código QR está incompleto. Escanealo de nuevo.');
      return;
    }
    let vigente = true;
    resolverQR(token)
      .then((d) => {
        if (!vigente) return;
        if (d.tipo === 'activo' && entraAGestion) router.replace(`/gestion/activos/${d.id}`);
        else router.replace(`/mis-ots?${d.tipo}=${d.id}&nombre=${encodeURIComponent(d.nombre)}`);
      })
      .catch((e) => vigente && setError(limpiarError(e)));
    return () => {
      vigente = false;
    };
  }, [token, perfil, cargando, entraAGestion, router]);

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorVista mensaje={error} />
        <BotonEnlace href="/mis-ots" campo ancho>
          Ir a Mis órdenes
        </BotonEnlace>
      </div>
    );
  }
  return <Esqueleto filas={2} />;
}

export default function PaginaQR() {
  return (
    <main className="mx-auto max-w-xl p-4">
      <Suspense fallback={<Esqueleto filas={2} />}>
        <Resolver />
      </Suspense>
    </main>
  );
}
