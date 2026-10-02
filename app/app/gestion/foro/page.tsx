'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Lock, Megaphone, MessageSquare, MessagesSquare, Pencil, Pin, Plus, Send, Trash2, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { Chips } from '@/components/gestion/Piezas';
import {
  CATEGORIAS_FORO, borrarHilo, borrarRespuesta, cambiarHilo, crearHilo, editarRespuesta, listarHilos, marcarLeido, respuestasDe, responder, type Hilo,
} from '@/lib/admin';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { ROLES, type Rol } from '@/lib/types';

const cuando = (s: string) => new Date(s).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function Nuevo({ onListo }: { onListo: (id: string | null) => void }) {
  const { esGerencia } = useSesion();
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [categoria, setCategoria] = useState('general');
  const [anuncio, setAnuncio] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const id = await crearHilo({ titulo: titulo.trim(), cuerpo: cuerpo.trim(), categoria, tipo: anuncio ? 'anuncio' : 'hilo' });
      toast.success(anuncio ? 'Anuncio publicado.' : 'Hilo publicado.');
      onListo(id);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Nuevo tema</h1>
        <Boton variante="fantasma" onClick={() => onListo(null)}>Volver al foro</Boton>
      </header>
      <section className="tarjeta space-y-4">
        <Campo etiqueta="Título" required value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <Selector etiqueta="Categoría" value={categoria} onChange={(e) => setCategoria(e.target.value)} opciones={CATEGORIAS_FORO} />
        <Area etiqueta="Mensaje" required rows={6} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} />
        {esGerencia && (
          <label className="flex min-h-control items-center gap-3">
            <input type="checkbox" className="h-6 w-6 accent-primario" checked={anuncio} onChange={(e) => setAnuncio(e.target.checked)} />
            <span>Es un anuncio (queda destacado para todos)</span>
          </label>
        )}
      </section>
      <Boton type="submit" variante="primario" icono={Send} cargando={guardando}>Publicar</Boton>
    </form>
  );
}

