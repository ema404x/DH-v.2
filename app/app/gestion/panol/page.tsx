'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, Coins, Download, PackageX, Plus, Save, Scale, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Casilla, Selector, oNull } from '@/components/Campos';
import { AvisoBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { ElegirExcel, Indicador, Indicadores, Pestanas, descargarCSV } from '@/components/gestion/Piezas';
import { fmtPesos } from '@/lib/certificacion';
import { leerCatalogoMateriales, type FilaMaterial } from '@/lib/excel';
import {
  CATEGORIAS, MOTIVOS, MOTIVOS_ENTRADA, MOTIVOS_SALIDA, UNIDADES, ajustarStock, borrarMaterial, cant, crearMaterial, guardarMaterial, importarMateriales,
  listarMateriales, listarMovimientos, registrarMovimiento, type Material, type Movimiento, type ResultadoCatalogo,
} from '@/lib/panol';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const numero = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(/\./g, '').replace(',', '.')));

// ------------------------------------------------------------------ mover stock (entrada, salida, ajuste)

function MoverStock({ material, onListo }: { material: Material; onListo: () => void }) {
  const [modo, setModo] = useState<'entrada' | 'salida' | 'ajuste'>('salida');
  const [motivo, setMotivo] = useState('consumo');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [obra, setObra] = useState<ResultadoBusqueda | null>(null);
  const [empleado, setEmpleado] = useState<ResultadoBusqueda | null>(null);
  const [responsable, setResponsable] = useState('');
  const [remito, setRemito] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const n = numero(cantidad);
  const resultado = modo === 'ajuste' ? n : modo === 'entrada' ? Number(material.stock) + n : Number(material.stock) - n;

  function cambiarModo(m: typeof modo) {
    setModo(m);
    setMotivo(m === 'entrada' ? 'compra' : m === 'salida' ? 'consumo' : '');
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (Number.isNaN(n) || (modo === 'ajuste' ? n < 0 : n <= 0)) {
      toast.error(modo === 'ajuste' ? 'Escribí cuánto contaste (cero o más).' : 'La cantidad tiene que ser mayor a cero.');
      return;
    }
    setGuardando(true);
    try {
      if (modo === 'ajuste') {
        const hubo = await ajustarStock(material.id, n, oNull(notas));
        toast.success(hubo ? 'Stock ajustado a lo contado.' : 'Coincidía con lo contado: no hizo falta ajustar.');
      } else {
        await registrarMovimiento({
          material: material.id, tipo: modo, motivo, cantidad: n, obra: obra?.id ?? null, empleado: empleado?.id ?? null,
          responsable: empleado ? null : oNull(responsable), remito: oNull(remito), notas: oNull(notas),
          costo: modo === 'entrada' && motivo === 'compra' && costo.trim() ? numero(costo) : null,
        });
        toast.success(modo === 'entrada' ? 'Entrada registrada.' : 'Salida registrada.');
      }
      setCantidad(''); setCosto(''); setRemito(''); setNotas(''); setObra(null); setEmpleado(null); setResponsable('');
      onListo();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="tarjeta space-y-4">
      <h2>Mover stock</h2>
      <Pestanas activa={modo} onCambio={cambiarModo} pestanas={[{ id: 'salida', texto: 'Salida' }, { id: 'entrada', texto: 'Entrada' }, { id: 'ajuste', texto: 'Ajuste por inventario' }]} />
      <div className="grid gap-4 md:grid-cols-3">
        {modo !== 'ajuste' && <Selector etiqueta="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} opciones={modo === 'entrada' ? MOTIVOS_ENTRADA : MOTIVOS_SALIDA} />}
        <Campo etiqueta={modo === 'ajuste' ? `Stock contado (${UNIDADES[material.unidad]})` : `Cantidad (${UNIDADES[material.unidad]})`} inputMode="decimal" required value={cantidad} onChange={(e) => setCantidad(e.target.value)}
          ayuda={!Number.isNaN(n) && cantidad ? `Queda en ${cant(Math.max(0, resultado), material.unidad)}${resultado < 0 ? ' — no alcanza el stock' : ''}` : `Hay ${cant(material.stock, material.unidad)}`} />
        {modo === 'entrada' && motivo === 'compra' && <Campo etiqueta="Costo unitario de la compra" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} ayuda="El costo del material pasa a ser el promedio ponderado." />}
      </div>
      {modo !== 'ajuste' && (
        <div className="grid gap-4 md:grid-cols-2">
          <BuscadorRemoto etiqueta={modo === 'salida' ? 'Obra (si va a una obra)' : 'Obra (opcional)'} tabla="obras" valor={obra} onCambio={setObra} />
          {modo === 'salida' && <BuscadorRemoto etiqueta="Quién lo retira" tabla="empleados" valor={empleado} onCambio={setEmpleado} />}
          {modo === 'salida' && !empleado && <Campo etiqueta="O el nombre (si no tiene ficha)" value={responsable} onChange={(e) => setResponsable(e.target.value)} />}
          <Campo etiqueta="Remito o referencia" value={remito} onChange={(e) => setRemito(e.target.value)} />
        </div>
      )}
      <Area etiqueta="Notas" value={notas} onChange={(e) => setNotas(e.target.value)} />
      <Boton type="submit" variante="primario" icono={modo === 'entrada' ? ArrowDownToLine : modo === 'salida' ? ArrowUpFromLine : Scale} cargando={guardando}>
        {modo === 'entrada' ? 'Registrar entrada' : modo === 'salida' ? 'Registrar salida' : 'Ajustar al contado'}
      </Boton>
    </form>
  );
}

// ------------------------------------------------------------------ ficha del material

function Ficha({ material, puedeEditar, esGerencia, onListo }: { material: Material | null; puedeEditar: boolean; esGerencia: boolean; onListo: (cambio: boolean) => void }) {
  const [m, setM] = useState(material);
  const [f, setF] = useState({
    nombre: m?.nombre ?? '', codigo: m?.codigo ?? '', categoria: m?.categoria ?? 'construccion', unidad: m?.unidad ?? 'unidad',
    stock_minimo: m ? String(Number(m.stock_minimo)) : '0', costo_unitario: m ? String(Number(m.costo_unitario)) : '0', stock_inicial: '0',
    proveedor_texto: m?.proveedor_texto ?? '', ubicacion_deposito: m?.ubicacion_deposito ?? '', notas: m?.notas ?? '',
  });
  const [prestable, setPrestable] = useState(m?.prestable ?? false);
  const [activo, setActivo] = useState(m?.activo ?? true);
  const [proveedor, setProveedor] = useState<ResultadoBusqueda | null>(m?.proveedor_id ? { id: m.proveedor_id, etiqueta: m.proveedor_nombre ?? '', detalle: null } : null);
  const [guardando, setGuardando] = useState(false);
  const [cambio, setCambio] = useState(false);
  const movs = useCarga(async () => (m ? listarMovimientos({ material: m.id }) : []), [m?.id, m?.stock]);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value })) });

  async function recargarMaterial() {
    setCambio(true);
    const todos = await listarMateriales();
    setM(todos.find((x) => x.id === m?.id) ?? m);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const minimo = numero(f.stock_minimo || '0');
    const costo = numero(f.costo_unitario || '0');
    const inicial = numero(f.stock_inicial || '0');
    if ([minimo, costo, inicial].some((x) => Number.isNaN(x) || x < 0)) {
      toast.error('Revisá los números: tienen que ser cero o más.');
      return;
    }
    setGuardando(true);
    const datos = {
      nombre: f.nombre.trim(), codigo: oNull(f.codigo), categoria: f.categoria, unidad: f.unidad, stock_minimo: minimo, costo_unitario: costo, prestable,
      proveedor_id: proveedor?.id ?? null, proveedor_texto: proveedor ? null : oNull(f.proveedor_texto), ubicacion_deposito: oNull(f.ubicacion_deposito), notas: oNull(f.notas), activo,
    };
    try {
      if (m) {
        await guardarMaterial(m.id, datos);
        toast.success('Material guardado.');
        await recargarMaterial();
      } else {
        await crearMaterial(datos, inicial);
        toast.success('Material creado.');
        onListo(true);
      }
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!m || !window.confirm(`¿Borrar "${m.nombre}"? Si ya tuvo movimientos no se va a poder: en ese caso desactivalo.`)) return;
    try {
      await borrarMaterial(m.id);
      toast.success('Material borrado.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>{m ? m.nombre : 'Nuevo material'}</h1>
          {m && (
            <p className="text-suave">
              Stock <strong className={m.bajo_minimo || m.sin_stock ? 'text-peligro' : 'text-texto'}>{cant(m.stock, m.unidad)}</strong>
              {Number(m.stock_minimo) > 0 && ` · mínimo ${cant(m.stock_minimo, m.unidad)}`}
              {Number(m.prestado) > 0 && ` · ${cant(m.prestado, m.unidad)} prestado`} · valor {fmtPesos(m.valor)}
            </p>
          )}
        </div>
        <Boton variante="fantasma" onClick={() => onListo(cambio)}>Volver al stock</Boton>
      </header>

      {m && puedeEditar && <MoverStock material={m} onListo={recargarMaterial} />}

      <form onSubmit={guardar} className="space-y-4">
        <fieldset disabled={!puedeEditar} className="tarjeta space-y-4">
          <h2>Datos</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Campo etiqueta="Nombre" required {...campo('nombre')} />
            <Campo etiqueta="Código" {...campo('codigo')} />
            <Selector etiqueta="Categoría" opciones={CATEGORIAS} {...campo('categoria')} />
            <Selector etiqueta="Unidad" opciones={UNIDADES} {...campo('unidad')} />
            <Campo etiqueta="Stock mínimo" inputMode="decimal" {...campo('stock_minimo')} ayuda="Por debajo, se avisa." />
            <Campo etiqueta="Costo unitario" inputMode="decimal" {...campo('costo_unitario')} />
            {!m && <Campo etiqueta="Stock inicial" inputMode="decimal" {...campo('stock_inicial')} ayuda="Queda registrado como movimiento de stock inicial." />}
            <Campo etiqueta="Ubicación en el depósito" {...campo('ubicacion_deposito')} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <BuscadorRemoto etiqueta="Proveedor" tabla="proveedores" valor={proveedor} onCambio={setProveedor} />
            {!proveedor && <Campo etiqueta="O el nombre del proveedor" {...campo('proveedor_texto')} />}
          </div>
          <Casilla etiqueta="Es una herramienta que se presta y vuelve (taladro, escalera)" checked={prestable} onChange={(e) => setPrestable(e.target.checked)} />
          {m && <Casilla etiqueta="Activo (desmarcalo para que no aparezca al buscar)" checked={activo} onChange={(e) => setActivo(e.target.checked)} />}
          <Area etiqueta="Notas" {...campo('notas')} />
        </fieldset>
        {puedeEditar && (
          <div className="flex flex-wrap justify-between gap-3">
            <Boton type="submit" variante={m ? 'secundario' : 'primario'} icono={Save} cargando={guardando}>{m ? 'Guardar datos' : 'Crear material'}</Boton>
            {m && esGerencia && <Boton variante="peligro" icono={Trash2} onClick={borrar}>Borrar</Boton>}
          </div>
        )}
      </form>

      {m && (
        <section className="tarjeta space-y-3">
          <h2>Movimientos</h2>
          {movs.cargando && !movs.datos ? <Esqueleto filas={3} /> : movs.error ? <ErrorVista mensaje={movs.error} onReintentar={movs.recargar} />
            : <ListaMovimientos movimientos={movs.datos ?? []} conMaterial={false} />}
        </section>
      )}
    </div>
  );
}

function ListaMovimientos({ movimientos, conMaterial }: { movimientos: Movimiento[]; conMaterial: boolean }) {
  if (movimientos.length === 0) return <p className="text-suave">Sin movimientos.</p>;
  return (
    <ul className="divide-y">
      {movimientos.map((x) => (
        <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
          <div className="min-w-0">
            <p className="font-medium">
              {conMaterial && <>{x.material_nombre} · </>}
              <span className={x.tipo === 'entrada' ? 'text-exito' : 'text-alerta'}>{MOTIVOS[x.motivo] ?? x.motivo}</span>
            </p>
            <p className="text-sm text-suave">
              {[fecha(x.created_at), x.obra_titulo && `Obra: ${x.obra_titulo}`, x.ot_codigo && `Orden ${x.ot_codigo}`, x.requerimiento_codigo,
                x.empleado_nombre ?? x.responsable_texto, x.remito && `Remito ${x.remito}`, x.registrado_por_nombre && `cargó ${x.registrado_por_nombre}`].filter(Boolean).join(' · ')}
            </p>
            {x.notas && <p className="text-sm">{x.notas}</p>}
          </div>
          <div className="text-right">
            <p className={`num font-semibold ${x.tipo === 'entrada' ? 'text-exito' : 'text-alerta'}`}>{x.tipo === 'entrada' ? '+' : '−'}{cant(x.cantidad, x.material_unidad)}</p>
            <p className="num text-xs text-suave">{cant(x.stock_anterior)} → {cant(x.stock_nuevo)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ importación

function Importar({ onListo }: { onListo: (cambio: boolean) => void }) {
  const [lectura, setLectura] = useState<{ filas: FilaMaterial[]; hoja: string; columnas: string[]; archivo: string } | null>(null);
  const [ajustar, setAjustar] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCatalogo | null>(null);
  const [importando, setImportando] = useState(false);

  async function importar() {
    if (!lectura) return;
    setImportando(true);
    try {
      setResultado(await importarMateriales(lectura.filas, ajustar));
      setLectura(null);
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setImportando(false);
    }
  }

  function plantilla() {
    descargarCSV('plantilla-panol.csv', ['nombre', 'codigo', 'categoria', 'unidad', 'stock', 'minimo', 'precio', 'proveedor', 'ubicacion', 'notas'], [
      ['Cable unipolar 2,5 mm', 'ELE-001', 'electrico', 'metro', 500, 100, '350,00', 'Proveedor SA', 'Estante A1', ''],
      ['Taladro percutor', 'HER-001', 'herramientas', 'unidad', 3, 1, '85000', '', 'Pañol', 'Se presta'],
    ]);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Importar el catálogo del pañol</h1>
        <Boton variante="fantasma" onClick={() => onListo(!!resultado)}>Volver al stock</Boton>
      </header>
      <section className="tarjeta space-y-4">
        <p className="text-suave">
          Una planilla (.xlsx) con encabezados: nombre, código, categoría, unidad, stock, mínimo, precio, proveedor, ubicación y notas (sirven variantes
          como "Material", "Cantidad" o "Costo"). Cada material se reconoce por su código (o por el nombre, si no tiene): reimportar actualiza, no duplica.
          Lo nuevo entra con su stock inicial; en lo que ya existe, el stock solo cambia si marcás el ajuste al contado.
        </p>
        <div className="flex flex-wrap gap-2">
          <ElegirExcel texto="Elegir planilla (.xlsx)" leer={leerCatalogoMateriales} onLeido={(l, archivo) => { setLectura({ ...l, archivo }); setResultado(null); }} />
          <Boton variante="fantasma" icono={Download} onClick={plantilla}>Bajar una plantilla</Boton>
        </div>
      </section>
      {lectura && (
        <section className="tarjeta space-y-4">
          <p><strong>{lectura.archivo}</strong> · hoja "{lectura.hoja}" · {lectura.filas.length} materiales</p>
          <p className="text-sm text-suave">Columnas reconocidas: {lectura.columnas.join(' · ')}</p>
          <div className="max-h-80 overflow-auto rounded border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-superficie"><tr className="border-b text-left text-suave">
                <th className="px-3 py-2 font-medium">Material</th><th className="px-3 py-2 font-medium">Categoría</th>
                <th className="num px-3 py-2 font-medium">Stock</th><th className="num px-3 py-2 font-medium">Mínimo</th><th className="num px-3 py-2 font-medium">Costo</th>
              </tr></thead>
              <tbody>
                {lectura.filas.slice(0, 200).map((f, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="px-3 py-2">{f.nombre}{f.codigo && <span className="block text-xs text-suave">{f.codigo}</span>}</td>
                    <td className="px-3 py-2">{CATEGORIAS[f.categoria] ?? '—'}</td>
                    <td className="num px-3 py-2">{f.stock === null ? '—' : cant(f.stock, f.unidad || undefined)}</td>
                    <td className="num px-3 py-2">{f.stock_minimo ?? '—'}</td>
                    <td className="num px-3 py-2">{f.costo_unitario === null ? '—' : fmtPesos(f.costo_unitario)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Casilla etiqueta="Es un inventario contado: ajustar el stock de lo que ya existe a lo que dice la planilla" checked={ajustar} onChange={(e) => setAjustar(e.target.checked)} />
          <Boton variante="primario" icono={Upload} cargando={importando} onClick={importar}>Importar {lectura.filas.length} materiales</Boton>
        </section>
      )}
      {resultado && (
        <div className="rounded border border-exito/40 bg-exito/10 p-3 text-exito" role="status">
          <p className="font-semibold">Importación terminada</p>
          <p>{resultado.nuevos} nuevos, {resultado.actualizados} actualizados{resultado.ajustados > 0 && `, ${resultado.ajustados} con el stock ajustado`}.{resultado.omitidos > 0 && ` ${resultado.omitidos} filas sin nombre.`}</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ movimientos (libro)

function Movimientos() {
  const hoy = new Date();
  const [desde, setDesde] = useState(new Date(hoy.getFullYear(), hoy.getMonth(), 1).toLocaleDateString('sv-SE'));
  const [hasta, setHasta] = useState(hoy.toLocaleDateString('sv-SE'));
  const [tipo, setTipo] = useState<'' | 'entrada' | 'salida'>('');
  const [texto, setTexto] = useState('');
  const carga = useCarga(() => listarMovimientos({ desde, hasta, tipo: tipo || null }), [desde, hasta, tipo]);
  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (carga.datos ?? []).filter((x) => !t || [x.material_nombre, x.material_codigo, x.obra_titulo, x.ot_codigo, x.empleado_nombre, x.responsable_texto, x.remito]
      .some((v) => v?.toLowerCase().includes(t)));
  }, [carga.datos, texto]);
  const valor = (t: 'entrada' | 'salida') => lista.filter((x) => x.tipo === t).reduce((s, x) => s + Number(x.valor), 0);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-[10rem_10rem_10rem_1fr]">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} opciones={{ '': 'Todos', entrada: 'Entradas', salida: 'Salidas' }} />
        <Campo etiqueta="Buscar por material, obra, orden, persona o remito" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>
      <Indicadores>
        <Indicador titulo="Movimientos" valor={lista.length} icono={ClipboardCheck} />
        <Indicador titulo="Entró (valor)" valor={<span className="text-lg">{fmtPesos(valor('entrada'))}</span>} icono={ArrowDownToLine} tono="exito" />
        <Indicador titulo="Salió (valor)" valor={<span className="text-lg">{fmtPesos(valor('salida'))}</span>} icono={ArrowUpFromLine} tono="alerta" />
        <Indicador titulo="Salidas a obras" valor={lista.filter((x) => x.tipo === 'salida' && x.obra_id).length} icono={Boxes} />
      </Indicadores>
      <div className="flex justify-end">
        <Boton icono={Download} disabled={lista.length === 0} onClick={() => descargarCSV(`movimientos-panol-${desde}-a-${hasta}.csv`,
          ['N°', 'Fecha', 'Material', 'Código', 'Tipo', 'Motivo', 'Cantidad', 'Unidad', 'Stock anterior', 'Stock nuevo', 'Costo unitario', 'Valor', 'Obra', 'Orden', 'Requerimiento', 'Quién', 'Remito', 'Cargó', 'Notas'],
          lista.map((x) => [x.numero, fecha(x.created_at), x.material_nombre, x.material_codigo, x.tipo, MOTIVOS[x.motivo] ?? x.motivo, Number(x.cantidad), x.material_unidad,
            Number(x.stock_anterior), Number(x.stock_nuevo), Number(x.costo_unitario), Number(x.valor), x.obra_titulo, x.ot_codigo, x.requerimiento_codigo,
            x.empleado_nombre ?? x.responsable_texto, x.remito, x.registrado_por_nombre, x.notas]))}>Exportar</Boton>
      </div>
      {carga.cargando && !carga.datos ? <Esqueleto filas={5} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : <section className="tarjeta"><ListaMovimientos movimientos={lista} conMaterial /></section>}
    </>
  );
}

// ------------------------------------------------------------------ pantalla

export default function Panol() {
  const { puedeValidar, esGerencia } = useSesion();
  const carga = useCarga(listarMateriales, []);
  const [pestana, setPestana] = useState<'stock' | 'movimientos'>('stock');
  const [vista, setVista] = useState<{ tipo: 'lista' } | { tipo: 'ficha'; material: Material | null } | { tipo: 'importar' }>({ tipo: 'lista' });
  const [texto, setTexto] = useState('');
  const [categoria, setCategoria] = useState('');
  const [filtro, setFiltro] = useState<'activos' | 'bajo' | 'todos'>('activos');

  const todos = useMemo(() => carga.datos ?? [], [carga.datos]);
  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return todos.filter((m) => (filtro === 'todos' || (filtro === 'bajo' ? m.activo && (m.bajo_minimo || m.sin_stock) : m.activo))
      && (!categoria || m.categoria === categoria)
      && (!t || [m.nombre, m.codigo, m.ubicacion_deposito, m.proveedor_nombre, m.proveedor_texto].some((v) => v?.toLowerCase().includes(t))));
  }, [todos, texto, categoria, filtro]);
  const activos = todos.filter((m) => m.activo);
  const bajos = activos.filter((m) => m.bajo_minimo).length;
  const sinStock = activos.filter((m) => m.sin_stock).length;

  if (vista.tipo === 'ficha') return <Ficha material={vista.material} puedeEditar={puedeValidar} esGerencia={esGerencia} onListo={(cambio) => { setVista({ tipo: 'lista' }); if (cambio) void carga.recargar(); }} />;
  if (vista.tipo === 'importar') return <Importar onListo={(cambio) => { setVista({ tipo: 'lista' }); if (cambio) void carga.recargar(); }} />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Pañol</h1>
        <div className="flex flex-wrap gap-2">
          {pestana === 'stock' && (
            <Boton icono={Download} disabled={lista.length === 0} onClick={() => descargarCSV('stock-panol.csv',
              ['Código', 'Material', 'Categoría', 'Unidad', 'Stock', 'Mínimo', 'Prestado', 'Costo unitario', 'Valor', 'Proveedor', 'Ubicación', 'Bajo mínimo'],
              lista.map((m) => [m.codigo, m.nombre, CATEGORIAS[m.categoria], m.unidad, Number(m.stock), Number(m.stock_minimo), Number(m.prestado), Number(m.costo_unitario),
                Number(m.valor), m.proveedor_nombre ?? m.proveedor_texto, m.ubicacion_deposito, m.bajo_minimo || m.sin_stock ? 'Sí' : 'No']))}>Exportar</Boton>
          )}
          {puedeValidar && <Boton icono={Upload} onClick={() => setVista({ tipo: 'importar' })}>Importar catálogo</Boton>}
          {puedeValidar && <Boton variante="primario" icono={Plus} onClick={() => setVista({ tipo: 'ficha', material: null })}>Nuevo material</Boton>}
        </div>
      </header>

      <Pestanas activa={pestana} onCambio={setPestana} pestanas={[{ id: 'stock', texto: 'Stock', cuenta: activos.length }, { id: 'movimientos', texto: 'Movimientos' }]} />

      {pestana === 'movimientos' ? <Movimientos /> : (
        <>
          <Indicadores>
            <Indicador titulo="Materiales activos" valor={activos.length} icono={Boxes} />
            <Indicador titulo="Bajo el mínimo" valor={bajos} icono={AlertTriangle} tono={bajos > 0 ? 'alerta' : 'neutro'} />
            <Indicador titulo="Sin stock" valor={sinStock} icono={PackageX} tono={sinStock > 0 ? 'peligro' : 'neutro'} />
            <Indicador titulo="Valor del stock" valor={<span className="text-lg">{fmtPesos(activos.reduce((t, m) => t + Number(m.valor), 0))}</span>} icono={Coins} />
          </Indicadores>

          <div className="grid gap-3 md:grid-cols-[1fr_12rem_12rem]">
            <Campo etiqueta="Buscar por nombre, código, ubicación o proveedor" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
            <Selector etiqueta="Categoría" value={categoria} onChange={(e) => setCategoria(e.target.value)} opciones={{ '': 'Todas', ...CATEGORIAS }} />
            <Selector etiqueta="Mostrar" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} opciones={{ activos: 'Activos', bajo: 'Bajo mínimo o sin stock', todos: 'Todos (también inactivos)' }} />
          </div>

          {carga.cargando && !carga.datos ? <Esqueleto filas={6} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
            : lista.length === 0 ? (
              <Vacio icono={Boxes} titulo={todos.length === 0 ? 'El pañol está vacío' : 'No hay materiales con ese filtro'}
                texto={todos.length === 0 ? 'Cargá los materiales y herramientas uno por uno o importá el catálogo desde una planilla.' : 'Probá con otra categoría u otro texto.'} />
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-superficie">
                <table className="w-full border-collapse text-sm">
                  <thead><tr className="border-b text-left text-suave">
                    <th className="px-3 py-3 font-medium">Material</th>
                    <th className="hidden px-3 py-3 font-medium md:table-cell">Categoría</th>
                    <th className="num px-3 py-3 font-medium">Stock</th>
                    <th className="num hidden px-3 py-3 font-medium md:table-cell">Costo</th>
                    <th className="num hidden px-3 py-3 font-medium lg:table-cell">Valor</th>
                  </tr></thead>
                  <tbody>
                    {lista.map((m) => (
                      <tr key={m.id} className={`border-b last:border-b-0 ${m.sin_stock || m.bajo_minimo ? 'bg-peligro/10' : 'hover:bg-elevado/60'} ${m.activo ? '' : 'opacity-60'}`}>
                        <td className="px-3 py-3">
                          <button type="button" className="block min-h-control text-left font-medium text-primario hover:underline" onClick={() => setVista({ tipo: 'ficha', material: m })}>
                            {m.nombre}
                            <span className="block text-xs font-normal text-suave">{[m.codigo, m.ubicacion_deposito, m.prestable && 'se presta', !m.activo && 'inactivo'].filter(Boolean).join(' · ')}</span>
                          </button>
                        </td>
                        <td className="hidden px-3 py-3 md:table-cell">{CATEGORIAS[m.categoria]}</td>
                        <td className="num px-3 py-3">
                          <span className="font-semibold">{cant(m.stock, m.unidad)}</span>
                          {Number(m.prestado) > 0 && <span className="block text-xs text-suave">{cant(m.prestado)} prestado</span>}
                          {m.sin_stock ? <div className="mt-1"><AvisoBadge texto="Sin stock" tono="peligro" /></div>
                            : m.bajo_minimo ? <div className="mt-1"><AvisoBadge texto={`Mínimo ${cant(m.stock_minimo)}`} /></div> : null}
                        </td>
                        <td className="num hidden px-3 py-3 md:table-cell">{fmtPesos(m.costo_unitario)}</td>
                        <td className="num hidden px-3 py-3 lg:table-cell">{fmtPesos(m.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}
    </>
  );
}
