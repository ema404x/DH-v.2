'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Ban, CheckCircle2, Download, History, PackageCheck, Plus, Save, Send, ShoppingCart, Trash2, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Casilla, Selector, oNull } from '@/components/Campos';
import { AvisoBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Documentos } from '@/components/gestion/Documentos';
import { Indicador, Indicadores, Pestanas, descargarCSV } from '@/components/gestion/Piezas';
import { fmtPesos } from '@/lib/certificacion';
import {
  ESTADOS_REQ, PRIORIDADES_REQ, UNIDADES, agregarItem, borrarRequerimiento, cambiarEstadoReq, cant, crearRequerimiento, guardarItem, guardarRequerimiento,
  listarRequerimientos, obtenerRequerimiento, quitarItem, recibir, type EstadoReq, type ItemReq, type Requerimiento,
} from '@/lib/panol';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

const TONO: Record<EstadoReq, string> = {
  borrador: 'text-suave', enviado: 'text-alerta', en_revision: 'text-info', aprobado: 'text-exito', en_compra: 'text-info',
  recibido: 'text-exito', rechazado: 'text-peligro', cancelado: 'text-suave',
};
const fechaHora = (s: string) => new Date(s).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' });
const dia = (s: string | null) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString('es-AR') : null);
const n = (v: string) => Number(v.replace(/\./g, '').replace(',', '.'));

// ------------------------------------------------------------------ alta

function Nuevo({ onCreado, onVolver }: { onCreado: (id: string) => void; onVolver: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [obra, setObra] = useState<ResultadoBusqueda | null>(null);
  const [ubicacion, setUbicacion] = useState<ResultadoBusqueda | null>(null);
  const [prioridad, setPrioridad] = useState('normal');
  const [fecha, setFecha] = useState('');
  const [obs, setObs] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const id = await crearRequerimiento({ titulo: titulo.trim(), obra_id: obra?.id ?? null, ubicacion_id: ubicacion?.id ?? null, establecimiento: ubicacion?.etiqueta ?? null,
        prioridad, fecha_necesidad: oNull(fecha), observaciones: oNull(obs), adjuntos: [] });
      toast.success('Requerimiento creado. Ahora cargá los ítems.');
      onCreado(id);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Nuevo requerimiento de compra</h1>
        <Boton variante="fantasma" onClick={onVolver}>Volver a la lista</Boton>
      </header>
      <section className="tarjeta space-y-4">
        <Campo etiqueta="Qué se necesita" required value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Materiales para la cubierta de la Escuela 21" />
        <div className="grid gap-4 md:grid-cols-2">
          <BuscadorRemoto etiqueta="Obra (opcional)" tabla="obras" valor={obra} onCambio={setObra} />
          <BuscadorRemoto etiqueta="Lugar (opcional)" tabla="ubicaciones" valor={ubicacion} onCambio={setUbicacion} />
          <Selector etiqueta="Prioridad" value={prioridad} onChange={(e) => setPrioridad(e.target.value)} opciones={PRIORIDADES_REQ} />
          <Campo etiqueta="Se necesita para el" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <Area etiqueta="Observaciones" value={obs} onChange={(e) => setObs(e.target.value)} />
      </section>
      <Boton type="submit" variante="primario" icono={Plus} cargando={guardando}>Crear y cargar ítems</Boton>
    </form>
  );
}

// ------------------------------------------------------------------ ficha

