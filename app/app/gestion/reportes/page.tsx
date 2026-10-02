'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, Coins, Download, Inbox, Printer, Siren, Timer, Trophy } from 'lucide-react';
import { Boton } from '@/components/Boton';
import { Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { BarrasHorizontales, Columnas } from '@/components/gestion/Graficos';
import { Indicador, Indicadores, Pestanas, descargarCSV } from '@/components/gestion/Piezas';
import { fmtPesos } from '@/lib/certificacion';
import { obtenerReporte, type Reporte } from '@/lib/control';
import { cant } from '@/lib/panol';
import { ESTADOS_PENDIENTE } from '@/lib/operacion';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { PRIORIDADES, TIPOS_OT, type ResultadoBusqueda } from '@/lib/types';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const pct = (n: number | null) => (n === null ? '—' : `${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`);
const dias = (n: number | null) => (n === null ? '—' : `${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 })} d`);
const horas = (n: number) => `${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 })} h`;
const iso = (d: Date) => d.toLocaleDateString('sv-SE');

function Bloque({ titulo, children, exportar }: { titulo: string; children: ReactNode; exportar?: () => void }) {
  return (
    <section className="tarjeta space-y-3" style={{ breakInside: 'avoid-page' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>{titulo}</h2>
        {exportar && <span className="no-imprimir"><Boton variante="fantasma" icono={Download} onClick={exportar}>CSV</Boton></span>}
      </div>
      {children}
    </section>
  );
}

const PRESETS = { mes: 'Este mes', '30': 'Últimos 30 días', '90': 'Últimos 3 meses', '180': 'Últimos 6 meses', anio: 'Este año', otro: 'Elegir fechas' };

// Reportes de operación. Todo se calcula en la base, con una sola definición de cada indicador; los filtros son el
// período (días de Buenos Aires), la zona y el jefe de sitio del lugar.
export default function Reportes() {
  const { sectorEfectivo } = useSesion();
  const hoy = new Date();
  const [preset, setPreset] = useState<keyof typeof PRESETS>('90');
  const [desdeManual, setDesdeManual] = useState(iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
  const [hastaManual, setHastaManual] = useState(iso(hoy));
  const [zona, setZona] = useState('');
  const [jefe, setJefe] = useState<ResultadoBusqueda | null>(null);
  const [pestana, setPestana] = useState<'ordenes' | 'pendientes' | 'jefes' | 'recursos'>('ordenes');
  const zonas = sectorEfectivo?.config?.zonas ?? [];

  const [desde, hasta] = useMemo(() => {
    const d = new Date();
    if (preset === 'otro') return [desdeManual, hastaManual];
    if (preset === 'mes') return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)];
    if (preset === 'anio') return [iso(new Date(d.getFullYear(), 0, 1)), iso(d)];
    return [iso(new Date(d.getTime() - Number(preset) * 86400000)), iso(d)];
  }, [preset, desdeManual, hastaManual]);

  const carga = useCarga(() => obtenerReporte(desde, hasta, zona || null, jefe?.id ?? null), [desde, hasta, zona, jefe?.id]);
  const r: Reporte | null = carga.datos;
  const nombreArchivo = (s: string) => `reporte-${s}-${desde}-a-${hasta}.csv`;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Reportes</h1>
          <p className="text-suave">{sectorEfectivo?.nombre} · del {new Date(`${desde}T12:00:00`).toLocaleDateString('es-AR')} al {new Date(`${hasta}T12:00:00`).toLocaleDateString('es-AR')}{zona && ` · zona ${zona}`}{jefe && ` · ${jefe.etiqueta}`}</p>
        </div>
        <span className="no-imprimir"><Boton icono={Printer} onClick={() => window.print()} disabled={!r}>Imprimir o guardar en PDF</Boton></span>
      </header>

      <div className="no-imprimir grid gap-3 md:grid-cols-[12rem_auto_12rem_1fr]">
        <Selector etiqueta="Período" value={preset} onChange={(e) => setPreset(e.target.value as keyof typeof PRESETS)} opciones={PRESETS} />
        {preset === 'otro' ? (
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Desde" type="date" value={desdeManual} onChange={(e) => setDesdeManual(e.target.value)} />
            <Campo etiqueta="Hasta" type="date" value={hastaManual} onChange={(e) => setHastaManual(e.target.value)} />
          </div>
        ) : <div />}
        <Selector etiqueta="Zona" value={zona} onChange={(e) => setZona(e.target.value)} opciones={{ '': 'Todas', ...Object.fromEntries(zonas.map((z) => [z, z])) }} />
        <BuscadorRemoto etiqueta="Jefe de sitio" tabla="jefes" valor={jefe} onCambio={setJefe} />
      </div>

      {carga.cargando && !r ? <Esqueleto filas={6} /> : carga.error || !r ? <ErrorVista mensaje={carga.error ?? 'No se pudo armar el reporte.'} onReintentar={carga.recargar} /> : (
        <>
          <Indicadores>
            <Indicador titulo="Órdenes del período" valor={r.ots.total} icono={ClipboardList} nota={`${r.ots.abiertas} abiertas`} />
            <Indicador titulo="Eficiencia" valor={pct(r.ots.eficiencia)} icono={CheckCircle2} tono="exito" nota="Completadas ÷ (todas − canceladas)" />
            <Indicador titulo="Pendientes SAP resueltos" valor={pct(r.pendientes.tasa_resolucion)} icono={Inbox} nota={`MTTR ${dias(r.pendientes.mttr_dias)}`} />
            <Indicador titulo="Vencidas hoy" valor={r.ots.vencidas + r.pendientes.vencidos} icono={AlertTriangle} tono={r.ots.vencidas + r.pendientes.vencidos > 0 ? 'peligro' : 'neutro'}
              nota={`${r.ots.vencidas} órdenes · ${r.pendientes.vencidos} pendientes`} />
          </Indicadores>

          <div className="no-imprimir">
            <Pestanas activa={pestana} onCambio={setPestana} pestanas={[
              { id: 'ordenes', texto: 'Órdenes' }, { id: 'pendientes', texto: 'Pendientes SAP' }, { id: 'jefes', texto: 'Jefes y personal' }, { id: 'recursos', texto: 'Horas, materiales y emergencias' },
            ]} />
          </div>

          {/* Al imprimir salen todas las secciones. */}
          <div className={pestana === 'ordenes' ? 'space-y-4' : 'hidden space-y-4 print:block'}>
            <Bloque titulo="Órdenes por mes" exportar={() => descargarCSV(nombreArchivo('ordenes-por-mes'), ['Mes', 'Total', 'Completadas', 'Abiertas'], r.ots.por_mes.map((m) => [m.mes, m.total, m.completadas, m.abiertas]))}>
              <Columnas datos={r.ots.por_mes.map((m) => ({ etiqueta: etiquetaMes(m.mes), total: m.total, parte: m.completadas }))} leyenda={['Creadas', 'Completadas']} />
              <p className="text-sm text-suave">Cierre promedio: {dias(r.ots.dias_promedio_cierre)} desde que se crea la orden.</p>
            </Bloque>
            <div className="grid gap-4 lg:grid-cols-2">
              <Bloque titulo="Por tipo de trabajo">
                <BarrasHorizontales barras={r.ots.por_tipo.map((t) => ({ etiqueta: TIPOS_OT[t.clave as keyof typeof TIPOS_OT] ?? t.clave, valor: t.cantidad }))} />
              </Bloque>
              <Bloque titulo="Por prioridad">
                <BarrasHorizontales barras={r.ots.por_prioridad.map((t) => ({ etiqueta: PRIORIDADES[t.clave as keyof typeof PRIORIDADES] ?? t.clave, valor: t.cantidad, parte: t.completadas,
                  detalle: `${t.completadas ?? 0} de ${t.cantidad}` }))} />
              </Bloque>
            </div>
            <Bloque titulo="Por zona" exportar={() => descargarCSV(nombreArchivo('ordenes-por-zona'), ['Zona', 'Total', 'Completadas', 'Vencidas'], r.ots.por_zona.map((z) => [z.zona, z.total, z.completadas, z.vencidas]))}>
              <BarrasHorizontales barras={r.ots.por_zona.map((z) => ({ etiqueta: z.zona, valor: z.total, parte: z.completadas, detalle: `${z.completadas} de ${z.total}${z.vencidas ? ` · ${z.vencidas} vencidas` : ''}` }))} />
            </Bloque>
          </div>

          <div className={pestana === 'pendientes' ? 'space-y-4' : 'hidden space-y-4 print:block'}>
            <Indicadores>
              <Indicador titulo="Pendientes del período" valor={r.pendientes.total} icono={Inbox} nota={`${r.pendientes.activos} activos`} />
              <Indicador titulo="Sin asignar" valor={r.pendientes.sin_asignar} icono={AlertTriangle} tono={r.pendientes.sin_asignar > 0 ? 'alerta' : 'neutro'} />
              <Indicador titulo="Tiempo de resolución (MTTR)" valor={dias(r.pendientes.mttr_dias)} icono={Timer} nota="De asignado a resuelto" />
              <Indicador titulo="Backlog" valor={r.pendientes.backlog === null ? '—' : r.pendientes.backlog.toLocaleString('es-AR')} icono={ClipboardList} nota="Activos por cada resuelto" />
            </Indicadores>
            <div className="grid gap-4 lg:grid-cols-2">
              <Bloque titulo="Antigüedad de los activos">
                <BarrasHorizontales barras={[
                  { etiqueta: 'Hasta 7 días', valor: r.pendientes.antiguedad.hasta_7 }, { etiqueta: '8 a 30 días', valor: r.pendientes.antiguedad.de_8_a_30 },
                  { etiqueta: '31 a 60 días', valor: r.pendientes.antiguedad.de_31_a_60 }, { etiqueta: 'Más de 60 días', valor: r.pendientes.antiguedad.mas_de_60 },
                ]} />
              </Bloque>
              <Bloque titulo="Por estado">
                <BarrasHorizontales barras={r.pendientes.por_estado.map((e) => ({ etiqueta: ESTADOS_PENDIENTE[e.clave as keyof typeof ESTADOS_PENDIENTE] ?? e.clave, valor: e.cantidad }))} />
              </Bloque>
            </div>
            <Bloque titulo="Por zona" exportar={() => descargarCSV(nombreArchivo('pendientes-por-zona'), ['Zona', 'Total', 'Resueltos', 'Activos', 'Vencidos'],
              r.pendientes.por_zona.map((z) => [z.zona, z.total, z.resueltos, z.activos, z.vencidos]))}>
              <BarrasHorizontales barras={r.pendientes.por_zona.map((z) => ({ etiqueta: z.zona, valor: z.total, parte: z.resueltos,
                detalle: `${z.resueltos} resueltos · ${z.activos} activos${z.vencidos ? ` · ${z.vencidos} vencidos` : ''}` }))} />
            </Bloque>
          </div>

          <div className={pestana === 'jefes' ? 'space-y-4' : 'hidden space-y-4 print:block'}>
            <Bloque titulo="Ranking de jefes de sitio" exportar={() => descargarCSV(nombreArchivo('jefes'), ['Jefe de sitio', 'Puntaje', 'Pendientes', 'Resueltos', 'Vencidos', 'MTTR (días)', 'Órdenes', 'Completadas'],
              r.jefes.map((j) => [j.nombre, j.puntaje, j.pendientes, j.resueltos, j.vencidos, j.mttr_dias, j.ots, j.ots_completadas]))}>
              <p className="text-sm text-suave">Puntaje: 50 % resolución de pendientes + 30 % eficiencia de órdenes + 20 puntos (menos 4 por cada pendiente vencido).</p>
              {r.jefes.length === 0 ? <p className="text-suave">Sin jefes con trabajo en el período.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead><tr className="border-b text-left text-suave">
                      <th className="py-2 pr-2 font-medium">Jefe de sitio</th><th className="num py-2 pr-2 font-medium">Puntaje</th><th className="num py-2 pr-2 font-medium">Pendientes</th>
                      <th className="num py-2 pr-2 font-medium">Vencidos</th><th className="num py-2 pr-2 font-medium">MTTR</th><th className="num py-2 font-medium">Órdenes</th>
                    </tr></thead>
                    <tbody>
                      {r.jefes.map((j, i) => (
                        <tr key={j.id} className="border-b last:border-b-0">
                          <td className="py-2 pr-2">{i === 0 && <Trophy className="mr-1 inline h-4 w-4 text-alerta" aria-label="Primero" />}{j.nombre}</td>
                          <td className={`num py-2 pr-2 font-semibold ${j.puntaje >= 80 ? 'text-exito' : j.puntaje >= 60 ? 'text-alerta' : 'text-peligro'}`}>{j.puntaje}</td>
                          <td className="num py-2 pr-2">{j.resueltos} de {j.pendientes}</td>
                          <td className="num py-2 pr-2">{j.vencidos}</td>
                          <td className="num py-2 pr-2">{dias(j.mttr_dias)}</td>
                          <td className="num py-2">{j.ots_completadas} de {j.ots}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Bloque>
            <Bloque titulo="Órdenes por operario" exportar={() => descargarCSV(nombreArchivo('operarios'), ['Operario', 'Órdenes', 'Completadas', 'Eficiencia %'],
              r.ots.por_operario.map((o) => [o.nombre, o.total, o.completadas, o.eficiencia]))}>
              <BarrasHorizontales barras={r.ots.por_operario.slice(0, 15).map((o) => ({ etiqueta: o.nombre, valor: o.total, parte: o.completadas, detalle: `${o.completadas} de ${o.total} · ${pct(o.eficiencia)}` }))} />
            </Bloque>
          </div>

          <div className={pestana === 'recursos' ? 'space-y-4' : 'hidden space-y-4 print:block'}>
            <Indicadores>
              <Indicador titulo="Horas cargadas" valor={horas(r.horas.total)} icono={Clock} nota={`${horas(r.horas.extra)} extra o guardia`} />
              <Indicador titulo="Materiales usados" valor={<span className="text-lg">{fmtPesos(r.materiales.salidas_valor)}</span>} icono={Coins} nota={`Compras: ${fmtPesos(r.materiales.compras_valor)}`} />
              <Indicador titulo="Emergencias" valor={r.emergencias.total} icono={Siren} tono={r.emergencias.abiertas > 0 ? 'peligro' : 'neutro'} nota={`${r.emergencias.abiertas} abiertas`} />
              <Indicador titulo="Respuesta a emergencias" valor={r.emergencias.minutos_atencion === null ? '—' : `${r.emergencias.minutos_atencion} min`} icono={Timer}
                nota={r.emergencias.minutos_resolucion === null ? undefined : `Resolución: ${r.emergencias.minutos_resolucion} min`} />
            </Indicadores>
            <div className="grid gap-4 lg:grid-cols-2">
              <Bloque titulo="Horas por persona" exportar={() => descargarCSV(nombreArchivo('horas'), ['Persona', 'Horas', 'Órdenes'], r.horas.por_persona.map((p) => [p.nombre, p.horas, p.ordenes]))}>
                <BarrasHorizontales barras={r.horas.por_persona.slice(0, 15).map((p) => ({ etiqueta: p.nombre, valor: Number(p.horas), detalle: `${horas(p.horas)} · ${p.ordenes} órd.` }))} />
              </Bloque>
              <Bloque titulo="Materiales por obra" exportar={() => descargarCSV(nombreArchivo('materiales-por-obra'), ['Obra', 'Valor'], r.materiales.por_obra.map((o) => [o.obra, o.valor]))}>
                <BarrasHorizontales barras={r.materiales.por_obra.map((o) => ({ etiqueta: o.obra, valor: Number(o.valor) }))} formato={(n) => fmtPesos(n)} vacio="Sin salidas del pañol a obras en el período." />
              </Bloque>
              <Bloque titulo="Materiales más usados">
                <BarrasHorizontales barras={r.materiales.mas_usados.map((m) => ({ etiqueta: m.material, valor: Number(m.valor), detalle: `${cant(m.cantidad, m.unidad)} · ${fmtPesos(m.valor)}` }))}
                  vacio="Sin consumos del pañol en el período." />
              </Bloque>
              <Bloque titulo="Emergencias por tipo">
                <BarrasHorizontales barras={r.emergencias.por_tipo.map((e) => ({ etiqueta: e.clave.replace(/_/g, ' '), valor: e.cantidad }))} vacio="Sin emergencias en el período." />
              </Bloque>
            </div>
          </div>
        </>
      )}
    </>
  );
}