function VerHilo({ hilo, onVolver }: { hilo: Hilo; onVolver: (cambio: boolean) => void }) {
  const { perfil, esGerencia } = useSesion();
  const carga = useCarga(() => respuestasDe(hilo.id), [hilo.id]);
  const [h, setH] = useState(hilo);
  const [texto, setTexto] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [edicion, setEdicion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cambio, setCambio] = useState(false);
  const mio = h.autor_id === perfil?.id;

  useEffect(() => { void marcarLeido(hilo.id); }, [hilo.id, carga.datos?.length]);

  async function hacer(fn: () => Promise<void>, ok?: string) {
    try {
      await fn();
      if (ok) toast.success(ok);
      setCambio(true);
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true);
    await hacer(async () => { await responder(h.id, texto.trim()); setTexto(''); await carga.recargar(); });
    setEnviando(false);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Boton variante="fantasma" onClick={() => onVolver(cambio)}>Volver al foro</Boton>
        <div className="flex flex-wrap gap-2">
          {esGerencia && <Boton variante="fantasma" icono={Pin} onClick={() => hacer(async () => { await cambiarHilo(h.id, { fijado: !h.fijado }); setH({ ...h, fijado: !h.fijado }); })}>{h.fijado ? 'Desfijar' : 'Fijar'}</Boton>}
          {esGerencia && <Boton variante="fantasma" icono={h.cerrado ? Unlock : Lock} onClick={() => hacer(async () => { await cambiarHilo(h.id, { cerrado: !h.cerrado }); setH({ ...h, cerrado: !h.cerrado }); })}>{h.cerrado ? 'Reabrir' : 'Cerrar'}</Boton>}
          {(mio || esGerencia) && <Boton variante="peligro" icono={Trash2} onClick={() => window.confirm('¿Borrar el tema y sus respuestas?') && hacer(async () => { await borrarHilo(h.id); onVolver(true); }, 'Tema borrado.')}>Borrar</Boton>}
        </div>
      </header>
      <article className={`tarjeta space-y-2 ${h.tipo === 'anuncio' ? 'border-info/60' : ''}`}>
        <p className="text-xs text-suave">{CATEGORIAS_FORO[h.categoria] ?? h.categoria}{h.tipo === 'anuncio' && ' · Anuncio'}{h.cerrado && ' · Cerrado'}</p>
        <h1>{h.titulo}</h1>
        <p className="text-sm text-suave">{h.autor_nombre ?? '—'} · {cuando(h.created_at)}</p>
        <p className="whitespace-pre-wrap">{h.cuerpo}</p>
      </article>

      {carga.cargando && !carga.datos ? <Esqueleto filas={3} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} /> : (
        <ol className="space-y-2">
          {(carga.datos ?? []).map((r) => (
            <li key={r.id} className="tarjeta space-y-1">
              <p className="text-sm text-suave">
                <span className="font-medium text-texto">{r.autor_nombre ?? '—'}</span>{r.autor_rol && ` · ${ROLES[r.autor_rol as Rol] ?? r.autor_rol}`} · {cuando(r.created_at)}{r.editado && ' · editado'}
              </p>
              {editando === r.id ? (
                <div className="space-y-2">
                  <Area etiqueta="Editar respuesta" value={edicion} onChange={(e) => setEdicion(e.target.value)} />
                  <div className="flex gap-2">
                    <Boton icono={Send} onClick={() => hacer(async () => { await editarRespuesta(r.id, edicion.trim()); setEditando(null); await carga.recargar(); })}>Guardar</Boton>
                    <Boton variante="fantasma" onClick={() => setEditando(null)}>Cancelar</Boton>
                  </div>
                </div>
              ) : <p className="whitespace-pre-wrap">{r.cuerpo}</p>}
              {(r.autor_id === perfil?.id || esGerencia) && editando !== r.id && (
                <div className="flex gap-1">
                  {r.autor_id === perfil?.id && <Boton variante="fantasma" icono={Pencil} onClick={() => { setEditando(r.id); setEdicion(r.cuerpo); }}>Editar</Boton>}
                  <Boton variante="fantasma" icono={Trash2} onClick={() => window.confirm('¿Borrar la respuesta?') && hacer(async () => { await borrarRespuesta(r.id); await carga.recargar(); })}>Borrar</Boton>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {h.cerrado ? <p className="text-suave">El tema está cerrado: ya no admite respuestas.</p> : (
        <form onSubmit={enviar} className="tarjeta space-y-3">
          <Area etiqueta="Tu respuesta" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <Boton type="submit" variante="primario" icono={Send} cargando={enviando} disabled={!texto.trim()}>Responder</Boton>
        </form>
      )}
    </div>
  );
}

// Foro del sector: consultas entre la gente, avisos de gerencia y respuestas, con lo nuevo marcado.
export default function Foro() {
  const carga = useCarga(listarHilos, []);
  const [vista, setVista] = useState<{ tipo: 'lista' } | { tipo: 'nuevo' } | { tipo: 'hilo'; hilo: Hilo }>({ tipo: 'lista' });
  const [categoria, setCategoria] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const todos = useMemo(() => carga.datos ?? [], [carga.datos]);
  const lista = todos.filter((h) => (!categoria || h.categoria === categoria)
    && (!texto.trim() || `${h.titulo} ${h.cuerpo}`.toLowerCase().includes(texto.trim().toLowerCase())));

  if (vista.tipo === 'nuevo') {
    return <Nuevo onListo={async (id) => {
      const datos = await listarHilos().catch(() => null);
      if (datos) carga.setDatos(datos);
      const h = id ? datos?.find((x) => x.id === id) : null;
      setVista(h ? { tipo: 'hilo', hilo: h } : { tipo: 'lista' });
    }} />;
  }
  if (vista.tipo === 'hilo') return <VerHilo hilo={vista.hilo} onVolver={() => { setVista({ tipo: 'lista' }); void carga.recargar(); }} />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Foro</h1>
        <Boton variante="primario" icono={Plus} onClick={() => setVista({ tipo: 'nuevo' })}>Nuevo tema</Boton>
      </header>
      <div className="grid gap-3 md:grid-cols-[1fr_16rem] md:items-end">
        <Chips opciones={Object.entries(CATEGORIAS_FORO).map(([id, t]) => ({ id, texto: t }))} valor={categoria} onCambio={setCategoria} todos="Todas" />
        <Campo etiqueta="Buscar" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>

      {carga.cargando && !carga.datos ? <Esqueleto filas={5} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : lista.length === 0 ? (
          <Vacio icono={MessagesSquare} titulo={todos.length === 0 ? 'Todavía no hay temas' : 'No hay temas con ese filtro'}
            texto={todos.length === 0 ? 'Abrí el primero: una consulta, un aviso o una idea para el equipo.' : 'Probá con otra categoría u otro texto.'} />
        ) : (
          <ul className="space-y-2">
            {lista.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => setVista({ tipo: 'hilo', hilo: h })}
                  className={`tarjeta flex w-full items-start gap-3 text-left hover:border-primario/60 ${h.tipo === 'anuncio' ? 'border-info/50' : ''}`}>
                  {h.tipo === 'anuncio' ? <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-label="Anuncio" />
                    : h.fijado ? <Pin className="mt-0.5 h-5 w-5 shrink-0 text-alerta" aria-label="Fijado" />
                      : <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-suave" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <p className={`${h.no_leido ? 'font-semibold' : 'font-medium'}`}>{h.titulo}{h.cerrado && <Lock className="ml-1 inline h-4 w-4 text-suave" aria-label="Cerrado" />}</p>
                    <p className="text-sm text-suave">{[CATEGORIAS_FORO[h.categoria] ?? h.categoria, h.autor_nombre, `${h.respuestas} ${h.respuestas === 1 ? 'respuesta' : 'respuestas'}`, cuando(h.ultima_actividad)].join(' · ')}</p>
                  </div>
                  {h.no_leido && <span className="shrink-0 rounded bg-primario/15 px-2 py-0.5 text-xs font-medium text-primario">Nuevo</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
