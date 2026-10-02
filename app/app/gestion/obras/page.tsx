'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, Building, ClipboardList, Coins, Download, HardHat, Plus, Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Boton, BotonEnlace } from '@/components/Boton';
import { Area, Campo, Selector, oNull } from '@/components/Campos';
import { AvisoBadge, EstadoOTBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { fmtFecha } from '@/components/OTCard';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Documentos } from '@/components/gestion/Documentos';
import { ElegirExcel, Indicador, Indicadores, Pestanas, descargarCSV } from '@/components/gestion/Piezas';
import { fmtPesos } from '@/lib/certificacion';
import { leerPlanillaObras, type FilaObra } from '@/lib/excel';
import {
  ESTADOS_COBRO, ESTADOS_OBRA, TIPOS_OBRA, borrarObra, cobrosDeObra, fmtPct, guardarDocumentosObra, guardarObra, importarPlanillaObras, listarObras,
  obtenerObra, ordenesDeObra, sumarObraAlCiclo, type AlertaPlazo, type EstadoObra, type FiltroObras, type Obra, type ResultadoPlanillaObras,
} from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { PRIORIDADES, type EstadoOT, type Prioridad, type ResultadoBusqueda } from '@/lib/types';

const FILTRO_ESTADO = { activas: 'En curso o por empezar', todas: 'Todas', ...ESTADOS_OBRA };
const TONO_ESTADO: Record<EstadoObra, string> = {
  pendiente: 'text-alerta', en_progreso: 'text-info', pausado: 'text-suave', completado: 'text-exito', cancelado: 'text-suave',
};
const TEXTO_ALERTA: Record<AlertaPlazo, string> = { peligro: 'Plazo en riesgo', alerta: 'Atrasada', aviso: 'Revisar avance' };
const TONO_ALERTA: Record<AlertaPlazo, 'peligro' | 'alerta' | 'info'> = { peligro: 'peligro', alerta: 'alerta', aviso: 'info' };

function textoPlazo(o: Obra): string | null {
  if (o.dias_restantes === null || o.estado === 'completado' || o.estado === 'cancelado') return null;
  if (o.dias_restantes < 0) return `Venció hace ${-o.dias_restantes} d`;
  if (o.dias_restantes === 0) return 'Vence hoy';
  return `Faltan ${o.dias_restantes} d`;
}

function Barra({ valor, esperado }: { valor: number; esperado?: number }) {
  return (
    <div className="relative h-2 w-full min-w-16 overflow-hidden rounded bg-elevado" aria-hidden>
      <div className="h-full bg-primario" style={{ width: `${Math.min(100, Math.max(0, valor))}%` }} />
      {esperado !== undefined && <div className="absolute top-0 h-full w-0.5 bg-texto/70" style={{ left: `${Math.min(100, esperado)}%` }} />}
    </div>
  );
}

// ------------------------------------------------------------------ ficha de la obra

