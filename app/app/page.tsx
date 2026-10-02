'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Esqueleto, ErrorVista } from '@/components/Estados';
import { Boton } from '@/components/Boton';
import { useSesion } from '@/lib/sesion';

// Entrada: cada rol va a su lugar. El operario a sus órdenes; el resto, al panel de gestión.
export default function Inicio() {
  const router = useRouter();
  const { perfil, cargando, error, entraAGestion, recargar, salir } = useSesion();

  useEffect(() => {
    if (cargando || error) return;
    if (!perfil) router.replace('/login');
    // Sin señal solo está disponible el portal de campo, que está guardado en el teléfono:
    // se entra con una carga directa, sin pedirle nada al servidor.
    else if (!navigator.onLine) window.location.replace('/mis-ots');
    else router.replace(entraAGestion ? '/gestion' : '/mis-ots');
  }, [cargando, error, perfil, entraAGestion, router]);

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      {error ? (
        <>
          <ErrorVista mensaje={error} onReintentar={recargar} />
          <Boton variante="fantasma" ancho onClick={salir}>
            Salir e ingresar con otro usuario
          </Boton>
        </>
      ) : (
        <Esqueleto filas={2} />
      )}
    </main>
  );
}
