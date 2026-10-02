'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowRightLeft, CheckCircle2, History, Plus, Power } from 'lucide-react';
import { toast } from 'sonner';
import { Boton, BotonEnlace } from '@/components/Boton';
import { Selector } from '@/components/Campos';
import { AvisoBadge, EstadoActivoBadge, EstadoOTBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto } from '@/components/Estados';
import { fmtFecha } from '@/components/OTCard';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { QRImprimible } from '@/components/gestion/QRImprimible';
import { actualizarActivo, obtenerExpediente } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { CRITICIDADES, TIPOS_ACTIVO, type EstadoActivo, type HistorialActivo, type ResultadoBusqueda } from '@/lib/types';

const ESTADOS: Record<EstadoActivo, string> = {
  operativo: 'Operativo',
  en_mantenimiento: 'En mantenimiento',
  fuera_de_servicio: 'Fuera de servicio',
  baja: 'Dado de baja',
};

const ICONO_HISTORIAL: Record<HistorialActivo['tipo'], typeof History> = {
  alta: Plus,
  ot_completada: CheckCircle2,
  cambio_estado: Power,
  movimiento: ArrowRightLeft,
};

function Dato({ titulo, valor }: { titulo: string; valor: string | number | null }) {
  return (
    <div>
      <dt className="text-xs text-suave">{titulo}</dt>
      <dd>{valor || '—'}</dd>
    </div>
  );
}

// Expediente del activo: ficha, QR, componentes, órdenes e historial.
// El historial lo escribe la base sola (triggers): acá solo se lee.
export default function Expediente() {
  const { id } = useParams<{ id: string }>();
  const { puedeValidar } = useSesion();
  const carga = useCarga(() => obtenerExpediente(id), [id]);
  const [moviendo, setMoviendo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  if (carga.cargando && !carga.datos) return <Esqueleto filas={4} />;
  if (carga.error || !carga.datos) {
    return <ErrorVista mensaje={carga.error ?? 'El activo no existe o no es de tu sector.'} onReintentar={carga.recargar} />;
  }
  const { activo: a, historial, ordenes, componentes } = carga.datos;

  async function cambiar(cambios: Parameters<typeof actualizarActivo>[1], exito: string) {
    setOcupado(true);
    try {
      await actualizarActivo(id, cambios);
      toast.success(exito);
      setMoviendo(false);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <BotonEnlace href="/gestion/activos" variante="fantasma" icono={ArrowLeft}>
        Activos
      </BotonEnlace>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <EstadoActivoBadge estado={a.estado} />
          {a.mantenimiento_vencido && <AvisoBadge texto="Mantenimiento vencido" tono="peligro" />}
        </div>
        <h1>{a.nombre}</h1>
        <p className="text-suave">{[a.codigo, TIPOS_ACTIVO[a.tipo]].filter(Boolean).join(' · ')}</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <section className="tarjeta space-y-4">
          <h2>Ficha</h2>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Dato titulo="Ubicación" valor={a.ubicacion_nombre} />
            <Dato titulo="Es parte de" valor={a.padre_nombre} />
            <Dato titulo="Criticidad" valor={CRITICIDADES[a.criticidad]} />
            <Dato titulo="Marca" valor={a.marca} />
            <Dato titulo="Modelo" valor={a.modelo} />
            <Dato titulo="N° de serie" valor={a.numero_serie} />
            <Dato titulo="Último mantenimiento" valor={fmtFecha(a.ultimo_mantenimiento)} />
            <Dato titulo="Próximo mantenimiento" valor={fmtFecha(a.proximo_mantenimiento)} />
            <Dato titulo="Frecuencia" valor={a.frecuencia_mant_dias ? `Cada ${a.frecuencia_mant_dias} días` : null} />
          </dl>

          {puedeValidar && (
            <div className="space-y-4 border-t pt-4">
              <div className="max-w-xs">
                <Selector etiqueta="Cambiar estado" value={a.estado} disabled={ocupado} opciones={ESTADOS}
                  onChange={(e) => cambiar({ estado: e.target.value as EstadoActivo }, 'Estado actualizado. Quedó en el historial.')} />
              </div>
              {moviendo ? (
                <div className="max-w-md space-y-2">
                  <BuscadorRemoto etiqueta="Mover a la ubicación" tabla="ubicaciones" valor={null}
                    onCambio={(u: ResultadoBusqueda | null) => u && cambiar({ ubicacion_id: u.id }, 'Activo movido. Quedó en el historial.')} />
                  <Boton variante="fantasma" onClick={() => setMoviendo(false)}>No mover</Boton>
                </div>
              ) : (
                <Boton icono={ArrowRightLeft} disabled={ocupado} onClick={() => setMoviendo(true)}>
                  Mover de ubicación
                </Boton>
              )}
            </div>
          )}
        </section>

        <section className="tarjeta space-y-3">
          <h2>Código QR</h2>
          <QRImprimible token={a.qr_token} titulo={a.nombre} subtitulo={a.ubicacion_nombre} />
        </section>
      </div>

      {componentes.length > 0 && (
        <section className="tarjeta space-y-3">
          <h2>Componentes</h2>
          <ul className="divide-y">
            {componentes.map((c) => (
              <li key={c.id}>
                <Link href={`/gestion/activos/${c.id}`} className="flex min-h-control items-center justify-between gap-3 py-2 hover:text-primario">
                  <span>{c.nombre}{c.codigo ? ` · ${c.codigo}` : ''}</span>
                  <EstadoActivoBadge estado={c.estado} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="tarjeta space-y-3">
        <h2>Órdenes de trabajo</h2>
        {ordenes.length === 0 ? (
          <p className="text-suave">Este activo todavía no tuvo órdenes de trabajo.</p>
        ) : (
          <ul className="divide-y">
            {ordenes.map((o) => (
              <li key={o.id}>
                <Link href={`/ot/${o.id}`} className="flex min-h-control flex-wrap items-center justify-between gap-2 py-2 hover:text-primario">
                  <span>{o.titulo} <span className="text-sm text-suave">· {o.codigo}</span></span>
                  <EstadoOTBadge estado={o.estado} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tarjeta space-y-3">
        <h2>Historial</h2>
        <p className="text-sm text-suave">Se registra solo: altas, cambios de estado, movimientos y órdenes completadas.</p>
        {historial.length === 0 ? (
          <p className="text-suave">Sin movimientos registrados.</p>
        ) : (
          <ol className="space-y-3">
            {historial.map((h) => {
              const Icono = ICONO_HISTORIAL[h.tipo];
              return (
                <li key={h.id} className="flex gap-3">
                  <Icono className="mt-0.5 h-5 w-5 shrink-0 text-suave" aria-hidden />
                  <div>
                    <p>{h.detalle}</p>
                    <p className="text-xs text-suave">{new Date(h.created_at).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' })}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}
