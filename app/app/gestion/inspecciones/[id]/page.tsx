'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, ArrowLeft, ArrowUp, Camera, Check, ChevronDown, ChevronRight, ClipboardList, Copy, FileText, Loader2, Mic, MicOff, Plus, Printer, Sparkles, Square, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Boton, BotonEnlace } from '@/components/Boton';
import { Area, Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto } from '@/components/Estados';
import { comprimirImagen } from '@/lib/imagen';
import { crearOT } from '@/lib/gestion';
import {
  URGENCIAS, generarInforme, guardarSecciones, obtenerInspeccion, proponerOTs, subirImagen,
  type Inspeccion, type OTPropuesta, type SeccionInspeccion, type Urgencia,
} from '@/lib/operacion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { PRIORIDADES, TIPOS_OT, type Prioridad, type TipoOT } from '@/lib/types';

const TONO_URGENCIA: Record<Urgencia, string> = {
  urgente: 'border-peligro bg-peligro/15 text-peligro', importante: 'border-alerta bg-alerta/15 text-alerta',
  leve: 'border-info bg-info/15 text-info', sin_issues: 'border-exito bg-exito/15 text-exito',
};

// Dictado por voz del navegador (Chrome y Edge). Lo reconocido se agrega al final de las notas; no se guarda audio.
type Reconocedor = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null };
function crearReconocedor(): Reconocedor | null {
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

function Seccion({ s, sectorId, abierta, onAbrir, onCambio, onMover }: {
  s: SeccionInspeccion; sectorId: string; abierta: boolean; onAbrir: () => void; onCambio: (cambios: Partial<SeccionInspeccion>) => void; onMover: (delta: number) => void;
}) {
  const [grabando, setGrabando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const rec = useRef<Reconocedor | null>(null);
  const texto = useRef(s.transcripcion);
  texto.current = s.transcripcion;
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => () => rec.current?.stop(), []);

  function dictar() {
    if (grabando) {
      rec.current?.stop();
      return;
    }
    const r = crearReconocedor();
    if (!r) return void toast.error('Este navegador no permite dictar. Usá Chrome o Edge, o escribí las notas.');
    r.lang = 'es-AR';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let nuevo = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) nuevo += e.results[i][0].transcript;
      if (nuevo.trim()) onCambio({ transcripcion: `${texto.current} ${nuevo}`.trim() });
    };
    r.onend = () => setGrabando(false);
    rec.current = r;
    r.start();
    setGrabando(true);
  }

  async function agregarFotos(lista: FileList | null) {
    if (!lista) return;
    setSubiendo(true);
    let fotos = s.fotos;
    for (const archivo of Array.from(lista)) {
      try {
        fotos = [...fotos, await subirImagen(sectorId, 'inspecciones', await comprimirImagen(archivo))];
        onCambio({ fotos });
      } catch (e) {
        toast.error(limpiarError(e));
      }
    }
    setSubiendo(false);
    if (entrada.current) entrada.current.value = '';
  }

  const resumen = (s.transcripcion || s.notas_libres).slice(0, 60);
  return (
    <li className={`tarjeta p-0 ${s.completada ? 'border-exito/40' : ''}`}>
      <div className="flex items-center gap-1 pr-2">
        <button type="button" aria-expanded={abierta} onClick={onAbrir} className="flex min-h-campo min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left">
          {abierta ? <ChevronDown className="h-5 w-5 shrink-0 text-suave" aria-hidden /> : <ChevronRight className="h-5 w-5 shrink-0 text-suave" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className={`font-semibold ${s.completada ? 'text-exito' : ''}`}>{s.nombre}{s.completada ? ' · revisada' : ''}</span>
            <span className="block truncate text-sm text-suave">
              {[s.urgencia && URGENCIAS[s.urgencia], s.fotos.length > 0 && `${s.fotos.length} fotos`, grabando && 'grabando', resumen].filter(Boolean).join(' · ') || 'Sin datos todavía'}
            </span>
          </span>
        </button>
        <button type="button" aria-label="Subir sección" onClick={() => onMover(-1)} className="flex h-11 w-11 items-center justify-center text-suave hover:text-texto"><ArrowUp className="h-5 w-5" aria-hidden /></button>
        <button type="button" aria-label="Bajar sección" onClick={() => onMover(1)} className="flex h-11 w-11 items-center justify-center text-suave hover:text-texto"><ArrowDown className="h-5 w-5" aria-hidden /></button>
      </div>

      {abierta && (
        <div className="space-y-4 border-t px-4 py-3">
          <div>
            <span className="etiqueta">Nivel de urgencia</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(URGENCIAS) as Urgencia[]).map((u) => (
                <button key={u} type="button" aria-pressed={s.urgencia === u} onClick={() => onCambio({ urgencia: s.urgencia === u ? null : u })}
                  className={`min-h-campo rounded border px-2 text-sm font-medium ${s.urgencia === u ? TONO_URGENCIA[u] : 'bg-elevado text-suave'}`}>
                  {URGENCIAS[u]}
                </button>
              ))}
            </div>
          </div>
          <Boton icono={grabando ? MicOff : Mic} variante={grabando ? 'peligro' : 'secundario'} campo onClick={dictar}>{grabando ? 'Detener dictado' : 'Dictar notas'}</Boton>
          <Area etiqueta="Notas de la sección" rows={4} value={s.transcripcion} onChange={(e) => onCambio({ transcripcion: e.target.value })} />
          <Area etiqueta="Observaciones adicionales" placeholder="Materiales necesarios, urgencias, recomendaciones" value={s.notas_libres} onChange={(e) => onCambio({ notas_libres: e.target.value })} />
          <div className="space-y-2">
            <span className="etiqueta">Fotos</span>
            {s.fotos.length > 0 && (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {s.fotos.map((f) => (
                  <li key={f} className="relative overflow-hidden rounded border">
                    <a href={f} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f} alt={`Foto de ${s.nombre}`} loading="lazy" className="aspect-square w-full object-cover" />
                    </a>
                    <button type="button" aria-label="Quitar foto" onClick={() => onCambio({ fotos: s.fotos.filter((x) => x !== f) })}
                      className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded bg-fondo/80 text-peligro"><Trash2 className="h-5 w-5" aria-hidden /></button>
                  </li>
                ))}
              </ul>
            )}
            <input ref={entrada} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => agregarFotos(e.target.files)} />
            <Boton icono={Camera} campo cargando={subiendo} onClick={() => entrada.current?.click()}>Sacar foto</Boton>
          </div>
          <Boton icono={s.completada ? Square : Check} variante={s.completada ? 'fantasma' : 'secundario'} campo ancho onClick={() => onCambio({ completada: !s.completada })}>
            {s.completada ? 'Desmarcar sección' : 'Marcar como revisada'}
          </Boton>
        </div>
      )}
    </li>
  );
}

