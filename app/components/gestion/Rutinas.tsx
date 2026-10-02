'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { FileCheck2, Paperclip, Save, Send, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '../Boton';
import { Area, Campo, Casilla, Selector, oNull } from '../Campos';
import { fmtFecha } from '../OTCard';
import { BuscadorRemoto } from './BuscadorRemoto';
import {
  CICLOS, ESTADOS_RUTINA, actualizarOrdenRutina, generarOTRutina, guardarRutina, subirAdjunto,
  type Ciclo, type EstadoRutina, type OrdenRutina, type Rutina,
} from '@/lib/operacion';
import { limpiarError } from '@/lib/errores';
import { useSesion } from '@/lib/sesion';
import { PRIORIDADES, TIPOS_OT, type Prioridad, type ResultadoBusqueda, type TipoOT } from '@/lib/types';

export const TONO_RUTINA: Record<EstadoRutina, string> = {
  pendiente: 'border-alerta/40 bg-alerta/10 text-alerta', en_proceso: 'border-info/40 bg-info/10 text-info',
  ejecutada: 'border-exito/40 bg-exito/10 text-exito', vencida: 'border-peligro/50 bg-peligro/10 text-peligro',
  derivada_tom: 'border-borde bg-elevado text-suave',
};

export function EstadoRutinaBadge({ estado }: { estado: EstadoRutina }) {
  return <span className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${TONO_RUTINA[estado]}`}>{ESTADOS_RUTINA[estado]}</span>;
}

export function vencimientoRutina(o: OrdenRutina): { texto: string; tono: string } {
  if (o.estado === 'ejecutada') return { texto: `Ejecutada el ${fmtFecha(o.fecha_ejecucion)}`, tono: 'text-exito' };
  if (o.estado === 'derivada_tom') return { texto: 'Derivada a TOM', tono: 'text-suave' };
  if (o.dias_restantes < 0) return { texto: `Vencida hace ${-o.dias_restantes} d`, tono: 'text-peligro' };
  if (o.dias_restantes === 0) return { texto: 'Vence hoy', tono: 'text-peligro' };
  if (o.dias_restantes <= 3) return { texto: `Vence en ${o.dias_restantes} d`, tono: 'text-alerta' };
  return { texto: `Vence el ${fmtFecha(o.fecha_limite)}`, tono: 'text-suave' };
}

const prioridadSugerida = (o: OrdenRutina): Prioridad =>
  o.estado === 'vencida' ? 'urgente' : o.ciclo === 'Semanal' || o.ciclo === 'Quincenal' ? 'alta' : o.ciclo === 'Mensual' ? 'media' : 'baja';

// Detalle de una orden de rutina: estado, comprobantes y orden de trabajo.
// Qué hace falta para darla por ejecutada (comprobante de SISMESC, matrícula) lo exige la base.
export function DetalleRutina({ orden: o, onListo }: { orden: OrdenRutina; onListo: (cambio: boolean) => void }) {
  const { sectorEfectivo, puedeValidar } = useSesion();
  const [estado, setEstado] = useState<EstadoRutina>(o.estado);
  const [matricula, setMatricula] = useState(o.matricula_profesional ?? '');
  const [observaciones, setObservaciones] = useState(o.observaciones ?? '');
  const [adjuntos, setAdjuntos] = useState(o.adjuntos ?? []);
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [generando, setGenerando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const cerrada = o.estado === 'ejecutada';
  const editable = puedeValidar && !cerrada;

  // formulario de la orden de trabajo
  const [ot, setOt] = useState({
    titulo: `[Rutina] ${o.objeto} — ${o.ubicacion_nombre}`, tipo: 'mantenimiento_preventivo' as TipoOT, prioridad: prioridadSugerida(o),
    fecha: o.fecha_limite,
    descripcion: [`${o.rubro_nombre} · ${o.ciclo} · plazo ${o.plazo_dias} días`, o.acciones, o.observaciones_tom && `Observaciones TOM: ${o.observaciones_tom}`,
      o.requiere_informe_matriculado && 'Requiere informe de un matriculado.', o.carga_sismesc && 'Se carga en SISMESC.'].filter(Boolean).join('\n'),
    notas: '',
  });
  const [asignado, setAsignado] = useState<ResultadoBusqueda | null>(null);

  async function adjuntar(lista: FileList | null) {
    if (!lista || !sectorEfectivo) return;
    setSubiendo(true);
    for (const archivo of Array.from(lista)) {
      try {
        const a = await subirAdjunto(sectorEfectivo.id, 'rutinas', archivo);
        setAdjuntos((actual) => [...actual, a]);
      } catch (e) {
        toast.error(limpiarError(e));
      }
    }
    setSubiendo(false);
    if (entrada.current) entrada.current.value = '';
  }

  async function guardar() {
    setGuardando(true);
    try {
      await actualizarOrdenRutina(o.id, { estado, matricula_profesional: oNull(matricula), observaciones: oNull(observaciones), adjuntos });
      toast.success(estado === 'ejecutada' ? 'Rutina ejecutada. Se reprogramó según su ciclo.' : 'Rutina guardada.');
      onListo(true);
    } catch (e) {
      toast.error(limpiarError(e));
      setGuardando(false);
    }
  }

  async function crearOT(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await generarOTRutina(o.id, { titulo: ot.titulo.trim(), descripcion: oNull(ot.descripcion), tipo: ot.tipo, prioridad: ot.prioridad, asignado_a: asignado?.id ?? null, fecha_programada: oNull(ot.fecha), notas: oNull(ot.notas) });
      toast.success('Orden de trabajo generada.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  const v = vencimientoRutina(o);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2"><EstadoRutinaBadge estado={o.estado} /><span className={`text-sm ${v.tono}`}>{v.texto}</span></div>
          <h1>{o.objeto}</h1>
          <p className="text-suave">{[o.ubicacion_nombre, o.rubro_nombre, o.ciclo, o.jefe_sitio_nombre && `jefe de sitio: ${o.jefe_sitio_nombre}`].filter(Boolean).join(' · ')}</p>
        </div>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Volver</Boton>
      </header>

      <section className="tarjeta space-y-3">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><dt className="text-xs text-suave">Generada</dt><dd>{fmtFecha(o.fecha_generada)}</dd></div>
          <div><dt className="text-xs text-suave">Límite</dt><dd>{fmtFecha(o.fecha_limite)}</dd></div>
          <div><dt className="text-xs text-suave">Informe de matriculado</dt><dd>{o.requiere_informe_matriculado ? 'Requerido' : 'No'}</dd></div>
          <div><dt className="text-xs text-suave">Carga en SISMESC</dt><dd>{o.carga_sismesc ? 'Requerida' : 'No'}</dd></div>
        </dl>
        {o.acciones && <div><p className="text-xs text-suave">Acciones</p><p className="whitespace-pre-wrap">{o.acciones}</p></div>}
        {o.observaciones_tom && <div><p className="text-xs text-suave">Observaciones TOM</p><p className="whitespace-pre-wrap">{o.observaciones_tom}</p></div>}
        {o.ot_id && <Link href={`/ot/${o.ot_id}`} className="inline-flex min-h-control items-center gap-2 text-primario hover:underline"><Wrench className="h-5 w-5" aria-hidden />Orden de trabajo {o.ot_codigo}</Link>}
      </section>

      {generando ? (
        <form onSubmit={crearOT} className="tarjeta space-y-4">
          <h2>Generar orden de trabajo</h2>
          <Campo etiqueta="Título" required value={ot.titulo} onChange={(e) => setOt({ ...ot, titulo: e.target.value })} />
          <div className="grid gap-4 md:grid-cols-3">
            <Selector etiqueta="Tipo" value={ot.tipo} opciones={TIPOS_OT} onChange={(e) => setOt({ ...ot, tipo: e.target.value as TipoOT })} />
            <Selector etiqueta="Prioridad" value={ot.prioridad} opciones={PRIORIDADES} onChange={(e) => setOt({ ...ot, prioridad: e.target.value as Prioridad })} />
            <Campo etiqueta="Fecha programada" type="date" value={ot.fecha} onChange={(e) => setOt({ ...ot, fecha: e.target.value })} />
          </div>
          <BuscadorRemoto etiqueta="Asignar a" tabla="perfiles" valor={asignado} onCambio={setAsignado} ayuda={`Si queda vacío, va al jefe de sitio del lugar${o.jefe_sitio_nombre ? ` (${o.jefe_sitio_nombre})` : ''}.`} />
          <Area etiqueta="Descripción" rows={5} value={ot.descripcion} onChange={(e) => setOt({ ...ot, descripcion: e.target.value })} />
          <Area etiqueta="Notas" value={ot.notas} onChange={(e) => setOt({ ...ot, notas: e.target.value })} />
          <div className="flex flex-wrap gap-3">
            <Boton type="submit" variante="primario" icono={Send} cargando={guardando}>Generar orden</Boton>
            <Boton variante="fantasma" onClick={() => setGenerando(false)}>Cancelar</Boton>
          </div>
        </form>
      ) : (
        <section className="tarjeta space-y-4">
          <fieldset disabled={!editable} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Selector etiqueta="Estado" value={estado} opciones={ESTADOS_RUTINA} onChange={(e) => setEstado(e.target.value as EstadoRutina)} />
              {o.requiere_informe_matriculado && <Campo etiqueta="Matrícula del profesional" value={matricula} onChange={(e) => setMatricula(e.target.value)} />}
            </div>
            <div className="space-y-2">
              <span className="etiqueta">Comprobantes adjuntos{o.carga_sismesc ? ' (hace falta al menos uno para darla por ejecutada)' : ''}</span>
              {adjuntos.length === 0 ? <p className="text-suave">Sin adjuntos.</p> : (
                <ul className="space-y-1">
                  {adjuntos.map((a) => (
                    <li key={a.url} className="flex items-center justify-between gap-2 rounded border bg-elevado/40 pl-3">
                      <a href={a.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-primario hover:underline"><FileCheck2 className="h-5 w-5 shrink-0" aria-hidden /><span className="truncate">{a.nombre}</span></a>
                      {editable && <Boton variante="fantasma" icono={Trash2} onClick={() => setAdjuntos((x) => x.filter((y) => y.url !== a.url))}>Quitar</Boton>}
                    </li>
                  ))}
                </ul>
              )}
              <input ref={entrada} type="file" multiple hidden onChange={(e) => adjuntar(e.target.files)} />
              {editable && <Boton icono={Paperclip} cargando={subiendo} onClick={() => entrada.current?.click()}>Adjuntar archivo</Boton>}
            </div>
            <Area etiqueta="Observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
          </fieldset>
          {editable && (
            <div className="flex flex-wrap gap-3">
              <Boton variante="primario" icono={Save} cargando={guardando} disabled={subiendo} onClick={guardar}>Guardar</Boton>
              {!o.ot_id && ['pendiente', 'en_proceso', 'vencida'].includes(o.estado) && <Boton icono={Wrench} onClick={() => setGenerando(true)}>Generar orden de trabajo</Boton>}
              {o.observaciones_tom && estado !== 'derivada_tom' && <Boton onClick={() => setEstado('derivada_tom')}>Derivar a TOM</Boton>}
            </div>
          )}
          {cerrada && <p className="text-suave">Esta rutina ya fue ejecutada y quedó cerrada. La próxima se genera sola según su ciclo.</p>}
        </section>
      )}
    </div>
  );
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Alta y edición de una rutina del catálogo. La frecuencia sale del ciclo: no se carga aparte.
export function FormRutina({ rutina: r, onListo }: { rutina: Rutina | null; onListo: (cambio: boolean) => void }) {
  const [f, setF] = useState({
    rubro_id: r?.rubro_id ?? '', rubro_nombre: r?.rubro_nombre ?? '', item: r?.item ?? '', objeto: r?.objeto ?? '', acciones: r?.acciones ?? '',
    observaciones_tom: r?.observaciones_tom ?? '', tipo: r?.tipo ?? ('mantenimiento' as Rutina['tipo']), ciclo: r?.ciclo ?? ('Mensual' as Ciclo),
    plazo: String(r?.plazo_dias ?? 15), matriculado: r?.requiere_informe_matriculado ?? false, sismesc: r?.carga_sismesc ?? false, activa: r?.activa ?? true,
  });
  const [meses, setMeses] = useState<number[]>(r?.estacionalidad ?? []);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await guardarRutina(r?.id ?? null, {
        rubro_id: oNull(f.rubro_id), rubro_nombre: f.rubro_nombre.trim(), item: oNull(f.item), objeto: f.objeto.trim(), acciones: oNull(f.acciones),
        observaciones_tom: oNull(f.observaciones_tom), tipo: f.tipo, ciclo: f.ciclo, estacionalidad: [...meses].sort((a, b) => a - b),
        plazo_dias: Math.max(1, Number(f.plazo) || 15), requiere_informe_matriculado: f.matriculado, carga_sismesc: f.sismesc, activa: f.activa,
      });
      toast.success(r ? 'Rutina guardada.' : 'Rutina agregada al catálogo.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="tarjeta space-y-4">
      <h2>{r ? 'Editar rutina' : 'Nueva rutina'}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Campo etiqueta="Rubro" required value={f.rubro_nombre} onChange={(e) => setF({ ...f, rubro_nombre: e.target.value })} />
        <Campo etiqueta="Ítem" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} />
      </div>
      <Campo etiqueta="Qué se revisa o mantiene" required value={f.objeto} onChange={(e) => setF({ ...f, objeto: e.target.value })} />
      <Area etiqueta="Acciones" value={f.acciones} onChange={(e) => setF({ ...f, acciones: e.target.value })} />
      <Area etiqueta="Observaciones TOM" ayuda="Si tiene, la rutina se puede derivar a TOM." value={f.observaciones_tom} onChange={(e) => setF({ ...f, observaciones_tom: e.target.value })} />
      <div className="grid gap-4 md:grid-cols-3">
        <Selector etiqueta="Tipo" value={f.tipo} opciones={{ mantenimiento: 'Mantenimiento', informe: 'Informe' }} onChange={(e) => setF({ ...f, tipo: e.target.value as Rutina['tipo'] })} />
        <Selector etiqueta="Ciclo" value={f.ciclo} opciones={Object.fromEntries(CICLOS.map((c) => [c, c]))} onChange={(e) => setF({ ...f, ciclo: e.target.value as Ciclo })} />
        <Campo etiqueta="Plazo para hacerla (días)" inputMode="numeric" value={f.plazo} onChange={(e) => setF({ ...f, plazo: e.target.value.replace(/\D/g, '') })} />
      </div>
      <div>
        <span className="etiqueta">Meses en que corresponde (sin marcar ninguno: todo el año)</span>
        <div className="flex flex-wrap gap-2">
          {MESES.map((m, i) => {
            const activo = meses.includes(i + 1);
            return (
              <button key={m} type="button" aria-pressed={activo} onClick={() => setMeses((a) => (activo ? a.filter((x) => x !== i + 1) : [...a, i + 1]))}
                className={`min-h-control min-w-control rounded border px-2 text-sm font-medium ${activo ? 'border-primario bg-primario/15 text-primario' : 'bg-elevado text-suave'}`}>
                {m}
              </button>
            );
          })}
        </div>
      </div>
      <Casilla etiqueta="Requiere informe de un matriculado" checked={f.matriculado} onChange={(e) => setF({ ...f, matriculado: e.target.checked })} />
      <Casilla etiqueta="Se carga en SISMESC (pide comprobante para cerrarla)" checked={f.sismesc} onChange={(e) => setF({ ...f, sismesc: e.target.checked })} />
      <Casilla etiqueta="Rutina activa" checked={f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked })} />
      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar rutina</Boton>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Cancelar</Boton>
      </div>
    </form>
  );
}
