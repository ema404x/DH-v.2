'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, Bell, Boxes, CalendarCheck, CheckCircle2, ClipboardCheck, ClipboardList, Flame, Plus, PlayCircle, Wrench, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Boton, BotonEnlace } from '@/components/Boton';
import { ErrorVista, Esqueleto } from '@/components/Estados';
import { generarPreventivos, obtenerKpis } from '@/lib/gestion';
import { listarAlertas, obtenerBandeja } from '@/lib/control';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

interface PropsIndicador {
  titulo: string;
  valor: number;
  icono: LucideIcon;
  href: string;
  // se resalta solo cuando hay algo que atender
  alerta?: boolean;
}

function Indicador({ titulo, valor, icono: Icono, href, alerta }: PropsIndicador) {
  const resaltar = alerta && valor > 0;
  return (
    <Link href={href} className={`tarjeta flex items-center gap-3 transition-colors hover:border-primario/60 ${resaltar ? 'border-alerta/50' : ''}`}>
      <Icono className={`h-8 w-8 shrink-0 ${resaltar ? 'text-alerta' : 'text-suave'}`} aria-hidden />
      <div>
        <p className="num text-left text-2xl font-bold">{valor}</p>
        <p className="text-sm text-suave">{titulo}</p>
      </div>
    </Link>
  );
}

export default function Tablero() {
  const { sectorEfectivo, puedeValidar } = useSesion();
  const kpis = useCarga(obtenerKpis, []);
  // Si la fase 11 todavía no está en la base, estas dos cargas fallan y la sección no aparece.
  const bandeja = useCarga(obtenerBandeja, []);
  const criticas = useCarga(async () => (await listarAlertas()).filter((a) => a.nivel === 'critica').slice(0, 6), []);
  const [generando, setGenerando] = useState(false);

  async function preventivos() {
    setGenerando(true);
    try {
      const n = await generarPreventivos(7);
      toast.success(n === 0 ? 'No hay preventivos nuevos para los próximos 7 días.' : n === 1 ? 'Se generó 1 orden preventiva.' : `Se generaron ${n} órdenes preventivas.`);
      await kpis.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setGenerando(false);
    }
  }

  const k = kpis.datos;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Tablero</h1>
          <p className="text-suave">{sectorEfectivo?.nombre ?? 'Sin sector'}</p>
        </div>
        {puedeValidar && (
          <BotonEnlace href="/gestion/ots/nueva" variante="primario" icono={Plus}>
            Nueva orden
          </BotonEnlace>
        )}
      </header>

      {kpis.cargando && !k ? (
        <Esqueleto filas={3} />
      ) : kpis.error || !k ? (
        <ErrorVista mensaje={kpis.error ?? 'No se pudieron cargar los indicadores.'} onReintentar={kpis.recargar} />
      ) : (
        <>
          {bandeja.datos && (
            <section aria-label="Para atender" className="tarjeta space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2>Para atender</h2>
                <Link href="/gestion/alertas" className="inline-flex min-h-control items-center gap-2 text-sm text-primario hover:underline">
                  <Bell className="h-4 w-4" aria-hidden />{bandeja.datos.alertas} {bandeja.datos.alertas === 1 ? 'alerta' : 'alertas'}
                </Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  ['ots_por_validar', 'órdenes a validar', '/gestion/ots?estado=pendiente_validacion'],
                  ['certificados_por_aprobar', 'certificados por aprobar', '/gestion/certificacion'],
                  ['solicitudes_por_revisar', 'solicitudes de certificado', '/gestion/solicitudes'],
                  ['requerimientos_por_revisar', 'requerimientos para revisar', '/gestion/requerimientos'],
                  ['requerimientos_en_compra', 'compras por recibir', '/gestion/requerimientos'],
                  ['informes_por_vencer', 'informes por vencer', '/gestion/informes'],
                ] as const).filter(([k]) => bandeja.datos![k] > 0).map(([k, texto, href]) => (
                  <Link key={k} href={href} className="inline-flex min-h-control items-center gap-2 rounded border border-alerta/40 bg-alerta/10 px-3 text-sm font-medium text-alerta hover:bg-alerta/20">
                    <span className="num font-bold">{bandeja.datos![k]}</span> {texto}
                  </Link>
                ))}
                {(['ots_por_validar', 'certificados_por_aprobar', 'solicitudes_por_revisar', 'requerimientos_por_revisar', 'requerimientos_en_compra', 'informes_por_vencer'] as const)
                  .every((k) => bandeja.datos![k] === 0) && <p className="text-suave">Nada esperando una acción.</p>}
              </div>
              {(criticas.datos ?? []).length > 0 && (
                <ul className="space-y-1">
                  {(criticas.datos ?? []).map((a) => (
                    <li key={a.clave} className="flex items-start gap-2 text-sm">
                      <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-peligro" aria-hidden />
                      <Link href={a.enlace} className="text-primario hover:underline">{a.titulo}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section aria-label="Órdenes de trabajo" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Indicador titulo="A validar" valor={k.por_validar} icono={ClipboardCheck} href="/gestion/ots?estado=pendiente_validacion" alerta />
            <Indicador titulo="Vencidas" valor={k.vencidas} icono={AlertTriangle} href="/gestion/ots?estado=abiertas" alerta />
            <Indicador titulo="Urgentes abiertas" valor={k.urgentes} icono={Flame} href="/gestion/ots?estado=abiertas" alerta />
            <Indicador titulo="En curso" valor={k.en_progreso} icono={PlayCircle} href="/gestion/ots?estado=en_progreso" />
            <Indicador titulo="Sin asignar" valor={k.pendientes} icono={ClipboardList} href="/gestion/ots?estado=pendiente" />
            <Indicador titulo="Asignadas" valor={k.asignadas} icono={ClipboardList} href="/gestion/ots?estado=asignada" />
            <Indicador titulo="Completadas este mes" valor={k.completadas_mes} icono={CheckCircle2} href="/gestion/ots?estado=completada" />
            <Indicador titulo="Activos" valor={k.activos} icono={Boxes} href="/gestion/activos" />
          </section>

          <section className="tarjeta space-y-3">
            <h2>Mantenimiento preventivo</h2>
            <div className="grid grid-cols-2 gap-3 lg:max-w-xl">
              <div className="flex items-center gap-3">
                <CalendarCheck className={`h-8 w-8 shrink-0 ${k.preventivos_por_vencer > 0 ? 'text-alerta' : 'text-suave'}`} aria-hidden />
                <div>
                  <p className="text-2xl font-bold">{k.preventivos_por_vencer}</p>
                  <p className="text-sm text-suave">Vencen en 7 días o ya vencieron</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Wrench className={`h-8 w-8 shrink-0 ${k.fuera_de_servicio > 0 ? 'text-peligro' : 'text-suave'}`} aria-hidden />
                <div>
                  <p className="text-2xl font-bold">{k.fuera_de_servicio}</p>
                  <p className="text-sm text-suave">Equipos fuera de servicio</p>
                </div>
              </div>
            </div>
            {puedeValidar && (
              <>
                <p className="text-suave">
                  Crea una orden preventiva por cada equipo cuyo mantenimiento vence en los próximos 7 días. Se puede tocar las veces que haga falta: no duplica órdenes.
                </p>
                <Boton icono={CalendarCheck} cargando={generando} onClick={preventivos}>
                  Generar órdenes preventivas
                </Boton>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