function PropuestaOTs({ insp, onCerrar }: { insp: Inspeccion; onCerrar: () => void }) {
  const [ordenes, setOrdenes] = useState<(OTPropuesta & { elegida: boolean })[] | null>(null);
  const [estado, setEstado] = useState<'pidiendo' | 'revisando' | 'creando' | 'listo'>('pidiendo');
  const [error, setError] = useState<string | null>(null);
  const [creadas, setCreadas] = useState(0);

  useEffect(() => {
    proponerOTs(insp.id)
      .then((r) => {
        setOrdenes(r.ordenes.map((o) => ({ ...o, elegida: true })));
        setEstado('revisando');
        if (r.origen === 'plantilla' && r.aviso) toast.warning(r.aviso, { duration: 10000 });
      })
      .catch((e) => setError(limpiarError(e)));
  }, [insp.id]);

  const cambiar = (i: number, c: Partial<OTPropuesta & { elegida: boolean }>) => setOrdenes((a) => (a ?? []).map((o, n) => (n === i ? { ...o, ...c } : o)));

  async function crear() {
    const elegidas = (ordenes ?? []).filter((o) => o.elegida && o.titulo.trim());
    setEstado('creando');
    let n = 0;
    for (const o of elegidas) {
      try {
        await crearOT({
          titulo: o.titulo.trim(), descripcion: [o.descripcion, o.lugar && `Lugar: ${o.lugar}`].filter(Boolean).join('\n\n'), tipo: o.tipo, prioridad: o.prioridad,
          ubicacion_id: insp.ubicacion_id, activo_id: null, asignado_a: null, fecha_programada: null, horas_estimadas: null, checklist: [], requiere_fotos: false,
        });
        n++;
        setCreadas(n);
      } catch (e) {
        toast.error(limpiarError(e));
      }
    }
    setEstado('listo');
  }

  return (
    <section className="tarjeta no-imprimir space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h2>Órdenes de trabajo a partir del informe</h2>
        <Boton variante="fantasma" onClick={onCerrar}>Cerrar</Boton>
      </div>
      {error ? <ErrorVista mensaje={error} /> : estado === 'pidiendo' ? <p className="text-suave">Leyendo el informe para proponer las órdenes. Puede tardar un minuto.</p>
        : estado === 'listo' ? (
          <div className="space-y-3">
            <p className="text-exito">Se crearon {creadas} órdenes de trabajo para {insp.establecimiento}. Quedan sin asignar, en Órdenes.</p>
            <BotonEnlace href="/gestion/ots" icono={ClipboardList}>Ver las órdenes</BotonEnlace>
          </div>
        ) : (
          <>
            <p className="text-suave">Revisá cada una antes de crearla: podés cambiarla o destildarla. Se crean en {insp.establecimiento}, sin asignar.</p>
            {(ordenes ?? []).length === 0 ? <p className="text-suave">El informe no tiene hallazgos que requieran una orden.</p> : (
              <ul className="space-y-3">
                {(ordenes ?? []).map((o, i) => (
                  <li key={i} className={`space-y-3 rounded border p-3 ${o.elegida ? 'bg-elevado/40' : 'opacity-60'}`}>
                    <label className="flex min-h-control cursor-pointer items-center gap-3">
                      <input type="checkbox" className="h-6 w-6 accent-primario" checked={o.elegida} onChange={(e) => cambiar(i, { elegida: e.target.checked })} />
                      <span className="font-medium">Crear esta orden</span>
                    </label>
                    <Campo etiqueta="Título" value={o.titulo} onChange={(e) => cambiar(i, { titulo: e.target.value })} />
                    <Area etiqueta="Descripción" value={o.descripcion} onChange={(e) => cambiar(i, { descripcion: e.target.value })} />
                    <div className="grid gap-3 md:grid-cols-3">
                      <Selector etiqueta="Tipo" value={o.tipo} opciones={TIPOS_OT} onChange={(e) => cambiar(i, { tipo: e.target.value as TipoOT })} />
                      <Selector etiqueta="Prioridad" value={o.prioridad} opciones={PRIORIDADES} onChange={(e) => cambiar(i, { prioridad: e.target.value as Prioridad })} />
                      <Campo etiqueta="Lugar" value={o.lugar} onChange={(e) => cambiar(i, { lugar: e.target.value })} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Boton variante="primario" icono={Wrench} cargando={estado === 'creando'} disabled={!(ordenes ?? []).some((o) => o.elegida)} onClick={crear}>
              Crear {(ordenes ?? []).filter((o) => o.elegida).length} órdenes
            </Boton>
          </>
        )}
    </section>
  );
}

// Una inspección: el recorrido por secciones y su informe. Todo lo que se carga se guarda solo.
export default function PaginaInspeccion() {
  const { id } = useParams<{ id: string }>();
  const carga = useCarga(() => obtenerInspeccion(id), [id]);
  const insp = carga.datos;
  const [secciones, setSecciones] = useState<SeccionInspeccion[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState('');
  const [guardado, setGuardado] = useState<'al_dia' | 'pendiente' | 'guardando' | 'error'>('al_dia');
  const [generando, setGenerando] = useState(false);
  const [proponiendo, setProponiendo] = useState(false);
  const cargada = useRef<string | null>(null);

  useEffect(() => {
    if (insp && cargada.current !== insp.id) {
      cargada.current = insp.id;
      setSecciones(insp.secciones ?? []);
    }
  }, [insp]);

  // Guardado automático: un solo guardado por vez, siempre con la última versión completa de las secciones.
  const ultimo = useRef(secciones);
  ultimo.current = secciones;
  useEffect(() => {
    if (guardado !== 'pendiente') return;
    const t = setTimeout(async () => {
      setGuardado('guardando');
      const enviado = ultimo.current;
      try {
        await guardarSecciones(id, enviado);
        setGuardado(ultimo.current === enviado ? 'al_dia' : 'pendiente');
      } catch (e) {
        setGuardado('error');
        toast.error(limpiarError(e));
      }
    }, 600);
    return () => clearTimeout(t);
  }, [guardado, secciones, id]);

  // Mientras haya una redacción con IA en camino, se mira cada 15 segundos si ya llegó. Solo se actualiza el
  // informe: lo que se está cargando en las secciones no se toca.
  const pendienteIA = insp?.informe_ia_pendiente ?? false;
  const { setDatos } = carga;
  useEffect(() => {
    if (!pendienteIA) return;
    const t = setInterval(async () => {
      try {
        const nueva = await obtenerInspeccion(id);
        setDatos(nueva);
        if (nueva.informe_origen === 'ia') toast.success('Llegó el informe redactado con IA.');
      } catch {
        // sin señal o un corte: se vuelve a mirar en la próxima vuelta
      }
    }, 15000);
    return () => clearInterval(t);
  }, [pendienteIA, id, setDatos]);

  const cambiar = (nuevas: SeccionInspeccion[]) => { setSecciones(nuevas); setGuardado('pendiente'); };
  const editar = (sid: string, c: Partial<SeccionInspeccion>) => cambiar(ultimo.current.map((s) => (s.id === sid ? { ...s, ...c } : s)));
  function mover(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= secciones.length) return;
    const copia = [...secciones];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    cambiar(copia);
  }
  function agregar() {
    if (!nueva.trim()) return;
    cambiar([...secciones, { id: `sec_custom_${Date.now()}`, nombre: nueva.trim(), urgencia: null, transcripcion: '', notas_libres: '', fotos: [], completada: false }]);
    setNueva('');
  }

  async function informe() {
    const sinRevisar = secciones.filter((s) => !s.completada).length;
    if (sinRevisar > 0 && !window.confirm(`Quedan ${sinRevisar} secciones sin revisar. El informe se hace solo con las revisadas. ¿Generar igual?`)) return;
    setGenerando(true);
    try {
      if (guardado !== 'al_dia') await guardarSecciones(id, ultimo.current);
      setGuardado('al_dia');
      const r = await generarInforme(id);
      toast.success(r.pendiente ? 'Informe listo. La redacción con IA se suma sola cuando esté.' : 'Informe listo.');
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      // Aunque la espera se haya cortado, el informe puede haber quedado guardado: se vuelve a leer.
      await carga.recargar();
      setGenerando(false);
    }
  }

  if (carga.cargando && !insp) return <Esqueleto filas={5} />;
  if (carga.error || !insp) return <ErrorVista mensaje={carga.error ?? 'La inspección no existe o no es de tu sector.'} onReintentar={carga.recargar} />;

  const hechas = secciones.filter((s) => s.completada).length;
  const pct = secciones.length ? Math.round((hechas * 100) / secciones.length) : 0;
  const fotosTotal = secciones.reduce((t, s) => t + s.fotos.length, 0);

  return (
    <>
      <div className="no-imprimir"><BotonEnlace href="/gestion/inspecciones" variante="fantasma" icono={ArrowLeft}>Inspecciones</BotonEnlace></div>

      <header className="no-imprimir space-y-2">
        <h1>{insp.titulo}</h1>
        <p className="text-suave">{[insp.establecimiento, insp.direccion, insp.zona].filter(Boolean).join(' · ')}</p>
        <div className="flex items-center gap-3">
          <span className="h-2 flex-1 rounded bg-elevado"><span className={`block h-2 rounded ${pct === 100 ? 'bg-exito' : 'bg-primario'}`} style={{ width: `${pct}%` }} /></span>
          <span className="text-sm text-suave">{hechas}/{secciones.length} secciones · {fotosTotal} fotos</span>
        </div>
        <p className="text-sm text-suave" role="status">
          {guardado === 'al_dia' ? 'Todo guardado.' : guardado === 'error' ? 'No se pudo guardar. Se reintenta con el próximo cambio.' : 'Guardando'}
        </p>
      </header>

      <div className="no-imprimir flex flex-wrap items-center gap-3">
        <Boton variante="primario" icono={Sparkles} cargando={generando} disabled={hechas === 0} onClick={informe}>
          {insp.informe_generado ? 'Volver a generar el informe' : 'Generar informe'}
        </Boton>
        {generando && <p className="text-suave">Armando el informe con tus notas.</p>}
        {hechas === 0 && <p className="text-suave">Marcá al menos una sección como revisada.</p>}
      </div>

      {proponiendo && <PropuestaOTs insp={insp} onCerrar={() => setProponiendo(false)} />}

      <div className={`grid gap-5 ${insp.informe_generado ? 'xl:grid-cols-2' : ''}`}>
        <section className="no-imprimir space-y-3">
          <h2>Recorrido</h2>
          <ul className="space-y-2">
            {secciones.map((s, i) => (
              <Seccion key={s.id} s={s} sectorId={insp.sector_id} abierta={abierta === s.id} onAbrir={() => setAbierta(abierta === s.id ? null : s.id)}
                onCambio={(c) => editar(s.id, c)} onMover={(d) => mover(i, d)} />
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <div className="flex-1"><Campo etiqueta="Agregar otra sección" value={nueva} onChange={(e) => setNueva(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } }} /></div>
            <Boton icono={Plus} onClick={agregar}>Agregar</Boton>
          </div>
        </section>

        {insp.informe_generado && (
          <section className="space-y-3">
            <div className="no-imprimir flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2"><FileText className="h-5 w-5" aria-hidden />Informe</h2>
              <div className="flex flex-wrap gap-2">
                <Boton icono={Copy} onClick={() => navigator.clipboard.writeText(insp.informe_generado ?? '').then(() => toast.success('Informe copiado.'))}>Copiar</Boton>
                <Boton icono={Printer} onClick={() => window.print()}>Imprimir o guardar PDF</Boton>
                <Boton icono={Wrench} onClick={() => setProponiendo(true)}>Generar órdenes</Boton>
              </div>
            </div>
            {insp.informe_ia_pendiente ? (
              <p className="no-imprimir flex items-start gap-2 rounded border border-info/40 bg-info/10 p-3 text-sm text-info" role="status">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
                <span>
                  Este informe está armado con tus notas y ya se puede usar. La redacción con IA está en camino y lo reemplaza sola;
                  si el servicio está saturado puede tardar de minutos a horas.
                  {insp.informe_ia_motivo && <span className="block text-suave">Último intento: {insp.informe_ia_motivo}.</span>}
                </span>
              </p>
            ) : insp.informe_origen === 'plantilla' && (
              <p className="no-imprimir flex items-start gap-2 rounded border bg-elevado p-3 text-sm text-suave" role="status">
                <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Informe armado con la plantilla, sin redacción por IA.
                  {insp.informe_ia_motivo && <span className="block">{insp.informe_ia_motivo}</span>}
                </span>
              </p>
            )}
            <article className="hoja informe tarjeta">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{insp.informe_generado}</ReactMarkdown>
              {fotosTotal > 0 && (
                <>
                  <h2>Registro fotográfico</h2>
                  {secciones.filter((s) => s.fotos.length > 0).map((s) => (
                    <div key={s.id}>
                      <h3>{s.nombre}</h3>
                      <div className="grid grid-cols-3 gap-2">
                        {s.fotos.map((f, n) => (
                          <figure key={f}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={f} alt={`${s.nombre}, foto ${n + 1}`} className="aspect-[4/3] w-full rounded border object-cover" />
                            <figcaption className="text-xs text-suave">Foto {n + 1}</figcaption>
                          </figure>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </article>
          </section>
        )}
      </div>
    </>
  );
}
