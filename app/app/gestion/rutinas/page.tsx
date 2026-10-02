'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarCheck, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Cog, FileSignature, ListChecks, Plus, RefreshCw, Users, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { fmtFecha } from '@/components/OTCard';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Indicador, Indicadores, Pestanas } from '@/components/gestion/Piezas';
import { DetalleRutina, EstadoRutinaBadge, FormRutina, vencimientoRutina } from '@/components/gestion/Rutinas';
import {
  CICLOS, ESTADOS_RUTINA, activarRutina, actualizarOrdenRutina, asignacionesDe, generarOTRutinas, listarCatalogo, listarOrdenesRutina,
  procesarRutinas, sincronizarRutinas, type EstadoRutina, type OrdenRutina, type ResumenRutinas, type Rutina,
} from '@/lib/operacion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

type Tab = 'jefes' | 'general' | 'generar' | 'catalogo' | 'asignacion' | 'sincronizar';
const ABIERTA = (o: OrdenRutina) => o.estado === 'pendiente' || o.estado === 'en_proceso' || o.estado === 'vencida';
const SEMAFORO: Record<string, string> = { rojo: 'bg-peligro', amarillo: 'bg-alerta', verde: 'bg-exito' };
const contiene = (t: string | null | undefined, q: string) => (t ?? '').toLowerCase().includes(q);
// "1 rutina" / "3 rutinas"
const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function agrupar<T>(lista: T[], clave: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of lista) m.set(clave(x), [...(m.get(clave(x)) ?? []), x]);
  return [...m.entries()];
}

function FilaOrden({ o, onVer, onEjecutar }: { o: OrdenRutina; onVer: () => void; onEjecutar?: () => void }) {
  const v = vencimientoRutina(o);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <button type="button" onClick={onVer} className="min-h-control min-w-0 flex-1 text-left hover:text-primario">
        <span className="flex items-center gap-2">
          {o.semaforo && <span className={`h-3 w-3 shrink-0 rounded-full ${SEMAFORO[o.semaforo]}`} aria-hidden />}
          <span className="truncate">{o.rubro_nombre}: {o.objeto}</span>
        </span>
        <span className={`block text-sm ${v.tono}`}>
          {[v.texto, o.ciclo, o.requiere_informe_matriculado && 'matriculado', o.carga_sismesc && 'SISMESC', o.ot_codigo].filter(Boolean).join(' · ')}
        </span>
      </button>
      {onEjecutar && <Boton variante="fantasma" icono={CheckCircle2} onClick={onEjecutar}>Ejecutada</Boton>}
    </li>
  );
}

// ------------------------------------------------------------------ pestañas

