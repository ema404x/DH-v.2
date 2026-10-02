'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Download, History, Inbox, MessageSquarePlus, PlayCircle, Plus, Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Selector, oNull } from '@/components/Campos';
import { AvisoBadge, PrioridadBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { fmtFecha } from '@/components/OTCard';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { ElegirExcel, Indicador, Indicadores, Pestanas, descargarCSV } from '@/components/gestion/Piezas';
import { leerPendientesSAP, type LecturaSAP } from '@/lib/excel';
import {
  ESTADOS_PENDIENTE, TIPOS_PENDIENTE, anotarPendiente, borrarPendientes, guardarPendiente, historialPendiente, importarPendientesSAP,
  listarPendientes, resumenPendientesPorZona, type EstadoPendiente, type FiltroPendientes, type HistorialPendiente, type Pendiente,
  type ResultadoSAP, type TipoPendiente,
} from '@/lib/operacion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { PRIORIDADES, type Prioridad, type ResultadoBusqueda } from '@/lib/types';

const FILTRO_ESTADO = { abiertos: 'Abiertos', todos: 'Todos', ...ESTADOS_PENDIENTE };
const TONO_ESTADO: Record<EstadoPendiente, string> = {
  pendiente: 'text-alerta', asignado: 'text-info', en_progreso: 'text-info', resuelto: 'text-exito', cancelado: 'text-suave',
};

function vencimiento(p: Pendiente): string | null {
  if (p.dias_restantes === null || p.estado === 'resuelto' || p.estado === 'cancelado') return null;
  if (p.dias_restantes < 0) return `Vencido hace ${-p.dias_restantes} d`;
  if (p.dias_restantes === 0) return 'Vence hoy';
  return `Vence en ${p.dias_restantes} d`;
}

// ------------------------------------------------------------------ formulario + historial

function Formulario({ pendiente, zona, puedeEditar, onListo }: { pendiente: Pendiente | null; zona: string | null; puedeEditar: boolean; onListo: (cambio: boolean) => void }) {
  const p = pendiente;
  const [pestana, setPestana] = useState<'datos' | 'historial'>('datos');
  const [f, setF] = useState({
    numero_sap: p?.numero_sap ?? '', numero_sap_desaprobado: p?.numero_sap_desaprobado ?? '', inspector_nombre: p?.inspector_nombre ?? '',
    zona: p?.zona ?? zona ?? '', clase_orden: p?.clase_orden ?? '', status_sap: p?.status_sap ?? '',
    tipo: p?.tipo ?? ('mantenimiento' as TipoPendiente), prioridad: p?.prioridad ?? ('media' as Prioridad), descripcion: p?.descripcion ?? '',
    sitio: p?.sitio ?? '', estado: p?.estado ?? ('pendiente' as EstadoPendiente),
    fecha_emision_sap: p?.fecha_emision_sap ?? '', fecha_limite: p?.fecha_limite ?? '', fecha_resolucion: p?.fecha_resolucion ?? '',
    activo_nombre: p?.activo_nombre ?? '', presupuesto: p ? String(Number(p.presupuesto_estimado)) : '0',
    materiales_necesarios: p?.materiales_necesarios ?? '', observaciones: p?.observaciones ?? '', notas_resolucion: p?.notas_resolucion ?? '',
  });
  const [ubicacion, setUbicacion] = useState<ResultadoBusqueda | null>(p?.ubicacion_id ? { id: p.ubicacion_id, etiqueta: p.ubicacion_nombre ?? p.establecimiento ?? '', detalle: null } : null);
  const [jefe, setJefe] = useState<ResultadoBusqueda | null>(p?.jefe_sitio_nombre ? { id: p.jefe_sitio_id ?? '', etiqueta: p.jefe_sitio_nombre, detalle: p.jefe_sitio_id ? null : 'nombre de planilla' } : null);
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value })) });

  const historial = useCarga(async () => (p ? historialPendiente(p.id) : ([] as HistorialPendiente[])), [p?.id]);
  const [nota, setNota] = useState('');

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await guardarPendiente(p?.id ?? null, {
        descripcion: f.descripcion.trim(), numero_sap: oNull(f.numero_sap), numero_sap_desaprobado: oNull(f.numero_sap_desaprobado),
        inspector_nombre: oNull(f.inspector_nombre), zona: oNull(f.zona), clase_orden: oNull(f.clase_orden), status_sap: oNull(f.status_sap),
        tipo: f.tipo, prioridad: f.prioridad, sitio: oNull(f.sitio), estado: f.estado,
        ubicacion_id: ubicacion?.id ?? null, establecimiento: ubicacion?.etiqueta ?? p?.establecimiento ?? null,
        // Un jefe con usuario va por id. Si era un nombre de planilla y no se tocó, se conserva tal cual.
        jefe_sitio_id: jefe?.id || null, jefe_sitio_nombre: jefe && !jefe.id ? jefe.etiqueta : null,
        fecha_emision_sap: oNull(f.fecha_emision_sap), fecha_limite: oNull(f.fecha_limite),
        fecha_resolucion: f.estado === 'resuelto' ? oNull(f.fecha_resolucion) : null,
        activo_nombre: oNull(f.activo_nombre), presupuesto_estimado: Number(f.presupuesto.replace(',', '.')) || 0,
        materiales_necesarios: oNull(f.materiales_necesarios), observaciones: oNull(f.observaciones),
        notas_resolucion: f.estado === 'resuelto' ? oNull(f.notas_resolucion) : null,
      });
      toast.success(p ? 'Pendiente guardado.' : 'Pendiente creado.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  async function agregarNota() {
    if (!p || !nota.trim()) return;
    try {
      await anotarPendiente(p.id, nota);
      setNota('');
      await historial.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>{p ? `Pendiente ${p.numero_sap ?? ''}` : 'Nuevo pendiente'}</h1>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Volver a la lista</Boton>
      </header>
      {p && <Pestanas pestanas={[{ id: 'datos', texto: 'Datos' }, { id: 'historial', texto: 'Historial', cuenta: historial.datos?.length }]} activa={pestana} onCambio={setPestana} />}

      {pestana === 'historial' && p ? (
        <section className="tarjeta space-y-4">
          <p className="text-sm text-suave">Cada cambio queda registrado solo: quién, cuándo y qué cambió.</p>
          {puedeEditar && (
            <div className="flex items-end gap-2">
              <div className="flex-1"><Campo etiqueta="Agregar una nota" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
              <Boton icono={MessageSquarePlus} onClick={agregarNota} disabled={!nota.trim()}>Agregar</Boton>
            </div>
          )}
          {historial.cargando && !historial.datos ? <Esqueleto filas={2} /> : historial.error ? <ErrorVista mensaje={historial.error} onReintentar={historial.recargar} />
            : (historial.datos ?? []).length === 0 ? <p className="text-suave">Sin movimientos todavía.</p> : (
              <ol className="space-y-3">
                {(historial.datos ?? []).map((h) => (
                  <li key={h.id} className="flex gap-3">
                    <History className="mt-0.5 h-5 w-5 shrink-0 text-suave" aria-hidden />
                    <div>
                      <p className="text-sm text-suave">{h.usuario_nombre ?? 'Sistema'} · {new Date(h.created_at).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' })}</p>
                      {h.estado_nuevo && <p>Estado: {h.estado_anterior ? ESTADOS_PENDIENTE[h.estado_anterior] : '—'} → {ESTADOS_PENDIENTE[h.estado_nuevo]}</p>}
                      {(h.jefe_nuevo || h.jefe_anterior) && <p>Jefe de sitio: {h.jefe_anterior ?? 'sin asignar'} → {h.jefe_nuevo ?? 'sin asignar'}</p>}
                      {h.campos_modificados.filter((c) => c !== 'estado' && c !== 'jefe_sitio').length > 0 && (
                        <p className="text-sm text-suave">Cambió: {h.campos_modificados.filter((c) => c !== 'estado' && c !== 'jefe_sitio').join(', ').replace('_', ' ')}</p>
                      )}
                      {h.comentario && <p className="whitespace-pre-wrap">{h.comentario}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
        </section>
      ) : (
        <form onSubmit={guardar} className="space-y-4">
          <fieldset disabled={!puedeEditar} className="space-y-4">
            <section className="tarjeta space-y-4">
              <h2>Datos de SAP</h2>
              <div className="grid gap-4 md:grid-cols-3">
                <Campo etiqueta="N° de orden SAP" {...campo('numero_sap')} />
                <Campo etiqueta="N° de orden desaprobada" {...campo('numero_sap_desaprobado')} />
                <Campo etiqueta="Inspector" {...campo('inspector_nombre')} />
                <Campo etiqueta="Zona o comuna" {...campo('zona')} />
                <Campo etiqueta="Clase de orden" {...campo('clase_orden')} />
                <Campo etiqueta="Status en SAP" {...campo('status_sap')} />
              </div>
            </section>
            <section className="tarjeta space-y-4">
              <h2>Trabajo</h2>
              <Area etiqueta="Tareas a realizar" required {...campo('descripcion')} />
              <div className="grid gap-4 md:grid-cols-2">
                <Selector etiqueta="Tipo" opciones={TIPOS_PENDIENTE} {...campo('tipo')} />
                <Selector etiqueta="Prioridad" opciones={PRIORIDADES} {...campo('prioridad')} />
                <BuscadorRemoto etiqueta="Establecimiento" tabla="ubicaciones" valor={ubicacion} onCambio={setUbicacion} ayuda="Al elegirlo, el pendiente toma su jefe de sitio e inspector." />
                <Campo etiqueta="Ubicación dentro del lugar" {...campo('sitio')} />
                <BuscadorRemoto etiqueta="Jefe de sitio" tabla="jefes" valor={jefe} onCambio={setJefe} ayuda="Al asignar un jefe, el pendiente pasa a Asignado." />
                <Selector etiqueta="Estado" opciones={ESTADOS_PENDIENTE} {...campo('estado')} />
                <Campo etiqueta="Fecha de emisión en SAP" type="date" {...campo('fecha_emision_sap')} />
                <Campo etiqueta="Fecha límite" type="date" {...campo('fecha_limite')} />
                <Campo etiqueta="Activo o equipo" {...campo('activo_nombre')} />
                <Campo etiqueta="Presupuesto estimado" inputMode="decimal" {...campo('presupuesto')} />
              </div>
              <Area etiqueta="Materiales necesarios" {...campo('materiales_necesarios')} />
              <Area etiqueta="Observaciones" {...campo('observaciones')} />
              {f.estado === 'resuelto' && (
                <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
                  <Campo etiqueta="Fecha de resolución" type="date" {...campo('fecha_resolucion')} ayuda="Si queda vacía, se pone la de hoy." />
                  <Area etiqueta="Notas de la resolución" {...campo('notas_resolucion')} />
                </div>
              )}
            </section>
          </fieldset>
          {puedeEditar && <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar pendiente</Boton>}
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ importación de SAP

function ImportarSAP({ zonas, zonaInicial, onListo }: { zonas: string[]; zonaInicial: string | null; onListo: (cambio: boolean) => void }) {
  const [zona, setZona] = useState(zonaInicial || zonas[0] || '');
  const [lectura, setLectura] = useState<(LecturaSAP & { archivo: string }) | null>(null);
  const [jefes, setJefes] = useState<Record<string, ResultadoBusqueda>>({});
  const [resultado, setResultado] = useState<ResultadoSAP | null>(null);
  const [importando, setImportando] = useState(false);

  async function importar() {
    if (!lectura) return;
    setImportando(true);
    try {
      const mapa = Object.fromEntries(Object.entries(jefes).map(([inspector, j]) => [inspector, j.id]));
      setResultado(await importarPendientesSAP(lectura.filas, zona, mapa));
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
        <h1>Importar pendientes de SAP</h1>
        <Boton variante="fantasma" onClick={() => onListo(!!resultado)}>Volver a la lista</Boton>
      </header>
      <section className="tarjeta space-y-4">
        <p className="text-suave">
          Planilla de órdenes de SAP (.xlsx). Se reconocen las hojas con encabezados (N° DE ORDEN, TAREAS A REALIZAR, UBICACIÓN, ESTABLECIMIENTO,
          INSPECTOR, FECHA INICIO, FECHA LIMITE SAP, CLASE DE ORDEN, STATUS) y las hojas sin encabezados por posición de columna.
          Las órdenes que ya están cargadas se omiten: nunca se pisa un pendiente existente.
        </p>
        <div className="grid gap-4 md:grid-cols-[14rem_auto] md:items-end">
          {zonas.length > 0
            ? <Selector etiqueta="Zona o comuna de la planilla" value={zona} onChange={(e) => setZona(e.target.value)} opciones={Object.fromEntries(zonas.map((z) => [z, z]))} />
            : <Campo etiqueta="Zona o comuna de la planilla" value={zona} onChange={(e) => setZona(e.target.value)} />}
          <div><ElegirExcel texto="Elegir planilla (.xlsx)" leer={leerPendientesSAP} onLeido={(l, archivo) => { setLectura({ ...l, archivo }); setResultado(null); setJefes({}); }} /></div>
        </div>
      </section>

      {lectura && (
        <section className="tarjeta space-y-4">
          <p><strong>{lectura.archivo}</strong> · {lectura.filas.length} órdenes</p>
          <ul className="text-sm text-suave">
            {lectura.hojas.map((h) => <li key={h.nombre}>Hoja "{h.nombre}": {h.ordenes} órdenes ({h.formato})</li>)}
          </ul>
          {lectura.inspectores.length > 0 && (
            <div className="space-y-3">
              <h2>Jefe de sitio por inspector (opcional)</h2>
              <p className="text-sm text-suave">
                Si no elegís ninguno, cada orden toma el jefe de sitio de su establecimiento, o el de la dirección a cargo de ese inspector.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {lectura.inspectores.map((i) => (
                  <BuscadorRemoto key={i} etiqueta={i} tabla="jefes" valor={jefes[i] ?? null}
                    onCambio={(j) => setJefes((a) => { const n = { ...a }; if (j) n[i] = j; else delete n[i]; return n; })} />
                ))}
              </div>
            </div>
          )}
          <Boton variante="primario" icono={Upload} cargando={importando} onClick={importar}>Importar {lectura.filas.length} órdenes en {zona || 'sin zona'}</Boton>
        </section>
      )}

      {resultado && (
        <div className="rounded border border-exito/40 bg-exito/10 p-3 text-exito" role="status">
          <p className="font-semibold">Importación terminada</p>
          <p>
            {resultado.importados} importadas. {resultado.omitidos} omitidas porque ya estaban cargadas.
            {resultado.invalidos > 0 && ` ${resultado.invalidos} filas sin número o sin tareas.`}
          </p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ lista

export default function Pendientes() {
  const { sectorEfectivo, puedeValidar, esGerencia } = useSesion();
  const zonasSector = useMemo(() => sectorEfectivo?.config?.zonas ?? [], [sectorEfectivo]);
  const [zona, setZona] = useState<string | null>(null);
  const [estado, setEstado] = useState<FiltroPendientes['estado']>('abiertos');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [inspector, setInspector] = useState('');
  const [vista, setVista] = useState<{ tipo: 'lista' } | { tipo: 'form'; pendiente: Pendiente | null } | { tipo: 'importar' }>({ tipo: 'lista' });
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setQ(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const resumen = useCarga(resumenPendientesPorZona, []);
  const carga = useCarga(() => listarPendientes({ zona, estado, q }), [zona, estado, q]);

  const zonas = useMemo(() => {
    const deDatos = (resumen.datos ?? []).map((r) => r.zona);
    return [...new Set([...zonasSector, ...deDatos.filter(Boolean)])];
  }, [zonasSector, resumen.datos]);
  const haySinZona = (resumen.datos ?? []).some((r) => r.zona === '');
  const cuenta = (z: string) => (resumen.datos ?? []).find((r) => r.zona === z);

  const lista = useMemo(() => (carga.datos ?? []).filter((p) => !inspector || p.inspector_nombre === inspector), [carga.datos, inspector]);
  const inspectores = useMemo(() => [...new Set((carga.datos ?? []).map((p) => p.inspector_nombre).filter((i): i is string => !!i))].sort(), [carga.datos]);
  const n = (f: (p: Pendiente) => boolean) => lista.filter(f).length;

  const recargar = async () => {
    setSeleccion(new Set());
    await Promise.all([carga.recargar(), resumen.recargar()]);
  };

  async function borrar(ids: string[]) {
    if (!window.confirm(ids.length === 1 ? '¿Borrar este pendiente? No se puede deshacer.' : `¿Borrar ${ids.length} pendientes? No se puede deshacer.`)) return;
    try {
      await borrarPendientes(ids);
      toast.success(ids.length === 1 ? 'Pendiente borrado.' : `${ids.length} pendientes borrados.`);
      await recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  function exportar() {
    descargarCSV(`pendientes-${zona || 'todas'}.csv`,
      ['N° SAP', 'Inspector', 'Jefe de sitio', 'Establecimiento', 'Tareas', 'Ubicación', 'Clase de orden', 'Estado', 'Zona', 'Inicio', 'Límite', 'Vencido', 'Prioridad', 'N° SAP desaprobado'],
      lista.map((p) => [p.numero_sap, p.inspector_nombre, p.jefe_sitio_nombre, p.establecimiento, p.descripcion, p.sitio, p.clase_orden, ESTADOS_PENDIENTE[p.estado], p.zona,
        p.fecha_emision_sap, p.fecha_limite, p.vencido ? 'Sí' : 'No', PRIORIDADES[p.prioridad], p.numero_sap_desaprobado]));
  }

  if (vista.tipo === 'form') {
    return <Formulario pendiente={vista.pendiente} zona={zona} puedeEditar={puedeValidar} onListo={(cambio) => { setVista({ tipo: 'lista' }); if (cambio) void recargar(); }} />;
  }
  if (vista.tipo === 'importar') {
    return <ImportarSAP zonas={zonasSector} zonaInicial={zona} onListo={(cambio) => { setVista({ tipo: 'lista' }); if (cambio) void recargar(); }} />;
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Pendientes SAP</h1>
        <div className="flex flex-wrap gap-2">
          <Boton icono={Download} onClick={exportar} disabled={lista.length === 0}>Exportar</Boton>
          {puedeValidar && <Boton icono={Upload} onClick={() => setVista({ tipo: 'importar' })}>Importar SAP</Boton>}
          {puedeValidar && <Boton variante="primario" icono={Plus} onClick={() => setVista({ tipo: 'form', pendiente: null })}>Nuevo pendiente</Boton>}
        </div>
      </header>

      <Pestanas
        activa={zona === null ? '__todas' : zona === '' ? '__sin' : zona}
        onCambio={(id) => { setZona(id === '__todas' ? null : id === '__sin' ? '' : id); setInspector(''); setSeleccion(new Set()); }}
        pestanas={[
          { id: '__todas', texto: 'Todas', cuenta: (resumen.datos ?? []).reduce((t, r) => t + r.total, 0) },
          ...zonas.map((z) => ({ id: z, texto: z, cuenta: cuenta(z)?.total ?? 0, alerta: !!cuenta(z)?.vencidos })),
          ...(haySinZona ? [{ id: '__sin', texto: 'Sin zona', cuenta: cuenta('')?.total ?? 0 }] : []),
        ]}
      />

      <Indicadores>
        <Indicador titulo="En la lista" valor={lista.length} icono={ClipboardList} />
        <Indicador titulo="Sin asignar" valor={n((p) => p.estado === 'pendiente')} icono={Inbox} tono={n((p) => p.estado === 'pendiente') > 0 ? 'alerta' : 'neutro'} />
        <Indicador titulo="Asignados o en curso" valor={n((p) => p.estado === 'asignado' || p.estado === 'en_progreso')} icono={PlayCircle} />
        <Indicador titulo="Vencidos" valor={n((p) => p.vencido)} icono={AlertTriangle} tono={n((p) => p.vencido) > 0 ? 'peligro' : 'neutro'} />
      </Indicadores>

      <div className="grid gap-3 md:grid-cols-[1fr_12rem_14rem]">
        <Campo etiqueta="Buscar por tarea, N° SAP, lugar, inspector o jefe" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} opciones={FILTRO_ESTADO} onChange={(e) => setEstado(e.target.value as FiltroPendientes['estado'])} />
        <Selector etiqueta="Inspector" value={inspector} opciones={{ '': 'Todos', ...Object.fromEntries(inspectores.map((i) => [i, i])) }} onChange={(e) => setInspector(e.target.value)} />
      </div>

      {esGerencia && seleccion.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded border border-peligro/40 bg-peligro/10 px-3 py-1">
          <p>{seleccion.size} seleccionados</p>
          <Boton variante="peligro" icono={Trash2} onClick={() => borrar([...seleccion])}>Borrar seleccionados</Boton>
        </div>
      )}

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : lista.length === 0 ? (
        <Vacio icono={CheckCircle2} titulo={q || inspector || (estado !== 'todos' && estado !== 'abiertos') ? 'No hay pendientes con ese filtro' : estado === 'abiertos' ? 'No hay pendientes abiertos' : 'Todavía no hay pendientes'}
          texto={q || inspector || (estado !== 'todos' && estado !== 'abiertos') ? 'Probá con otro estado, otra zona u otro texto.' : 'Importá la planilla de órdenes de SAP o cargá un pendiente a mano.'} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-superficie">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-suave">
                {esGerencia && (
                  <th className="px-3 py-3">
                    <input type="checkbox" className="h-5 w-5 accent-primario" aria-label="Seleccionar todos"
                      checked={seleccion.size === lista.length} onChange={(e) => setSeleccion(e.target.checked ? new Set(lista.map((p) => p.id)) : new Set())} />
                  </th>
                )}
                <th className="px-3 py-3 font-medium">Tareas</th>
                <th className="px-3 py-3 font-medium">Estado</th>
                <th className="hidden px-3 py-3 font-medium md:table-cell">Lugar</th>
                <th className="hidden px-3 py-3 font-medium lg:table-cell">Inspector</th>
                <th className="hidden px-3 py-3 font-medium md:table-cell">Jefe de sitio</th>
                <th className="px-3 py-3 font-medium">Límite</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className={`border-b last:border-b-0 ${p.vencido ? 'bg-peligro/10' : 'hover:bg-elevado/60'}`}>
                  {esGerencia && (
                    <td className="px-3 py-3">
                      <input type="checkbox" className="h-5 w-5 accent-primario" aria-label={`Seleccionar ${p.numero_sap ?? p.descripcion}`} checked={seleccion.has(p.id)}
                        onChange={(e) => setSeleccion((s) => { const c = new Set(s); if (e.target.checked) c.add(p.id); else c.delete(p.id); return c; })} />
                    </td>
                  )}
                  <td className="px-3 py-3">
                    <button type="button" className="block min-h-control text-left font-medium text-primario hover:underline" onClick={() => setVista({ tipo: 'form', pendiente: p })}>
                      {p.descripcion}
                      <span className="block text-xs font-normal text-suave">{[p.numero_sap && `SAP ${p.numero_sap}`, TIPOS_PENDIENTE[p.tipo], p.clase_orden].filter(Boolean).join(' · ')}</span>
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`font-medium ${TONO_ESTADO[p.estado]}`}>{ESTADOS_PENDIENTE[p.estado]}</span>
                    {(p.prioridad === 'alta' || p.prioridad === 'urgente') && <div className="mt-1"><PrioridadBadge prioridad={p.prioridad} /></div>}
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell">{p.establecimiento ?? '—'}{p.sitio && p.sitio !== p.establecimiento && <span className="block text-xs text-suave">{p.sitio}</span>}</td>
                  <td className="hidden px-3 py-3 lg:table-cell">{p.inspector_nombre ?? '—'}</td>
                  <td className="hidden px-3 py-3 md:table-cell">{p.jefe_sitio_nombre ?? <span className="text-alerta">Sin asignar</span>}</td>
                  <td className="px-3 py-3">
                    {fmtFecha(p.fecha_limite) ?? '—'}
                    {vencimiento(p) && <div className="mt-1">{p.vencido ? <AvisoBadge texto={vencimiento(p)!} tono="peligro" /> : <span className="text-xs text-suave">{vencimiento(p)}</span>}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
