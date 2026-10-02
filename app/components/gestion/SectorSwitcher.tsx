'use client';

import { useState } from 'react';
import { Building2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useSesion } from '@/lib/sesion';
import { cambiarSectorActivo, setVerTodos } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';

// Sector en el que está parado el usuario. Siempre a la vista.
// Gerente general y admin pueden cambiarlo (de a uno); "ver todos" es un interruptor aparte, solo del admin.
// Después de cambiar se recarga la pantalla entera: no puede quedar nada del sector anterior en memoria.
export function SectorSwitcher() {
  const { perfil, sectores, sectorEfectivo } = useSesion();
  const [ocupado, setOcupado] = useState(false);

  if (!perfil) return null;
  const puedeCambiar = perfil.rol === 'admin' || perfil.rol === 'gerente_general';

  async function aplicar(accion: () => Promise<void>) {
    setOcupado(true);
    try {
      await accion();
      window.location.reload();
    } catch (e) {
      toast.error(limpiarError(e));
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-2 rounded border bg-superficie p-3">
      <label className="flex items-center gap-2 text-xs font-medium text-suave" htmlFor="sector-activo">
        <Building2 className="h-4 w-4" aria-hidden />
        Sector
      </label>
      {puedeCambiar ? (
        <select
          id="sector-activo"
          className="control"
          disabled={ocupado}
          value={sectorEfectivo?.id ?? ''}
          onChange={(e) => aplicar(() => cambiarSectorActivo(e.target.value))}
        >
          {sectores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      ) : (
        <p id="sector-activo" className="font-semibold">
          {sectorEfectivo?.nombre ?? 'Sin sector'}
        </p>
      )}

      {perfil.rol === 'admin' && (
        <label className="flex min-h-control cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-6 w-6 shrink-0 accent-primario"
            checked={perfil.ver_todos}
            disabled={ocupado}
            onChange={(e) => aplicar(() => setVerTodos(e.target.checked))}
          />
          <span className="flex items-center gap-1.5">
            <Eye className="h-4 w-4" aria-hidden />
            Ver todos los sectores
          </span>
        </label>
      )}
      {perfil.ver_todos && (
        <p className="rounded border border-alerta/40 bg-alerta/10 px-2 py-1 text-xs text-alerta">
          Estás viendo todos los sectores juntos. Lo que crees se guarda en {sectorEfectivo?.nombre ?? 'tu sector'}.
        </p>
      )}
    </div>
  );
}