function Ficha({ id, zonas, puedeEditar, esGerencia, onListo }: { id: string | null; zonas: string[]; puedeEditar: boolean; esGerencia: boolean; onListo: (cambio: boolean) => void }) {
  const { sectorEfectivo } = useSesion();
  const carga = useCarga(async () => (id ? obtenerObra(id) : null), [id]);
  const [pestana, setPestana] = useState<'datos' | 'documentos' | 'ordenes' | 'cobro'>('datos');
  const [cambio, setCambio] = useState(false);
  const o = carga.datos;

  if (id && carga.cargando && !o) return <Esqueleto filas={6} />;
  if (id && (carga.error || !o)) return <ErrorVista mensaje={carga.error ?? 'No se encontró la obra.'} onReintentar={carga.recargar} />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words">{o ? o.titulo : 'Nueva obra'}</h1>
          {o && <p className="text-suave">{[o.codigo_sap && `SAP ${o.codigo_sap}`, o.establecimiento, o.zona].filter(Boolean).join(' · ')}</p>}
        </div>
        <Boton variante="fantasma" onClick={() => onListo(cambio)}>Volver a la lista</Boton>
      </header>
      {o && (
        <Pestanas activa={pestana} onCambio={setPestana} pestanas={[
          { id: 'datos', texto: 'Datos' },
          { id: 'documentos', texto: 'Documentos', cuenta: o.documentos.length },
          { id: 'ordenes', texto: 'Órdenes', cuenta: o.ots_total },
          { id: 'cobro', texto: 'Cobro' },
        ]} />
      )}
      {pestana === 'datos' || !o ? (
        <FormObra obra={o} zonas={zonas} puedeEditar={puedeEditar} esGerencia={esGerencia}
          onGuardada={async () => { setCambio(true); if (!o) onListo(true); else await carga.recargar(); }}
          onBorrada={() => onListo(true)} />
      ) : pestana === 'documentos' ? (
        <section className="tarjeta space-y-3">
          <p className="text-sm text-suave">Actas, planos, fotos y cualquier archivo de la obra. Se guardan en privado: solo los ve tu sector.</p>
          {sectorEfectivo && (
            <Documentos sectorId={sectorEfectivo.id} carpeta={`obras/${o.id}`} documentos={o.documentos} puedeEditar={puedeEditar}
              onCambio={async (docs) => { await guardarDocumentosObra(o.id, docs); carga.setDatos({ ...o, documentos: docs }); }} />
          )}
        </section>
      ) : pestana === 'ordenes' ? (
        <OrdenesObra obra={o} puedeEditar={puedeEditar} />
      ) : (
        <CobroObra obra={o} puedeEditar={puedeEditar} />
      )}
    </div>
  );
}

