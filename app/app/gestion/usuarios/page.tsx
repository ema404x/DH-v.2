'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, Send, UserPlus, UserX, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { Tabla, type Columna } from '@/components/gestion/Tabla';
import { actualizarUsuario, invitarUsuario, listarUsuarios } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { ROLES, type Perfil, type Rol } from '@/lib/types';

function FormInvitacion({ onListo, onCancelar }: { onListo: () => void; onCancelar: () => void }) {
  const { sectores, sectorEfectivo } = useSesion();
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<Rol>('operario');
  // El sector se elige siempre a conciencia: arranca en el sector activo, nunca en uno "por defecto".
  const [sector, setSector] = useState(sectorEfectivo?.id ?? '');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!sector) {
      toast.error('Elegí el sector del usuario.');
      return;
    }
    setEnviando(true);
    try {
      await invitarUsuario({ email: email.trim().toLowerCase(), nombre: nombre.trim(), rol, sector_id: sector });
      toast.success('Invitación enviada. Le llega un correo para crear su contraseña.');
      onListo();
    } catch (err) {
      toast.error(limpiarError(err));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="tarjeta space-y-4">
      <h2>Invitar usuario</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Campo etiqueta="Nombre y apellido" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Campo etiqueta="Correo" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Selector etiqueta="Rol" value={rol} onChange={(e) => setRol(e.target.value as Rol)} opciones={ROLES} />
        <Selector etiqueta="Sector" value={sector} onChange={(e) => setSector(e.target.value)}
          opciones={Object.fromEntries(sectores.map((s) => [s.id, s.nombre]))}
          ayuda="El usuario va a ver solo los datos de este sector." />
      </div>
      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Send} cargando={enviando}>
          Enviar invitación
        </Boton>
        <Boton variante="fantasma" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

// Usuarios del sector. Solo el administrador invita, cambia roles y da de baja.
export default function Usuarios() {
  const { perfil, sectores } = useSesion();
  const esAdmin = perfil?.rol === 'admin';
  const carga = useCarga(listarUsuarios, []);
  const [invitando, setInvitando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function cambiar(u: Perfil, cambios: Parameters<typeof actualizarUsuario>[1], exito: string) {
    setOcupado(u.id);
    try {
      await actualizarUsuario(u.id, cambios);
      toast.success(exito);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setOcupado(null);
    }
  }

  const columnas: Columna<Perfil>[] = [
    {
      titulo: 'Usuario',
      celda: (u) => (
        <>
          <span className="font-medium">{u.nombre}{u.id === perfil?.id ? ' (vos)' : ''}</span>
          <span className="block text-xs text-suave">{u.email}</span>
        </>
      ),
    },
    {
      titulo: 'Rol',
      celda: (u) =>
        esAdmin && u.id !== perfil?.id ? (
          <select className="control min-w-[10rem]" aria-label={`Rol de ${u.nombre}`} value={u.rol} disabled={ocupado === u.id}
            onChange={(e) => cambiar(u, { rol: e.target.value as Rol }, 'Rol actualizado.')}>
            {Object.entries(ROLES).map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        ) : (
          ROLES[u.rol]
        ),
    },
    { titulo: 'Sector', celda: (u) => sectores.find((s) => s.id === u.sector_id)?.nombre ?? '—', secundaria: true },
    {
      titulo: 'Acceso',
      celda: (u) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-sm ${u.activo ? 'text-exito' : 'text-suave'}`}>
            {u.activo ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <UserX className="h-4 w-4" aria-hidden />}
            {u.activo ? 'Activo' : 'Dado de baja'}
          </span>
          {esAdmin && u.id !== perfil?.id && (
            <Boton variante="fantasma" disabled={ocupado === u.id}
              onClick={() => cambiar(u, { activo: !u.activo }, u.activo ? 'Usuario dado de baja.' : 'Usuario reactivado.')}>
              {u.activo ? 'Dar de baja' : 'Reactivar'}
            </Boton>
          )}
        </div>
      ),
    },
  ];

  if (invitando) {
    return <FormInvitacion onCancelar={() => setInvitando(false)} onListo={() => { setInvitando(false); void carga.recargar(); }} />;
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Usuarios</h1>
        {esAdmin && (
          <Boton variante="primario" icono={UserPlus} onClick={() => setInvitando(true)}>
            Invitar usuario
          </Boton>
        )}
      </header>

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error || !carga.datos ? (
        <ErrorVista mensaje={carga.error ?? 'No se pudieron cargar los usuarios.'} onReintentar={carga.recargar} />
      ) : carga.datos.length === 0 ? (
        <Vacio icono={Users} titulo="No hay usuarios en este sector" texto="Invitá a la primera persona para que pueda ingresar." />
      ) : (
        <Tabla columnas={columnas} filas={carga.datos} clave={(u) => u.id} />
      )}
    </>
  );
}
