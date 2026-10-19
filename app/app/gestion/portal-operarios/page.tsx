'use client';

import { KeyRound } from 'lucide-react';
import { Vacio } from '@/components/Estados';
import { PortalOperarios } from '@/components/gestion/PortalOperarios';
import { useSesion } from '@/lib/sesion';

// Portal de operarios sin usuario (fase 16): clave del sector, prender/apagar y registro. Solo el admin.
export default function PaginaPortalOperarios() {
  const { perfil, sectorEfectivo } = useSesion();
  if (perfil && perfil.rol !== 'admin') return <Vacio icono={KeyRound} titulo="Solo el admin" texto="El portal de operarios lo configura el admin." />;
  return (
    <>
      <header>
        <h1>Portal de operarios</h1>
        <p className="text-suave">{sectorEfectivo?.nombre ?? ''}</p>
      </header>
      <PortalOperarios sectorId={sectorEfectivo?.id} />
    </>
  );
}
