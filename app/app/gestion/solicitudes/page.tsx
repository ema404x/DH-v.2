'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, FileQuestion, History, MessageSquare, Plus, Save, Send, Trash2, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Documentos } from '@/components/gestion/Documentos';
import { Indicador, Indicadores, Pestanas } from '@/components/gestion/Piezas';
import { fmtPesos } from '@/lib/certificacion';
import {
  ESTADOS_SOLICITUD, PRIORIDADES_COBRO, borrarSolicitud, cambiarEstadoSolicitud, comentarSolicitud, fmtPct, guardarSolicitud, listarSolicitudes,
  type Documento, type EstadoSolicitud, type Solicitud,
} from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

const TONO: Record<EstadoSolicitud, string> = {
  borrador: 'text-suave', enviada: 'text-alerta', en_revision: 'text-info', aprobada: 'text-exito', rechazada: 'text-peligro',
};
const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' });

// ------------------------------------------------------------------ ficha

function Ficha({ solicitud, onListo }: { solicitud: Solicitud | null; onListo: (cambio: boolean) => void }) {
  const { perfil, esGerencia, sectorEfectivo } = useSesion();
  const s = solicitud;
  const mia = !s || s.solicitante_id === perfil?.id;
  const editable = !s || (mia && s.estado === 'borrador');
  const [f, setF] = useState({
    titulo: s?.titulo ?? '', establecimiento: s?.establecimiento ?? '', descripcion: s?.descripcion ?? '', monto: s ? String(Number(s.monto_solicitado)) : '',
    avance: s ? String(Number(s.avance)) : '0', periodo: s?.periodo ?? '', prioridad: s?.prioridad ?? 'normal',
  });
  const [obra, setObra] = useState<ResultadoBusqueda | null>(s?.obra_id ? { id: s.obra_id, etiqueta: s.obra_titulo ?? '', detalle: null } : null);
  const [contrato, setContrato] = useState<ResultadoBusqueda | null>(s?.contrato_id ? { id: s.contrato_id, etiqueta: s.contrato_contratista ?? '', detalle: null } : null);
  const [adjuntos, setAdjuntos] = useState<Documento[]>(s?.adjuntos ?? []);
  const [comentario, setComentario] = useState(s?.comentarios ?? '');
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value })) });

  const datos = () => ({
    titulo: f.titulo.trim(), obra_id: obra?.id ?? null, contrato_id: contrato?.id ?? null, establecimiento: f.establecimiento.trim() || null,
    descripcion: f.descripcion.trim() || null, monto_solicitado: Number(f.monto.replace(/\./g, '').replace(',', '.')) || 0,
    avance: Number(f.avance.replace(',', '.')) || 0, periodo: f.periodo.trim() || null, prioridad: f.prioridad as Solicitud['prioridad'], adjuntos,
  });

  async function hacer(fn: () => Promise<void>, ok: string) {
    setTrabajando(true);
    try {
      await fn();
      toast.success(ok);
      onListo(true);
    } catch (e) {
      toast.error(limpiarError(e));
      setTrabajando(false);
    }
  }

  function guardar(e: FormEvent, enviar = false) {
    e.preventDefault();
    void hacer(() => guardarSolicitud(s?.id ?? null, datos(), enviar), enviar ? 'Solicitud enviada.' : 'Solicitud guardada como borrador.');
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>{s ? `${s.codigo} · ${s.titulo}` : 'Nueva solicitud de certificado'}</h1>
          {s && <p className={`font-medium ${TONO[s.estado]}`}>{ESTADOS_SOLICITUD[s.estado]}{s.solicitante_nombre && <span className="font-normal text-suave"> · pedida por {s.solicitante_nombre}</span>}</p>}
        </div>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Volver a la lista</Boton>
      </header>

      {s?.estado === 'rechazada' && s.motivo_rechazo && (
        <p className="rounded border border-peligro/40 bg-peligro/10 p-3 text-peligro">Rechazada: {s.motivo_rechazo}{mia && ' · Volvela a borrador para corregirla y reenviarla.'}</p>
      )}

      <form onSubmit={(e) => guardar(e)} className="space-y-4">
        <fieldset disabled={!editable} className="tarjeta space-y-4">
          <Campo etiqueta="Qué se pide certificar" required {...campo('titulo')} />
          <div className="grid gap-4 md:grid-cols-2">
            <BuscadorRemoto etiqueta="Obra" tabla="obras" valor={obra} onCambio={setObra} />
            <BuscadorRemoto etiqueta="Contrato (opcional)" tabla="contratos" valor={contrato} onCambio={setContrato} />
            <Campo etiqueta="Establecimiento" {...campo('establecimiento')} />
            <Campo etiqueta="Período" placeholder="Ej.: Octubre 2026" {...campo('periodo')} />
            <Campo etiqueta="Monto solicitado" inputMode="decimal" {...campo('monto')} />
            <Campo etiqueta="Avance (%)" inputMode="decimal" {...campo('avance')} />
            <Selector etiqueta="Prioridad" opciones={PRIORIDADES_COBRO} {...campo('prioridad')} />
          </div>
          <Area etiqueta="Detalle" {...campo('descripcion')} />
        </fieldset>
        <section className="tarjeta space-y-3">
          <h2>Adjuntos</h2>
          {sectorEfectivo && (
            <Documentos sectorId={sectorEfectivo.id} carpeta="solicitudes" documentos={adjuntos} puedeEditar={editable}
              onCambio={async (docs) => {
                // En una solicitud ya guardada los adjuntos se guardan al toque; en una nueva, al guardarla.
                if (s) await guardarSolicitud(s.id, { ...datos(), adjuntos: docs }, false);
                setAdjuntos(docs);
              }} />
          )}
        </section>
        {editable && (
          <div className="flex flex-wrap justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Boton variante="primario" icono={Send} cargando={trabajando} onClick={(e) => guardar(e as unknown as FormEvent, true)}>Enviar a gerencia</Boton>
              <Boton type="submit" icono={Save} cargando={trabajando}>Guardar borrador</Boton>
            </div>
            {s && <Boton variante="peligro" icono={Trash2} onClick={() => window.confirm('¿Borrar esta solicitud?') && hacer(() => borrarSolicitud(s.id), 'Solicitud borrada.')}>Borrar</Boton>}
          </div>
        )}
      </form>

      {s && mia && s.estado === 'rechazada' && (
        <Boton icono={Undo2} cargando={trabajando} onClick={() => hacer(() => cambiarEstadoSolicitud(s.id, 'borrador'), 'Volvió a borrador. Corregila y reenviala.')}>Volver a borrador para corregir</Boton>
      )}

      {s && esGerencia && (s.estado === 'enviada' || s.estado === 'en_revision') && (
        <section className="tarjeta space-y-4">
          <h2>Revisión</h2>
          {mia ? (
            <p className="text-suave">La pediste vos: la tiene que resolver otra persona de gerencia.</p>
          ) : (
            <>
              <div className="flex items-end gap-2">
                <div className="flex-1"><Area etiqueta="Comentarios para quien la pidió" value={comentario} onChange={(e) => setComentario(e.target.value)} /></div>
                <Boton icono={MessageSquare} cargando={trabajando} onClick={() => hacer(() => comentarSolicitud(s.id, comentario.trim()), 'Comentario guardado.')}>Guardar</Boton>
              </div>
              <div className="flex flex-wrap gap-2">
                {s.estado === 'enviada' && <Boton cargando={trabajando} onClick={() => hacer(() => cambiarEstadoSolicitud(s.id, 'en_revision'), 'La tomaste para revisar.')}>Tomar para revisar</Boton>}
                <Boton variante="primario" icono={CheckCircle2} cargando={trabajando} onClick={() => hacer(() => cambiarEstadoSolicitud(s.id, 'aprobada', { comentarios: comentario.trim() || undefined }), 'Solicitud aprobada.')}>Aprobar</Boton>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1"><Campo etiqueta="Motivo del rechazo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
                <Boton variante="peligro" icono={XCircle} cargando={trabajando} disabled={!motivo.trim()}
                  onClick={() => hacer(() => cambiarEstadoSolicitud(s.id, 'rechazada', { motivo_rechazo: motivo.trim() }), 'Solicitud rechazada.')}>Rechazar</Boton>
              </div>
            </>
          )}
        </section>
      )}

      {s && s.estado === 'aprobada' && s.contrato_id && (
        <p className="text-suave">Aprobada. El certificado se emite desde <Link className="text-primario hover:underline" href={`/gestion/certificacion/${s.contrato_id}`}>el contrato de {s.contrato_contratista}</Link>.</p>
      )}

      {s && (
        <section className="tarjeta space-y-3">
          <h2>Historial</h2>
          <ol className="space-y-3">
            {[...s.historial].reverse().map((h, i) => (
              <li key={i} className="flex gap-3">
                <History className="mt-0.5 h-5 w-5 shrink-0 text-suave" aria-hidden />
                <div>
                  <p className="text-sm text-suave">{h.usuario ?? 'Sistema'} · {fecha(h.fecha)}</p>
                  <p><span className={TONO[h.estado]}>{ESTADOS_SOLICITUD[h.estado]}</span>{h.comentario && ` · ${h.comentario}`}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ lista

export default function Solicitudes() {
  const { perfil, esGerencia } = useSesion();
  const carga = useCarga(listarSolicitudes, []);
  const [vista, setVista] = useState<{ solicitud: Solicitud | null } | null>(null);
  const [filtro, setFiltro] = useState<'abiertas' | 'mias' | EstadoSolicitud | 'todas'>('abiertas');
  const todas = useMemo(() => carga.datos ?? [], [carga.datos]);
  const porRevisar = todas.filter((s) => (s.estado === 'enviada' || s.estado === 'en_revision') && s.solicitante_id !== perfil?.id);
  const lista = todas.filter((s) => filtro === 'todas' || (filtro === 'abiertas' ? !['aprobada', 'rechazada'].includes(s.estado) || (s.estado === 'rechazada' && s.solicitante_id === perfil?.id)
    : filtro === 'mias' ? s.solicitante_id === perfil?.id : s.estado === filtro));

  if (vista) return <Ficha solicitud={vista.solicitud} onListo={(cambio) => { setVista(null); if (cambio) void carga.recargar(); }} />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Solicitudes de certificado</h1>
        <Boton variante="primario" icono={Plus} onClick={() => setVista({ solicitud: null })}>Nueva solicitud</Boton>
      </header>
      <p className="text-suave">El jefe de sitio pide certificar un avance; gerencia la revisa y la aprueba o la rechaza. Nadie aprueba lo que pidió.</p>

      <Indicadores>
        <Indicador titulo={esGerencia ? 'Para revisar' : 'Esperando a gerencia'} valor={esGerencia ? porRevisar.length : todas.filter((s) => s.solicitante_id === perfil?.id && (s.estado === 'enviada' || s.estado === 'en_revision')).length}
          icono={FileQuestion} tono={esGerencia && porRevisar.length > 0 ? 'alerta' : 'neutro'} />
        <Indicador titulo="Borradores míos" valor={todas.filter((s) => s.solicitante_id === perfil?.id && s.estado === 'borrador').length} icono={Save} />
        <Indicador titulo="Aprobadas" valor={todas.filter((s) => s.estado === 'aprobada').length} icono={CheckCircle2} tono="exito" />
        <Indicador titulo="Rechazadas" valor={todas.filter((s) => s.estado === 'rechazada').length} icono={XCircle} />
      </Indicadores>

      <Pestanas activa={filtro} onCambio={setFiltro} pestanas={[
        { id: 'abiertas', texto: 'Abiertas' }, { id: 'mias', texto: 'Mías' }, { id: 'enviada', texto: 'Enviadas' }, { id: 'en_revision', texto: 'En revisión' },
        { id: 'aprobada', texto: 'Aprobadas' }, { id: 'rechazada', texto: 'Rechazadas' }, { id: 'todas', texto: 'Todas' },
      ]} />

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={4} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : lista.length === 0 ? (
        <Vacio icono={FileQuestion} titulo={todas.length === 0 ? 'Todavía no hay solicitudes' : 'No hay solicitudes en esta pestaña'}
          texto={todas.length === 0 ? 'Cuando una obra tenga un avance para certificar, pedilo desde acá con sus adjuntos.' : 'Probá con otra pestaña.'} />
      ) : (
        <ul className="space-y-2">
          {lista.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setVista({ solicitud: s })} className="tarjeta flex w-full flex-wrap items-center justify-between gap-3 text-left hover:border-primario/60">
                <div className="min-w-0">
                  <p className="font-medium">{s.codigo} · {s.titulo}</p>
                  <p className="text-sm text-suave">{[s.obra_titulo ?? s.establecimiento, s.periodo, s.solicitante_nombre, `avance ${fmtPct(s.avance)}`].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="text-right">
                  <p className={`font-medium ${TONO[s.estado]}`}>{ESTADOS_SOLICITUD[s.estado]}</p>
                  <p className="num text-sm">{fmtPesos(s.monto_solicitado)}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
