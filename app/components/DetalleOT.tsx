'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Ban, CalendarClock, Check, CheckCheck, CloudUpload, MapPin, Play, RefreshCw, Save, Trash2, Undo2, User, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from './Boton';
import { Area } from './Campos';
import { Checklist } from './Checklist';
import { AvisoBadge, EstadoOTBadge, PrioridadBadge } from './EstadoBadge';
import { AvisoOffline, ErrorVista, Esqueleto } from './Estados';
import { FotoUploader } from './FotoUploader';
import { fmtFecha } from './OTCard';
import {
  aprobarOT, cancelarOT, finalizarOT, guardarBorrador, guardarEjecucion, iniciarOT, leerBorrador, listarFotos, obtenerOT,
  posicionActual, rechazarOT, type Destino, type Ejecucion,
} from '@/lib/ot';
import { descartar, reintentar } from '@/lib/offline/cola';
import { useCola } from '@/lib/offline/useCola';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { TIPOS_OT, type FotoOT, type TareaChecklist } from '@/lib/types';

const EN_TELEFONO = 'Guardado en el teléfono. Se envía cuando haya señal.';

function useSinSenal(): boolean {
  const [sinSenal, setSinSenal] = useState(false);
  useEffect(() => {
    const actualizar = () => setSinSenal(!navigator.onLine);
    actualizar();
    window.addEventListener('online', actualizar);
    window.addEventListener('offline', actualizar);
    return () => {
      window.removeEventListener('online', actualizar);
      window.removeEventListener('offline', actualizar);
    };
  }, []);
  return sinSenal;
}