function FormObra({ obra, zonas, puedeEditar, esGerencia, onGuardada, onBorrada }: {
  obra: Obra | null; zonas: string[]; puedeEditar: boolean; esGerencia: boolean; onGuardada: () => Promise<void> | void; onBorrada: () => void;
}) {
  const o = obra;
  const [f, setF] = useState({
    titulo: o?.titulo ?? '', codigo_sap: o?.codigo_sap ?? '', mein: o?.mein ?? '', establecimiento: o?.establecimiento ?? '', direccion: o?.direccion ?? '',
    zona: o?.zona ?? '', tipo: o?.tipo ?? 'obra_nueva', estado: o?.estado ?? ('pendiente' as EstadoObra), prioridad: o?.prioridad ?? ('media' as Prioridad),
    estado_sap: o?.estado_sap ?? '', detalle: o?.detalle ?? '', monto_base: o ? String(Number(o.monto_base)) : '', costo_real: o ? String(Number(o.costo_real)) : '',
    avance: o ? String(Number(o.avance)) : '0', plazo_dias: o?.plazo_dias != null ? String(o.plazo_dias) : '', fecha_inicio: o?.fecha_inicio ?? '', fecha_fin: o?.fecha_fin ?? '',
    supervisor: o?.supervisor ?? '', descripcion: o?.descripcion ?? '', notas: o?.notas ?? '',
  });
  const aBusqueda = (idR: string | null, nombre: string | null): ResultadoBusqueda | null => (nombre ? { id: idR ?? '', etiqueta: nombre, detalle: idR ? null : 'nombre de planilla' } : null);
  const [ubicacion, setUbicacion] = useState<ResultadoBusqueda | null>(o?.ubicacion_id ? { id: o.ubicacion_id, etiqueta: o.ubicacion_nombre ?? o.establecimiento ?? '', detalle: null } : null);
  const [jefe, setJefe] = useState(aBusqueda(o?.jefe_sitio_id ?? null, o?.jefe_sitio_nombre ?? null));
  const [inspector, setInspector] = useState(aBusqueda(o?.inspector_id ?? null, o?.inspector_nombre ?? null));
  const [proveedor, setProveedor] = useState<ResultadoBusqueda | null>(o?.proveedor_id ? { id: o.proveedor_id, etiqueta: o.proveedor_nombre ?? '', detalle: null } : null);
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value })) });
  const numero = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(/\./g, '').replace(',', '.')));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const monto = numero(f.monto_base);
    const avance = Number(f.avance.replace(',', '.'));
    if (Number.isNaN(monto) || Number.isNaN(numero(f.costo_real)) || Number.isNaN(avance)) {
      toast.error('Revisá los montos y el avance: tienen que ser números.');
      return;
    }
    setGuardando(true);
    try {
      await guardarObra(o?.id ?? null, {
        titulo: f.titulo.trim(), codigo_sap: oNull(f.codigo_sap), mein: oNull(f.mein), ubicacion_id: ubicacion?.id ?? null,
        // Al cambiar de lugar, la base completa establecimiento, dirección y zona con los del lugar nuevo.
        establecimiento: ubicacion && ubicacion.id !== o?.ubicacion_id ? null : oNull(f.establecimiento),
        direccion: ubicacion && ubicacion.id !== o?.ubicacion_id ? null : oNull(f.direccion),
        zona: ubicacion && ubicacion.id !== o?.ubicacion_id && !f.zona ? null : oNull(f.zona),
        tipo: f.tipo, estado: f.estado, prioridad: f.prioridad, estado_sap: oNull(f.estado_sap), detalle: oNull(f.detalle),
        monto_base: monto, costo_real: numero(f.costo_real), avance, plazo_dias: f.plazo_dias ? Math.round(Number(f.plazo_dias)) : null,
        fecha_inicio: oNull(f.fecha_inicio), fecha_fin: oNull(f.fecha_fin),
        jefe_sitio_id: jefe?.id || null, jefe_sitio_nombre: jefe && !jefe.id ? jefe.etiqueta : null,
        inspector_id: inspector?.id || null, inspector_nombre: inspector && !inspector.id ? inspector.etiqueta : null,
        supervisor: oNull(f.supervisor), proveedor_id: proveedor?.id ?? null, descripcion: oNull(f.descripcion), notas: oNull(f.notas),
      });
      toast.success(o ? 'Obra guardada.' : 'Obra creada.');
      await onGuardada();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!o || !window.confirm(`¿Borrar la obra "${o.titulo}"? Se borran también sus filas de cobro. No se puede deshacer.`)) return;
    try {
      await borrarObra(o.id);
      toast.success('Obra borrada.');
      onBorrada();
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <fieldset disabled={!puedeEditar} className="space-y-4">
        <section className="tarjeta space-y-4">
          <h2>Obra</h2>
          <Campo etiqueta="Título de obra en SAP" required {...campo('titulo')} />
          <div className="grid gap-4 md:grid-cols-3">
            <Campo etiqueta="N° de orden SAP (MTOM)" {...campo('codigo_sap')} />
            <Campo etiqueta="N° MEIN" {...campo('mein')} />
            <Selector etiqueta="Tipo" opciones={TIPOS_OBRA} {...campo('tipo')} />
            <Selector etiqueta="Estado" opciones={ESTADOS_OBRA} {...campo('estado')} />
            <Selector etiqueta="Prioridad" opciones={PRIORIDADES} {...campo('prioridad')} />
            <Campo etiqueta="Estado en SAP" {...campo('estado_sap')} />
          </div>
          <Campo etiqueta="Detalle (de la planilla)" {...campo('detalle')} />
          <Area etiqueta="Descripción" {...campo('descripcion')} />
        </section>
        <section className="tarjeta space-y-4">
          <h2>Dónde y quién</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <BuscadorRemoto etiqueta="Lugar" tabla="ubicaciones" valor={ubicacion} onCambio={setUbicacion} ayuda="Al elegirlo, la obra toma su dirección, zona, jefe e inspector." />
            {zonas.length > 0
              ? <Selector etiqueta="Zona o comuna" opciones={{ '': 'Sin zona', ...Object.fromEntries(zonas.map((z) => [z, z])) }} {...campo('zona')} />
              : <Campo etiqueta="Zona o comuna" {...campo('zona')} />}
            <Campo etiqueta="Establecimiento" {...campo('establecimiento')} />
            <Campo etiqueta="Dirección" {...campo('direccion')} />
            <BuscadorRemoto etiqueta="Jefe de sitio" tabla="jefes" valor={jefe} onCambio={setJefe} />
            <BuscadorRemoto etiqueta="Inspector" tabla="perfiles" valor={inspector} onCambio={setInspector} />
            <Campo etiqueta="Supervisor" {...campo('supervisor')} />
            <BuscadorRemoto etiqueta="Proveedor o contratista" tabla="proveedores" valor={proveedor} onCambio={setProveedor} />
          </div>
        </section>
        <section className="tarjeta space-y-4">
          <h2>Plazo, avance y montos</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Campo etiqueta="Acta de inicio" type="date" {...campo('fecha_inicio')} />
            <Campo etiqueta="Acta de recepción (fin)" type="date" {...campo('fecha_fin')} />
            <Campo etiqueta="Plazo (días)" inputMode="numeric" {...campo('plazo_dias')} />
            <Campo etiqueta="Avance (%)" inputMode="decimal" {...campo('avance')} />
            <Campo etiqueta="Monto base" inputMode="decimal" {...campo('monto_base')} />
            <Campo etiqueta="Costo real" inputMode="decimal" {...campo('costo_real')} />
          </div>
          {o && o.fecha_inicio && o.fecha_fin && o.estado !== 'completado' && o.estado !== 'cancelado' && (
            <div className="space-y-1">
              <Barra valor={Number(o.avance)} esperado={Number(o.avance_esperado)} />
              <p className="text-sm text-suave">
                Avance real {fmtPct(o.avance)} · esperado a hoy {fmtPct(o.avance_esperado)} (la raya).{' '}
                {o.alerta_plazo && <strong className="text-peligro">{TEXTO_ALERTA[o.alerta_plazo]}.</strong>}
              </p>
            </div>
          )}
          <Area etiqueta="Notas" {...campo('notas')} />
        </section>
      </fieldset>
      {puedeEditar && (
        <div className="flex flex-wrap justify-between gap-3">
          <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>{o ? 'Guardar obra' : 'Crear obra'}</Boton>
          {o && esGerencia && <Boton variante="peligro" icono={Trash2} onClick={borrar}>Borrar obra</Boton>}
        </div>
      )}
    </form>
  );
}

