'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AlertaEmergencias } from '@/components/Emergencias';
import { BuscadorGlobal } from '@/components/gestion/BuscadorGlobal';
import { Marco } from '@/components/layout/Marco';
import { ErrorVista, Esqueleto } from '@/components/Estados';
import { useSesion } from '@/lib/sesion';

// Secciones abiertas a todos (también al operario, que no entra al resto de gestión).
const PARA_TODOS = ['/gestion/foro', '/gestion/sugerencias', '/gestion/perfil', '/gestion/ayuda'];

// Marco del panel de gestión. El operario no entra: se lo lleva a sus órdenes.
// (Es navegación: aunque entrara, la base no le dejaría escribir nada de gestión.)
export default function GestionLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const ruta = usePathname();
  const { perfil, cargando, error, entraAGestion, recargar } = useSesion();
  const libre = PARA_TODOS.some((p) => ruta === p || ruta.startsWith(`${p}/`));

  useEffect(() => {
    if (!cargando && perfil && !entraAGestion && !libre) router.replace('/mis-ots');
  }, [cargando, perfil, entraAGestion, libre, router]);

  if (error) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <ErrorVista mensaje={error} onReintentar={recargar} />
      </main>
    );
  }
  if (cargando || !perfil || (!entraAGestion && !libre)) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <Esqueleto filas={3} />
      </main>
    );
  }

  // El operario ve estas secciones con un marco simple y la vuelta a sus órdenes.
  if (!entraAGestion) {
    return (
      <main className="mx-auto max-w-3xl space-y-5 p-4">
        <Link href="/mis-ots" className="inline-flex min-h-control items-center gap-2 text-primario hover:underline"><ArrowLeft className="h-5 w-5" aria-hidden />Mis órdenes</Link>
        {children}
      </main>
    );
  }

  return (
    <Marco extra={<><AlertaEmergencias /><BuscadorGlobal /></>}>
      {children}
    </Marco>
  );
}