// Una orden de trabajo. El botón primario es siempre el paso que sigue:
// Iniciar → Finalizar → (jefe de sitio o gerencia) Aprobar.
//
// El operario trabaja igual con o sin señal: lo que hace queda guardado en el teléfono y se envía solo.
// La pantalla pide el cambio; la base lo valida cuando llega y, si lo rechaza, acá se ve el motivo.
export function DetalleOT({ id, onVolver }: { id: string; onVolver: () => void }) {
  const { perfil, puedeValidar } = useSesion();
  const quien = useMemo(() => (perfil ? { id: perfil.id, nombre: perfil.nombre } : null), [perfil]);
  const cola = useCola(perfil?.id);
  const sinSenal = useSinSenal();

  const carga = useCarga(async () => (quien ? obtenerOT(id, quien) : null), [id, quien, cola.version]);
  const ot = carga.datos?.ot ?? null;
  const guardada = carga.datos?.guardada ?? false;

  const [tareas, setTareas] = useState<TareaChecklist[]>([]);
  const [notas, setNotas] = useState('');
  const [motivo, setMotivo] = useState('');
  const [listo, setListo] = useState(false);
  const [fotos, setFotos] = useState<FotoOT[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [comentario, setComentario] = useState('');

  // Al abrir la orden (o cuando cambia de estado) se cargan los datos que el operario edita.
  // Si había un borrador en el teléfono —se cerró la app a mitad del trabajo—, se retoma desde ahí.
  // Las recargas de fondo no pisan lo que se está escribiendo.
  const otId = ot?.id;
  const otEstado = ot?.estado;
  useEffect(() => {
    if (!ot) return;
    let vigente = true;
    setListo(false);
    leerBorrador(ot.id)
      .catch(() => undefined)
      .then((b) => {
        if (!vigente) return;
        // Orden de preferencia: el borrador del teléfono; si no, lo que la base rechazó (para corregirlo);
        // si no, lo que tiene la orden.
        const r = ot.ejecucionRechazada;
        if (b && ot.estado === 'en_progreso') {
          setTareas(b.checklist);
          setNotas(b.notas);
          setMotivo(b.motivo);
        } else if (r && ot.estado === 'en_progreso') {
          setTareas(r.checklist);
          setNotas(r.notas ?? '');
          setMotivo(r.motivos_incompleto[0]?.texto ?? '');
        } else {
          setTareas(ot.checklist ?? []);
          setNotas(ot.notas ?? '');
          setMotivo(ot.motivos_incompleto?.[0]?.texto ?? '');
        }
        setListo(true);
      });
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otId, otEstado]);

  // Cada cambio del operario queda en el teléfono al instante (con una pausa mínima para no escribir por cada tecla).
  useEffect(() => {
    if (!listo || !otId || otEstado !== 'en_progreso') return;
    const t = setTimeout(() => void guardarBorrador({ ot_id: otId, checklist: tareas, notas, motivo }).catch(() => undefined), 400);
    return () => clearTimeout(t);
  }, [listo, otId, otEstado, tareas, notas, motivo]);

  const urls = useRef<string[]>([]);
  const cargarFotos = useCallback(async () => {
    if (!otId) return;
    try {
      const lista = await listarFotos(otId);
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = lista.filter((f) => f.enEspera).map((f) => f.url);
      setFotos(lista);
    } catch {
      setFotos([]);
    }
  }, [otId]);

  useEffect(() => {
    void cargarFotos();
  }, [cargarFotos, cola.version]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  if (!quien || (carga.cargando && !ot)) {
    return <Esqueleto filas={4} />;
  }
  if (carga.error || !ot) {
    return (
      <div className="space-y-4">
        <ErrorVista mensaje={carga.error ?? 'La orden no existe o no es de tu sector.'} onReintentar={carga.recargar} />
        <Boton variante="fantasma" icono={ArrowLeft} onClick={onVolver}>
          Volver
        </Boton>
      </div>
    );
  }

  const enCurso = ot.estado === 'en_progreso';
  const porIniciar = ot.estado === 'pendiente' || ot.estado === 'asignada';
  const aValidar = ot.estado === 'pendiente_validacion';
  const cerrada = ot.estado === 'completada' || ot.estado === 'cancelada';
  const incompleto = tareas.some((t) => !t.hecho);

  const ejecucion = (): Ejecucion => ({
    checklist: tareas,
    notas: notas.trim() || null,
    motivos_incompleto: incompleto && motivo.trim() ? [{ id: 'm1', texto: motivo.trim() }] : [],
  });

  const refrescar = async () => {
    await Promise.all([carga.recargar(), cargarFotos()]);
  };

  // Acciones del operario: funcionan con o sin señal.
  async function hacer(clave: string, accion: () => Promise<Destino>, exito: string) {
    setOcupado(clave);
    try {
      const destino = await accion();
      toast.success(destino === 'enviado' ? exito : EN_TELEFONO);
      await refrescar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setOcupado(null);
    }
  }

  // Acciones de validación: necesitan conexión.
  async function validar(clave: string, accion: () => Promise<void>, exito: string) {
    setOcupado(clave);
    try {
      await accion();
      toast.success(exito);
      setRechazando(false);
      setComentario('');
      await refrescar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="space-y-4 pb-32">
      <Boton variante="fantasma" icono={ArrowLeft} onClick={onVolver}>
        Mis órdenes
      </Boton>

      <AvisoOffline guardadas={guardada} />

      {ot.rechazadas > 0 && (
        <section className="space-y-3 rounded border border-peligro/50 bg-peligro/10 p-3" role="alert">
          <p className="flex gap-2 font-semibold text-peligro">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            {ot.rechazadas === 1 ? 'Un cambio de esta orden no se pudo aplicar' : `${ot.rechazadas} cambios de esta orden no se pudieron aplicar`}
          </p>
          <p>{ot.errorEnvio}</p>
          <p className="text-sm text-suave">Lo que cargaste sigue guardado en el teléfono. Podés probar de nuevo o descartarlo.</p>
          <div className="flex flex-wrap gap-3">
            <Boton icono={RefreshCw} disabled={!!ocupado} onClick={() => reintentar(quien.id, ot.id).then(refrescar)}>
              Probar de nuevo
            </Boton>
            <Boton variante="peligro" icono={Trash2} disabled={!!ocupado}
              onClick={() => window.confirm('¿Descartar lo que no se pudo enviar de esta orden? Se pierde.') && descartar(quien.id, ot.id).then(refrescar)}>
              Descartar
            </Boton>
          </div>
        </section>
      )}

      {ot.sinEnviar > 0 && (
        <p className="flex items-center gap-2 rounded border border-alerta/40 bg-alerta/10 px-3 py-2 text-alerta" role="status">
          <CloudUpload className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            {ot.sinEnviar === 1 ? 'Hay 1 cambio de esta orden guardado' : `Hay ${ot.sinEnviar} cambios de esta orden guardados`} en el teléfono.
            {cola.enviando ? ' Enviando.' : ' Se envía cuando haya señal.'}
          </span>
        </p>
      )}

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <EstadoOTBadge estado={ot.estado} />
          <PrioridadBadge prioridad={ot.prioridad} />
          {ot.vencida && <AvisoBadge texto="Vencida" tono="peligro" />}
        </div>
        <h1>{ot.titulo}</h1>
        <p className="text-sm text-suave">{ot.codigo} · {TIPOS_OT[ot.tipo]}</p>
      </header>

      {ot.rechazo_comentario && enCurso && (
        <div className="rounded border border-alerta/40 bg-alerta/10 p-3 text-alerta" role="status">
          <p className="font-semibold">El trabajo fue devuelto para corregir</p>
          <p>{ot.rechazo_comentario}</p>
        </div>
      )}

      <section className="tarjeta space-y-2">
        <ul className="space-y-2">
          {ot.ubicacion_nombre && (
            <li className="flex gap-2">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-suave" aria-hidden />
              <span>
                {ot.ubicacion_nombre}
                {ot.ubicacion_direccion && <span className="block text-sm text-suave">{ot.ubicacion_direccion}</span>}
              </span>
            </li>
          )}
          {ot.activo_nombre && (
            <li className="flex gap-2">
              <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-suave" aria-hidden />
              <span>{ot.activo_nombre}{ot.activo_codigo ? ` · ${ot.activo_codigo}` : ''}</span>
            </li>
          )}
          <li className="flex gap-2">
            <User className="mt-0.5 h-5 w-5 shrink-0 text-suave" aria-hidden />
            <span>{ot.asignado_nombre ?? 'Sin asignar: queda a nombre de quien la inicie'}</span>
          </li>
          {ot.fecha_programada && (
            <li className="flex gap-2">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-suave" aria-hidden />
              <span>Programada para el {fmtFecha(ot.fecha_programada)}</span>
            </li>
          )}
        </ul>
        {ot.descripcion && <p className="whitespace-pre-wrap border-t pt-2">{ot.descripcion}</p>}
      </section>

      <section className="tarjeta space-y-3">
        <h2>Tareas</h2>
        <Checklist tareas={tareas} editable={enCurso} onCambio={setTareas} />
        {enCurso && incompleto && tareas.length > 0 && (
          <Area
            etiqueta="Si alguna tarea no se pudo hacer, contá por qué"
            ayuda="Sin este motivo no se puede finalizar con tareas sin marcar."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        )}
        {!enCurso && ot.motivos_incompleto.length > 0 && (
          <p className="rounded border border-alerta/40 bg-alerta/10 p-3 text-alerta">
            Quedó incompleta: {ot.motivos_incompleto.map((m) => m.texto).join(' · ')}
          </p>
        )}
      </section>

      {!porIniciar && (
        <section className="tarjeta space-y-3">
          <h2>Fotos</h2>
          <FotoUploader ot={ot} quien={quien} fotos={fotos} editable={enCurso} sinSenal={sinSenal} onCambio={refrescar} />
          {sinSenal && fotos.some((f) => !f.enEspera) && <p className="text-sm text-suave">Las fotos ya enviadas se ven cuando haya señal.</p>}
        </section>
      )}

      {!porIniciar && (
        <section className="tarjeta space-y-3">
          <h2>Notas del trabajo</h2>
          {enCurso ? (
            <Area etiqueta="Qué se hizo, qué quedó pendiente, qué material faltó" value={notas} onChange={(e) => setNotas(e.target.value)} />
          ) : (
            <p className="whitespace-pre-wrap">{ot.notas || <span className="text-suave">Sin notas.</span>}</p>
          )}
          {enCurso && (
            <>
              <p className="text-sm text-suave">Lo que marcás y escribís queda guardado en este teléfono al instante.</p>
              <Boton icono={Save} cargando={ocupado === 'guardar'} disabled={!!ocupado}
                onClick={() => hacer('guardar', () => guardarEjecucion(quien, ot, ejecucion()), 'Avance enviado.')}>
                Enviar avance
              </Boton>
            </>
          )}
        </section>
      )}

      {cerrada && ot.validado_nombre && (
        <p className="text-sm text-suave">Aprobada por {ot.validado_nombre} el {fmtFecha(ot.fecha_validacion)}.</p>
      )}

      {aValidar && puedeValidar && rechazando && (
        <section className="tarjeta space-y-3 border-peligro/40">
          <Area etiqueta="Motivo de la devolución" ayuda="Lo va a leer el operario al reabrir la orden." value={comentario} onChange={(e) => setComentario(e.target.value)} />
          <div className="flex flex-wrap gap-3">
            <Boton variante="peligro" icono={Undo2} cargando={ocupado === 'rechazar'} disabled={!!ocupado || !comentario.trim()}
              onClick={() => validar('rechazar', () => rechazarOT(ot.id, comentario.trim()), 'Orden devuelta para corregir.')}>
              Devolver para corregir
            </Boton>
            <Boton variante="fantasma" onClick={() => setRechazando(false)}>No devolver</Boton>
          </div>
        </section>
      )}

      {!cerrada && puedeValidar && !sinSenal && ot.sinEnviar === 0 && (
        <Boton variante="fantasma" icono={Ban} disabled={!!ocupado}
          onClick={() => window.confirm('¿Cancelar esta orden? No se puede deshacer.') && validar('cancelar', () => cancelarOT(ot.id), 'Orden cancelada.')}>
          Cancelar la orden
        </Boton>
      )}

      {/* Barra de acción: un solo botón primario, el paso que sigue. */}
      {!cerrada && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-barra p-3">
          <div className="mx-auto flex max-w-xl gap-3">
            {porIniciar && (
              <Boton variante="primario" icono={Play} campo ancho cargando={ocupado === 'iniciar'} disabled={!!ocupado}
                onClick={() => hacer('iniciar', async () => iniciarOT(quien, ot, sinSenal ? null : await posicionActual()), 'Trabajo iniciado.')}>
                Iniciar trabajo
              </Boton>
            )}
            {enCurso && (
              <Boton variante="primario" icono={Check} campo ancho cargando={ocupado === 'finalizar'} disabled={!!ocupado || !listo}
                onClick={() => hacer('finalizar', () => finalizarOT(quien, ot, ejecucion()), 'Trabajo finalizado. Queda a validar.')}>
                Finalizar trabajo
              </Boton>
            )}
            {aValidar && puedeValidar && !sinSenal && ot.sinEnviar === 0 && (
              <>
                <Boton icono={Undo2} campo disabled={!!ocupado || rechazando} onClick={() => setRechazando(true)}>
                  Devolver
                </Boton>
                <Boton variante="primario" icono={CheckCheck} campo ancho cargando={ocupado === 'aprobar'} disabled={!!ocupado}
                  onClick={() => validar('aprobar', () => aprobarOT(ot.id), 'Orden aprobada.')}>
                  Aprobar
                </Boton>
              </>
            )}
            {aValidar && puedeValidar && (sinSenal || ot.sinEnviar > 0) && (
              <p className="flex min-h-campo w-full items-center justify-center text-center text-suave">
                {ot.sinEnviar > 0 ? 'Falta enviar el trabajo. Después se puede validar.' : 'Para aprobar o devolver hace falta señal.'}
              </p>
            )}
            {aValidar && !puedeValidar && (
              <p className="flex min-h-campo w-full items-center justify-center text-center text-suave">
                {ot.sinEnviar > 0 ? 'Trabajo finalizado. Se envía cuando haya señal.' : 'Trabajo finalizado. Falta que lo valide el jefe de sitio.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
