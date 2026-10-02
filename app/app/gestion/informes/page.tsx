'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { AlarmClock, CheckCircle2, Download, FileClock, FileText, Plus, Save, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Casilla, Selector, oNull } from '@/components/Campos';
import { AvisoBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Documentos } from '@/components/gestion/Documentos';
import { Indicador, Indicadores, Pestanas, descargarCSV } from '@/components/gestion/Piezas';
import { ESTADOS_INFORME, TIPOS_INFORME, borrarInforme, guardarDocumentosInforme, guardarInforme, listarInformes, type EstadoInforme, type Informe } from '@/lib/control';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { PRIORIDADES, type ResultadoBusqueda } from '@/lib/types';

const TONO: Record<EstadoInforme, string> = { pendiente: 'text-alerta', en_preparacion: 'text-info', enviado: 'text-exito', aprobado: 'text-exito', rechazado: 'text-peligro' };
const dia = (s: string | null) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString('es-AR') : null);

function plazo(i: Informe): { texto: string; tono: 'peligro' | 'alerta' | 'info' } | null {
  if (i.dias_restantes === null) return null;
  if (i.dias_restantes < 0) return { texto: `Venció hace ${-i.dias_restantes} d`, tono: 'peligro' };
  if (i.dias_restantes === 0) return { texto: 'Vence hoy', tono: 'peligro' };
  if (i.dias_restantes <= 3) return { texto: `Vence en ${i.dias_restantes} d`, tono: 'alerta' };
  if (i.dias_restantes <= 7) return { texto: `Vence en ${i.dias_restantes} d`, tono: 'info' };
  return null;
}

