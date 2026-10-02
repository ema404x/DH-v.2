'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Activity, Ban, CheckCheck, ChevronDown, ChevronRight, Clock, HandHelping, Phone, Repeat, ShieldCheck, Siren, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area } from '@/components/Campos';
import { FormEmergencia } from '@/components/Emergencias';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { Chips, Indicador, Indicadores, Pestanas } from '@/components/gestion/Piezas';
import {
  ESTADOS_EMERGENCIA, TIPOS_EMERGENCIA, borrarEmergencia, cambiarEmergencia, listarEmergencias, type Emergencia, type EstadoEmergencia,
} from '@/lib/operacion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

const TONO: Record<EstadoEmergencia, string> = {
  activa: 'border-peligro/50 bg-peligro/10 text-peligro', en_atencion: 'border-alerta/50 bg-alerta/10 text-alerta',
  resuelta: 'border-exito/40 bg-exito/10 text-exito', cancelada: 'border-borde bg-elevado text-suave',
};
const ICONO: Record<EstadoEmergencia, typeof Siren> = { activa: Siren, en_atencion: HandHelping, resuelta: ShieldCheck, cancelada: Ban };

function hace(fecha: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(fecha).getTime()) / 60000));
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
}
const duracion = (min: number | null) => (min === null ? '—' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

function Barras({ titulo, datos }: { titulo: string; datos: [string, number][] }) {
  const max = Math.max(1, ...datos.map(([, n]) => n));
  return (
    <section className="tarjeta space-y-3">
      <h2>{titulo}</h2>
      {datos.length === 0 ? <p className="text-suave">Sin datos.</p> : (
        <ul className="space-y-2">
          {datos.map(([nombre, n]) => (
            <li key={nombre} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-2 text-sm">
              <span className="truncate">{nombre}</span>
              <span className="h-3 rounded bg-elevado"><span className="block h-3 rounded bg-primario" style={{ width: `${(n / max) * 100}%` }} /></span>
              <span className="num">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tarjeta({ e, puedeAtender, esGerencia, onCambio }: { e: Emergencia; puedeAtender: boolean; esGerencia: boolean; onCambio: () => Promise<void> }) {
  const [abierta, setAbierta] = useState(false);
  const [resolviendo, setResolviendo] = useState(false);
  const [notas, setNotas] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const Icono = ICONO[e.estado];
  const cerrada = e.estado === 'resuelta' || e.estado === 'cancelada';

  async function hacer(accion: () => Promise<void>, exito: string) {
    setOcupado(true);
    try {
      await accion();
      toast.success(exito);
      setResolviendo(false);
      await onCambio();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className={`tarjeta space-y-3 ${e.estado === 'activa' ? 'border-peligro/60' : ''}`}>
      <button type="button" aria-expanded={abierta} onClick={() => setAbierta(!abierta)} className="flex w-full items-start gap-3 text-left">
        {abierta ? <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-suave" aria-hidden /> : <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-suave" aria-hidden />}
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${TONO[e.estado]}`}>
              <Icono className="h-4 w-4" aria-hidden />{ESTADOS_EMERGENCIA[e.estado]}
            </span>
            <span className="text-sm text-suave">{TIPOS_EMERGENCIA[e.tipo]} · {e.codigo} · {hace(e.created_at)}</span>
          </span>
          <span className="block font-semibold">{e.titulo}</span>
          <span className="block text-sm text-suave">{[e.ubicacion_nombre, e.zona, e.jefe_sitio_nombre ? `a cargo de ${e.jefe_sitio_nombre}` : 'sin jefe de sitio'].filter(Boolean).join(' · ')}</span>
        </span>
      </button>

      {abierta && (
        <div className="space-y-3 border-t pt-3">
          {e.descripcion && <p className="whitespace-pre-wrap">{e.descripcion}</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><dt className="text-xs text-suave">Domicilio</dt><dd>{e.domicilio ?? '—'}</dd></div>
            <div><dt className="text-xs text-suave">Avisó</dt><dd>{e.reportado_por ?? '—'}</dd></div>
            <div><dt className="text-xs text-suave">Teléfono</dt><dd>{e.telefono_contacto ? <a className="inline-flex items-center gap-1 text-primario" href={`tel:${e.telefono_contacto}`}><Phone className="h-4 w-4" aria-hidden />{e.telefono_contacto}</a> : '—'}</dd></div>
            <div><dt className="text-xs text-suave">Tiempos</dt><dd>Atención: {duracion(e.minutos_atencion)} · Resolución: {duracion(e.minutos_resolucion)}</dd></div>
          </dl>
          {e.notas_resolucion && <p className="rounded border bg-elevado/40 p-2 text-sm">Resolución: {e.notas_resolucion}</p>}
          {e.fotos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {e.fotos.map((f) => (
                <li key={f}><a href={f} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f} alt="Foto de la emergencia" loading="lazy" className="aspect-square w-full rounded border object-cover" />
                </a></li>
              ))}
            </ul>
          )}
          {e.ot_id && <Link href={`/ot/${e.ot_id}`} className="inline-flex min-h-control items-center text-primario hover:underline">Ver la orden de trabajo {e.ot_codigo}</Link>}
        </div>
      )}

      {resolviendo && (
        <div className="space-y-2 border-t pt-3">
          <Area etiqueta="Cómo se resolvió" value={notas} onChange={(ev) => setNotas(ev.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Boton variante="primario" icono={CheckCheck} cargando={ocupado} onClick={() => hacer(() => cambiarEmergencia(e.id, 'resuelta', notas.trim()), 'Emergencia resuelta. Se cerró su orden de trabajo.')}>Confirmar resolución</Boton>
            <Boton variante="fantasma" onClick={() => setResolviendo(false)}>Volver</Boton>
          </div>
        </div>
      )}

      {!cerrada && puedeAtender && !resolviendo && (
        <div className="flex flex-wrap gap-2">
          {e.estado === 'activa' && <Boton variante="primario" icono={HandHelping} cargando={ocupado} onClick={() => hacer(() => cambiarEmergencia(e.id, 'en_atencion'), 'Emergencia en atención.')}>Atender</Boton>}
          {e.estado === 'en_atencion' && <Boton variante="primario" icono={CheckCheck} disabled={ocupado} onClick={() => setResolviendo(true)}>Resolver</Boton>}
          <Boton variante="fantasma" icono={Ban} disabled={ocupado}
            onClick={() => window.confirm('¿Cancelar esta emergencia? Se cancela también su orden de trabajo.') && hacer(() => cambiarEmergencia(e.id, 'cancelada'), 'Emergencia cancelada.')}>
            Cancelar
          </Boton>
        </div>
      )}
      {esGerencia && cerrada && abierta && (
        <Boton variante="fantasma" icono={Trash2} disabled={ocupado}
          onClick={() => window.confirm('¿Borrar esta emergencia del registro? No se puede deshacer.') && hacer(() => borrarEmergencia(e.id), 'Emergencia borrada.')}>
          Borrar del registro
        </Boton>
      )}
    </li>
  );
}

export default function Emergencias() {
  const { puedeValidar, esGerencia } = useSesion();
  const carga = useCarga(listarEmergencias, []);
  const [pestana, setPestana] = useState<'lista' | 'tablero'>('lista');
  const [filtro, setFiltro] = useState<EstadoEmergencia | null>(null);
  const [creando, setCreando] = useState(false);

  if (creando) {
    return <FormEmergencia onCancelar={() => setCreando(false)} onListo={() => { setCreando(false); void carga.recargar(); }} />;
  }

  const todas = carga.datos?.emergencias ?? [];
  const patrones = carga.datos?.patrones ?? [];
  const n = (e: EstadoEmergencia) => todas.filter((x) => x.estado === e).length;
  const lista = filtro ? todas.filter((e) => e.estado === filtro) : todas;
  const contar = (clave: (e: Emergencia) => string) =>
    Object.entries(todas.reduce<Record<string, number>>((a, e) => ({ ...a, [clave(e)]: (a[clave(e)] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const resueltas = todas.filter((e) => e.estado === 'resuelta' && e.minutos_resolucion !== null);
  const promedio = resueltas.length ? Math.round(resueltas.reduce((t, e) => t + (e.minutos_resolucion ?? 0), 0) / resueltas.length) : null;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Emergencias</h1>
        <Boton variante="primario" icono={Siren} onClick={() => setCreando(true)}>Nueva emergencia</Boton>
      </header>

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={4} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : (
        <>
          <Indicadores>
            <Indicador titulo="Activas" valor={n('activa')} icono={Siren} tono={n('activa') > 0 ? 'peligro' : 'neutro'} />
            <Indicador titulo="En atención" valor={n('en_atencion')} icono={HandHelping} tono={n('en_atencion') > 0 ? 'alerta' : 'neutro'} />
            <Indicador titulo="Resueltas" valor={n('resuelta')} icono={ShieldCheck} />
            <Indicador titulo="Tiempo medio de resolución" valor={duracion(promedio)} icono={Clock} />
          </Indicadores>

          {patrones.length > 0 && (
            <div className="space-y-1 rounded border border-alerta/40 bg-alerta/10 p-3 text-alerta" role="status">
              <p className="flex items-center gap-2 font-semibold"><Repeat className="h-5 w-5" aria-hidden />Emergencias repetidas en los últimos 30 días</p>
              <ul className="text-sm">
                {patrones.map((p) => <li key={p.ubicacion_id}>{p.ubicacion_nombre}: {p.cantidad} emergencias, sobre todo {TIPOS_EMERGENCIA[p.tipo_mas_frecuente].toLowerCase()}. Conviene una inspección preventiva.</li>)}
              </ul>
            </div>
          )}

          <Pestanas pestanas={[{ id: 'lista', texto: 'Lista', cuenta: todas.length }, { id: 'tablero', texto: 'Tablero' }]} activa={pestana} onCambio={setPestana} />

          {pestana === 'tablero' ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <Barras titulo="Por estado" datos={contar((e) => ESTADOS_EMERGENCIA[e.estado])} />
              <Barras titulo="Por tipo" datos={contar((e) => TIPOS_EMERGENCIA[e.tipo])} />
              <Barras titulo="Por zona" datos={contar((e) => e.zona ?? 'Sin zona')} />
            </div>
          ) : todas.length === 0 ? (
            <Vacio icono={Activity} titulo="No hay emergencias registradas" texto="Cuando alguien reporte una, aparece acá con su orden de trabajo urgente y suena el aviso a gerencia y jefes de sitio." />
          ) : (
            <>
              <Chips valor={filtro} onCambio={setFiltro} todos={`Todas (${todas.length})`}
                opciones={(Object.keys(ESTADOS_EMERGENCIA) as EstadoEmergencia[]).map((e) => ({ id: e, texto: `${ESTADOS_EMERGENCIA[e]} (${n(e)})` }))} />
              {lista.length === 0 ? <Vacio titulo="No hay emergencias en ese estado" texto="Elegí otro filtro." /> : (
                <ul className="space-y-3">
                  {lista.map((e) => <Tarjeta key={e.id} e={e} puedeAtender={puedeValidar} esGerencia={esGerencia} onCambio={carga.recargar} />)}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
