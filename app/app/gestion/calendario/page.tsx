'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarCheck, ChevronLeft, ChevronRight, ClipboardList, FileText, Hand, Save, Wrench, X } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo } from '@/components/Campos';
import { AvisoBadge, TEXTO_ESTADO_OT } from '@/components/EstadoBadge';
import { ErrorVista } from '@/components/Estados';
import { ESTADOS_RUTINA, eventosEntre, reprogramarOT, type EventoCalendario } from '@/lib/operacion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { PRIORIDADES, type EstadoOT } from '@/lib/types';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const deIso = (s: string) => new Date(`${s}T12:00:00`);
const masDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const TIPO = {
  ot: { texto: 'Orden de trabajo', icono: ClipboardList },
  mantenimiento: { texto: 'Mantenimiento de activo', icono: Wrench },
  rutina: { texto: 'Rutina', icono: CalendarCheck },
  informe: { texto: 'Entrega de informe', icono: FileText },
  prestamo: { texto: 'Devolución de herramienta', icono: Hand },
} as const;

// Color del chip: acompaña al texto y a la leyenda. El tipo y la prioridad también se leen en el detalle.
function tono(e: EventoCalendario): string {
  if (e.tipo === 'rutina') return 'border-info/50 bg-info/15 text-info';
  if (e.tipo === 'informe' || e.tipo === 'prestamo') return 'border-dashed border-texto/40 bg-elevado text-texto';
  if (e.prioridad === 'urgente') return 'border-peligro/50 bg-peligro/15 text-peligro';
  if (e.prioridad === 'alta') return 'border-alerta/50 bg-alerta/15 text-alerta';
  if (e.tipo === 'mantenimiento') return 'border-exito/40 bg-exito/10 text-exito';
  return 'border-primario/50 bg-primario/15 text-primario';
}
const LEYENDA: [string, string][] = [
  ['Orden', 'border-primario/50 bg-primario/15 text-primario'], ['Orden de prioridad alta', 'border-alerta/50 bg-alerta/15 text-alerta'],
  ['Urgente', 'border-peligro/50 bg-peligro/15 text-peligro'], ['Mantenimiento de activo', 'border-exito/40 bg-exito/10 text-exito'],
  ['Rutina por vencer', 'border-info/50 bg-info/15 text-info'], ['Informe o devolución', 'border-dashed border-texto/40 bg-elevado text-texto'],
];
const estadoTexto = (e: EventoCalendario) =>
  e.tipo === 'ot' ? TEXTO_ESTADO_OT[e.estado as EstadoOT] : e.tipo === 'rutina' ? ESTADOS_RUTINA[e.estado as keyof typeof ESTADOS_RUTINA]
    : e.tipo === 'informe' ? String(e.estado).replace('_', ' ').replace(/^./, (c) => c.toUpperCase()) : e.tipo === 'prestamo' ? 'Prestada' : 'Programado';

