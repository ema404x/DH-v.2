'use client';

import { useParams } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { Boton, BotonEnlace } from '@/components/Boton';
import { TEXTO_ESTADO_OT } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto } from '@/components/Estados';
import { supabase } from '@/lib/supabase/client';
import { exigir } from '@/lib/errores';
import { horasDeOT } from '@/lib/gente';
import { cant, materialesDeOT } from '@/lib/panol';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { PRIORIDADES, TIPOS_OT, type OT } from '@/lib/types';

const fecha = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('es-AR') : '—');

async function cargar(id: string) {
  const [ot, materiales, horas] = await Promise.all([
    supabase().from('v_ordenes').select('*').eq('id', id).single().then((r) => exigir(r) as OT & { obra_titulo?: string | null }),
    materialesDeOT(id).catch(() => []),
    horasDeOT(id).catch(() => []),
  ]);
  return { ot, materiales, horas };
}

function Dato({ titulo, valor }: { titulo: string; valor: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide opacity-70">{titulo}</dt>
      <dd className="font-medium">{valor || '—'}</dd>
    </div>
  );
}

// Orden de trabajo para imprimir y llevar al campo (la v1 la exportaba en PDF): datos, tareas para tildar,
// materiales y horas cargados, renglones en blanco para lo que falte, y lugar para las firmas.
export default function ImprimirOT() {
  const { id } = useParams<{ id: string }>();
  const { sectorEfectivo } = useSesion();
  const carga = useCarga(() => cargar(id), [id]);

  if (carga.cargando && !carga.datos) return <main className="mx-auto max-w-3xl p-4"><Esqueleto filas={6} /></main>;
  if (carga.error || !carga.datos) return <main className="mx-auto max-w-3xl p-4"><ErrorVista mensaje={carga.error ?? 'No se encontró la orden.'} onReintentar={carga.recargar} /></main>;
  const { ot, materiales, horas } = carga.datos;
  const blancos = (n: number, cols: number) => Array.from({ length: n }, (_, i) => (
    <tr key={`b${i}`} className="h-8 border-b border-tinta/20">{Array.from({ length: cols }, (_, j) => <td key={j} />)}</tr>
  ));

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="no-imprimir flex flex-wrap items-center justify-between gap-3">
        <BotonEnlace href={`/ot/${id}`} variante="fantasma" icono={ArrowLeft}>Volver a la orden</BotonEnlace>
        <Boton variante="primario" icono={Printer} onClick={() => window.print()}>Imprimir o guardar en PDF</Boton>
      </div>

      <article className="hoja space-y-5 rounded-lg bg-papel p-6 text-sm text-tinta">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-tinta/30 pb-3">
          <div>
            <p className="text-xs uppercase tracking-wide opacity-70">{sectorEfectivo?.nombre ?? ''} · Orden de trabajo</p>
            <h1 className="text-xl font-bold">{ot.codigo} · {ot.titulo}</h1>
          </div>
          <div className="text-right">
            <p className="font-semibold">{TEXTO_ESTADO_OT[ot.estado]}</p>
            <p className="text-xs opacity-70">Impresa el {new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' })}</p>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Dato titulo="Tipo" valor={TIPOS_OT[ot.tipo]} />
          <Dato titulo="Prioridad" valor={PRIORIDADES[ot.prioridad]} />
          <Dato titulo="Programada" valor={fecha(ot.fecha_programada)} />
          <Dato titulo="Lugar" valor={[ot.ubicacion_nombre, ot.ubicacion_direccion].filter(Boolean).join(' · ')} />
          <Dato titulo="Activo o equipo" valor={[ot.activo_nombre, ot.activo_codigo].filter(Boolean).join(' · ')} />
          <Dato titulo="Obra" valor={ot.obra_titulo} />
          <Dato titulo="Asignada a" valor={ot.asignado_nombre} />
          <Dato titulo="Jefe de sitio" valor={ot.jefe_sitio_nombre} />
          <Dato titulo="Horas estimadas" valor={ot.horas_estimadas ? `${Number(ot.horas_estimadas).toLocaleString('es-AR')} h` : null} />
        </dl>

        {ot.descripcion && (
          <section className="space-y-1">
            <h2 className="font-semibold">Trabajo a realizar</h2>
            <p className="whitespace-pre-wrap">{ot.descripcion}</p>
          </section>
        )}

        <section className="space-y-1">
          <h2 className="font-semibold">Tareas</h2>
          {ot.checklist.length === 0 ? <p className="opacity-70">Sin lista de tareas.</p> : (
            <ul className="space-y-1">
              {ot.checklist.map((t, i) => (
                <li key={t.id ?? i} className="flex items-start gap-2">
                  <span className="mt-0.5 inline-block h-4 w-4 shrink-0 border border-tinta/60 text-center text-xs leading-4">{t.hecho ? '✓' : ''}</span>
                  <span>{t.tarea}{t.nota && <span className="opacity-70"> — {t.nota}</span>}</span>
                </li>
              ))}
            </ul>
          )}
          {ot.requiere_fotos && <p className="text-xs opacity-70">Esta orden pide al menos una foto para poder finalizarse.</p>}
        </section>

        <section className="space-y-1">
          <h2 className="font-semibold">Materiales usados</h2>
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-tinta/40 text-left"><th className="py-1 pr-2">Material</th><th className="py-1 pr-2 text-right">Cantidad</th><th className="py-1">Observaciones</th></tr></thead>
            <tbody>
              {materiales.map((m) => (
                <tr key={m.id} className="border-b border-tinta/20"><td className="py-1 pr-2">{m.descripcion}</td><td className="py-1 pr-2 text-right">{cant(m.cantidad, m.unidad)}</td><td className="py-1">{m.descontar ? 'Del pañol' : ''}</td></tr>
              ))}
              {blancos(Math.max(3, 5 - materiales.length), 3)}
            </tbody>
          </table>
        </section>

        <section className="space-y-1">
          <h2 className="font-semibold">Materiales que faltaron</h2>
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-tinta/40 text-left"><th className="py-1 pr-2">Material</th><th className="py-1 pr-2">Cantidad</th><th className="py-1">Por qué</th></tr></thead>
            <tbody>{blancos(3, 3)}</tbody>
          </table>
        </section>

        <section className="space-y-1">
          <h2 className="font-semibold">Horas trabajadas</h2>
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-tinta/40 text-left"><th className="py-1 pr-2">Quién</th><th className="py-1 pr-2">Fecha</th><th className="py-1 text-right">Horas</th></tr></thead>
            <tbody>
              {horas.map((h) => (
                <tr key={h.id} className="border-b border-tinta/20"><td className="py-1 pr-2">{h.empleado_nombre}</td><td className="py-1 pr-2">{fecha(h.fecha)}</td><td className="py-1 text-right">{Number(h.horas).toLocaleString('es-AR')}</td></tr>
              ))}
              {blancos(Math.max(2, 4 - horas.length), 3)}
            </tbody>
          </table>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Observaciones</h2>
          {ot.notas && <p className="whitespace-pre-wrap">{ot.notas}</p>}
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-7 border-b border-tinta/30" />)}
        </section>

        <footer className="grid grid-cols-2 gap-8 pt-10" style={{ breakInside: 'avoid-page' }}>
          <div className="border-t border-tinta/60 pt-1 text-center text-xs">Firma y aclaración de quien hizo el trabajo</div>
          <div className="border-t border-tinta/60 pt-1 text-center text-xs">Firma y aclaración del jefe de sitio</div>
        </footer>
      </article>
    </main>
  );
}
