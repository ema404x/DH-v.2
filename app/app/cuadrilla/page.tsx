'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogIn, LogOut, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Boton, BotonEnlace } from '@/components/Boton';
import { AvisoOffline, ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { avisarFichaje } from '@/components/Fichaje';
import { limpiarError } from '@/lib/errores';
import { fichar, textoEstado, useFichaje } from '@/lib/fichaje';
import { listarEmpleados, type Empleado } from '@/lib/gente';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { useTablet } from '@/lib/tablet';

// Fichaje de la cuadrilla: la tablet (o el jefe de sitio desde su teléfono) marca la entrada y la salida de
// la gente que no tiene usuario propio. Queda anotado quién cargó cada marca.
export default function Cuadrilla() {
  const router = useRouter();
  const { perfil, cargando: cargandoSesion, puedeValidar, esGerencia } = useSesion();
  const { tablet, lista } = useTablet(perfil?.id);
  const cola = useFichaje(perfil?.id);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Marcas hechas en esta pantalla y todavía no reflejadas en la lista (o guardadas sin señal).
  const [locales, setLocales] = useState<Record<string, { tipo: 'entrada' | 'salida'; momento: string }>>({});

  useEffect(() => {
    if (!cargandoSesion && !perfil) router.replace('/login');
  }, [cargandoSesion, perfil, router]);

  // De quién es la cuadrilla: la tablet, la de su jefe; un jefe de sitio, la suya; gerencia, todo el sector.
  const jefe = tablet?.jefe_sitio_id ?? (puedeValidar && !esGerencia ? perfil?.id : undefined);
  const permitido = !!tablet || puedeValidar;
  const carga = useCarga(async () => (lista && permitido ? listarEmpleados() : null), [lista, permitido]);

  const gente = useMemo(
    () => (carga.datos ?? []).filter((e) => e.estado !== 'inactivo' && (!jefe || e.jefe_sitio_id === jefe) && e.perfil_id !== perfil?.id),
    [carga.datos, jefe, perfil?.id],
  );

  async function marcar(e: Empleado, tipo: 'entrada' | 'salida') {
    if (!perfil) return;
    setOcupado(e.id);
    try {
      const r = await fichar(perfil.id, { tipo, empleado_id: e.id, empleado_nombre: e.nombre });
      avisarFichaje(r);
      setLocales((l) => ({ ...l, [e.id]: { tipo, momento: r.destino === 'enviado' ? r.resultado.momento : r.marca.momento } }));
      if (r.destino === 'enviado') void carga.recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setOcupado(null);
    }
  }

  const titulo = tablet ? `Cuadrilla de ${tablet.jefe_sitio_nombre ?? 'su jefe de sitio'}` : esGerencia ? 'Personal del sector' : 'Mi gente';

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <BotonEnlace href="/mis-ots" variante="fantasma" icono={ArrowLeft}>Volver a las órdenes</BotonEnlace>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1>Fichaje</h1>
          <p className="truncate text-sm text-suave">{titulo}</p>
        </div>
        <Boton variante="fantasma" icono={RefreshCw} cargando={carga.cargando} onClick={carga.recargar}>Actualizar</Boton>
      </header>

      <AvisoOffline />
      {cola.pendientes > 0 && (
        <p className="rounded border border-alerta/40 bg-alerta/10 px-3 py-2 text-sm text-alerta" role="status">
          {cola.pendientes === 1 ? '1 marca guardada en este equipo, falta enviar.' : `${cola.pendientes} marcas guardadas en este equipo, falta enviar.`} Se envían solas al volver la señal.
        </p>
      )}
      {cola.rechazo && <p className="rounded border border-peligro/40 bg-peligro/10 px-3 py-2 text-sm text-peligro" role="alert">{cola.rechazo}</p>}

      {cargandoSesion || !lista || (carga.cargando && !carga.datos) ? (
        <Esqueleto filas={4} />
      ) : !permitido ? (
        <Vacio icono={Users} titulo="Esta pantalla es para fichar a otros" texto="La usan la tablet de la cuadrilla, los jefes de sitio y gerencia. Tu fichaje lo hacés desde Mis órdenes." />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : gente.length === 0 ? (
        <Vacio icono={Users} titulo="No hay gente cargada en esta cuadrilla"
          texto="En Gestión → Empleados, a cada persona se le indica su jefe de sitio. Las que tengan a este jefe aparecen acá." />
      ) : (
        <ul className="space-y-3">
          {gente.map((e) => {
            const local = locales[e.id];
            const ultimo = local && (!e.ultimo_fichaje_momento || local.momento >= e.ultimo_fichaje_momento)
              ? { tipo: local.tipo, momento: local.momento, lugar: null }
              : { tipo: e.ultimo_fichaje_tipo, momento: e.ultimo_fichaje_momento, lugar: e.ultimo_fichaje_lugar };
            const adentro = ultimo.tipo === 'entrada';
            return (
              <li key={e.id} className={`tarjeta flex flex-wrap items-center justify-between gap-3 ${adentro ? 'border-exito/50' : ''}`}>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{e.nombre}</p>
                  <p className="truncate text-sm text-suave">{[e.puesto, e.estado !== 'activo' ? (e.estado === 'licencia' ? 'de licencia' : 'de vacaciones') : null].filter(Boolean).join(' · ') || 'Sin puesto cargado'}</p>
                  <p className={`text-sm ${adentro ? 'text-exito' : 'text-suave'}`}>{textoEstado(ultimo).replace('Todavía no fichaste.', 'Todavía no fichó.')}</p>
                </div>
                <Boton campo icono={adentro ? LogOut : LogIn} cargando={ocupado === e.id} disabled={!!ocupado}
                  onClick={() => marcar(e, adentro ? 'salida' : 'entrada')}>
                  {adentro ? 'Salida' : 'Entrada'}
                </Boton>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
