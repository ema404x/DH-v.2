'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Building2, CheckCircle2, Download, Flame, Save, Thermometer, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Selector, oNull } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { Chips, ElegirExcel, Indicador, Indicadores, Pestanas, descargarCSV } from '@/components/gestion/Piezas';
import { leerCalefaccion, type FilaCalefaccion } from '@/lib/excel';
import {
  ESTADOS_OPERATIVOS, TIPOS_EQUIPO, borrarEquipamiento, equipamientoDe, guardarEquipamiento, importarCalefaccion, periodosCalefaccion,
  type Equipamiento, type EstadoOperativo, type TipoEquipo,
} from '@/lib/operacion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

const ORDEN: EstadoOperativo[] = ['critico', 'alerta', 'normal', 'optimo'];
const TONO: Record<EstadoOperativo, { texto: string; barra: string; borde: string }> = {
  critico: { texto: 'text-peligro', barra: 'bg-peligro', borde: 'border-peligro/50' },
  alerta: { texto: 'text-alerta', barra: 'bg-alerta', borde: 'border-alerta/50' },
  normal: { texto: 'text-info', barra: 'bg-info', borde: 'border-borde' },
  optimo: { texto: 'text-exito', barra: 'bg-exito', borde: 'border-borde' },
};
const CATEGORIAS = [
  { id: 'calefaccion', texto: 'Calefacción', tipos: (t: TipoEquipo) => t !== 'otros' },
  { id: 'ventilacion', texto: 'Ventilación', tipos: (t: TipoEquipo) => t === 'aire_acondicionado_calor' || t === 'conductos' },
] as const;
type Categoria = (typeof CATEGORIAS)[number]['id'];

// Mismo criterio que la base (estado_operativo): menos de 50 crítico, menos de 75 alerta, menos de 90 normal.
const estadoDe = (funciona: number, total: number): EstadoOperativo => {
  const p = total > 0 ? (funciona * 100) / total : 0;
  return p < 50 ? 'critico' : p < 75 ? 'alerta' : p < 90 ? 'normal' : 'optimo';
};
const peor = (rs: Equipamiento[]): EstadoOperativo => ORDEN.find((e) => rs.some((r) => r.estado === e)) ?? 'optimo';
const pct = (rs: Equipamiento[]) => {
  const total = rs.reduce((t, r) => t + r.cantidad_total, 0);
  return total > 0 ? Math.round((rs.reduce((t, r) => t + r.cantidad_funciona, 0) * 100) / total) : 0;
};

function Barra({ valor, estado }: { valor: number; estado: EstadoOperativo }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 flex-1 rounded bg-elevado"><span className={`block h-2 rounded ${TONO[estado].barra}`} style={{ width: `${valor}%` }} /></span>
      <span className={`num w-14 whitespace-nowrap text-sm font-semibold ${TONO[estado].texto}`}>{valor} %</span>
    </div>
  );
}

function Editar({ equipo: e, onListo }: { equipo: Equipamiento; onListo: (cambio: boolean) => void }) {
  const [tipo, setTipo] = useState<TipoEquipo>(e.tipo_equipo);
  const [total, setTotal] = useState(String(e.cantidad_total));
  const [funciona, setFunciona] = useState(String(e.cantidad_funciona));
  const [obs, setObs] = useState(e.observaciones ?? '');
  const [ocupado, setOcupado] = useState(false);
  const t = Number(total) || 0;
  const f = Math.min(Number(funciona) || 0, t);

  async function hacer(accion: () => Promise<void>, exito: string) {
    setOcupado(true);
    try {
      await accion();
      toast.success(exito);
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
      setOcupado(false);
    }
  }
  const guardar = (ev: FormEvent) => {
    ev.preventDefault();
    void hacer(() => guardarEquipamiento(e.id, { tipo_equipo: tipo, cantidad_total: t, cantidad_funciona: f, observaciones: oNull(obs) }), 'Equipamiento guardado.');
  };

  return (
    <form onSubmit={guardar} className="tarjeta space-y-4">
      <h2>{e.escuela} · {e.periodo}</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <Selector etiqueta="Tipo de equipo" value={tipo} opciones={TIPOS_EQUIPO} onChange={(ev) => setTipo(ev.target.value as TipoEquipo)} />
        <Campo etiqueta="Cantidad total" inputMode="numeric" required value={total} onChange={(ev) => setTotal(ev.target.value.replace(/\D/g, ''))} />
        <Campo etiqueta="Funcionando" inputMode="numeric" required value={funciona} onChange={(ev) => setFunciona(ev.target.value.replace(/\D/g, ''))} />
      </div>
      <p className="text-suave">
        Con falla: <strong>{Math.max(0, t - f)}</strong> · Operativo: <strong>{t > 0 ? Math.round((f * 100) / t) : 0} %</strong> · Estado:{' '}
        <strong className={TONO[estadoDe(f, t)].texto}>{ESTADOS_OPERATIVOS[estadoDe(f, t)]}</strong> (se calcula solo)
      </p>
      <Area etiqueta="Observaciones" value={obs} onChange={(ev) => setObs(ev.target.value)} />
      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Save} cargando={ocupado} disabled={t <= 0}>Guardar</Boton>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Cancelar</Boton>
        <Boton variante="peligro" icono={Trash2} disabled={ocupado} onClick={() => window.confirm('¿Eliminar este registro de equipamiento?') && hacer(() => borrarEquipamiento(e.id), 'Registro eliminado.')}>Eliminar</Boton>
      </div>
    </form>
  );
}

