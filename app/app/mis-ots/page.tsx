'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardCheck, LayoutDashboard, LogOut, QrCode, RefreshCw, Siren, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Boton, BotonEnlace } from '@/components/Boton';
import { DetalleOT } from '@/components/DetalleOT';
import { EstadoCola } from '@/components/EstadoCola';
import { TarjetaFichaje } from '@/components/Fichaje';
import { useTablet } from '@/lib/tablet';
import { AvisoOffline, ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { OTCard } from '@/components/OTCard';
import { ScannerModal } from '@/components/ScannerModal';
import { listarMisOTs, resolverQRLocal } from '@/lib/ot';
import { useCola } from '@/lib/offline/useCola';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

// Cambia los parámetros de la dirección sin pedirle nada al servidor: así abrir una orden,
// volver a la lista o filtrar por un QR funciona igual sin señal. Next lo refleja en useSearchParams.
function irA(params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  window.history.pushState(null, '', q ? `/mis-ots?${q}` : '/mis-ots');
}

// Portal del operario: sus órdenes y las libres del sector. Con un QR escaneado,
// las órdenes abiertas de esa ubicación o equipo. Todo el trabajo de campo pasa en esta página.
function MisOrdenes() {
  const router = useRouter();
  const params = useSearchParams();
  const { perfil, sectorEfectivo, cargando: cargandoSesion, error: errorSesion, entraAGestion, puedeValidar, salir } = useSesion();
  const [escaneando, setEscaneando] = useState(false);
  const cola = useCola(perfil?.id);

  const abierta = params.get('ot');
  const ubicacion = params.get('ubicacion') ?? undefined;
  const activo = params.get('activo') ?? undefined;
  const nombreFiltro = params.get('nombre');
  const conFiltro = !!(ubicacion || activo);
  const filtro = useMemo(() => {
    const f: Record<string, string> = {};
    if (ubicacion) f.ubicacion = ubicacion;
    if (activo) f.activo = activo;
    if (nombreFiltro) f.nombre = nombreFiltro;
    return f;
  }, [ubicacion, activo, nombreFiltro]);

  // Sin sesión: al ingreso. (Esta página no pasa por el control del servidor para poder abrir sin señal.)
  useEffect(() => {
    if (!cargandoSesion && !errorSesion && !perfil) router.replace('/login');
  }, [cargandoSesion, errorSesion, perfil, router]);

  const quien = useMemo(() => (perfil ? { id: perfil.id, nombre: perfil.nombre } : null), [perfil]);
  // Tablet de cuadrilla: en vez de "mis órdenes", muestra las de los lugares de su jefe de sitio.
  const { tablet, lista: tabletLista } = useTablet(perfil?.id);
  const jefe = tablet?.jefe_sitio_id;
  // Se recarga al volver de una orden y cada vez que la cola envió algo.
  const carga = useCarga(
    async () => (quien && tabletLista ? listarMisOTs(quien, { ubicacion, activo, jefe }) : null),
    [quien, tabletLista, jefe, ubicacion, activo, cola.version, abierta === null],
  );

  // El QR se busca primero en las órdenes guardadas en el teléfono (sirve sin señal).
  // Si no está ahí y hay señal, lo resuelve el servidor.
  const alLeer = useCallback(
    async (token: string) => {
      setEscaneando(false);
      const local = await resolverQRLocal(token).catch(() => null);
      if (local) {
        irA({ [local.tipo]: local.id, nombre: local.nombre });
      } else if (navigator.onLine) {
        router.push(`/q?t=${encodeURIComponent(token)}`);
      } else {
        toast.error('Sin señal: ese QR no es de ninguna de las órdenes guardadas en el teléfono.');
      }
    },
    [router],
  );
  const cerrarScanner = useCallback(() => setEscaneando(false), []);

  if (abierta) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <DetalleOT id={abierta} onVolver={() => irA(filtro)} />
      </main>
    );
  }

  const ots = carga.datos?.ots ?? [];

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4 pb-28">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1>{tablet ? 'Órdenes de la cuadrilla' : 'Mis órdenes'}</h1>
          <p className="truncate text-sm text-suave">
            {tablet
              ? `${tablet.nombre} · cuadrilla de ${tablet.jefe_sitio_nombre ?? 'su jefe de sitio'}`
              : perfil ? `${perfil.nombre} · ${sectorEfectivo?.nombre ?? 'Sin sector'}` : ' '}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {entraAGestion && (
            <BotonEnlace href="/gestion" variante="fantasma" icono={LayoutDashboard}>
              Gestión
            </BotonEnlace>
          )}
          <Boton variante="fantasma" icono={LogOut} onClick={salir}>
            Salir
          </Boton>
        </div>
      </header>

      <AvisoOffline guardadas={carga.datos?.guardadas} />
      <EstadoCola cola={cola} />

      {/* Fichaje: cada uno el suyo; la tablet (y quien tiene gente a cargo) ficha a la cuadrilla. */}
      {perfil && tabletLista && !tablet && (
        <TarjetaFichaje usuarioId={perfil.id} lugar={ubicacion ? { id: ubicacion, nombre: nombreFiltro ?? 'este lugar' } : undefined} />
      )}
      {(tablet || puedeValidar) && (
        <BotonEnlace href="/cuadrilla" icono={Users} campo={!!tablet} ancho>
          {tablet ? 'Fichar a la cuadrilla' : 'Fichar a mi gente'}
        </BotonEnlace>
      )}

      <BotonEnlace href="/emergencia" variante="peligro" icono={Siren} ancho>
        Reportar una emergencia
      </BotonEnlace>

      {/* Lo del equipo (con señal): foro, ayuda, avisar un problema y el perfil propio. */}
      {!tablet && (
        <nav aria-label="Equipo" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/gestion/foro" className="inline-flex min-h-control items-center text-primario hover:underline">Foro</Link>
          <Link href="/gestion/ayuda" className="inline-flex min-h-control items-center text-primario hover:underline">Ayuda</Link>
          <Link href="/gestion/sugerencias" className="inline-flex min-h-control items-center text-primario hover:underline">Avisar un problema</Link>
          <Link href="/gestion/perfil" className="inline-flex min-h-control items-center text-primario hover:underline">Mi perfil</Link>
        </nav>
      )}

      {conFiltro && (
        <div className="flex items-center justify-between gap-2 rounded border border-info/40 bg-info/10 py-1 pl-3 text-info">
          <p className="min-w-0 truncate">
            <QrCode className="mr-2 inline h-5 w-5" aria-hidden />
            Órdenes de: <strong>{nombreFiltro ?? 'lo que escaneaste'}</strong>
          </p>
          <Boton variante="fantasma" icono={X} onClick={() => irA({})}>
            Ver todas
          </Boton>
        </div>
      )}

      {errorSesion ? (
        <ErrorVista mensaje={errorSesion} />
      ) : cargandoSesion || !tabletLista || (carga.cargando && !carga.datos) ? (
        <Esqueleto filas={4} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : ots.length === 0 ? (
        <Vacio
          icono={ClipboardCheck}
          titulo={conFiltro ? 'No hay órdenes abiertas acá' : tablet ? 'La cuadrilla está al día' : 'No tenés órdenes pendientes'}
          texto={
            carga.datos?.guardadas
              ? 'No hay órdenes guardadas en el teléfono. Cuando tengas señal, abrí esta pantalla para que se carguen.'
              : conFiltro
                ? 'Este lugar o equipo no tiene trabajos abiertos. Si encontraste un problema, avisale a tu jefe de sitio para que cargue la orden.'
                : tablet
                  ? 'No hay órdenes abiertas en los lugares de este jefe de sitio. Cuando cargue una, va a aparecer acá.'
                  : 'Cuando te asignen un trabajo o haya uno libre en tu sector, va a aparecer acá. También podés escanear el QR del lugar.'
          }
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-suave">{ots.length === 1 ? '1 orden' : `${ots.length} órdenes`}</p>
            <Boton variante="fantasma" icono={RefreshCw} cargando={carga.cargando} onClick={carga.recargar}>
              Actualizar
            </Boton>
          </div>
          <ul className="space-y-3">
            {ots.map((ot) => (
              <li key={ot.id}>
                <OTCard ot={ot} miId={perfil?.id} onAbrir={(id) => irA({ ...filtro, ot: id })} />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t bg-barra p-3">
        <div className="mx-auto max-w-xl">
          <Boton variante="primario" icono={QrCode} campo ancho onClick={() => setEscaneando(true)}>
            Escanear QR
          </Boton>
        </div>
      </div>

      {escaneando && <ScannerModal onToken={alLeer} onCerrar={cerrarScanner} />}
    </main>
  );
}

export default function Pagina() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl p-4"><Esqueleto filas={4} /></main>}>
      <MisOrdenes />
    </Suspense>
  );
}
