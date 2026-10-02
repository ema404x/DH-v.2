'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  AlertTriangle, Building2, CheckCircle2, ClipboardList, Crosshair, LocateFixed, MapPin, MapPinOff, Siren, Trash2, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Chips, Indicador, Indicadores, Pestanas } from '@/components/gestion/Piezas';
import { SERIES, type MarcaMapa, type Token } from '@/components/gestion/MapaBase';
import { limpiarError } from '@/lib/errores';
import {
  asignadosA, asignarEmpleado, desasignarEmpleado, fichajesConPosicion, lugaresDelMapa, otsDelMapa, quitarPosicion, ubicarLugar,
  type LugarMapa, type OTMapa, type Semaforo,
} from '@/lib/gente';
import { ubicarPorDireccion } from '@/lib/geocodificar';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { PRIORIDADES, type ResultadoBusqueda } from '@/lib/types';

// Leaflet usa el navegador: se carga solo del lado del cliente.
const MapaBase = dynamic(() => import('@/components/gestion/MapaBase'), { ssr: false, loading: () => <div className="esqueleto h-[32rem]" /> });

type Tab = 'lugares' | 'fichajes' | 'ordenes';
type ColorPor = 'semaforo' | 'zona' | 'jefe';

const SEMAFORO: Record<Semaforo, { token: Token; texto: string }> = {
  rojo: { token: 'peligro', texto: 'Emergencia abierta, 2 pendientes vencidos o 3 abiertos' },
  amarillo: { token: 'alerta', texto: 'Con pendientes abiertos' },
  verde: { token: 'exito', texto: 'Sin pendientes' },
};
const hora = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function Leyenda({ items }: { items: { token: Token; texto: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-suave">
      {items.map((i) => (
        <li key={i.texto} className="flex items-center gap-1.5">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: `hsl(var(--${i.token}))` }} aria-hidden />
          {i.texto}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ personal asignado a un lugar

function Personal({ lugarId }: { lugarId: string }) {
  const { puedeValidar } = useSesion();
  const carga = useCarga(() => asignadosA(lugarId), [lugarId]);
  const [nuevo, setNuevo] = useState<ResultadoBusqueda | null>(null);

  async function sumar(r: ResultadoBusqueda | null) {
    setNuevo(r);
    if (!r) return;
    try {
      await asignarEmpleado(lugarId, r.id);
      setNuevo(null);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }
  async function sacar(id: string) {
    try {
      await desasignarEmpleado(lugarId, id);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4" aria-hidden />Personal del lugar</h3>
      {carga.error ? <p className="text-sm text-peligro">{carga.error}</p> : (carga.datos ?? []).length === 0 ? (
        <p className="text-sm text-suave">{carga.cargando ? 'Cargando' : 'Nadie asignado todavía.'}</p>
      ) : (
        <ul className="space-y-1">
          {(carga.datos ?? []).map((a) => (
            <li key={a.empleado_id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{a.nombre}{a.puesto && <span className="text-suave"> · {a.puesto}</span>}</span>
              {puedeValidar && (
                <button type="button" onClick={() => sacar(a.empleado_id)} aria-label={`Sacar a ${a.nombre} de este lugar`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-suave hover:bg-elevado hover:text-peligro">
                  <X className="h-5 w-5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {puedeValidar && <BuscadorRemoto etiqueta="Sumar a alguien" tabla="empleados" valor={nuevo} onCambio={sumar} />}
    </div>
  );
}

// ------------------------------------------------------------------ lugares

function Lugares() {
  const { esGerencia, sectorEfectivo } = useSesion();
  const zonas = sectorEfectivo?.config?.zonas ?? [];
  const unidad = sectorEfectivo?.config?.unidad?.plural?.toLowerCase() ?? 'lugares';
  const carga = useCarga(lugaresDelMapa, []);
  const [colorPor, setColorPor] = useState<ColorPor>('semaforo');
  const [zona, setZona] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [elegido, setElegido] = useState<string | null>(null);
  const [ubicando, setUbicando] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ corriendo: boolean; ubicados: number; sin: number; quedan: number | null }>({ corriendo: false, ubicados: 0, sin: 0, quedan: null });

  const todos = carga.datos ?? [];
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return todos.filter((l) => (!zona || l.zona === zona) && (!t || [l.nombre, l.codigo, l.domicilio, l.jefe_sitio_nombre].some((x) => (x ?? '').toLowerCase().includes(t))));
  }, [todos, zona, q]);
  const conPosicion = filtrados.filter((l) => l.lat !== null && l.lng !== null);
  const sinPosicion = filtrados.filter((l) => l.lat === null || l.lng === null);

  // Un color por zona o por jefe de sitio, estable según el orden alfabético.
  const paleta = useMemo(() => {
    const claves = [...new Set(todos.map((l) => (colorPor === 'zona' ? l.zona : l.jefe_sitio_nombre) ?? 'Sin asignar'))].sort();
    return new Map(claves.map((c, i) => [c, SERIES[i % SERIES.length]]));
  }, [todos, colorPor]);

  const marcas: MarcaMapa[] = conPosicion.map((l) => ({
    id: l.id, lat: l.lat!, lng: l.lng!, forma: 'lugar',
    relleno: colorPor === 'semaforo' ? SEMAFORO[l.semaforo].token : paleta.get((colorPor === 'zona' ? l.zona : l.jefe_sitio_nombre) ?? 'Sin asignar') ?? 'serie-8',
    estado: colorPor === 'semaforo' ? undefined : SEMAFORO[l.semaforo].token,
    titulo: l.nombre,
    arrastrable: esGerencia,
  }));

  const lugar = todos.find((l) => l.id === elegido) ?? null;

  async function mover(id: string, lat: number, lng: number) {
    const l = todos.find((x) => x.id === id);
    if (!window.confirm(`¿Mover ${l?.nombre ?? 'el lugar'} a este punto?`)) {
      await carga.recargar();
      return;
    }
    try {
      await ubicarLugar(id, lat, lng);
      toast.success('Posición guardada.');
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
      await carga.recargar();
    }
  }

  async function tocar(lat: number, lng: number) {
    if (!ubicando) return;
    try {
      await ubicarLugar(ubicando, lat, lng);
      toast.success('Lugar ubicado en el mapa.');
      setElegido(ubicando);
      setUbicando(null);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  async function quitar(l: LugarMapa) {
    try {
      await quitarPosicion(l.id);
      toast.success('Se quitó la posición.');
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  // Busca por dirección de a un lugar, al ritmo que permite OpenStreetMap. Se puede cortar cerrando la pantalla:
  // lo ya ubicado queda guardado.
  async function ubicarTodos() {
    setGeo({ corriendo: true, ubicados: 0, sin: 0, quedan: null });
    try {
      const r = await ubicarPorDireccion(sectorEfectivo?.config?.geocodificacion ?? {}, (p) =>
        setGeo({ corriendo: true, ubicados: p.ubicados, sin: p.sinEncontrar, quedan: p.quedan }));
      toast.success(`${cuantos(r.ubicados, 'lugar ubicado', 'lugares ubicados')} por su dirección${r.sinEncontrar > 0 ? `; ${cuantos(r.sinEncontrar, 'no se encontró', 'no se encontraron')} (se marcan a mano)` : ''}.`);
    } catch (e) {
      toast.error(`La búsqueda se cortó: ${limpiarError(e)}. Lo ya ubicado quedó guardado.`);
    } finally {
      setGeo((g) => ({ ...g, corriendo: false }));
      await carga.recargar();
    }
  }

  if (carga.cargando && !carga.datos) return <Esqueleto filas={4} />;
  if (carga.error) return <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />;
  if (todos.length === 0) return <Vacio icono={Building2} titulo={`Todavía no hay ${unidad}`} texto="Cargalos en Ubicaciones o importá el directorio en Información general." />;

  const pendientesGeo = todos.filter((l) => (l.lat === null || l.lng === null) && l.domicilio && !l.geo_intento_at).length;

  return (
    <>
      <Indicadores>
        <Indicador titulo={`${unidad[0].toUpperCase()}${unidad.slice(1)} en el mapa`} valor={todos.filter((l) => l.lat !== null).length} icono={MapPin} nota={`de ${todos.length}`} />
        <Indicador titulo="Sin ubicar" valor={todos.filter((l) => l.lat === null).length} icono={MapPinOff} tono={todos.some((l) => l.lat === null) ? 'alerta' : 'neutro'} />
        <Indicador titulo="En rojo" valor={todos.filter((l) => l.semaforo === 'rojo').length} icono={AlertTriangle} tono={todos.some((l) => l.semaforo === 'rojo') ? 'peligro' : 'neutro'} />
        <Indicador titulo="Emergencias abiertas" valor={todos.reduce((t, l) => t + l.emergencias_activas, 0)} icono={Siren} tono="peligro" />
      </Indicadores>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1"><Campo etiqueta="Buscar por nombre, código, dirección o jefe" type="search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div>
          <span className="etiqueta">Color por</span>
          <Chips todos="Semáforo" valor={colorPor === 'semaforo' ? null : colorPor} onCambio={(v) => setColorPor(v ?? 'semaforo')}
            opciones={[{ id: 'zona', texto: 'Zona' }, { id: 'jefe', texto: 'Jefe de sitio' }]} />
        </div>
        {zonas.length > 0 && (
          <div>
            <span className="etiqueta">Zona</span>
            <Chips todos="Todas" valor={zona} onCambio={setZona} opciones={zonas.map((z) => ({ id: z, texto: z }))} />
          </div>
        )}
      </div>

      {ubicando && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-info/40 bg-info/10 px-3 py-2 text-info" role="status">
          <span className="flex items-center gap-2"><Crosshair className="h-5 w-5" aria-hidden />Tocá en el mapa dónde está <strong>{todos.find((l) => l.id === ubicando)?.nombre}</strong>.</span>
          <Boton variante="fantasma" onClick={() => setUbicando(null)}>Cancelar</Boton>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-2">
          <MapaBase marcas={marcas} seleccion={elegido} onElegir={setElegido} onMover={mover} onTocar={ubicando ? tocar : undefined} />
          {colorPor === 'semaforo'
            ? <Leyenda items={(['verde', 'amarillo', 'rojo'] as Semaforo[]).map((s) => ({ token: SEMAFORO[s].token, texto: SEMAFORO[s].texto }))} />
            : <Leyenda items={[...paleta.entries()].slice(0, 16).map(([texto, token]) => ({ token, texto }))} />}
          {esGerencia && <p className="text-sm text-suave">Para corregir una posición, arrastrá la marca.</p>}
        </div>

        <aside className="space-y-3">
          {lugar ? (
            <section className="tarjeta space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate">{lugar.nombre}</h2>
                  <p className="text-sm text-suave">{[lugar.codigo, lugar.domicilio, lugar.zona].filter(Boolean).join(' · ')}</p>
                </div>
                <button type="button" onClick={() => setElegido(null)} aria-label="Cerrar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-suave hover:bg-elevado">
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
              <p className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: `hsl(var(--${SEMAFORO[lugar.semaforo].token}))` }} aria-hidden />
                {SEMAFORO[lugar.semaforo].texto}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-suave">Jefe de sitio</dt><dd>{lugar.jefe_sitio_nombre ?? 'Sin asignar'}</dd></div>
                <div><dt className="text-suave">Inspector</dt><dd>{lugar.inspector_nombre ?? '—'}</dd></div>
                <div><dt className="text-suave">Pendientes abiertos</dt><dd>{lugar.pendientes_abiertos}{lugar.pendientes_vencidos > 0 && <span className="text-peligro"> · {lugar.pendientes_vencidos} vencidos</span>}</dd></div>
                <div><dt className="text-suave">Emergencias abiertas</dt><dd className={lugar.emergencias_activas > 0 ? 'text-peligro' : ''}>{lugar.emergencias_activas}</dd></div>
                <div><dt className="text-suave">Órdenes abiertas</dt><dd>{lugar.ots_abiertas}</dd></div>
                {lugar.m2 && <div><dt className="text-suave">Superficie</dt><dd>{Number(lugar.m2).toLocaleString('es-AR')} m²</dd></div>}
              </dl>
              <Personal lugarId={lugar.id} />
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Link href={`/gestion/ots?estado=todas&ubicacion=${lugar.id}&nombre=${encodeURIComponent(lugar.nombre)}`} className="inline-flex min-h-control items-center gap-2 rounded px-3 text-sm font-semibold text-primario hover:bg-elevado">
                  <ClipboardList className="h-5 w-5" aria-hidden />Ver órdenes
                </Link>
                {esGerencia && lugar.lat !== null && <Boton variante="fantasma" icono={Trash2} onClick={() => quitar(lugar)}>Quitar del mapa</Boton>}
              </div>
            </section>
          ) : (
            <p className="tarjeta text-suave">Tocá un {sectorEfectivo?.config?.unidad?.singular?.toLowerCase() ?? 'lugar'} en el mapa para ver su estado y su personal.</p>
          )}

          <section className="tarjeta space-y-2">
            <h2 className="flex items-center gap-2"><MapPinOff className="h-5 w-5" aria-hidden />Sin ubicar ({sinPosicion.length})</h2>
            {esGerencia && pendientesGeo > 0 && (
              <div className="space-y-2 rounded border border-alerta/40 bg-alerta/10 p-3 text-sm">
                <p>{cuantos(pendientesGeo, 'lugar tiene', 'lugares tienen')} dirección y todavía no se buscó en el mapa. La búsqueda usa OpenStreetMap, de a un lugar por segundo.</p>
                <Boton icono={LocateFixed} cargando={geo.corriendo} onClick={ubicarTodos}>Ubicar por dirección</Boton>
                {geo.corriendo && <p role="status">Ubicados: {geo.ubicados} · sin encontrar: {geo.sin}{geo.quedan !== null ? ` · quedan ${geo.quedan}` : ''}</p>}
              </div>
            )}
            {sinPosicion.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-exito"><CheckCircle2 className="h-4 w-4" aria-hidden />Todos están en el mapa.</p>
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto">
                {sinPosicion.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block truncate">{l.nombre}</span>
                      <span className="block truncate text-xs text-suave">{l.domicilio ?? 'Sin dirección'}{l.geo_intento_at ? ' · no se encontró por dirección' : ''}</span>
                    </span>
                    {esGerencia && (
                      <Boton variante="fantasma" icono={Crosshair} onClick={() => setUbicando(l.id)}>Marcar</Boton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ fichajes

const DIAS = [{ id: '1', texto: 'Hoy' }, { id: '3', texto: '3 días' }, { id: '7', texto: '7 días' }, { id: '30', texto: '30 días' }];

function Fichajes() {
  const [dias, setDias] = useState('7');
  const [tipo, setTipo] = useState<'entrada' | 'salida' | null>(null);
  const [empleado, setEmpleado] = useState('');
  const carga = useCarga(async () => {
    const [f, l] = await Promise.all([fichajesConPosicion(Number(dias)), lugaresDelMapa()]);
    return { fichajes: f, lugares: l };
  }, [dias]);

  const fichajes = (carga.datos?.fichajes ?? []).filter((f) => (!tipo || f.tipo === tipo) && (!empleado || f.empleado_id === empleado));
  const personas = [...new Map((carga.datos?.fichajes ?? []).map((f) => [f.empleado_id, f.empleado_nombre])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const marcas: MarcaMapa[] = [
    ...(carga.datos?.lugares ?? []).filter((l) => l.lat !== null).map((l): MarcaMapa => ({ id: `l-${l.id}`, lat: l.lat!, lng: l.lng!, forma: 'lugar', relleno: 'serie-8', titulo: l.nombre })),
    ...fichajes.map((f): MarcaMapa => ({
      id: f.id, lat: f.lat!, lng: f.lng!, forma: 'punto', relleno: f.tipo === 'entrada' ? 'exito' : 'info',
      titulo: `${f.empleado_nombre} · ${f.tipo === 'entrada' ? 'entrada' : 'salida'}`,
      lineas: [hora(f.momento), f.ubicacion_nombre ? `En ${f.ubicacion_nombre}` : 'Sin lugar',
        ...(f.distancia_m !== null ? [`A ${f.distancia_m >= 1000 ? `${(f.distancia_m / 1000).toFixed(1).replace('.', ',')} km` : `${f.distancia_m} m`} del lugar${f.lejos ? ' (lejos)' : ''}`] : [])],
    })),
  ];

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div><span className="etiqueta">Período</span><Chips todos="Hoy" valor={dias === '1' ? null : dias} onCambio={(v) => setDias(v ?? '1')} opciones={DIAS.slice(1)} /></div>
        <div><span className="etiqueta">Marca</span><Chips todos="Todas" valor={tipo} onCambio={setTipo} opciones={[{ id: 'entrada', texto: 'Entradas' }, { id: 'salida', texto: 'Salidas' }]} /></div>
        <label className="min-w-[14rem]">
          <span className="etiqueta">Empleado</span>
          <select className="control" value={empleado} onChange={(e) => setEmpleado(e.target.value)}>
            <option value="">Todos</option>
            {personas.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </label>
      </div>
      {carga.cargando && !carga.datos ? <Esqueleto filas={4} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} /> : (
        <>
          <p className="text-sm text-suave">{cuantos(fichajes.length, 'fichaje con posición', 'fichajes con posición')}. Tocá un punto para ver quién y cuándo.</p>
          <MapaBase marcas={marcas} />
          <Leyenda items={[{ token: 'exito', texto: 'Entrada' }, { token: 'info', texto: 'Salida' }, { token: 'serie-8', texto: 'Lugar' }]} />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ órdenes

const TOKEN_PRIORIDAD: Record<string, Token> = { urgente: 'peligro', alta: 'alerta', media: 'primario', baja: 'suave' };
const ORDEN_PRIORIDAD = ['urgente', 'alta', 'media', 'baja'];

function Ordenes() {
  const [dias, setDias] = useState('7');
  const carga = useCarga(() => otsDelMapa(Number(dias)), [dias]);

  // Las abiertas se agrupan por lugar: una marca con la cantidad, del color de la más urgente.
  const porLugar = new Map<string, OTMapa[]>();
  for (const o of carga.datos?.abiertas ?? []) {
    if (o.ubicacion_lat === null || o.ubicacion_lng === null || !o.ubicacion_id) continue;
    porLugar.set(o.ubicacion_id, [...(porLugar.get(o.ubicacion_id) ?? []), o]);
  }
  const sinLugar = (carga.datos?.abiertas ?? []).filter((o) => o.ubicacion_lat === null || o.ubicacion_lng === null).length;
  const marcas: MarcaMapa[] = [
    ...[...porLugar.values()].map((os): MarcaMapa => {
      const peor = [...os].sort((a, b) => ORDEN_PRIORIDAD.indexOf(a.prioridad) - ORDEN_PRIORIDAD.indexOf(b.prioridad))[0];
      return {
        id: `a-${peor.ubicacion_id}`, lat: peor.ubicacion_lat!, lng: peor.ubicacion_lng!, forma: 'lugar', relleno: TOKEN_PRIORIDAD[peor.prioridad] ?? 'primario',
        estado: os.some((o) => o.vencida) ? 'peligro' : undefined, numero: os.length,
        titulo: `${peor.ubicacion_nombre}: ${cuantos(os.length, 'orden abierta', 'órdenes abiertas')}`,
      };
    }),
    ...(carga.datos?.completadas ?? []).flatMap((o): MarcaMapa[] => {
      const lat = o.gps_lat ?? o.ubicacion_lat;
      const lng = o.gps_lng ?? o.ubicacion_lng;
      if (lat === null || lng === null) return [];
      return [{
        id: `c-${o.id}`, lat, lng, forma: 'punto', relleno: 'exito', titulo: `${o.codigo} · ${o.titulo}`,
        lineas: [o.ubicacion_nombre ?? '', o.fecha_validacion ? `Aprobada ${hora(o.fecha_validacion)}` : '', o.gps_lat !== null ? 'Posición tomada al iniciar' : 'En la posición del lugar'].filter(Boolean),
      }];
    }),
  ];

  return (
    <>
      <div><span className="etiqueta">Completadas en los últimos</span><Chips todos="Hoy" valor={dias === '1' ? null : dias} onCambio={(v) => setDias(v ?? '1')} opciones={DIAS.slice(1)} /></div>
      {carga.cargando && !carga.datos ? <Esqueleto filas={4} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} /> : (
        <>
          <p className="text-sm text-suave">
            {cuantos(carga.datos?.abiertas.length ?? 0, 'orden abierta', 'órdenes abiertas')} en {cuantos(porLugar.size, 'lugar', 'lugares')}
            {sinLugar > 0 ? ` (${cuantos(sinLugar, 'sin lugar ubicado', 'sin lugar ubicado')} no aparece${sinLugar === 1 ? '' : 'n'})` : ''} · {cuantos(carga.datos?.completadas.length ?? 0, 'completada', 'completadas')}.
          </p>
          <MapaBase marcas={marcas} />
          <Leyenda items={[
            ...ORDEN_PRIORIDAD.map((p) => ({ token: TOKEN_PRIORIDAD[p], texto: `Abierta, prioridad ${PRIORIDADES[p as keyof typeof PRIORIDADES].toLowerCase()}` })),
            { token: 'exito', texto: 'Completada' },
          ]} />
        </>
      )}
    </>
  );
}

// Mapa: el estado de cada lugar, dónde fichó la gente y dónde están las órdenes.
export default function PaginaMapa() {
  const [tab, setTab] = useState<Tab>('lugares');
  return (
    <>
      <header>
        <h1>Mapa</h1>
        <p className="text-suave">Estado de cada lugar, fichajes y órdenes de trabajo</p>
      </header>
      <Pestanas activa={tab} onCambio={setTab}
        pestanas={[{ id: 'lugares', texto: 'Lugares' }, { id: 'fichajes', texto: 'Fichajes' }, { id: 'ordenes', texto: 'Órdenes' }]} />
      {tab === 'lugares' ? <Lugares /> : tab === 'fichajes' ? <Fichajes /> : <Ordenes />}
    </>
  );
}

