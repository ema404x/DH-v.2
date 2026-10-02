'use client';

import { useState, type FormEvent } from 'react';
import { Bug, CheckCircle2, LifeBuoy, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { Pestanas } from '@/components/gestion/Piezas';
import { ESTADOS_SUGERENCIA, TIPOS_SUGERENCIA, atenderSugerencia, enviarSugerencia, listarSugerencias, type Sugerencia } from '@/lib/admin';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

const TONO: Record<string, string> = { nueva: 'text-alerta', vista: 'text-info', resuelta: 'text-exito', descartada: 'text-suave' };

function Atender({ s, onListo }: { s: Sugerencia; onListo: () => void }) {
  const [estado, setEstado] = useState(s.estado);
  const [respuesta, setRespuesta] = useState(s.respuesta ?? '');
  const [guardando, setGuardando] = useState(false);
  return (
    <div className="mt-2 grid gap-2 rounded border bg-elevado/40 p-3 md:grid-cols-[12rem_1fr_auto] md:items-end">
      <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} opciones={ESTADOS_SUGERENCIA} />
      <Campo etiqueta="Respuesta para quien lo reportó" value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
      <Boton cargando={guardando} onClick={async () => {
        setGuardando(true);
        try { await atenderSugerencia(s.id, estado, respuesta.trim() || null); toast.success('Guardado.'); onListo(); } catch (e) { toast.error(limpiarError(e)); } finally { setGuardando(false); }
      }}>Guardar</Boton>
    </div>
  );
}

// Sugerencias y problemas: cada uno cuenta lo que le pasa y ve la respuesta; el admin las atiende.
// (En la v1 se mandaba un mail a una casilla personal y no quedaba registro.)
export default function Sugerencias() {
  const { perfil } = useSesion();
  const admin = perfil?.rol === 'admin';
  const carga = useCarga(listarSugerencias, []);
  const [tipo, setTipo] = useState('problema');
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [pagina, setPagina] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [filtro, setFiltro] = useState<'abiertas' | 'todas'>('abiertas');
  const lista = (carga.datos ?? []).filter((s) => filtro === 'todas' || ['nueva', 'vista'].includes(s.estado));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await enviarSugerencia({ tipo, titulo: titulo.trim(), descripcion: descripcion.trim(), pagina: pagina.trim() || null });
      toast.success('Gracias: quedó registrado y lo va a ver el administrador.');
      setTitulo(''); setDescripcion(''); setPagina('');
      await carga.recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <header><h1>Sugerencias y problemas</h1></header>
      <form onSubmit={enviar} className="tarjeta max-w-3xl space-y-4">
        <h2 className="flex items-center gap-2"><LifeBuoy className="h-5 w-5" aria-hidden />Contanos</h2>
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          <Selector etiqueta="Qué es" value={tipo} onChange={(e) => setTipo(e.target.value)} opciones={TIPOS_SUGERENCIA} />
          <Campo etiqueta="En pocas palabras" required maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </div>
        <Area etiqueta="Qué pasó o qué se te ocurre" required maxLength={4000} rows={5} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        <Campo etiqueta="En qué pantalla (opcional)" placeholder="Ej.: Pañol, al importar el catálogo" value={pagina} onChange={(e) => setPagina(e.target.value)} />
        <Boton type="submit" variante="primario" icono={Send} cargando={enviando}>Enviar</Boton>
      </form>

      <Pestanas activa={filtro} onCambio={setFiltro} pestanas={[{ id: 'abiertas', texto: admin ? 'Por atender' : 'Abiertas' }, { id: 'todas', texto: 'Todas' }]} />
      {carga.cargando && !carga.datos ? <Esqueleto filas={3} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : lista.length === 0 ? <Vacio icono={CheckCircle2} titulo="Nada pendiente" texto={admin ? 'No hay reportes por atender.' : 'Lo que envíes aparece acá, con la respuesta.'} /> : (
          <ul className="space-y-2">
            {lista.map((s) => (
              <li key={s.id} className="tarjeta">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">{s.tipo === 'problema' && <Bug className="h-4 w-4 text-peligro" aria-hidden />}{s.titulo}</p>
                    <p className="text-sm text-suave">{[TIPOS_SUGERENCIA[s.tipo], admin ? s.autor_nombre : null, s.pagina, new Date(s.created_at).toLocaleDateString('es-AR')].filter(Boolean).join(' · ')}</p>
                  </div>
                  <span className={`font-medium ${TONO[s.estado]}`}>{ESTADOS_SUGERENCIA[s.estado]}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{s.descripcion}</p>
                {admin && s.navegador && <p className="mt-1 text-xs text-suave">{s.navegador}</p>}
                {s.respuesta && <p className="mt-2 rounded bg-elevado p-2 text-sm"><strong>Respuesta:</strong> {s.respuesta}</p>}
                {admin && <Atender s={s} onListo={carga.recargar} />}
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
