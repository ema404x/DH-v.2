'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, ChevronDown, ChevronRight, MapPin, Ruler, Upload, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Boton, BotonEnlace } from '@/components/Boton';
import { Campo } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Chips, ElegirExcel, Indicador, Indicadores, Pestanas } from '@/components/gestion/Piezas';
import { leerDirectorio, type LecturaDirectorio } from '@/lib/excel';
import { asignarResponsable, importarDirectorio, obtenerDirectorio, type Direccion, type ResultadoDirectorio, type UbicacionDetalle } from '@/lib/operacion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

const SIN_DIRECCION = '__sin__';
const contiene = (texto: string | null | undefined, q: string) => (texto ?? '').toLowerCase().includes(q);

function Responsable({ etiqueta, nombre, enganchado, editable, tabla, onElegir }: {
  etiqueta: string; nombre: string | null; enganchado: boolean; editable: boolean; tabla: 'jefes' | 'perfiles'; onElegir: (p: ResultadoBusqueda | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  if (editando) {
    return (
      <div className="min-w-[14rem] flex-1 space-y-1">
        <BuscadorRemoto etiqueta={etiqueta} tabla={tabla} valor={null} onCambio={(p) => { if (p) { onElegir(p); setEditando(false); } }} />
        <div className="flex gap-2">
          {nombre && <Boton variante="fantasma" onClick={() => { onElegir(null); setEditando(false); }}>Quitar</Boton>}
          <Boton variante="fantasma" onClick={() => setEditando(false)}>Cancelar</Boton>
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-[12rem] flex-1">
      <p className="text-xs text-suave">{etiqueta}</p>
      <p className={nombre ? '' : 'text-alerta'}>
        {nombre ?? 'Sin asignar'}
        {nombre && !enganchado && <span className="block text-xs text-suave">Nombre de planilla, todavía sin usuario</span>}
      </p>
      {editable && <Boton variante="fantasma" onClick={() => setEditando(true)}>{nombre ? 'Cambiar' : 'Asignar'}</Boton>}
    </div>
  );
}

function Importar({ onListo }: { onListo: () => void }) {
  const [lectura, setLectura] = useState<(LecturaDirectorio & { archivo: string }) | null>(null);
  const [resultado, setResultado] = useState<ResultadoDirectorio | null>(null);
  const [importando, setImportando] = useState(false);

  async function importar() {
    if (!lectura) return;
    setImportando(true);
    try {
      setResultado(await importarDirectorio(lectura.filas));
      setLectura(null);
      onListo();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setImportando(false);
    }
  }

  return (
    <section className="tarjeta space-y-4">
      <h2>Importar direcciones, establecimientos y jefes de sitio</h2>
      <p className="text-suave">
        Acepta la planilla de cuatro columnas (jefe, comuna, dirección, escuela) o una con encabezados: Establecimiento, Dirección,
        Jefe de Sitio, Comuna, Ubicación Técnica, M2, Inspector. Se puede importar la misma planilla más de una vez: lo que ya está
        cargado se actualiza, no se duplica.
      </p>
      <ElegirExcel texto="Elegir planilla (.xlsx)" leer={leerDirectorio} onLeido={(l, archivo) => { setLectura({ ...l, archivo }); setResultado(null); }} />

      {lectura && (
        <div className="space-y-3 rounded border bg-elevado/40 p-3">
          <p><strong>{lectura.archivo}</strong> · {lectura.filas.length} establecimientos · {lectura.formato}</p>
          <ul className="space-y-1 text-sm text-suave">
            {lectura.filas.slice(0, 5).map((f, i) => (
              <li key={i}>{f.establecimiento} — {f.direccion || 'sin dirección'}{f.zona ? ` (${f.zona})` : ''}{f.jefe ? ` · jefe: ${f.jefe}` : ''}</li>
            ))}
            {lectura.filas.length > 5 && <li>y {lectura.filas.length - 5} más</li>}
          </ul>
          <Boton variante="primario" icono={Upload} cargando={importando} onClick={importar}>
            Importar {lectura.filas.length} establecimientos
          </Boton>
        </div>
      )}

      {resultado && (
        <div className="rounded border border-exito/40 bg-exito/10 p-3 text-exito" role="status">
          <p className="font-semibold">Importación terminada</p>
          <p>
            Direcciones: {resultado.direcciones_nuevas} nuevas, {resultado.direcciones_actualizadas} actualizadas. Establecimientos:{' '}
            {resultado.ubicaciones_nuevas} nuevos, {resultado.ubicaciones_actualizadas} actualizados.
            {resultado.omitidas > 0 && ` ${resultado.omitidas} filas sin nombre se omitieron.`}
          </p>
        </div>
      )}
    </section>
  );
}

// Información general: el directorio del sector. Direcciones con sus establecimientos, y quién es
// el jefe de sitio y el inspector de cada una. Lo que se asigna a una dirección vale para todos sus establecimientos.
export default function InformacionGeneral() {
  const { sectorEfectivo, esGerencia } = useSesion();
  const carga = useCarga(obtenerDirectorio, []);
  const [pestana, setPestana] = useState<'directorio' | 'importar'>('directorio');
  const [texto, setTexto] = useState('');
  const [zona, setZona] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const unidad = sectorEfectivo?.config?.unidad ?? { singular: 'Establecimiento', plural: 'Establecimientos' };
  const dir = carga.datos;

  const vista = useMemo(() => {
    if (!dir) return null;
    const porDireccion = new Map<string, UbicacionDetalle[]>();
    for (const u of dir.ubicaciones) {
      const k = u.direccion_id ?? SIN_DIRECCION;
      porDireccion.set(k, [...(porDireccion.get(k) ?? []), u]);
    }
    const q = texto.trim().toLowerCase();
    const grupos = dir.direcciones
      .map((d) => ({ d, ubicaciones: porDireccion.get(d.id) ?? [] }))
      .filter(({ d }) => !zona || d.zona === zona)
      .filter(({ d, ubicaciones }) => !q || contiene(d.direccion, q) || contiene(d.jefe_sitio_nombre, q) || contiene(d.inspector_nombre, q)
        || ubicaciones.some((u) => contiene(u.nombre, q) || contiene(u.codigo, q)));
    const sueltas = (porDireccion.get(SIN_DIRECCION) ?? []).filter((u) => (!zona || u.zona === zona) && (!q || contiene(u.nombre, q) || contiene(u.codigo, q)));
    const zonas = sectorEfectivo?.config?.zonas?.length
      ? sectorEfectivo.config.zonas
      : [...new Set(dir.direcciones.map((d) => d.zona).filter((z): z is string => !!z))].sort();
    return {
      grupos, sueltas, zonas,
      total: dir.ubicaciones.length,
      activas: dir.ubicaciones.filter((u) => u.activa).length,
      jefes: new Set(dir.ubicaciones.map((u) => u.jefe_sitio_nombre).filter(Boolean)).size,
      m2: dir.ubicaciones.reduce((t, u) => t + Number(u.m2 ?? 0), 0),
      sinJefe: dir.ubicaciones.filter((u) => u.activa && !u.jefe_sitio_nombre).length,
    };
  }, [dir, texto, zona, sectorEfectivo]);

  async function asignar(d: Direccion, campo: 'jefe_sitio' | 'inspector', p: ResultadoBusqueda | null) {
    try {
      await asignarResponsable(d.id, campo, p?.id ?? null);
      toast.success(p ? `${p.etiqueta} queda a cargo de ${d.direccion} y de sus ${d.ubicaciones_total} establecimientos.` : 'Asignación quitada.');
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  if (sectorEfectivo?.config?.directorio === 'activos') {
    return (
      <>
        <h1>Información general</h1>
        <Vacio icono={Building2} titulo="En este sector el directorio son los activos"
          texto="Acá no se trabaja por establecimiento y dirección, sino por equipos e instalaciones. Están en Activos, agrupados por ubicación.">
          <BotonEnlace href="/gestion/activos" variante="primario">Ir a Activos</BotonEnlace>
        </Vacio>
      </>
    );
  }

  return (
    <>
      <header>
        <h1>Información general</h1>
        <p className="text-suave">{sectorEfectivo?.nombre} · direcciones, {unidad.plural.toLowerCase()} y responsables</p>
      </header>

      {carga.cargando && !vista ? (
        <Esqueleto filas={4} />
      ) : carga.error || !vista || !dir ? (
        <ErrorVista mensaje={carga.error ?? 'No se pudo cargar el directorio.'} onReintentar={carga.recargar} />
      ) : (
        <>
          <Indicadores>
            <Indicador titulo={unidad.plural} valor={vista.total} icono={Building2} nota={vista.activas === 1 ? '1 activa' : `${vista.activas} activas`} />
            <Indicador titulo="Direcciones" valor={dir.direcciones.length} icono={MapPin} />
            <Indicador titulo="Jefes de sitio" valor={vista.jefes} icono={Users} />
            <Indicador titulo="Superficie" valor={`${Math.round(vista.m2).toLocaleString('es-AR')} m²`} icono={Ruler} />
          </Indicadores>

          <Pestanas pestanas={[{ id: 'directorio', texto: 'Directorio' }, ...(esGerencia ? [{ id: 'importar' as const, texto: 'Importar' }] : [])]} activa={pestana} onCambio={setPestana} />

          {pestana === 'importar' ? (
            <Importar onListo={carga.recargar} />
          ) : vista.total === 0 ? (
            <Vacio icono={Building2} titulo="El directorio está vacío"
              texto={esGerencia ? 'Importá la planilla de direcciones y jefes de sitio, o cargá las ubicaciones una por una desde Ubicaciones.' : 'Todavía no hay establecimientos cargados en este sector.'}>
              {esGerencia && <Boton variante="primario" icono={Upload} onClick={() => setPestana('importar')}>Importar planilla</Boton>}
            </Vacio>
          ) : (
            <>
              {vista.sinJefe > 0 ? (
                <p className="flex items-center gap-2 rounded border border-alerta/40 bg-alerta/10 px-3 py-2 text-alerta" role="status">
                  <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
                  {vista.sinJefe === 1 ? `1 ${unidad.singular.toLowerCase()} no tiene` : `${vista.sinJefe} ${unidad.plural.toLowerCase()} no tienen`} jefe de sitio.
                </p>
              ) : (
                <p className="flex items-center gap-2 rounded border border-exito/40 bg-exito/10 px-3 py-2 text-exito" role="status">
                  <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
                  Todos tienen jefe de sitio.
                </p>
              )}

              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <Campo etiqueta="Buscar por dirección, establecimiento, jefe o inspector" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
                {vista.zonas.length > 0 && <Chips opciones={vista.zonas.map((z) => ({ id: z, texto: z }))} valor={zona} onCambio={setZona} todos="Todas" />}
              </div>

              {vista.grupos.length === 0 && vista.sueltas.length === 0 ? (
                <Vacio titulo="Nada coincide con la búsqueda" texto="Probá con otro texto o quitá el filtro de zona." />
              ) : (
                <ul className="space-y-2">
                  {vista.grupos.map(({ d, ubicaciones }) => {
                    const expandida = abierta === d.id;
                    return (
                      <li key={d.id} className="tarjeta p-0">
                        <button type="button" aria-expanded={expandida} onClick={() => setAbierta(expandida ? null : d.id)}
                          className="flex min-h-campo w-full items-center gap-3 px-4 py-3 text-left">
                          {expandida ? <ChevronDown className="h-5 w-5 shrink-0 text-suave" aria-hidden /> : <ChevronRight className="h-5 w-5 shrink-0 text-suave" aria-hidden />}
                          <span className="min-w-0 flex-1">
                            <span className="font-semibold">{d.direccion}</span>
                            <span className="block text-sm text-suave">
                              {[d.zona, `${ubicaciones.length} ${ubicaciones.length === 1 ? unidad.singular.toLowerCase() : unidad.plural.toLowerCase()}`, d.jefe_sitio_nombre ?? 'sin jefe de sitio'].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          {!d.jefe_sitio_nombre && <AlertTriangle className="h-5 w-5 shrink-0 text-alerta" aria-label="Sin jefe de sitio" />}
                        </button>
                        {expandida && (
                          <div className="space-y-4 border-t px-4 py-3">
                            <div className="flex flex-wrap gap-4">
                              <Responsable etiqueta="Jefe de sitio" tabla="jefes" nombre={d.jefe_sitio_nombre} enganchado={!!d.jefe_sitio_id} editable={esGerencia} onElegir={(p) => asignar(d, 'jefe_sitio', p)} />
                              <Responsable etiqueta="Inspector" tabla="perfiles" nombre={d.inspector_nombre} enganchado={!!d.inspector_id} editable={esGerencia} onElegir={(p) => asignar(d, 'inspector', p)} />
                            </div>
                            <ul className="divide-y">
                              {ubicaciones.map((u) => (
                                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                  <span>{u.nombre}{u.codigo && <span className="text-sm text-suave"> · {u.codigo}</span>}</span>
                                  <span className="text-sm text-suave">
                                    {[Number(u.m2) > 0 ? `${Number(u.m2).toLocaleString('es-AR')} m²` : null, u.ots_abiertas > 0 ? `${u.ots_abiertas} órdenes abiertas` : null, u.activa ? null : 'inactiva'].filter(Boolean).join(' · ')}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {vista.sueltas.length > 0 && (
                    <li className="tarjeta space-y-2">
                      <p className="font-semibold">Sin dirección asignada ({vista.sueltas.length})</p>
                      <ul className="divide-y">
                        {vista.sueltas.map((u) => (
                          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <span>{u.nombre}{u.codigo && <span className="text-sm text-suave"> · {u.codigo}</span>}</span>
                            <span className="flex items-center gap-1.5 text-sm text-suave"><UserCheck className="h-4 w-4" aria-hidden />{u.jefe_sitio_nombre ?? 'sin jefe de sitio'}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