function Ficha({ id, onListo }: { id: string; onListo: (cambio: boolean) => void }) {
  const { perfil, esGerencia, puedeValidar, sectorEfectivo } = useSesion();
  const carga = useCarga(() => obtenerRequerimiento(id), [id]);
  const [cambio, setCambio] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [material, setMaterial] = useState<ResultadoBusqueda | null>(null);
  const [desc, setDesc] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [unidad, setUnidad] = useState('unidad');
  const [costo, setCosto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [oc, setOc] = useState<{ numero: string; proveedor: ResultadoBusqueda | null; texto: string; entrega: string } | null>(null);
  const [recepcion, setRecepcion] = useState<Record<string, string>>({});
  const [remito, setRemito] = useState('');
  const [cerrar, setCerrar] = useState(false);

  if (carga.cargando && !carga.datos) return <Esqueleto filas={6} />;
  if (carga.error || !carga.datos) return <ErrorVista mensaje={carga.error ?? 'No se encontró el requerimiento.'} onReintentar={carga.recargar} />;
  const { req: r, items } = carga.datos;
  const mio = r.solicitante_id === perfil?.id;
  const editable = mio && r.estado === 'borrador';
  const revisa = esGerencia && !mio && (r.estado === 'enviado' || r.estado === 'en_revision');
  const datosOC = oc ?? { numero: r.numero_orden_compra ?? '', proveedor: r.proveedor_id ? { id: r.proveedor_id, etiqueta: r.proveedor_nombre ?? '', detalle: null } : null, texto: r.proveedor_texto ?? '', entrega: r.fecha_entrega_estimada ?? '' };

  async function hacer(fn: () => Promise<unknown>, ok: string) {
    setTrabajando(true);
    try {
      await fn();
      toast.success(ok);
      setCambio(true);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setTrabajando(false);
    }
  }

  async function agregar(e: FormEvent) {
    e.preventDefault();
    const c = n(cantidad);
    if (!(c > 0)) { toast.error('La cantidad tiene que ser mayor a cero.'); return; }
    if (!material && !desc.trim()) { toast.error('Elegí un material del pañol o escribí qué se necesita.'); return; }
    await hacer(() => agregarItem({ requerimiento_id: r.id, material_id: material?.id ?? null, descripcion: material ? '' : desc.trim(), unidad, cantidad_solicitada: c,
      costo_estimado: costo.trim() ? n(costo) : 0, notas: null, orden: items.length + 1 }), 'Ítem agregado.');
    setMaterial(null); setDesc(''); setCantidad('1'); setCosto('');
  }

  const datosOcGuardar = () => ({
    numero_orden_compra: oNull(datosOC.numero), proveedor_id: datosOC.proveedor?.id ?? null, proveedor_texto: datosOC.proveedor ? null : oNull(datosOC.texto),
    fecha_entrega_estimada: oNull(datosOC.entrega),
  });

  async function confirmarRecepcion() {
    const lista = items.map((i) => ({ item_id: i.id, cantidad: recepcion[i.id] ? n(recepcion[i.id]) : 0, costo: null })).filter((i) => i.cantidad > 0);
    if (lista.length === 0 && !cerrar) { toast.error('Cargá cuánto llegó de cada ítem.'); return; }
    if (lista.some((i) => Number.isNaN(i.cantidad) || i.cantidad < 0)) { toast.error('Revisá las cantidades recibidas.'); return; }
    await hacer(async () => {
      const res = await recibir(r.id, lista, oNull(remito), cerrar);
      setRecepcion({}); setRemito(''); setCerrar(false);
      return res;
    }, 'Recepción registrada: lo del pañol ya está en el stock.');
  }

  const pendiente = (i: ItemReq) => Math.max(0, Number(i.cantidad_aprobada ?? i.cantidad_solicitada) - Number(i.cantidad_recibida));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>{r.codigo} · {r.titulo}</h1>
          <p className={`font-medium ${TONO[r.estado]}`}>{ESTADOS_REQ[r.estado]}<span className="font-normal text-suave"> · pedido por {r.solicitante_nombre ?? '—'} · {fmtPesos(r.total_estimado)}</span></p>
        </div>
        <Boton variante="fantasma" onClick={() => onListo(cambio)}>Volver a la lista</Boton>
      </header>
      {r.estado === 'rechazado' && r.motivo_rechazo && <p className="rounded border border-peligro/40 bg-peligro/10 p-3 text-peligro">Rechazado: {r.motivo_rechazo}</p>}

      <section className="tarjeta space-y-2">
        <p className="text-sm text-suave">{[r.obra_titulo && `Obra: ${r.obra_titulo}`, r.ubicacion_nombre ?? r.establecimiento, `prioridad ${PRIORIDADES_REQ[r.prioridad]?.toLowerCase()}`,
          r.fecha_necesidad && `se necesita para el ${dia(r.fecha_necesidad)}`].filter(Boolean).join(' · ')}</p>
        {r.observaciones && <p>{r.observaciones}</p>}
        {r.numero_orden_compra && <p className="text-sm">OC {r.numero_orden_compra}{(r.proveedor_nombre ?? r.proveedor_texto) && ` · ${r.proveedor_nombre ?? r.proveedor_texto}`}{r.fecha_entrega_estimada && ` · entrega estimada ${dia(r.fecha_entrega_estimada)}`}</p>}
      </section>

      <section className="tarjeta space-y-3">
        <h2>Ítems</h2>
        {items.length === 0 ? <p className="text-suave">Sin ítems todavía.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead><tr className="border-b text-left text-suave">
                <th className="py-2 pr-2 font-medium">Ítem</th><th className="num py-2 pr-2 font-medium">Pedido</th><th className="num py-2 pr-2 font-medium">Aprobado</th>
                <th className="num py-2 pr-2 font-medium">Recibido</th><th className="num py-2 pr-2 font-medium">Costo est.</th>
                {r.estado === 'en_compra' && puedeValidar && <th className="py-2 font-medium">Llegó ahora</th>}
                {editable && <th />}
              </tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-2">{i.descripcion}<span className="block text-xs text-suave">{i.material_id ? 'del pañol' : 'fuera del catálogo'}</span></td>
                    <td className="num py-2 pr-2">{cant(i.cantidad_solicitada, i.unidad)}</td>
                    <td className="num py-2 pr-2">
                      {revisa ? (
                        <input className="control w-24 text-right" inputMode="decimal" defaultValue={i.cantidad_aprobada ?? ''} placeholder={String(Number(i.cantidad_solicitada))}
                          aria-label={`Cantidad aprobada de ${i.descripcion}`}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(i.cantidad_aprobada ?? '')) void hacer(() => guardarItem(i.id, { cantidad_aprobada: v === '' ? null : n(v) }), 'Cantidad aprobada guardada.'); }} />
                      ) : i.cantidad_aprobada === null ? '—' : cant(i.cantidad_aprobada)}
                    </td>
                    <td className="num py-2 pr-2">{cant(i.cantidad_recibida)}</td>
                    <td className="num py-2 pr-2">{fmtPesos(i.costo_estimado)}</td>
                    {r.estado === 'en_compra' && puedeValidar && (
                      <td className="py-2">
                        <input className="control w-24 text-right" inputMode="decimal" value={recepcion[i.id] ?? ''} placeholder={String(pendiente(i))}
                          aria-label={`Cantidad recibida de ${i.descripcion}`} onChange={(e) => setRecepcion((a) => ({ ...a, [i.id]: e.target.value }))} />
                      </td>
                    )}
                    {editable && (
                      <td className="py-2 text-right">
                        <button type="button" aria-label={`Quitar ${i.descripcion}`} onClick={() => hacer(() => quitarItem(i.id), 'Ítem quitado.')}
                          className="inline-flex min-h-control min-w-control items-center justify-center rounded text-suave hover:bg-elevado hover:text-peligro">
                          <Trash2 className="h-5 w-5" aria-hidden />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editable && (
          <form onSubmit={agregar} className="space-y-3 rounded border bg-elevado/40 p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <BuscadorRemoto etiqueta="Material del pañol" tabla="materiales" valor={material} onCambio={setMaterial} />
              {!material && <Campo etiqueta="O qué se necesita (si no está en el pañol)" value={desc} onChange={(e) => setDesc(e.target.value)} />}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Campo etiqueta="Cantidad" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
              {!material && <Selector etiqueta="Unidad" value={unidad} onChange={(e) => setUnidad(e.target.value)} opciones={UNIDADES} />}
              <Campo etiqueta="Costo unitario estimado" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} ayuda={material ? 'Vacío: el costo del pañol.' : undefined} />
            </div>
            <Boton type="submit" icono={Plus} cargando={trabajando}>Agregar ítem</Boton>
          </form>
        )}
        {r.estado === 'en_compra' && puedeValidar && items.length > 0 && (
          <div className="space-y-3 rounded border bg-elevado/40 p-3">
            <h3 className="font-semibold">Recibir la mercadería</h3>
            <p className="text-sm text-suave">Cargá en "Llegó ahora" lo que entró. Lo que es del pañol suma al stock al confirmar; se puede recibir en varias veces.</p>
            <div className="grid gap-3 md:grid-cols-[16rem_1fr] md:items-end">
              <Campo etiqueta="Remito" value={remito} onChange={(e) => setRemito(e.target.value)} />
              <Casilla etiqueta="Cerrar el requerimiento aunque falte algo" checked={cerrar} onChange={(e) => setCerrar(e.target.checked)} />
            </div>
            <Boton variante="primario" icono={PackageCheck} cargando={trabajando} onClick={confirmarRecepcion}>Confirmar recepción</Boton>
          </div>
        )}
      </section>

      {sectorEfectivo && (
        <section className="tarjeta space-y-3">
          <h2>Adjuntos</h2>
          <Documentos sectorId={sectorEfectivo.id} carpeta={`requerimientos/${r.id}`} documentos={r.adjuntos} puedeEditar={editable}
            onCambio={async (docs) => { await guardarRequerimiento(r.id, { adjuntos: docs }); await carga.recargar(); }} />
        </section>
      )}

      {/* Acciones del circuito */}
      <section className="tarjeta space-y-3">
        <h2>Acciones</h2>
        <div className="flex flex-wrap gap-2">
          {editable && <Boton variante="primario" icono={Send} cargando={trabajando} disabled={items.length === 0} onClick={() => hacer(() => cambiarEstadoReq(r.id, 'enviado'), 'Enviado a gerencia.')}>Enviar a gerencia</Boton>}
          {mio && r.estado === 'rechazado' && <Boton icono={Undo2} cargando={trabajando} onClick={() => hacer(() => cambiarEstadoReq(r.id, 'borrador'), 'Volvió a borrador.')}>Volver a borrador para corregir</Boton>}
          {esGerencia && r.estado === 'enviado' && <Boton cargando={trabajando} onClick={() => hacer(() => cambiarEstadoReq(r.id, 'en_revision'), 'Lo tomaste para revisar.')}>Tomar para revisar</Boton>}
          {revisa && <Boton variante="primario" icono={CheckCircle2} cargando={trabajando} onClick={() => hacer(() => cambiarEstadoReq(r.id, 'aprobado'), 'Requerimiento aprobado.')}>Aprobar</Boton>}
          {(mio || esGerencia) && ['borrador', 'enviado', 'en_revision', 'aprobado'].includes(r.estado) && (
            <Boton variante="peligro" icono={Ban} cargando={trabajando} onClick={() => window.confirm('¿Cancelar este requerimiento?') && hacer(() => cambiarEstadoReq(r.id, 'cancelado'), 'Requerimiento cancelado.')}>Cancelar</Boton>
          )}
          {editable && <Boton variante="fantasma" icono={Trash2} onClick={() => window.confirm('¿Borrar este borrador?') && hacer(async () => { await borrarRequerimiento(r.id); onListo(true); }, 'Borrador borrado.')}>Borrar borrador</Boton>}
        </div>
        {esGerencia && mio && (r.estado === 'enviado' || r.estado === 'en_revision') && <p className="text-sm text-suave">Lo pediste vos: lo aprueba o rechaza otra persona de gerencia.</p>}
        {revisa && (
          <div className="flex items-end gap-2">
            <div className="flex-1"><Campo etiqueta="Motivo del rechazo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
            <Boton variante="peligro" icono={XCircle} disabled={!motivo.trim()} cargando={trabajando} onClick={() => hacer(() => cambiarEstadoReq(r.id, 'rechazado', { motivo_rechazo: motivo.trim() }), 'Requerimiento rechazado.')}>Rechazar</Boton>
          </div>
        )}
        {esGerencia && (r.estado === 'aprobado' || r.estado === 'en_compra') && (
          <div className="space-y-3 rounded border bg-elevado/40 p-3">
            <h3 className="font-semibold">Datos de la compra</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <Campo etiqueta="N° de orden de compra" value={datosOC.numero} onChange={(e) => setOc({ ...datosOC, numero: e.target.value })} />
              <Campo etiqueta="Entrega estimada" type="date" value={datosOC.entrega} onChange={(e) => setOc({ ...datosOC, entrega: e.target.value })} />
              <BuscadorRemoto etiqueta="Proveedor" tabla="proveedores" valor={datosOC.proveedor} onCambio={(p) => setOc({ ...datosOC, proveedor: p })} />
              {!datosOC.proveedor && <Campo etiqueta="O el nombre del proveedor" value={datosOC.texto} onChange={(e) => setOc({ ...datosOC, texto: e.target.value })} />}
            </div>
            <div className="flex flex-wrap gap-2">
              <Boton icono={Save} cargando={trabajando} onClick={() => hacer(() => guardarRequerimiento(r.id, datosOcGuardar()), 'Datos de compra guardados.')}>Guardar</Boton>
              {r.estado === 'aprobado' && <Boton variante="primario" icono={ShoppingCart} cargando={trabajando} onClick={() => hacer(() => cambiarEstadoReq(r.id, 'en_compra', datosOcGuardar()), 'Pasó a compra.')}>Pasar a compra</Boton>}
            </div>
          </div>
        )}
      </section>

      <section className="tarjeta space-y-3">
        <h2>Historial</h2>
        <ol className="space-y-3">
          {[...r.historial].reverse().map((h, i) => (
            <li key={i} className="flex gap-3">
              <History className="mt-0.5 h-5 w-5 shrink-0 text-suave" aria-hidden />
              <div>
                <p className="text-sm text-suave">{h.usuario ?? 'Sistema'} · {fechaHora(h.fecha)}</p>
                <p><span className={TONO[h.estado]}>{ESTADOS_REQ[h.estado]}</span>{h.comentario && ` · ${h.comentario}`}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ lista

export default function Requerimientos() {
  const { perfil, esGerencia } = useSesion();
  const carga = useCarga(listarRequerimientos, []);
  const [vista, setVista] = useState<{ tipo: 'lista' } | { tipo: 'nuevo' } | { tipo: 'ficha'; id: string }>({ tipo: 'lista' });
  const [filtro, setFiltro] = useState<'abiertos' | 'mios' | 'revisar' | 'compra' | 'cerrados'>('abiertos');
  const [texto, setTexto] = useState('');
  const todos = useMemo(() => carga.datos ?? [], [carga.datos]);
  const abiertos = (r: Requerimiento) => !['recibido', 'rechazado', 'cancelado'].includes(r.estado);
  const paraRevisar = todos.filter((r) => (r.estado === 'enviado' || r.estado === 'en_revision') && r.solicitante_id !== perfil?.id);
  const lista = todos.filter((r) => {
    const t = texto.trim().toLowerCase();
    const enFiltro = filtro === 'abiertos' ? abiertos(r) : filtro === 'mios' ? r.solicitante_id === perfil?.id : filtro === 'revisar' ? paraRevisar.includes(r)
      : filtro === 'compra' ? r.estado === 'aprobado' || r.estado === 'en_compra' : !abiertos(r);
    return enFiltro && (!t || [r.codigo, r.titulo, r.solicitante_nombre, r.obra_titulo, r.numero_orden_compra].some((v) => v?.toLowerCase().includes(t)));
  });

  if (vista.tipo === 'nuevo') return <Nuevo onCreado={(id) => setVista({ tipo: 'ficha', id })} onVolver={() => setVista({ tipo: 'lista' })} />;
  if (vista.tipo === 'ficha') return <Ficha id={vista.id} onListo={(cambio) => { setVista({ tipo: 'lista' }); if (cambio) void carga.recargar(); }} />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Requerimientos de compra</h1>
        <div className="flex flex-wrap gap-2">
          <Boton icono={Download} disabled={lista.length === 0} onClick={() => descargarCSV('requerimientos.csv',
            ['Código', 'Título', 'Estado', 'Pidió', 'Obra', 'Prioridad', 'Se necesita', 'Ítems', 'Total estimado', 'OC', 'Proveedor', 'Creado'],
            lista.map((r) => [r.codigo, r.titulo, ESTADOS_REQ[r.estado], r.solicitante_nombre, r.obra_titulo, PRIORIDADES_REQ[r.prioridad], r.fecha_necesidad, r.items_total,
              Number(r.total_estimado), r.numero_orden_compra, r.proveedor_nombre ?? r.proveedor_texto, dia(r.created_at.slice(0, 10))]))}>Exportar</Boton>
          <Boton variante="primario" icono={Plus} onClick={() => setVista({ tipo: 'nuevo' })}>Nuevo requerimiento</Boton>
        </div>
      </header>
      <p className="text-suave">Se pide lo que falta; gerencia lo revisa y lo aprueba (nunca quien lo pidió); al recibir la compra, lo del pañol entra al stock.</p>

      <Indicadores>
        <Indicador titulo={esGerencia ? 'Para revisar' : 'Esperando a gerencia'} valor={esGerencia ? paraRevisar.length : todos.filter((r) => r.solicitante_id === perfil?.id && (r.estado === 'enviado' || r.estado === 'en_revision')).length}
          icono={Send} tono={esGerencia && paraRevisar.length > 0 ? 'alerta' : 'neutro'} />
        <Indicador titulo="En compra" valor={todos.filter((r) => r.estado === 'en_compra').length} icono={ShoppingCart} tono="info" />
        <Indicador titulo="Atrasados" valor={todos.filter((r) => r.atrasado).length} icono={XCircle} tono={todos.some((r) => r.atrasado) ? 'peligro' : 'neutro'} />
        <Indicador titulo="Recibidos" valor={todos.filter((r) => r.estado === 'recibido').length} icono={PackageCheck} tono="exito" />
      </Indicadores>

      <Pestanas activa={filtro} onCambio={setFiltro} pestanas={[
        { id: 'abiertos', texto: 'Abiertos' }, { id: 'mios', texto: 'Míos' }, { id: 'revisar', texto: 'Para revisar', cuenta: paraRevisar.length, alerta: esGerencia },
        { id: 'compra', texto: 'Aprobados y en compra' }, { id: 'cerrados', texto: 'Cerrados' },
      ]} />
      <Campo etiqueta="Buscar por código, título, quién pidió, obra u OC" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />

      {carga.cargando && !carga.datos ? <Esqueleto filas={4} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : lista.length === 0 ? (
          <Vacio icono={ShoppingCart} titulo={todos.length === 0 ? 'Todavía no hay requerimientos' : 'No hay requerimientos en esta pestaña'}
            texto={todos.length === 0 ? 'Cuando falte material, pedilo desde acá con sus ítems: queda el circuito completo hasta que llega.' : 'Probá con otra pestaña.'} />
        ) : (
          <ul className="space-y-2">
            {lista.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setVista({ tipo: 'ficha', id: r.id })} className="tarjeta flex w-full flex-wrap items-center justify-between gap-3 text-left hover:border-primario/60">
                  <div className="min-w-0">
                    <p className="font-medium">{r.codigo} · {r.titulo}</p>
                    <p className="text-sm text-suave">{[r.solicitante_nombre, r.obra_titulo, `${r.items_total} ${r.items_total === 1 ? 'ítem' : 'ítems'}`, r.fecha_necesidad && `para el ${dia(r.fecha_necesidad)}`,
                      r.numero_orden_compra && `OC ${r.numero_orden_compra}`].filter(Boolean).join(' · ')}</p>
                    {r.atrasado && <div className="mt-1"><AvisoBadge texto="Pasó la fecha en que se necesitaba" tono="peligro" /></div>}
                  </div>
                  <div className="text-right">
                    <p className={`font-medium ${TONO[r.estado]}`}>{ESTADOS_REQ[r.estado]}</p>
                    <p className="num text-sm">{fmtPesos(r.total_estimado)}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