function OrdenesObra({ obra, puedeEditar }: { obra: Obra; puedeEditar: boolean }) {
  const carga = useCarga(() => ordenesDeObra(obra.id), [obra.id]);
  const nueva = new URLSearchParams({ obra: obra.id, obraTitulo: obra.titulo, ...(obra.ubicacion_id ? { ubicacion: obra.ubicacion_id, ubicacionNombre: obra.ubicacion_nombre ?? '' } : {}) });
  return (
    <section className="tarjeta space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-suave">Órdenes de trabajo hechas dentro de esta obra.</p>
        {puedeEditar && <BotonEnlace href={`/gestion/ots/nueva?${nueva.toString()}`} icono={Plus}>Nueva orden en la obra</BotonEnlace>}
      </div>
      {carga.cargando && !carga.datos ? <Esqueleto filas={2} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : (carga.datos ?? []).length === 0 ? <p className="text-suave">Sin órdenes todavía.</p> : (
          <ul className="divide-y rounded border">
            {(carga.datos ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <Link href={`/ot/${t.id}`} className="min-h-control py-2 font-medium text-primario hover:underline">
                  {t.codigo} · {t.titulo}
                  <span className="block text-xs font-normal text-suave">{[t.asignado_nombre ?? 'Sin asignar', fmtFecha(t.fecha_programada)].filter(Boolean).join(' · ')}</span>
                </Link>
                <EstadoOTBadge estado={t.estado as EstadoOT} />
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function CobroObra({ obra, puedeEditar }: { obra: Obra; puedeEditar: boolean }) {
  const carga = useCarga(() => cobrosDeObra(obra.id), [obra.id]);
  const [sumando, setSumando] = useState(false);
  const enAbierto = (carga.datos ?? []).some((c) => c.ciclo_abierto);

  async function sumar() {
    setSumando(true);
    try {
      await sumarObraAlCiclo(obra.id);
      toast.success('La obra entró al ciclo de cobro abierto.');
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setSumando(false);
    }
  }

  return (
    <section className="tarjeta space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-suave">El seguimiento del cobro de la obra, ciclo por ciclo.</p>
        <div className="flex flex-wrap gap-2">
          {puedeEditar && !enAbierto && !carga.cargando && <Boton icono={Coins} cargando={sumando} onClick={sumar}>Sumar al ciclo de cobro</Boton>}
          <BotonEnlace href="/gestion/cobros" variante="fantasma">Ir al cobro de obras</BotonEnlace>
        </div>
      </div>
      {carga.cargando && !carga.datos ? <Esqueleto filas={2} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : (carga.datos ?? []).length === 0 ? <p className="text-suave">La obra todavía no entró en ningún ciclo de cobro.</p> : (
          <ul className="divide-y rounded border">
            {(carga.datos ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <p className="font-medium">{c.ciclo_nombre}{c.ciclo_abierto && <span className="ml-2 text-xs text-info">(abierto)</span>}</p>
                  <p className="text-sm text-suave">{ESTADOS_COBRO[c.estado_cobro]} · avance {fmtPct(c.avance)}{c.motivo_observacion && ` · ${c.motivo_observacion}`}</p>
                </div>
                <span className="num">{fmtPesos(c.monto_a_cobrar)}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

// ------------------------------------------------------------------ importación

function Importar({ onListo }: { onListo: (cambio: boolean) => void }) {
  const [lectura, setLectura] = useState<{ filas: FilaObra[]; hoja: string; archivo: string } | null>(null);
  const [resultado, setResultado] = useState<ResultadoPlanillaObras | null>(null);
  const [importando, setImportando] = useState(false);
  const conCodigo = lectura?.filas.filter((f) => f.codigo_sap).length ?? 0;

  async function importar() {
    if (!lectura) return;
    setImportando(true);
    try {
      setResultado(await importarPlanillaObras(lectura.filas));
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
        <h1>Importar la planilla de obras</h1>
        <Boton variante="fantasma" onClick={() => onListo(!!resultado)}>Volver a la lista</Boton>
      </header>
      <section className="tarjeta space-y-4">
        <p className="text-suave">
          La planilla de obras de SAP (.xlsx), con los datos desde la tercera fila: comuna, dirección, establecimiento, título, monto, N° de orden SAP,
          estado SAP, detalle, plazo, actas de inicio y de recepción, % de avance, jefe de sitio, inspector y supervisor.
          Se reconoce cada obra por su N° de orden SAP (o por el título, si no tiene): reimportar actualiza, no duplica. Lo que la planilla trae vacío no se borra.
        </p>
        <ElegirExcel texto="Elegir planilla (.xlsx)" leer={leerPlanillaObras} onLeido={(l, archivo) => { setLectura({ ...l, archivo }); setResultado(null); }} />
      </section>
      {lectura && (
        <section className="tarjeta space-y-4">
          <p><strong>{lectura.archivo}</strong> · hoja "{lectura.hoja}" · {lectura.filas.length} obras ({conCodigo} con N° de orden SAP)</p>
          <div className="max-h-96 overflow-auto rounded border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-superficie">
                <tr className="border-b text-left text-suave">
                  <th className="px-3 py-2 font-medium">Obra</th><th className="px-3 py-2 font-medium">Zona</th>
                  <th className="px-3 py-2 font-medium">Detalle / SAP</th><th className="num px-3 py-2 font-medium">Monto</th><th className="num px-3 py-2 font-medium">Avance</th>
                </tr>
              </thead>
              <tbody>
                {lectura.filas.slice(0, 200).map((f, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="px-3 py-2">{f.titulo}<span className="block text-xs text-suave">{[f.codigo_sap && `SAP ${f.codigo_sap}`, f.establecimiento].filter(Boolean).join(' · ')}</span></td>
                    <td className="px-3 py-2">{f.zona || '—'}</td>
                    <td className="px-3 py-2">{[f.detalle, f.estado_sap].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="num px-3 py-2">{f.monto_base === null ? '—' : fmtPesos(f.monto_base)}</td>
                    <td className="num px-3 py-2">{f.avance === null ? '—' : fmtPct(f.avance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lectura.filas.length > 200 && <p className="text-sm text-suave">Se muestran las primeras 200. Se importan todas.</p>}
          <Boton variante="primario" icono={Upload} cargando={importando} onClick={importar}>Importar {lectura.filas.length} obras</Boton>
        </section>
      )}
      {resultado && (
        <div className="rounded border border-exito/40 bg-exito/10 p-3 text-exito" role="status">
          <p className="font-semibold">Importación terminada</p>
          <p>{resultado.nuevas} obras nuevas, {resultado.actualizadas} actualizadas.{resultado.omitidas > 0 && ` ${resultado.omitidas} filas sin título.`}</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ lista

export default function Obras() {
  const { sectorEfectivo, puedeValidar, esGerencia } = useSesion();
  const zonasSector = useMemo(() => sectorEfectivo?.config?.zonas ?? [], [sectorEfectivo]);
  const [zona, setZona] = useState<string | null>(null);
  const [estado, setEstado] = useState<FiltroObras['estado']>('activas');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [vista, setVista] = useState<{ tipo: 'lista' } | { tipo: 'ficha'; id: string | null } | { tipo: 'importar' }>({ tipo: 'lista' });

  useEffect(() => {
    const t = setTimeout(() => setQ(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);

  // Se traen todas las del estado elegido; la zona se filtra acá para poder contar por pestaña.
  const carga = useCarga(() => listarObras({ zona: null, estado, q }), [estado, q]);
  const todas = useMemo(() => carga.datos ?? [], [carga.datos]);
  const zonas = useMemo(() => [...new Set([...zonasSector, ...todas.map((o) => o.zona).filter((z): z is string => !!z)])], [zonasSector, todas]);
  const lista = useMemo(() => todas.filter((o) => zona === null || (zona === '' ? !o.zona : o.zona === zona)), [todas, zona]);
  const monto = lista.reduce((t, o) => t + Number(o.monto_base), 0);
  const enRiesgo = lista.filter((o) => o.alerta_plazo === 'peligro' || o.alerta_plazo === 'alerta').length;

  if (vista.tipo === 'ficha') {
    return <Ficha id={vista.id} zonas={zonasSector} puedeEditar={puedeValidar} esGerencia={esGerencia} onListo={(cambio) => { setVista({ tipo: 'lista' }); if (cambio) void carga.recargar(); }} />;
  }
  if (vista.tipo === 'importar') {
    return <Importar onListo={(cambio) => { setVista({ tipo: 'lista' }); if (cambio) void carga.recargar(); }} />;
  }

  function exportar() {
    descargarCSV(`obras-${zona || 'todas'}.csv`,
      ['N° SAP', 'MEIN', 'Título', 'Establecimiento', 'Dirección', 'Zona', 'Estado', 'Estado SAP', 'Detalle', 'Monto base', 'Costo real', 'Avance %', 'Acta de inicio', 'Acta de recepción', 'Plazo (días)', 'Jefe de sitio', 'Inspector', 'Supervisor', 'Proveedor', 'Alerta de plazo'],
      lista.map((o) => [o.codigo_sap, o.mein, o.titulo, o.establecimiento, o.direccion, o.zona, ESTADOS_OBRA[o.estado], o.estado_sap, o.detalle, Number(o.monto_base), Number(o.costo_real),
        Number(o.avance), o.fecha_inicio, o.fecha_fin, o.plazo_dias, o.jefe_sitio_nombre, o.inspector_nombre, o.supervisor, o.proveedor_nombre, o.alerta_plazo ? TEXTO_ALERTA[o.alerta_plazo] : '']));
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Obras</h1>
        <div className="flex flex-wrap gap-2">
          <Boton icono={Download} onClick={exportar} disabled={lista.length === 0}>Exportar</Boton>
          {puedeValidar && <Boton icono={Upload} onClick={() => setVista({ tipo: 'importar' })}>Importar planilla</Boton>}
          {puedeValidar && <Boton variante="primario" icono={Plus} onClick={() => setVista({ tipo: 'ficha', id: null })}>Nueva obra</Boton>}
        </div>
      </header>

      <Pestanas
        activa={zona === null ? '__todas' : zona === '' ? '__sin' : zona}
        onCambio={(id) => setZona(id === '__todas' ? null : id === '__sin' ? '' : id)}
        pestanas={[
          { id: '__todas', texto: 'Todas', cuenta: todas.length },
          ...zonas.map((z) => ({ id: z, texto: z, cuenta: todas.filter((o) => o.zona === z).length })),
          ...(todas.some((o) => !o.zona) ? [{ id: '__sin', texto: 'Sin zona', cuenta: todas.filter((o) => !o.zona).length }] : []),
        ]}
      />

      <Indicadores>
        <Indicador titulo="Obras en la lista" valor={lista.length} icono={Building} />
        <Indicador titulo="En ejecución" valor={lista.filter((o) => o.estado === 'en_progreso').length} icono={HardHat} tono="info" />
        <Indicador titulo="Con el plazo en riesgo" valor={enRiesgo} icono={AlertTriangle} tono={enRiesgo > 0 ? 'peligro' : 'neutro'} />
        <Indicador titulo="Monto base" valor={<span className="text-lg">{fmtPesos(monto)}</span>} icono={Coins} />
      </Indicadores>

      <div className="grid gap-3 md:grid-cols-[1fr_16rem]">
        <Campo etiqueta="Buscar por título, N° SAP, MEIN, establecimiento, jefe o inspector" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} opciones={FILTRO_ESTADO} onChange={(e) => setEstado(e.target.value as FiltroObras['estado'])} />
      </div>

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : lista.length === 0 ? (
        <Vacio icono={ClipboardList} titulo={todas.length === 0 && !q && estado === 'activas' ? 'Todavía no hay obras en curso' : 'No hay obras con ese filtro'}
          texto={todas.length === 0 && !q ? 'Importá la planilla de obras de SAP o cargá una obra a mano.' : 'Probá con otro estado, otra zona u otro texto.'} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-superficie">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-suave">
                <th className="px-3 py-3 font-medium">Obra</th>
                <th className="px-3 py-3 font-medium">Estado</th>
                <th className="hidden px-3 py-3 font-medium md:table-cell">Jefe de sitio</th>
                <th className="px-3 py-3 font-medium">Avance</th>
                <th className="hidden px-3 py-3 font-medium lg:table-cell">Plazo</th>
                <th className="num hidden px-3 py-3 font-medium md:table-cell">Monto base</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((o) => (
                <tr key={o.id} className={`border-b last:border-b-0 ${o.alerta_plazo === 'peligro' ? 'bg-peligro/10' : 'hover:bg-elevado/60'}`}>
                  <td className="px-3 py-3">
                    <button type="button" className="block min-h-control text-left font-medium text-primario hover:underline" onClick={() => setVista({ tipo: 'ficha', id: o.id })}>
                      {o.titulo}
                      <span className="block text-xs font-normal text-suave">{[o.codigo_sap && `SAP ${o.codigo_sap}`, o.establecimiento, o.zona].filter(Boolean).join(' · ')}</span>
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`font-medium ${TONO_ESTADO[o.estado]}`}>{ESTADOS_OBRA[o.estado]}</span>
                    {o.alerta_plazo && <div className="mt-1"><AvisoBadge texto={TEXTO_ALERTA[o.alerta_plazo]} tono={TONO_ALERTA[o.alerta_plazo]} /></div>}
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell">{o.jefe_sitio_nombre ?? <span className="text-alerta">Sin asignar</span>}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2"><Barra valor={Number(o.avance)} /><span className="num shrink-0">{fmtPct(o.avance)}</span></div>
                  </td>
                  <td className="hidden px-3 py-3 lg:table-cell">{fmtFecha(o.fecha_fin) ?? '—'}{textoPlazo(o) && <span className="block text-xs text-suave">{textoPlazo(o)}</span>}</td>
                  <td className="num hidden px-3 py-3 md:table-cell">{fmtPesos(o.monto_base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