function Importar({ onListo }: { onListo: (periodo: string | null) => void }) {
  const [periodo, setPeriodo] = useState(() => {
    const t = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(' de ', ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  });
  const [lectura, setLectura] = useState<{ filas: FilaCalefaccion[]; hojas: string[]; archivo: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function importar() {
    if (!lectura) return;
    setOcupado(true);
    try {
      const r = await importarCalefaccion(lectura.filas, periodo);
      const atencion = (r.por_estado.critico ?? 0) + (r.por_estado.alerta ?? 0);
      toast.success(`${r.importados} registros importados.${atencion === 1 ? ' 1 requiere atención.' : atencion > 1 ? ` ${atencion} requieren atención.` : ''}`);
      onListo(periodo.trim());
    } catch (e) {
      toast.error(limpiarError(e));
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta space-y-4">
      <h2>Importar relevamiento</h2>
      <p className="text-suave">
        Planilla .xlsx con una hoja por comuna ("COMUNA 8A", "COMUNA 8B"…): escuela en la columna B, jefe de sitio en la C, y cada tipo de equipo
        en tres columnas (cantidad, funciona, no funciona). Importar un período que ya existe lo reemplaza completo.
      </p>
      <div className="grid gap-4 md:grid-cols-[16rem_auto] md:items-end">
        <Campo etiqueta="Período del relevamiento" required value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
        <div><ElegirExcel texto="Elegir planilla (.xlsx)" leer={leerCalefaccion} onLeido={(l, archivo) => setLectura({ ...l, archivo })} /></div>
      </div>
      {lectura && (
        <div className="space-y-3 rounded border bg-elevado/40 p-3">
          <p><strong>{lectura.archivo}</strong> · {lectura.filas.length} registros de {new Set(lectura.filas.map((f) => f.escuela)).size} escuelas · hojas: {lectura.hojas.join(', ')}</p>
          <Boton variante="primario" icono={Upload} cargando={ocupado} disabled={!periodo.trim()} onClick={importar}>Importar en {periodo || '…'}</Boton>
        </div>
      )}
      <Boton variante="fantasma" onClick={() => onListo(null)}>Volver</Boton>
    </section>
  );
}

// Plan de infraestructura: estado del equipamiento de calefacción por establecimiento, según el último relevamiento.
export default function Calefaccion() {
  const { esGerencia, sectorEfectivo } = useSesion();
  const periodos = useCarga(periodosCalefaccion, []);
  const [periodo, setPeriodo] = useState('');
  const [categoria, setCategoria] = useState<Categoria | null>('calefaccion');
  const [tab, setTab] = useState<'tablero' | 'alertas' | 'detalle'>('tablero');
  const [q, setQ] = useState('');
  const [zona, setZona] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoOperativo | null>(null);
  const [editando, setEditando] = useState<Equipamiento | null>(null);
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    if (!periodo && periodos.datos?.length) setPeriodo(periodos.datos[0]);
  }, [periodo, periodos.datos]);

  const carga = useCarga(async () => (periodo ? equipamientoDe(periodo) : []), [periodo]);

  const vista = useMemo(() => {
    const cat = CATEGORIAS.find((c) => c.id === categoria);
    const deCategoria = (carga.datos ?? []).filter((r) => !cat || cat.tipos(r.tipo_equipo));
    const t = q.trim().toLowerCase();
    const filtrados = deCategoria.filter((r) => (!zona || r.zona === zona) && (!estado || r.estado === estado)
      && (!t || r.escuela.toLowerCase().includes(t) || (r.jefe_sitio_nombre ?? '').toLowerCase().includes(t)));
    const porEscuela = (rs: Equipamiento[]) => {
      const m = new Map<string, Equipamiento[]>();
      for (const r of rs) m.set(r.escuela, [...(m.get(r.escuela) ?? []), r]);
      return [...m.entries()].map(([escuela, registros]) => ({ escuela, registros, estado: peor(registros), pct: pct(registros) }));
    };
    const escuelas = porEscuela(filtrados).sort((a, b) => ORDEN.indexOf(a.estado) - ORDEN.indexOf(b.estado) || a.pct - b.pct);
    const zonas = [...new Set(deCategoria.map((r) => r.zona).filter((z): z is string => !!z))].sort();
    return { deCategoria, filtrados, escuelas, zonas, todasLasEscuelas: porEscuela(deCategoria) };
  }, [carga.datos, categoria, q, zona, estado]);

  if (importando) {
    return <Importar onListo={(p) => { setImportando(false); if (p) { setPeriodo(p); void periodos.recargar(); void carga.recargar(); } }} />;
  }
  if (editando) {
    return <Editar equipo={editando} onListo={(cambio) => { setEditando(null); if (cambio) void carga.recargar(); }} />;
  }

  const conProblemas = vista.escuelas.filter((e) => e.estado === 'critico' || e.estado === 'alerta');
  const exportar = () => descargarCSV(`infraestructura-${periodo}.csv`,
    ['Escuela', 'Jefe de sitio', 'Zona', 'Tipo de equipo', 'Total', 'Funciona', 'No funciona', '% operativo', 'Estado'],
    vista.filtrados.map((r) => [r.escuela, r.jefe_sitio_nombre, r.zona, TIPOS_EQUIPO[r.tipo_equipo], r.cantidad_total, r.cantidad_funciona, r.cantidad_no_funciona, r.porcentaje_operativo, ESTADOS_OPERATIVOS[r.estado]]));

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Plan de infraestructura</h1>
          <p className="text-suave">{sectorEfectivo?.nombre} · calefacción y climatización por establecimiento</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton icono={Download} onClick={exportar} disabled={vista.filtrados.length === 0}>Exportar</Boton>
          {esGerencia && <Boton variante="primario" icono={Upload} onClick={() => setImportando(true)}>Importar relevamiento</Boton>}
        </div>
      </header>

      {periodos.cargando && !periodos.datos ? (
        <Esqueleto filas={3} />
      ) : periodos.error ? (
        <ErrorVista mensaje={periodos.error} onReintentar={periodos.recargar} />
      ) : (periodos.datos ?? []).length === 0 ? (
        <Vacio icono={Thermometer} titulo="Todavía no hay relevamientos"
          texto={esGerencia ? 'Importá la planilla del relevamiento de calefacción para ver el estado de cada establecimiento.' : 'Cuando gerencia importe un relevamiento, acá se ve el estado de cada establecimiento.'} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-[16rem_1fr] md:items-end">
            <Selector etiqueta="Relevamiento" value={periodo} opciones={Object.fromEntries((periodos.datos ?? []).map((p) => [p, p]))} onChange={(e) => setPeriodo(e.target.value)} />
            <Chips opciones={CATEGORIAS.map((c) => ({ id: c.id, texto: c.texto }))} valor={categoria} onCambio={setCategoria} todos="Todos los equipos" />
          </div>

          {carga.cargando && !carga.datos ? <Esqueleto filas={4} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} /> : (
            <>
              <Indicadores>
                <Indicador titulo="Establecimientos" valor={vista.todasLasEscuelas.length} icono={Building2} nota={`${vista.deCategoria.length} registros`} />
                <Indicador titulo="Operativo en general" valor={`${pct(vista.deCategoria)} %`} icono={Flame} />
                <Indicador titulo="En estado crítico" valor={vista.todasLasEscuelas.filter((e) => e.estado === 'critico').length} icono={AlertTriangle} tono="peligro" />
                <Indicador titulo="En alerta" valor={vista.todasLasEscuelas.filter((e) => e.estado === 'alerta').length} icono={AlertTriangle} tono="alerta" />
              </Indicadores>

              <Pestanas activa={tab} onCambio={setTab} pestanas={[{ id: 'tablero', texto: 'Tablero' }, { id: 'alertas', texto: 'Alertas', cuenta: conProblemas.length, alerta: true }, { id: 'detalle', texto: 'Detalle' }]} />

              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <Campo etiqueta="Buscar por escuela o jefe de sitio" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
                <Chips opciones={vista.zonas.map((z) => ({ id: z, texto: z }))} valor={zona} onCambio={setZona} todos="Todas las zonas" />
              </div>
              <Chips opciones={ORDEN.map((e) => ({ id: e, texto: ESTADOS_OPERATIVOS[e] }))} valor={estado} onCambio={setEstado} todos="Todos los estados" />

              {(tab === 'alertas' ? conProblemas : vista.escuelas).length === 0 ? (
                <Vacio icono={CheckCircle2} titulo={tab === 'alertas' ? 'Ningún establecimiento en estado crítico o de alerta' : 'Nada coincide con el filtro'} texto="Probá con otra zona, otro estado u otro texto." />
              ) : tab === 'detalle' ? (
                <div className="overflow-x-auto rounded-lg border bg-superficie">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-suave">
                        <th className="px-3 py-3 font-medium">Escuela</th><th className="px-3 py-3 font-medium">Equipo</th>
                        <th className="num px-3 py-3 font-medium">Total</th><th className="num px-3 py-3 font-medium">Funciona</th><th className="num px-3 py-3 font-medium">Con falla</th>
                        <th className="px-3 py-3 font-medium">Operativo</th>{esGerencia && <th className="px-3 py-3" />}
                      </tr>
                    </thead>
                    <tbody>
                      {vista.escuelas.flatMap((e) => e.registros.map((r, i) => (
                        <tr key={r.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2">{i === 0 && <><span className="font-medium">{e.escuela}</span><span className="block text-xs text-suave">{[r.zona, r.jefe_sitio_nombre ?? 'sin jefe de sitio'].filter(Boolean).join(' · ')}</span></>}</td>
                          <td className="px-3 py-2">{TIPOS_EQUIPO[r.tipo_equipo]}</td>
                          <td className="num px-3 py-2">{r.cantidad_total}</td><td className="num px-3 py-2">{r.cantidad_funciona}</td><td className="num px-3 py-2">{r.cantidad_no_funciona}</td>
                          <td className="min-w-[10rem] px-3 py-2"><Barra valor={r.porcentaje_operativo} estado={r.estado} /><span className={`text-xs ${TONO[r.estado].texto}`}>{ESTADOS_OPERATIVOS[r.estado]}</span></td>
                          {esGerencia && <td className="px-3 py-2"><Boton variante="fantasma" onClick={() => setEditando(r)}>Editar</Boton></td>}
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(tab === 'alertas' ? conProblemas : vista.escuelas).map((e) => (
                    <li key={e.escuela} className={`tarjeta space-y-2 ${TONO[e.estado].borde}`}>
                      <div>
                        <p className="font-semibold">{e.escuela}</p>
                        <p className="text-sm text-suave">{[e.registros[0].zona, e.registros[0].jefe_sitio_nombre ?? 'Sin jefe de sitio'].filter(Boolean).join(' · ')}</p>
                      </div>
                      <Barra valor={e.pct} estado={e.estado} />
                      <p className={`text-sm font-medium ${TONO[e.estado].texto}`}>{ESTADOS_OPERATIVOS[e.estado]}</p>
                      <ul className="space-y-1 text-sm">
                        {[...e.registros].sort((a, b) => a.porcentaje_operativo - b.porcentaje_operativo).slice(0, tab === 'alertas' ? 8 : 4).map((r) => (
                          <li key={r.id} className="flex justify-between gap-2">
                            <span>{TIPOS_EQUIPO[r.tipo_equipo]} <span className="text-suave">({r.cantidad_total})</span></span>
                            <span className={r.cantidad_no_funciona > 0 ? TONO[r.estado].texto : 'text-suave'}>{r.cantidad_no_funciona > 0 ? `${r.cantidad_no_funciona} sin funcionar` : 'todo funciona'}</span>
                          </li>
                        ))}
                      </ul>
                      {e.registros.find((r) => r.observaciones) && <p className="border-t pt-2 text-sm text-suave">{e.registros.find((r) => r.observaciones)!.observaciones}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
