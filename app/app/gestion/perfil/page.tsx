'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo } from '@/components/Campos';
import { ErrorVista, Esqueleto } from '@/components/Estados';
import { FirmaCanvas } from '@/components/FirmaCanvas';
import { cambiarMiClave, guardarMiPerfil, obtenerMiPerfil } from '@/lib/admin';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { ROLES } from '@/lib/types';

// Mi perfil: nombre, teléfono, especialidad, firma (la usan los certificados) y contraseña. (En la v1 "Mi perfil"
// llevaba a la lista de empleados.)
export default function Perfil() {
  const { perfil, sectorEfectivo, recargar } = useSesion();
  const carga = useCarga(async () => (perfil ? obtenerMiPerfil(perfil.id) : null), [perfil?.id]);
  const [f, setF] = useState({ nombre: '', telefono: '', especialidad: '' });
  const [firma, setFirma] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [clave, setClave] = useState({ nueva: '', repetir: '' });
  const [cambiando, setCambiando] = useState(false);

  useEffect(() => {
    if (!carga.datos) return;
    setF({ nombre: carga.datos.nombre, telefono: carga.datos.telefono ?? '', especialidad: carga.datos.especialidad ?? '' });
    setFirma(carga.datos.firma_url);
  }, [carga.datos]);

  if (!perfil || (carga.cargando && !carga.datos)) return <Esqueleto filas={4} />;
  if (carga.error || !carga.datos) return <ErrorVista mensaje={carga.error ?? 'No se pudo cargar tu perfil.'} onReintentar={carga.recargar} />;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!perfil) return;
    setGuardando(true);
    try {
      await guardarMiPerfil(perfil.id, { nombre: f.nombre.trim(), telefono: f.telefono.trim() || null, especialidad: f.especialidad.trim() || null, firma_url: firma });
      toast.success('Perfil guardado.');
      await recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function nuevaClave(e: FormEvent) {
    e.preventDefault();
    if (clave.nueva.length < 8) { toast.error('La contraseña tiene que tener al menos 8 caracteres.'); return; }
    if (clave.nueva !== clave.repetir) { toast.error('Las dos contraseñas no coinciden.'); return; }
    setCambiando(true);
    try {
      await cambiarMiClave(clave.nueva);
      toast.success('Contraseña cambiada.');
      setClave({ nueva: '', repetir: '' });
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setCambiando(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <header>
        <h1>Mi perfil</h1>
        <p className="text-suave">{carga.datos.email} · {ROLES[perfil.rol]} · {sectorEfectivo?.nombre}</p>
      </header>
      <form onSubmit={guardar} className="space-y-4">
        <section className="tarjeta space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Campo etiqueta="Nombre" required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
            <Campo etiqueta="Teléfono" type="tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} />
            <Campo etiqueta="Especialidad" value={f.especialidad} onChange={(e) => setF({ ...f, especialidad: e.target.value })} />
          </div>
        </section>
        <section className="tarjeta space-y-3">
          <h2>Mi firma</h2>
          <p className="text-sm text-suave">Se usa al aprobar certificados. Dibujala con el dedo o el mouse.</p>
          <FirmaCanvas inicial={carga.datos.firma_url} onCambio={setFirma} />
        </section>
        <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar</Boton>
      </form>
      <form onSubmit={nuevaClave} className="tarjeta space-y-4">
        <h2>Cambiar mi contraseña</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Campo etiqueta="Contraseña nueva" type="password" autoComplete="new-password" value={clave.nueva} onChange={(e) => setClave({ ...clave, nueva: e.target.value })} />
          <Campo etiqueta="Repetila" type="password" autoComplete="new-password" value={clave.repetir} onChange={(e) => setClave({ ...clave, repetir: e.target.value })} />
        </div>
        <Boton type="submit" icono={KeyRound} cargando={cambiando}>Cambiar contraseña</Boton>
      </form>
    </div>
  );
}
