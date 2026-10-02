'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Coins, History, Lock, Plus, Printer, Save, Trash2, Upload, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { fmtFecha } from '@/components/OTCard';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Chips, ElegirExcel, Indicador, Indicadores, Pestanas, descargarCSV } from '@/components/gestion/Piezas';
import { fmtPesos } from '@/lib/certificacion';
import { leerPlanillaCobros, type FilaCobro } from '@/lib/excel';
import {
  COLORES_AVANCE, ESTADOS_COBRO, PRIORIDADES_COBRO, TONO_COBRO, TRAMOS, abrirCiclo, cerrarCiclo, fmtPct, guardarCobro, historialCobro, importarCobros,
  listarCiclos, listarCobros, sacarDelCiclo, sumarObraAlCiclo, type Cobro, type EstadoCobro, type ResultadoCobros,
} from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

const COLOR: Record<string, string> = {
  rojo: 'bg-peligro', amarillo: 'bg-alerta', naranja: 'bg-[hsl(var(--serie-4))]', verde: 'bg-exito', azul: 'bg-info', gris: 'bg-suave',
};
const TEXTO_TONO = { exito: 'text-exito', alerta: 'text-alerta', neutro: 'text-suave', peligro: 'text-peligro', info: 'text-info' };
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const mesSiguiente = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`;
};

// Sin tramo hay dos casos: la obra llegó al 100 % o todavía no tiene avance.
const nombreTramo = (c: Cobro) => (c.tramo ? TRAMOS[c.tramo] : Number(c.avance) >= 100 ? 'Completo' : 'Sin avance');

function Punto({ color }: { color: string }) {
  return <span className={`inline-block h-3 w-3 shrink-0 rounded-full ${COLOR[color] ?? 'bg-suave'}`} aria-hidden />;
}

function totales(filas: Cobro[]) {
  const listo = filas.filter((c) => c.estado_cobro === 'listo_certificar');
  return {
    obras: filas.length,
    total: filas.reduce((t, c) => t + Number(c.monto_a_cobrar), 0),
    listas: listo.length,
    listo: listo.reduce((t, c) => t + Number(c.monto_a_cobrar), 0),
    observadas: filas.filter((c) => c.estado_cobro === 'observado').length,
  };
}

// ------------------------------------------------------------------ edición de una fila

function EditarCobro({ cobro, editable, esGerencia, onListo }: { cobro: Cobro; editable: boolean; esGerencia: boolean; onListo: (cambio: boolean) => void }) {
  const c = cobro;
  const [f, setF] = useState({
    estado_cobro: c.estado_cobro, prioridad: c.prioridad, monto_a_cobrar: String(Number(c.monto_a_cobrar)), avance: String(Number(c.avance)),
    tramo_manual: c.tramo_manual ?? '', color_avance: c.color_avance, motivo_observacion: c.motivo_observacion ?? '', periodo: c.periodo ?? '', notas: c.notas ?? '',
  });
  const [guardando, setGuardando] = useState(false);
  const historial = useCarga(() => historialCobro(c.id), [c.id]);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value })) });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const monto = Number(f.monto_a_cobrar.replace(/\./g, '').replace(',', '.'));
    const avance = Number(f.avance.replace(',', '.'));
    if (Number.isNaN(monto) || Number.isNaN(avance)) {
      toast.error('El monto y el avance tienen que ser números.');
      return;
    }
    setGuardando(true);
    try {
      await guardarCobro(c.id, {
        estado_cobro: f.estado_cobro as EstadoCobro, prioridad: f.prioridad as Cobro['prioridad'], monto_a_cobrar: monto, avance,
        tramo_manual: f.tramo_manual || null, color_avance: f.color_avance, motivo_observacion: f.motivo_observacion.trim() || null,
        periodo: f.periodo.trim() || null, notas: f.notas.trim() || null,
      });
      toast.success('Cobro guardado.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  async function sacar() {
    if (!window.confirm(`¿Sacar "${c.titulo}" de este ciclo? La obra no se borra.`)) return;
    try {
      await sacarDelCiclo(c.id);
      toast.success('La obra salió del ciclo.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words">{c.titulo}</h1>
          <p className="text-suave">{[c.mtom && `MTOM ${c.mtom}`, c.mein && `MEIN ${c.mein}`, c.establecimiento, c.zona, c.ciclo_nombre].filter(Boolean).join(' · ')}</p>
        </div>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Volver al ciclo</Boton>
      </header>
      {!editable && <p className="rounded border border-info/40 bg-info/10 p-3 text-info">Este ciclo está cerrado: sus registros quedan como estaban al cerrarlo.</p>}
      <form onSubmit={guardar} className="space-y-4">
        <fieldset disabled={!editable} className="tarjeta space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Selector etiqueta="Estado del cobro" opciones={ESTADOS_COBRO} {...campo('estado_cobro')} />
            <Selector etiqueta="Prioridad" opciones={PRIORIDADES_COBRO} {...campo('prioridad')} />
            <Campo etiqueta="Período" placeholder="Ej.: Octubre 2026" {...campo('periodo')} />
            <Campo etiqueta="Monto a cobrar" inputMode="decimal" {...campo('monto_a_cobrar')} ayuda={`Monto base de la obra: ${fmtPesos(c.monto_base)}`} />
            <Campo etiqueta="Avance (%)" inputMode="decimal" {...campo('avance')} />
            <Selector etiqueta="Tramo" opciones={{ '': 'Según el avance', ...TRAMOS }} {...campo('tramo_manual')} />
            <Selector etiqueta="Color" opciones={COLORES_AVANCE} {...campo('color_avance')} />
          </div>
          {f.estado_cobro === 'observado' && <Area etiqueta="Motivo de la observación" required {...campo('motivo_observacion')} />}
          <Area etiqueta="Notas" {...campo('notas')} />
        </fieldset>
        {editable && (
          <div className="flex flex-wrap justify-between gap-3">
            <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar</Boton>
            {esGerencia && <Boton variante="peligro" icono={Trash2} onClick={sacar}>Sacar del ciclo</Boton>}
          </div>
        )}
      </form>
      <section className="tarjeta space-y-3">
        <h2>Historial</h2>
        {historial.cargando && !historial.datos ? <Esqueleto filas={2} /> : historial.error ? <ErrorVista mensaje={historial.error} onReintentar={historial.recargar} /> : (
          <ol className="space-y-3">
            {(historial.datos ?? []).map((h) => (
              <li key={h.id} className="flex gap-3">
                <History className="mt-0.5 h-5 w-5 shrink-0 text-suave" aria-hidden />
                <div>
                  <p className="text-sm text-suave">{h.usuario_nombre ?? 'Sistema'} · {new Date(h.created_at).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' })}</p>
                  <p>{h.descripcion}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ importación

function Importar({ ciclo, onListo }: { ciclo: string; onListo: (cambio: boolean) => void }) {
  const [lectura, setLectura] = useState<{ filas: FilaCobro[]; hojas: { nombre: string; obras: number }[]; archivo: string } | null>(null);
  const [resultado, setResultado] = useState<ResultadoCobros | null>(null);
  const [importando, setImportando] = useState(false);

  async function importar() {
    if (!lectura) return;
    setImportando(true);
    try {
      setResultado(await importarCobros(lectura.filas));
      setLectura(null);
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Importar la planilla de certificación</h1>
        <Boton variante="fantasma" onClick={() => onListo(!!resultado)}>Volver al ciclo</Boton>
      </header>
      <section className="tarjeta space-y-4">
        <p className="text-suave">
          Una hoja por comuna, con encabezados: TITULO DE OBRA EN SAP, DIRECCION, ESTABLECIMIENTO, JEFE DE SITIO, INSPECTOR, N° MTOM, N° MEIN, MONTO BASE, %,
          PLAZO, ACTA DE INICIO, ACTA DE RECEPCION y OBSERVACIONES. Se carga en el ciclo abierto ({ciclo}). Cada obra se busca por su MTOM (o por el título);
          si no existe, se crea. Las observaciones definen el estado: "listo para certificar", "falta cargar actas", "observado" o, si no, pendiente.
        </p>
        <ElegirExcel texto="Elegir planilla (.xlsx)" leer={leerPlanillaCobros} onLeido={(l, archivo) => { setLectura({ ...l, archivo }); setResultado(null); }} />
      </section>
      {lectura && (
        <section className="tarjeta space-y-4">
          <p><strong>{lectura.archivo}</strong> · {lectura.filas.length} obras</p>
          <ul className="text-sm text-suave">{lectura.hojas.map((h) => <li key={h.nombre}>Hoja "{h.nombre}": {h.obras} obras</li>)}</ul>
          <Boton variante="primario" icono={Upload} cargando={importando} onClick={importar}>Importar {lectura.filas.length} obras al ciclo</Boton>
        </section>
      )}
      {resultado && (
        <div className="rounded border border-exito/40 bg-exito/10 p-3 text-exito" role="status">
          <p className="font-semibold">Importación terminada</p>
          <p>
            {resultado.nuevas === 1 ? '1 obra entró' : `${resultado.nuevas} obras entraron`} al ciclo y{' '}
            {resultado.actualizadas === 1 ? '1 se actualizó' : `${resultado.actualizadas} se actualizaron`}.
            {resultado.obras_nuevas === 1 && ' Se creó 1 obra que no estaba cargada.'}
            {resultado.obras_nuevas > 1 && ` Se crearon ${resultado.obras_nuevas} obras que no estaban cargadas.`}
            {resultado.omitidas > 0 && (resultado.omitidas === 1 ? ' 1 fila sin título.' : ` ${resultado.omitidas} filas sin título.`)}
          </p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ hoja para imprimir, por comuna

function Hoja({ ciclo, filas, onVolver }: { ciclo: string; filas: Cobro[]; onVolver: () => void }) {
  const grupos = useMemo(() => {
    const m = new Map<string, Cobro[]>();
    for (const c of filas) m.set(c.zona ?? 'Sin zona', [...(m.get(c.zona ?? 'Sin zona') ?? []), c]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
  }, [filas]);
  const t = totales(filas);
  return (
    <div className="space-y-4">
      <div className="no-imprimir flex flex-wrap justify-between gap-3">
        <Boton variante="fantasma" onClick={onVolver}>Volver al ciclo</Boton>
        <Boton variante="primario" icono={Printer} onClick={() => window.print()}>Imprimir o guardar en PDF</Boton>
      </div>
      <article className="hoja space-y-6 rounded-lg bg-papel p-6 text-sm text-tinta">
        <header>
          <h1>Certificación de obras · {ciclo}</h1>
          <p>{t.obras} obras · a cobrar {fmtPesos(t.total)} · listas para certificar: {t.listas} ({fmtPesos(t.listo)}) · emitido el {new Date().toLocaleDateString('es-AR')}</p>
        </header>
        {grupos.map(([zona, lista]) => {
          const tz = totales(lista);
          return (
            <section key={zona} className="space-y-2" style={{ breakInside: 'avoid-page' }}>
              <h2>Comuna {zona}</h2>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-tinta/30 text-left">
                    <th className="py-1 pr-2">Obra</th><th className="py-1 pr-2">MTOM</th><th className="py-1 pr-2">Jefe de sitio</th>
                    <th className="py-1 pr-2">Estado</th><th className="num py-1 pr-2">Avance</th><th className="num py-1">A cobrar</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((c) => (
                    <tr key={c.id} className="border-b border-tinta/15 align-top">
                      <td className="py-1 pr-2">{c.titulo}{c.establecimiento && <span className="block text-xs">{c.establecimiento}</span>}</td>
                      <td className="py-1 pr-2">{c.mtom ?? '—'}</td>
                      <td className="py-1 pr-2">{c.jefe_sitio_nombre ?? '—'}</td>
                      <td className="py-1 pr-2">{ESTADOS_COBRO[c.estado_cobro]}{c.motivo_observacion && <span className="block text-xs">{c.motivo_observacion}</span>}</td>
                      <td className="num py-1 pr-2">{fmtPct(c.avance)}</td>
                      <td className="num py-1">{fmtPesos(c.monto_a_cobrar)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-1" colSpan={5}>Total comuna {zona} · listo para certificar {fmtPesos(tz.listo)}</td>
                    <td className="num py-1">{fmtPesos(tz.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          );
        })}
      </article>
    </div>
  );
}

// ------------------------------------------------------------------ tablero

export default function CobroObras() {
  const { puedeValidar, esGerencia } = useSesion();
  const ciclos = useCarga(listarCiclos, []);
  const [cicloId, setCicloId] = useState<string | null>(null);
  const ciclo = (ciclos.datos ?? []).find((c) => c.id === cicloId) ?? null;
  const [zona, setZona] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoCobro | null>(null);
  const [texto, setTexto] = useState('');
  const [vista, setVista] = useState<{ tipo: 'tablero' } | { tipo: 'editar'; cobro: Cobro } | { tipo: 'importar' } | { tipo: 'hoja' }>({ tipo: 'tablero' });
  const [obraNueva, setObraNueva] = useState<ResultadoBusqueda | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  // Por defecto, el ciclo abierto (o el último, si no hay uno abierto).
  useEffect(() => {
    if (!cicloId && ciclos.datos?.length) setCicloId((ciclos.datos.find((c) => c.abierto) ?? ciclos.datos[0]).id);
  }, [ciclos.datos, cicloId]);

  const carga = useCarga(async () => (cicloId ? listarCobros(cicloId) : []), [cicloId]);
  const todas = useMemo(() => carga.datos ?? [], [carga.datos]);
  const zonas = useMemo(() => [...new Set(todas.map((c) => c.zona ?? ''))].sort((a, b) => a.localeCompare(b, 'es')), [todas]);
  const enZona = useMemo(() => todas.filter((c) => zona === null || (c.zona ?? '') === zona), [todas, zona]);
  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return enZona.filter((c) => (!estado || c.estado_cobro === estado)
      && (!t || [c.titulo, c.mtom, c.mein, c.establecimiento, c.jefe_sitio_nombre].some((v) => v?.toLowerCase().includes(t))));
  }, [enZona, estado, texto]);
  const t = totales(enZona);
  const editable = !!ciclo?.abierto && puedeValidar;
  const abierto = (ciclos.datos ?? []).find((c) => c.abierto);

  const recargar = async () => {
    await Promise.all([ciclos.recargar(), carga.recargar()]);
  };

  async function accion(fn: () => Promise<unknown>, ok: string) {
    setTrabajando(true);
    try {
      await fn();
      toast.success(ok);
      await recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setTrabajando(false);
    }
  }

  async function cerrar() {
    const nombre = window.prompt(`Se cierra "${ciclo?.nombre}" y se abre el ciclo siguiente. Pasan al nuevo las obras que siguen en curso; las cobradas al 100 % quedan en este.\n\nNombre del ciclo nuevo:`, mesSiguiente());
    if (!nombre?.trim()) return;
    setTrabajando(true);
    try {
      const nuevo = await cerrarCiclo(nombre.trim());
      toast.success(`Ciclo cerrado. Ahora está abierto "${nombre.trim()}".`);
      await ciclos.recargar();
      setCicloId(nuevo);
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setTrabajando(false);
    }
  }

  if (vista.tipo === 'editar') {
    return <EditarCobro cobro={vista.cobro} editable={editable} esGerencia={esGerencia} onListo={(cambio) => { setVista({ tipo: 'tablero' }); if (cambio) void carga.recargar(); }} />;
  }
  if (vista.tipo === 'importar' && abierto) {
    return <Importar ciclo={abierto.nombre} onListo={(cambio) => { setVista({ tipo: 'tablero' }); if (cambio) { setCicloId(abierto.id); void recargar(); } }} />;
  }
  if (vista.tipo === 'hoja' && ciclo) {
    return <Hoja ciclo={ciclo.nombre} filas={enZona} onVolver={() => setVista({ tipo: 'tablero' })} />;
  }

  if (ciclos.cargando && !ciclos.datos) return <Esqueleto filas={6} />;
  if (ciclos.error) return <ErrorVista mensaje={ciclos.error} onReintentar={ciclos.recargar} />;
  if ((ciclos.datos ?? []).length === 0) {
    return (
      <>
        <h1>Cobro de obras</h1>
        <Vacio icono={Wallet} titulo="Todavía no hay ciclos de cobro" texto="El seguimiento del cobro va por ciclos mensuales. Abrí el primero y después sumá obras o importá la planilla de certificación.">
          {puedeValidar && <Boton variante="primario" icono={Plus} cargando={trabajando} onClick={() => accion(abrirCiclo, 'Ciclo abierto.')}>Abrir el ciclo de este mes</Boton>}
        </Vacio>
      </>
    );
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Cobro de obras</h1>
        <div className="flex flex-wrap gap-2">
          <Boton icono={Printer} disabled={enZona.length === 0} onClick={() => setVista({ tipo: 'hoja' })}>Hoja por comuna</Boton>
          <Boton disabled={lista.length === 0} onClick={() => descargarCSV(`cobro-${ciclo?.nombre ?? ''}.csv`,
            ['Comuna', 'Obra', 'Establecimiento', 'MTOM', 'MEIN', 'Jefe de sitio', 'Inspector', 'Estado', 'Motivo', 'Prioridad', 'Avance %', 'Tramo', 'Monto base', 'A cobrar'],
            lista.map((c) => [c.zona, c.titulo, c.establecimiento, c.mtom, c.mein, c.jefe_sitio_nombre, c.inspector_nombre, ESTADOS_COBRO[c.estado_cobro], c.motivo_observacion,
              PRIORIDADES_COBRO[c.prioridad], Number(c.avance), nombreTramo(c), Number(c.monto_base), Number(c.monto_a_cobrar)]))}>
            Exportar
          </Boton>
          {puedeValidar && abierto && <Boton icono={Upload} onClick={() => setVista({ tipo: 'importar' })}>Importar planilla</Boton>}
          {esGerencia && ciclo?.abierto && <Boton icono={Lock} cargando={trabajando} onClick={cerrar}>Cerrar el ciclo</Boton>}
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-[16rem_1fr]">
        <Selector etiqueta="Ciclo" value={cicloId ?? ''} onChange={(e) => { setCicloId(e.target.value); setZona(null); }}
          opciones={Object.fromEntries((ciclos.datos ?? []).map((c) => [c.id, c.abierto ? `${c.nombre} (abierto)` : `${c.nombre} · cerrado ${fmtFecha(c.cerrado_at?.slice(0, 10) ?? null) ?? ''}`]))} />
        {editable ? (
          <div className="flex items-end gap-2">
            <div className="flex-1"><BuscadorRemoto etiqueta="Sumar una obra al ciclo" tabla="obras" valor={obraNueva} onCambio={setObraNueva} /></div>
            <Boton icono={Plus} disabled={!obraNueva} cargando={trabajando}
              onClick={() => obraNueva && accion(async () => { await sumarObraAlCiclo(obraNueva.id); setObraNueva(null); }, 'La obra entró al ciclo.')}>Sumar</Boton>
          </div>
        ) : !ciclo?.abierto ? (
          <p className="self-end rounded border border-info/40 bg-info/10 p-3 text-sm text-info">Ciclo cerrado: se puede consultar e imprimir, no modificar.</p>
        ) : null}
      </div>

      <Pestanas
        activa={zona === null ? '__todas' : zona || '__sin'}
        onCambio={(id) => setZona(id === '__todas' ? null : id === '__sin' ? '' : id)}
        pestanas={[
          { id: '__todas', texto: 'Todas', cuenta: todas.length },
          ...zonas.map((z) => ({ id: z || '__sin', texto: z || 'Sin zona', cuenta: todas.filter((c) => (c.zona ?? '') === z).length, alerta: todas.some((c) => (c.zona ?? '') === z && c.estado_cobro === 'observado') })),
        ]}
      />

      <Indicadores>
        <Indicador titulo="Obras en el ciclo" valor={t.obras} icono={Coins} />
        <Indicador titulo="A cobrar" valor={<span className="text-lg">{fmtPesos(t.total)}</span>} icono={Wallet} />
        <Indicador titulo="Listas para certificar" valor={t.listas} icono={CheckCircle2} tono={t.listas > 0 ? 'exito' : 'neutro'} nota={fmtPesos(t.listo)} />
        <Indicador titulo="Observadas" valor={t.observadas} icono={AlertTriangle} tono={t.observadas > 0 ? 'peligro' : 'neutro'} />
      </Indicadores>

      {zona === null && zonas.length > 1 && (
        <div className="overflow-x-auto rounded-lg border bg-superficie">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b text-left text-suave">
              <th className="px-3 py-2 font-medium">Comuna</th><th className="num px-3 py-2 font-medium">Obras</th>
              <th className="num px-3 py-2 font-medium">Listo para certificar</th><th className="num px-3 py-2 font-medium">Total a cobrar</th>
            </tr></thead>
            <tbody>
              {zonas.map((z) => {
                const tz = totales(todas.filter((c) => (c.zona ?? '') === z));
                return (
                  <tr key={z} className="border-b last:border-b-0">
                    <td className="px-3 py-2">{z || 'Sin zona'}</td><td className="num px-3 py-2">{tz.obras}</td>
                    <td className="num px-3 py-2 text-exito">{fmtPesos(tz.listo)}</td><td className="num px-3 py-2 font-medium">{fmtPesos(tz.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-3">
        <Chips opciones={(Object.keys(ESTADOS_COBRO) as EstadoCobro[]).map((e) => ({ id: e, texto: `${ESTADOS_COBRO[e]} (${enZona.filter((c) => c.estado_cobro === e).length})` }))} valor={estado} onCambio={setEstado} />
        <Campo etiqueta="Buscar por obra, MTOM, MEIN, establecimiento o jefe" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : lista.length === 0 ? (
        <Vacio icono={Coins} titulo={todas.length === 0 ? 'El ciclo está vacío' : 'No hay obras con ese filtro'}
          texto={todas.length === 0 ? 'Sumá obras desde el buscador o importá la planilla de certificación.' : 'Probá con otro estado, otra comuna u otro texto.'} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-superficie">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-suave">
                <th className="px-3 py-3 font-medium">Obra</th>
                <th className="px-3 py-3 font-medium">Estado</th>
                <th className="px-3 py-3 font-medium">Avance</th>
                <th className="hidden px-3 py-3 font-medium md:table-cell">Jefe de sitio</th>
                <th className="num px-3 py-3 font-medium">A cobrar</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className={`border-b last:border-b-0 ${c.estado_cobro === 'observado' ? 'bg-peligro/10' : 'hover:bg-elevado/60'}`}>
                  <td className="px-3 py-3">
                    <button type="button" className="block min-h-control text-left font-medium text-primario hover:underline" onClick={() => setVista({ tipo: 'editar', cobro: c })}>
                      {c.titulo}
                      <span className="block text-xs font-normal text-suave">{[c.mtom && `MTOM ${c.mtom}`, c.mein && `MEIN ${c.mein}`, c.establecimiento, zona === null && c.zona].filter(Boolean).join(' · ')}</span>
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`font-medium ${TEXTO_TONO[TONO_COBRO[c.estado_cobro]]}`}>{ESTADOS_COBRO[c.estado_cobro]}</span>
                    {c.prioridad !== 'normal' && <span className="ml-2 text-xs text-alerta">{PRIORIDADES_COBRO[c.prioridad]}</span>}
                    {c.motivo_observacion && <span className="block text-xs text-suave">{c.motivo_observacion}</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2"><Punto color={c.color} /><span className="num">{fmtPct(c.avance)}</span></span>
                    <span className="block text-xs text-suave">{nombreTramo(c)}</span>
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell">{c.jefe_sitio_nombre ?? '—'}</td>
                  <td className="num px-3 py-3 font-medium">{fmtPesos(c.monto_a_cobrar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