function Ficha({ informe, onListo }: { informe: Informe | null; onListo: (cambio: boolean) => void }) {
  const { perfil, puedeValidar, esGerencia, sectorEfectivo } = useSesion();
  const i = informe;
  const puedeEditar = puedeValidar || (!!i && i.responsable_id === perfil?.id);
  const [f, setF] = useState({
    titulo: i?.titulo ?? '', tipo: i?.tipo ?? 'avance_obra', estado: i?.estado ?? ('pendiente' as EstadoInforme), prioridad: i?.prioridad ?? 'media',
    destinatario: i?.destinatario ?? '', fecha_limite: i?.fecha_limite ?? '', fecha_envio: i?.fecha_envio ?? '', fecha_aprobacion: i?.fecha_aprobacion ?? '',
    descripcion: i?.descripcion ?? '', observaciones: i?.observaciones ?? '', responsable_texto: i?.responsable_id ? '' : i?.responsable_texto ?? '',
  });
  const [firma, setFirma] = useState({ requiere: i?.requiere_firma ?? false, obtenida: i?.firma_obtenida ?? false });
  const [obra, setObra] = useState<ResultadoBusqueda | null>(i?.obra_id ? { id: i.obra_id, etiqueta: i.obra_titulo ?? '', detalle: null } : null);
  const [lugar, setLugar] = useState<ResultadoBusqueda | null>(i?.ubicacion_id ? { id: i.ubicacion_id, etiqueta: i.ubicacion_nombre ?? '', detalle: null } : null);
  const [responsable, setResponsable] = useState<ResultadoBusqueda | null>(i?.responsable_id ? { id: i.responsable_id, etiqueta: i.responsable_texto ?? '', detalle: null } : null);
  const [docs, setDocs] = useState(i?.documentos ?? []);
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value })) });

  async function guardar(e: FormEvent, estado?: EstadoInforme) {
    e.preventDefault();
    setGuardando(true);
    try {
      await guardarInforme(i?.id ?? null, {
        titulo: f.titulo.trim(), tipo: f.tipo, estado: estado ?? f.estado, prioridad: f.prioridad, obra_id: obra?.id ?? null, ubicacion_id: lugar?.id ?? null,
        destinatario: oNull(f.destinatario), responsable_id: responsable?.id ?? null, responsable_texto: responsable ? null : oNull(f.responsable_texto),
        fecha_limite: oNull(f.fecha_limite), fecha_envio: oNull(f.fecha_envio), fecha_aprobacion: oNull(f.fecha_aprobacion),
        descripcion: oNull(f.descripcion), observaciones: oNull(f.observaciones), requiere_firma: firma.requiere, firma_obtenida: firma.obtenida,
      });
      toast.success(estado === 'enviado' ? 'Informe marcado como enviado.' : i ? 'Informe guardado.' : 'Informe creado.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!i || !window.confirm(`¿Borrar "${i.titulo}"?`)) return;
    try {
      await borrarInforme(i.id);
      toast.success('Informe borrado.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  return (
    <form onSubmit={(e) => guardar(e)} className="max-w-4xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>{i ? `${i.codigo} · ${i.titulo}` : 'Nuevo informe'}</h1>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Volver a la lista</Boton>
      </header>
      <fieldset disabled={!puedeEditar} className="space-y-4">
        <section className="tarjeta space-y-4">
          <Campo etiqueta="Título" required {...campo('titulo')} />
          <div className="grid gap-4 md:grid-cols-3">
            <Selector etiqueta="Tipo" opciones={TIPOS_INFORME} {...campo('tipo')} />
            <Selector etiqueta="Estado" opciones={ESTADOS_INFORME} {...campo('estado')} />
            <Selector etiqueta="Prioridad" opciones={PRIORIDADES} {...campo('prioridad')} />
            <Campo etiqueta="Fecha límite" type="date" {...campo('fecha_limite')} />
            <Campo etiqueta="Enviado el" type="date" {...campo('fecha_envio')} ayuda="Si queda vacía, al enviarlo se pone la de hoy." />
            <Campo etiqueta="Aprobado el" type="date" {...campo('fecha_aprobacion')} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <BuscadorRemoto etiqueta="Obra" tabla="obras" valor={obra} onCambio={setObra} />
            <BuscadorRemoto etiqueta="Lugar" tabla="ubicaciones" valor={lugar} onCambio={setLugar} />
            <BuscadorRemoto etiqueta="Responsable" tabla="perfiles" valor={responsable} onCambio={setResponsable} ayuda="Con usuario puede actualizarlo él mismo." />
            {!responsable && <Campo etiqueta="O el nombre del responsable" {...campo('responsable_texto')} />}
            <Campo etiqueta="Para quién (destinatario)" {...campo('destinatario')} />
          </div>
          <Area etiqueta="Descripción" {...campo('descripcion')} />
          <Area etiqueta="Observaciones" {...campo('observaciones')} />
          <div className="flex flex-wrap gap-6">
            <Casilla etiqueta="Requiere firma" checked={firma.requiere} onChange={(e) => setFirma((a) => ({ ...a, requiere: e.target.checked }))} />
            {firma.requiere && <Casilla etiqueta="Firma obtenida" checked={firma.obtenida} onChange={(e) => setFirma((a) => ({ ...a, obtenida: e.target.checked }))} />}
          </div>
        </section>
      </fieldset>
      {i && sectorEfectivo && (
        <section className="tarjeta space-y-3">
          <h2>Archivos</h2>
          <Documentos sectorId={sectorEfectivo.id} carpeta={`informes/${i.id}`} documentos={docs} puedeEditar={puedeEditar}
            onCambio={async (d) => { await guardarDocumentosInforme(i.id, d); setDocs(d); }} />
        </section>
      )}
      {puedeEditar && (
        <div className="flex flex-wrap justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>{i ? 'Guardar' : 'Crear informe'}</Boton>
            {i && ['pendiente', 'en_preparacion', 'rechazado'].includes(i.estado) && (
              <Boton icono={Send} cargando={guardando} onClick={(e) => guardar(e as unknown as FormEvent, 'enviado')}>Marcar enviado</Boton>
            )}
          </div>
          {i && esGerencia && <Boton variante="peligro" icono={Trash2} onClick={borrar}>Borrar</Boton>}
        </div>
      )}
    </form>
  );
}

// Seguimiento de la entrega de informes con fecha límite. Las entregas también aparecen en el calendario.
export default function Informes() {
  const { puedeValidar } = useSesion();
  const carga = useCarga(listarInformes, []);
  const [vista, setVista] = useState<{ informe: Informe | null } | null>(null);
  const [filtro, setFiltro] = useState<'abiertos' | 'vencidos' | 'entregados' | 'todos'>('abiertos');
  const [texto, setTexto] = useState('');
  const todos = useMemo(() => carga.datos ?? [], [carga.datos]);
  const abierto = (i: Informe) => ['pendiente', 'en_preparacion', 'rechazado'].includes(i.estado);
  const lista = todos.filter((i) => {
    const t = texto.trim().toLowerCase();
    const ok = filtro === 'todos' || (filtro === 'abiertos' ? abierto(i) : filtro === 'vencidos' ? i.vencido : !abierto(i));
    return ok && (!t || [i.codigo, i.titulo, i.obra_titulo, i.responsable_texto, i.destinatario].some((v) => v?.toLowerCase().includes(t)));
  });

  if (vista) return <Ficha informe={vista.informe} onListo={(cambio) => { setVista(null); if (cambio) void carga.recargar(); }} />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Informes</h1>
        <div className="flex flex-wrap gap-2">
          <Boton icono={Download} disabled={lista.length === 0} onClick={() => descargarCSV('informes.csv',
            ['Código', 'Título', 'Tipo', 'Estado', 'Prioridad', 'Obra', 'Responsable', 'Destinatario', 'Fecha límite', 'Enviado', 'Aprobado', 'Vencido', 'Falta firma'],
            lista.map((i) => [i.codigo, i.titulo, TIPOS_INFORME[i.tipo], ESTADOS_INFORME[i.estado], i.prioridad, i.obra_titulo, i.responsable_texto, i.destinatario, i.fecha_limite,
              i.fecha_envio, i.fecha_aprobacion, i.vencido ? 'Sí' : 'No', i.falta_firma ? 'Sí' : 'No']))}>Exportar</Boton>
          {puedeValidar && <Boton variante="primario" icono={Plus} onClick={() => setVista({ informe: null })}>Nuevo informe</Boton>}
        </div>
      </header>

      <Indicadores>
        <Indicador titulo="Por entregar" valor={todos.filter(abierto).length} icono={FileClock} />
        <Indicador titulo="Vencidos" valor={todos.filter((i) => i.vencido).length} icono={AlarmClock} tono={todos.some((i) => i.vencido) ? 'peligro' : 'neutro'} />
        <Indicador titulo="Vencen en 5 días" valor={todos.filter((i) => i.dias_restantes !== null && i.dias_restantes >= 0 && i.dias_restantes <= 5).length} icono={AlarmClock} tono="alerta" />
        <Indicador titulo="Entregados" valor={todos.filter((i) => !abierto(i)).length} icono={CheckCircle2} tono="exito" />
      </Indicadores>

      <Pestanas activa={filtro} onCambio={setFiltro} pestanas={[
        { id: 'abiertos', texto: 'Por entregar' }, { id: 'vencidos', texto: 'Vencidos', cuenta: todos.filter((i) => i.vencido).length, alerta: true },
        { id: 'entregados', texto: 'Entregados' }, { id: 'todos', texto: 'Todos' },
      ]} />
      <Campo etiqueta="Buscar por código, título, obra, responsable o destinatario" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />

      {carga.cargando && !carga.datos ? <Esqueleto filas={4} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : lista.length === 0 ? (
          <Vacio icono={FileText} titulo={todos.length === 0 ? 'Todavía no hay informes' : 'No hay informes en esta pestaña'}
            texto={todos.length === 0 ? 'Cargá los informes que hay que entregar, con su fecha límite: se avisan cuando se acercan y van al calendario.' : 'Probá con otra pestaña.'} />
        ) : (
          <ul className="space-y-2">
            {lista.map((i) => {
              const p = plazo(i);
              return (
                <li key={i.id}>
                  <button type="button" onClick={() => setVista({ informe: i })} className={`tarjeta flex w-full flex-wrap items-center justify-between gap-3 text-left hover:border-primario/60 ${i.vencido ? 'border-peligro/50' : ''}`}>
                    <div className="min-w-0">
                      <p className="font-medium">{i.codigo} · {i.titulo}</p>
                      <p className="text-sm text-suave">{[TIPOS_INFORME[i.tipo], i.obra_titulo ?? i.ubicacion_nombre, i.responsable_texto, i.fecha_limite && `límite ${dia(i.fecha_limite)}`].filter(Boolean).join(' · ')}</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {p && <AvisoBadge texto={p.texto} tono={p.tono} />}
                        {i.falta_firma && <AvisoBadge texto="Falta la firma" tono="alerta" />}
                      </div>
                    </div>
                    <span className={`font-medium ${TONO[i.estado]}`}>{ESTADOS_INFORME[i.estado]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </>
  );
}