function Lista({ titulo, eventos, vacio, onVer }: { titulo: string; eventos: EventoCalendario[]; vacio: string; onVer: (e: EventoCalendario) => void }) {
  return (
    <section className="tarjeta space-y-2">
      <h2>{titulo}</h2>
      {eventos.length === 0 ? <p className="text-suave">{vacio}</p> : (
        <ul className="space-y-1">
          {eventos.map((e) => (
            <li key={`${e.tipo}-${e.id}`}>
              <button type="button" onClick={() => onVer(e)} className={`flex min-h-control w-full items-center gap-2 rounded border px-2 text-left text-sm ${tono(e)}`}>
                <span className="shrink-0 font-medium">{deIso(e.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}</span>
                <span className="truncate text-texto">{e.titulo}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Calendario() {
  const { puedeValidar } = useSesion();
  const hoy = useMemo(() => new Date(), []);
  const [mes, setMes] = useState(() => new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const [dia, setDia] = useState<string | null>(null);
  const [evento, setEvento] = useState<EventoCalendario | null>(null);
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Semanas completas de lunes a domingo que cubren el mes, más los 7 días siguientes a hoy.
  const grilla = useMemo(() => {
    const desde = masDias(mes, -((mes.getDay() + 6) % 7));
    const finMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const hasta = masDias(finMes, 6 - ((finMes.getDay() + 6) % 7));
    const dias: Date[] = [];
    for (let d = desde; d <= hasta; d = masDias(d, 1)) dias.push(d);
    return { desde, hasta, dias };
  }, [mes]);

  const carga = useCarga(async () => {
    const hasta7 = masDias(hoy, 7);
    const [delMes, proximos] = await Promise.all([eventosEntre(iso(grilla.desde), iso(grilla.hasta)), eventosEntre(iso(hoy), iso(hasta7))]);
    return { delMes, proximos };
  }, [grilla.desde.getTime()]);

  const porDia = useMemo(() => {
    const m = new Map<string, EventoCalendario[]>();
    for (const e of carga.datos?.delMes ?? []) m.set(e.fecha, [...(m.get(e.fecha) ?? []), e]);
    return m;
  }, [carga.datos]);

  function ver(e: EventoCalendario) {
    setEvento(e);
    setNuevaFecha(e.fecha);
  }

  async function reprogramar() {
    if (!evento || !nuevaFecha || nuevaFecha === evento.fecha) return;
    setGuardando(true);
    try {
      await reprogramarOT(evento.id, nuevaFecha);
      toast.success('Orden reprogramada.');
      setEvento(null);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setGuardando(false);
    }
  }

  const hoyIso = iso(hoy);
  const titulo = mes.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="first-letter:uppercase">{titulo}</h1>
        <div className="flex gap-1">
          <Boton variante="fantasma" icono={ChevronLeft} onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}>Anterior</Boton>
          <Boton onClick={() => { setMes(new Date(hoy.getFullYear(), hoy.getMonth(), 1)); setDia(hoyIso); }}>Hoy</Boton>
          <Boton variante="fantasma" icono={ChevronRight} onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}>Siguiente</Boton>
        </div>
      </header>

      <ul className="flex flex-wrap gap-2 text-xs">
        {LEYENDA.map(([texto, clase]) => <li key={texto} className={`rounded border px-2 py-0.5 ${clase}`}>{texto}</li>)}
      </ul>

      {carga.error && <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />}

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="overflow-x-auto">
          <div className={`grid min-w-[44rem] grid-cols-7 overflow-hidden rounded-lg border bg-superficie ${carga.cargando ? 'opacity-70' : ''}`} aria-busy={carga.cargando}>
            {DIAS.map((d) => <div key={d} className="border-b px-2 py-2 text-center text-xs font-medium text-suave">{d}</div>)}
            {grilla.dias.map((d) => {
              const clave = iso(d);
              const eventos = porDia.get(clave) ?? [];
              const delMes = d.getMonth() === mes.getMonth();
              return (
                <div key={clave} className={`min-h-[7rem] border-b border-r p-1 ${delMes ? '' : 'bg-fondo/60'} ${dia === clave ? 'outline outline-2 -outline-offset-2 outline-primario' : ''}`}>
                  <button type="button" onClick={() => setDia(dia === clave ? null : clave)} aria-pressed={dia === clave}
                    className={`mb-1 flex h-8 w-8 items-center justify-center rounded text-sm ${clave === hoyIso ? 'bg-primario font-bold text-sobre-primario' : delMes ? '' : 'text-suave'}`}>
                    {d.getDate()}
                  </button>
                  <ul className="space-y-1">
                    {eventos.slice(0, 3).map((e) => (
                      <li key={`${e.tipo}-${e.id}`}>
                        <button type="button" onClick={() => ver(e)} title={e.titulo} className={`block w-full truncate rounded border px-1 py-0.5 text-left text-xs ${tono(e)}`}>{e.titulo}</button>
                      </li>
                    ))}
                    {eventos.length > 3 && <li><button type="button" className="text-xs text-suave hover:text-texto" onClick={() => setDia(clave)}>+{eventos.length - 3} más</button></li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          {evento ? (
            <section className="tarjeta space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-2 text-sm text-suave">{(() => { const I = TIPO[evento.tipo].icono; return <I className="h-5 w-5" aria-hidden />; })()}{TIPO[evento.tipo].texto}</p>
                <Boton variante="fantasma" icono={X} onClick={() => setEvento(null)}>Cerrar</Boton>
              </div>
              <h2>{evento.titulo}</h2>
              <div className="flex flex-wrap gap-2">
                <span className="rounded border bg-elevado px-2 py-0.5 text-xs">{estadoTexto(evento)}</span>
                <span className="rounded border bg-elevado px-2 py-0.5 text-xs">Prioridad {PRIORIDADES[evento.prioridad].toLowerCase()}</span>
                {evento.vencido && <AvisoBadge texto="Vencido" tono="peligro" />}
              </div>
              <p className="first-letter:uppercase">{deIso(evento.fecha).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
              {evento.responsable && <p className="text-sm"><span className="text-suave">A cargo de:</span> {evento.responsable}</p>}
              {evento.ubicacion && <p className="text-sm"><span className="text-suave">Lugar:</span> {evento.ubicacion}</p>}
              {evento.descripcion && <p className="line-clamp-3 whitespace-pre-wrap text-sm text-suave">{evento.descripcion}</p>}
              {evento.tipo === 'ot' && <Link href={`/ot/${evento.id}`} className="inline-flex min-h-control items-center text-primario hover:underline">Abrir la orden</Link>}
              {evento.tipo === 'mantenimiento' && <Link href={`/gestion/activos/${evento.id}`} className="inline-flex min-h-control items-center text-primario hover:underline">Abrir el activo</Link>}
              {evento.tipo === 'rutina' && <Link href="/gestion/rutinas" className="inline-flex min-h-control items-center text-primario hover:underline">Ir a Rutinas</Link>}
            {evento.tipo === 'informe' && <Link href="/gestion/informes" className="inline-flex min-h-control items-center text-primario hover:underline">Ir a Informes</Link>}
            {evento.tipo === 'prestamo' && <Link href="/gestion/prestamos" className="inline-flex min-h-control items-center text-primario hover:underline">Ir a Préstamos</Link>}
              {evento.tipo === 'ot' && puedeValidar && !['completada', 'cancelada'].includes(evento.estado) && (
                <div className="flex items-end gap-2 border-t pt-3">
                  <div className="flex-1"><Campo etiqueta="Reprogramar para" type="date" required value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} /></div>
                  <Boton icono={Save} cargando={guardando} disabled={!nuevaFecha || nuevaFecha === evento.fecha} onClick={reprogramar}>Guardar</Boton>
                </div>
              )}
            </section>
          ) : (
            <>
              {dia && dia !== hoyIso && <Lista titulo={deIso(dia).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })} eventos={porDia.get(dia) ?? []} vacio="Sin eventos ese día." onVer={ver} />}
              <Lista titulo="Hoy" eventos={(carga.datos?.proximos ?? []).filter((e) => e.fecha === hoyIso)} vacio="Sin eventos hoy." onVer={ver} />
              <Lista titulo="Próximos 7 días" eventos={(carga.datos?.proximos ?? []).filter((e) => e.fecha > hoyIso).slice(0, 12)} vacio="Sin eventos próximos." onVer={ver} />
            </>
          )}
        </aside>
      </div>
    </>
  );
}