function PorJefe({ ordenes, onVer, onCambio }: { ordenes: OrdenRutina[]; onVer: (o: OrdenRutina) => void; onCambio: () => Promise<void> }) {
  const { puedeValidar } = useSesion();
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const abiertas = ordenes.filter(ABIERTA);
  const jefes = useMemo(() => {
    const t = q.trim().toLowerCase();
    return agrupar(abiertas, (o) => o.jefe_sitio_nombre ?? 'Sin jefe de sitio')
      .filter(([jefe, os]) => !t || contiene(jefe, t) || os.some((o) => contiene(o.ubicacion_nombre, t)))
      .map(([jefe, os]) => ({ jefe, os, vencidas: os.filter((o) => o.semaforo === 'rojo').length, porVencer: os.filter((o) => o.semaforo === 'amarillo' && o.estado === 'pendiente').length }))
      .sort((a, b) => b.vencidas - a.vencidas || b.porVencer - a.porVencer || a.jefe.localeCompare(b.jefe));
  }, [abiertas, q]);

  async function ejecutar(o: OrdenRutina) {
    try {
      await actualizarOrdenRutina(o.id, { estado: 'ejecutada' });
      toast.success('Rutina ejecutada.');
      await onCambio();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  return (
    <>
      <Indicadores>
        <Indicador titulo="Jefes de sitio con rutinas" valor={jefes.length} icono={Users} />
        <Indicador titulo="Con rutinas vencidas" valor={jefes.filter((j) => j.vencidas > 0).length} icono={AlertTriangle} tono={jefes.some((j) => j.vencidas > 0) ? 'peligro' : 'neutro'} />
        <Indicador titulo="Rutinas vencidas" valor={abiertas.filter((o) => o.semaforo === 'rojo').length} icono={AlertTriangle} tono="peligro" />
        <Indicador titulo="Ejecutadas" valor={ordenes.filter((o) => o.estado === 'ejecutada').length} icono={CheckCircle2} tono="exito" />
      </Indicadores>
      <Campo etiqueta="Buscar por jefe de sitio o establecimiento" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      {jefes.length === 0 ? (
        <Vacio icono={Users} titulo="No hay rutinas abiertas" texto="Cuando se procesen las rutinas, acá aparecen agrupadas por jefe de sitio y por establecimiento." />
      ) : (
        <ul className="space-y-2">
          {jefes.map(({ jefe, os, vencidas, porVencer }) => (
            <li key={jefe} className={`tarjeta p-0 ${vencidas > 0 ? 'border-peligro/50' : porVencer > 0 ? 'border-alerta/50' : ''}`}>
              <button type="button" aria-expanded={abierto === jefe} onClick={() => setAbierto(abierto === jefe ? null : jefe)} className="flex min-h-campo w-full items-center gap-3 px-4 py-3 text-left">
                {abierto === jefe ? <ChevronDown className="h-5 w-5 shrink-0 text-suave" aria-hidden /> : <ChevronRight className="h-5 w-5 shrink-0 text-suave" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{jefe}</span>
                  <span className="block text-sm text-suave">
                    {cuantos(new Set(os.map((o) => o.ubicacion_id)).size, 'establecimiento', 'establecimientos')} · {cuantos(os.length, 'rutina abierta', 'rutinas abiertas')}
                    {vencidas > 0 && <span className="text-peligro"> · {vencidas} vencidas</span>}
                    {vencidas === 0 && porVencer > 0 && <span className="text-alerta"> · {porVencer} por vencer</span>}
                  </span>
                </span>
              </button>
              {abierto === jefe && (
                <div className="space-y-3 border-t px-4 py-3">
                  {agrupar(os, (o) => o.ubicacion_nombre).map(([lugar, delLugar]) => (
                    <div key={lugar}>
                      <p className="font-medium">{lugar}</p>
                      <ul className="divide-y">
                        {delLugar.sort((a, b) => a.dias_restantes - b.dias_restantes).map((o) => (
                          <FilaOrden key={o.id} o={o} onVer={() => onVer(o)}
                            onEjecutar={puedeValidar && !o.carga_sismesc && !o.requiere_informe_matriculado ? () => ejecutar(o) : undefined} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function General({ ordenes, onVer, onCambio }: { ordenes: OrdenRutina[]; onVer: (o: OrdenRutina) => void; onCambio: () => Promise<void> }) {
  const { puedeValidar } = useSesion();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<EstadoRutina | 'abiertas' | 'todas'>('abiertas');
  const [ciclo, setCiclo] = useState('');
  const [rubro, setRubro] = useState('');
  const [procesando, setProcesando] = useState(false);
  const rubros = useMemo(() => [...new Set(ordenes.map((o) => o.rubro_nombre))].sort(), [ordenes]);
  const lista = ordenes.filter((o) => (estado === 'todas' || (estado === 'abiertas' ? ABIERTA(o) : o.estado === estado)) && (!ciclo || o.ciclo === ciclo) && (!rubro || o.rubro_nombre === rubro)
    && (!q.trim() || contiene(o.objeto, q.trim().toLowerCase()) || contiene(o.ubicacion_nombre, q.trim().toLowerCase()) || contiene(o.rubro_nombre, q.trim().toLowerCase())));
  const n = (e: EstadoRutina) => ordenes.filter((o) => o.estado === e).length;

  async function procesar() {
    setProcesando(true);
    try {
      const r = await procesarRutinas();
      const generadas = r.ordenes_creadas === 1 ? 'Se generó 1 orden de rutina' : `Se generaron ${r.ordenes_creadas} órdenes de rutina`;
      const vencidas = r.ordenes_vencidas === 0 ? '' : r.ordenes_vencidas === 1 ? ' y 1 pasó a vencida' : ` y ${r.ordenes_vencidas} pasaron a vencidas`;
      toast.success(`${generadas}${vencidas}.`);
      await onCambio();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setProcesando(false);
    }
  }

  return (
    <>
      <Indicadores>
        <Indicador titulo="Pendientes" valor={n('pendiente')} icono={ClipboardList} tono="alerta" />
        <Indicador titulo="En proceso" valor={n('en_proceso')} icono={Cog} tono="info" />
        <Indicador titulo="Vencidas" valor={n('vencida')} icono={AlertTriangle} tono={n('vencida') > 0 ? 'peligro' : 'neutro'} />
        <Indicador titulo="Ejecutadas" valor={n('ejecutada')} icono={CheckCircle2} tono="exito" />
      </Indicadores>
      {puedeValidar && (
        <div className="tarjeta flex flex-wrap items-center justify-between gap-3">
          <p className="text-suave">Genera las rutinas que tocan hoy según su ciclo y marca las que pasaron su fecha límite. Se puede correr las veces que haga falta.</p>
          <Boton icono={RefreshCw} cargando={procesando} onClick={procesar}>Procesar rutinas</Boton>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-4">
        <Campo etiqueta="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} opciones={{ abiertas: 'Abiertas', todas: 'Todas', ...ESTADOS_RUTINA }} onChange={(e) => setEstado(e.target.value as typeof estado)} />
        <Selector etiqueta="Ciclo" value={ciclo} opciones={{ '': 'Todos', ...Object.fromEntries(CICLOS.map((c) => [c, c])) }} onChange={(e) => setCiclo(e.target.value)} />
        <Selector etiqueta="Rubro" value={rubro} opciones={{ '': 'Todos', ...Object.fromEntries(rubros.map((r) => [r, r])) }} onChange={(e) => setRubro(e.target.value)} />
      </div>
      {lista.length === 0 ? (
        <Vacio icono={ListChecks} titulo="No hay órdenes de rutina con ese filtro" texto="Si todavía no se generó ninguna: cargá el catálogo, sincronizá los establecimientos y tocá Procesar rutinas." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-superficie">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-suave">
                <th className="px-3 py-3 font-medium">Rutina</th>
                <th className="px-3 py-3 font-medium">Establecimiento</th>
                <th className="hidden px-3 py-3 font-medium md:table-cell">Ciclo</th>
                <th className="px-3 py-3 font-medium">Límite</th>
                <th className="px-3 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {lista.slice(0, 300).map((o) => (
                <tr key={o.id} className="border-b last:border-b-0 hover:bg-elevado/60">
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => onVer(o)} className="flex min-h-control items-center gap-2 text-left font-medium text-primario hover:underline">
                      {o.semaforo && <span className={`h-3 w-3 shrink-0 rounded-full ${SEMAFORO[o.semaforo]}`} aria-hidden />}
                      <span>{o.objeto}<span className="block text-xs font-normal text-suave">{o.rubro_nombre}{o.ot_codigo ? ` · ${o.ot_codigo}` : ''}</span></span>
                    </button>
                  </td>
                  <td className="px-3 py-3">{o.ubicacion_nombre}</td>
                  <td className="hidden px-3 py-3 md:table-cell">{o.ciclo}</td>
                  <td className="px-3 py-3"><span className={vencimientoRutina(o).tono}>{fmtFecha(o.fecha_limite)}</span></td>
                  <td className="px-3 py-3"><EstadoRutinaBadge estado={o.estado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.length > 300 && <p className="p-3 text-sm text-suave">Se muestran las primeras 300 de {lista.length}. Afiná el filtro para ver el resto.</p>}
        </div>
      )}
    </>
  );
}

function GenerarOTs({ ordenes, onCambio }: { ordenes: OrdenRutina[]; onCambio: () => Promise<void> }) {
  const sinOT = ordenes.filter((o) => (o.estado === 'pendiente' || o.estado === 'vencida') && !o.ot_id);
  const lugares = agrupar(sinOT, (o) => o.ubicacion_id);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function generar(ids: string[]) {
    setOcupado(ids.length === 1 ? ids[0] : 'todos');
    let hechas = 0;
    for (const id of ids) {
      try {
        await generarOTRutinas(id);
        hechas++;
      } catch (e) {
        toast.error(limpiarError(e));
      }
    }
    if (hechas > 0) toast.success(hechas === 1 ? 'Orden de trabajo generada.' : `${hechas} órdenes de trabajo generadas.`);
    setOcupado(null);
    await onCambio();
  }

  if (lugares.length === 0) {
    return <Vacio icono={CheckCircle2} titulo="Todas las rutinas tienen orden de trabajo" texto="No queda ninguna rutina pendiente o vencida sin orden asignada." />;
  }
  return (
    <>
      <Indicadores>
        <Indicador titulo="Establecimientos con rutinas sin orden" valor={lugares.length} icono={Wrench} />
        <Indicador titulo="Rutinas sin orden" valor={sinOT.length} icono={ClipboardList} />
        <Indicador titulo="Vencidas" valor={sinOT.filter((o) => o.estado === 'vencida').length} icono={AlertTriangle} tono="peligro" />
      </Indicadores>
      <div className="tarjeta flex flex-wrap items-center justify-between gap-3">
        <p className="text-suave">Genera una orden de trabajo por establecimiento, con sus rutinas como lista de tareas, asignada al jefe de sitio del lugar.</p>
        <Boton variante="primario" icono={Wrench} cargando={ocupado === 'todos'} disabled={!!ocupado} onClick={() => generar(lugares.map(([id]) => id))}>
          {lugares.length === 1 ? 'Generar la orden' : `Generar las ${lugares.length} órdenes`}
        </Boton>
      </div>
      <ul className="space-y-2">
        {lugares.map(([id, os]) => (
          <li key={id} className="tarjeta space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{os[0].ubicacion_nombre}</p>
                <p className="text-sm text-suave">{cuantos(os.length, 'rutina', 'rutinas')} · {os[0].jefe_sitio_nombre ?? 'sin jefe de sitio'}{os.some((o) => o.estado === 'vencida') && <span className="text-peligro"> · con vencidas</span>}</p>
              </div>
              <Boton icono={Wrench} cargando={ocupado === id} disabled={!!ocupado} onClick={() => generar([id])}>Generar orden</Boton>
            </div>
            <ul className="divide-y text-sm">
              {os.map((o) => <li key={o.id} className="flex flex-wrap justify-between gap-2 py-1"><span>{o.rubro_nombre}: {o.objeto}</span><span className={vencimientoRutina(o).tono}>{vencimientoRutina(o).texto}</span></li>)}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}

function Catalogo() {
  const { esGerencia } = useSesion();
  const carga = useCarga(listarCatalogo, []);
  const [q, setQ] = useState('');
  const [ciclo, setCiclo] = useState('');
  const [editando, setEditando] = useState<Rutina | null | 'nueva'>(null);

  if (editando) return <FormRutina rutina={editando === 'nueva' ? null : editando} onListo={(cambio) => { setEditando(null); if (cambio) void carga.recargar(); }} />;
  if (carga.cargando && !carga.datos) return <Esqueleto filas={4} />;
  if (carga.error) return <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />;

  const todas = carga.datos ?? [];
  const lista = todas.filter((r) => (!ciclo || r.ciclo === ciclo) && (!q.trim() || [r.objeto, r.rubro_nombre, r.item, r.acciones].some((t) => contiene(t, q.trim().toLowerCase()))));
  return (
    <>
      <Indicadores>
        <Indicador titulo="Rutinas" valor={todas.length} icono={ListChecks} />
        <Indicador titulo="De mantenimiento" valor={todas.filter((r) => r.tipo === 'mantenimiento').length} icono={Wrench} />
        <Indicador titulo="Requieren matriculado" valor={todas.filter((r) => r.requiere_informe_matriculado).length} icono={FileSignature} />
        <Indicador titulo="Rubros" valor={new Set(todas.map((r) => r.rubro_nombre)).size} icono={ClipboardList} />
      </Indicadores>
      <div className="grid gap-3 md:grid-cols-[1fr_14rem_auto] md:items-end">
        <Campo etiqueta="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        <Selector etiqueta="Ciclo" value={ciclo} opciones={{ '': 'Todos', ...Object.fromEntries(CICLOS.map((c) => [c, `${c} (${todas.filter((r) => r.ciclo === c).length})`])) }} onChange={(e) => setCiclo(e.target.value)} />
        {esGerencia && <Boton icono={Plus} onClick={() => setEditando('nueva')}>Nueva rutina</Boton>}
      </div>
      {lista.length === 0 ? (
        <Vacio icono={ListChecks} titulo={todas.length === 0 ? 'El catálogo está vacío' : 'Ninguna rutina coincide'}
          texto={todas.length === 0 ? 'Las rutinas del contrato (Anexo 3) llegan con la migración desde la versión anterior. También se pueden cargar acá, una por una.' : 'Probá con otro texto u otro ciclo.'} />
      ) : (
        <ul className="space-y-3">
          {agrupar(lista, (r) => r.rubro_nombre).map(([rubro, rs]) => (
            <li key={rubro} className="tarjeta space-y-2">
              <p className="font-semibold">{rubro} <span className="text-sm font-normal text-suave">· {rs.length}</span></p>
              <ul className="divide-y">
                {rs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className={r.activa ? '' : 'text-suave line-through'}>
                      {r.item && <span className="text-suave">{r.item} · </span>}{r.objeto}
                      <span className="block text-sm text-suave">
                        {[r.ciclo, `plazo ${r.plazo_dias} d`, r.tipo === 'informe' ? 'Informe' : 'Mantenimiento', r.requiere_informe_matriculado && 'Matriculado', r.carga_sismesc && 'SISMESC',
                          r.observaciones_tom && 'TOM', r.estacionalidad.length > 0 && `meses ${r.estacionalidad.join(', ')}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {esGerencia && <Boton variante="fantasma" onClick={() => setEditando(r)}>Editar</Boton>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Asignacion() {
  const { esGerencia } = useSesion();
  const [lugar, setLugar] = useState<ResultadoBusqueda | null>(null);
  const catalogo = useCarga(listarCatalogo, []);
  const asignadas = useCarga(async () => (lugar ? asignacionesDe(lugar.id) : []), [lugar?.id]);
  const [q, setQ] = useState('');
  const activas = (asignadas.datos ?? []).filter((a) => a.activa).length;

  async function alternar(r: Rutina) {
    if (!lugar) return;
    const a = (asignadas.datos ?? []).find((x) => x.rutina_id === r.id);
    try {
      await activarRutina(lugar.id, r.id, a?.id ?? null, !(a?.activa ?? false));
      await asignadas.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  return (
    <>
      <div className="tarjeta space-y-3">
        <BuscadorRemoto etiqueta="Establecimiento" tabla="ubicaciones" valor={lugar} onCambio={setLugar} ayuda="Elegí uno para ver y cambiar qué rutinas le corresponden." />
        {lugar && <p className="text-suave">{activas} de {(catalogo.datos ?? []).length} rutinas activas en este establecimiento.</p>}
      </div>
      {!lugar ? null : catalogo.cargando || asignadas.cargando && !asignadas.datos ? <Esqueleto filas={3} /> : (
        <>
          <Campo etiqueta="Buscar rutina" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="tarjeta divide-y">
            {(catalogo.datos ?? []).filter((r) => r.activa && (!q.trim() || contiene(r.objeto, q.trim().toLowerCase()) || contiene(r.rubro_nombre, q.trim().toLowerCase()))).map((r) => {
              const a = (asignadas.datos ?? []).find((x) => x.rutina_id === r.id);
              return (
                <li key={r.id}>
                  <label className="flex min-h-campo cursor-pointer items-center gap-3 py-1">
                    <input type="checkbox" className="h-6 w-6 shrink-0 accent-primario" checked={a?.activa ?? false} disabled={!esGerencia} onChange={() => alternar(r)} />
                    <span>
                      {r.rubro_nombre}: {r.objeto}
                      <span className="block text-sm text-suave">{r.ciclo}{a?.activa ? ` · próxima: ${fmtFecha(a.proxima_ejecucion)}${a.ultima_ejecucion ? ` · última: ${fmtFecha(a.ultima_ejecucion)}` : ''}` : ''}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

function Sincronizar({ onCambio }: { onCambio: () => Promise<void> }) {
  const [resultado, setResultado] = useState<ResumenRutinas | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function sincronizar() {
    setOcupado(true);
    try {
      setResultado(await sincronizarRutinas());
      await onCambio();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta space-y-4">
      <h2>Asignar el catálogo a todos los establecimientos</h2>
      <p className="text-suave">
        Le asigna cada rutina activa del catálogo a cada establecimiento activo del sector. Se puede repetir: solo agrega lo que falta
        (establecimientos nuevos o rutinas nuevas) y no toca lo que ya estaba asignado ni lo que se desactivó a mano.
      </p>
      <Boton variante="primario" icono={RefreshCw} cargando={ocupado} onClick={sincronizar}>Sincronizar</Boton>
      {resultado && (
        <div className="rounded border border-exito/40 bg-exito/10 p-3 text-exito" role="status">
          <p className="font-semibold">Sincronización terminada</p>
          <p>{cuantos(resultado.asignaciones_creadas, 'asignación nueva', 'asignaciones nuevas')}. En total: {resultado.ubicaciones} establecimientos, {resultado.rutinas} rutinas y {resultado.asignaciones} asignaciones.</p>
          {resultado.asignaciones_creadas > 0 && <p>Ahora tocá "Procesar rutinas" en el tablero general para generar las órdenes que correspondan.</p>}
        </div>
      )}
    </section>
  );
}

// Rutinas de mantenimiento: el catálogo del contrato, a qué establecimiento le toca cada una,
// y las órdenes que se generan según el ciclo.
export default function Rutinas() {
  const { esGerencia } = useSesion();
  const [tab, setTab] = useState<Tab>('jefes');
  const [detalle, setDetalle] = useState<OrdenRutina | null>(null);
  const carga = useCarga(() => listarOrdenesRutina('todas'), []);
  const ordenes = carga.datos ?? [];

  if (detalle) {
    return <DetalleRutina orden={detalle} onListo={(cambio) => { setDetalle(null); if (cambio) void carga.recargar(); }} />;
  }

  return (
    <>
      <header>
        <h1>Rutinas</h1>
        <p className="flex items-center gap-2 text-suave"><CalendarCheck className="h-5 w-5" aria-hidden />Mantenimiento programado según el catálogo del contrato</p>
      </header>
      <Pestanas activa={tab} onCambio={setTab} pestanas={[
        { id: 'jefes', texto: 'Por jefe de sitio' },
        { id: 'general', texto: 'Tablero general', cuenta: ordenes.filter((o) => o.estado === 'vencida').length, alerta: true },
        { id: 'generar', texto: 'Generar órdenes', cuenta: ordenes.filter((o) => (o.estado === 'pendiente' || o.estado === 'vencida') && !o.ot_id).length },
        { id: 'catalogo', texto: 'Catálogo' },
        { id: 'asignacion', texto: 'Asignación' },
        ...(esGerencia ? [{ id: 'sincronizar' as const, texto: 'Sincronizar' }] : []),
      ]} />

      {tab === 'catalogo' ? <Catalogo />
        : tab === 'asignacion' ? <Asignacion />
        : tab === 'sincronizar' ? <Sincronizar onCambio={carga.recargar} />
        : carga.cargando && !carga.datos ? <Esqueleto filas={4} />
        : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : tab === 'jefes' ? <PorJefe ordenes={ordenes} onVer={setDetalle} onCambio={carga.recargar} />
        : tab === 'general' ? <General ordenes={ordenes} onVer={setDetalle} onCambio={carga.recargar} />
        : <GenerarOTs ordenes={ordenes} onCambio={carga.recargar} />}
    </>
  );
}
