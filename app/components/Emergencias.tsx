'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Camera, Siren, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from './Boton';
import { Area, Campo } from './Campos';
import { BuscadorRemoto } from './gestion/BuscadorRemoto';
import { comprimirImagen } from '@/lib/imagen';
import { TIPOS_EMERGENCIA, reportarEmergencia, subirImagen, type Emergencia, type TipoEmergencia } from '@/lib/operacion';
import { supabase } from '@/lib/supabase/client';
import { limpiarError } from '@/lib/errores';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

// Alta de una emergencia. La puede cargar cualquier persona del sector, desde gestión o desde el portal de campo.
// La base crea en el mismo paso la orden de trabajo urgente, asignada al jefe de sitio del lugar.
export function FormEmergencia({ onListo, onCancelar }: { onListo: () => void; onCancelar: () => void }) {
  const { perfil, sectorEfectivo } = useSesion();
  const [tipo, setTipo] = useState<TipoEmergencia | null>(null);
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [ubicacion, setUbicacion] = useState<ResultadoBusqueda | null>(null);
  const [jefe, setJefe] = useState<ResultadoBusqueda | null>(null);
  const [reporta, setReporta] = useState(perfil?.nombre ?? '');
  const [telefono, setTelefono] = useState(perfil?.telefono ?? '');
  const [fotos, setFotos] = useState<string[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  async function agregarFotos(lista: FileList | null) {
    if (!lista || !sectorEfectivo) return;
    setSubiendo(true);
    for (const archivo of Array.from(lista)) {
      try {
        const url = await subirImagen(sectorEfectivo.id, 'emergencias', await comprimirImagen(archivo));
        setFotos((a) => [...a, url]);
      } catch (e) {
        toast.error(limpiarError(e));
      }
    }
    setSubiendo(false);
    if (entrada.current) entrada.current.value = '';
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!tipo) return toast.error('Elegí el tipo de emergencia.');
    if (!ubicacion) return toast.error('Elegí el establecimiento de la lista.');
    setGuardando(true);
    try {
      await reportarEmergencia({
        tipo, titulo: titulo.trim(), descripcion: descripcion.trim() || null, ubicacion_id: ubicacion.id, jefe_sitio_id: jefe?.id ?? null,
        reportado_por: reporta.trim() || null, telefono_contacto: telefono.trim() || null, fotos,
      });
      toast.success('Emergencia reportada. Se generó su orden de trabajo urgente.');
      onListo();
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="tarjeta space-y-4">
      <h2>Nueva emergencia</h2>
      <div>
        <span className="etiqueta">Tipo</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.entries(TIPOS_EMERGENCIA) as [TipoEmergencia, string][]).map(([id, texto]) => (
            <button key={id} type="button" aria-pressed={tipo === id} onClick={() => setTipo(id)}
              className={`min-h-campo rounded border px-2 text-sm font-medium ${tipo === id ? 'border-peligro bg-peligro/15 text-peligro' : 'bg-elevado text-suave'}`}>
              {texto}
            </button>
          ))}
        </div>
      </div>
      <Campo etiqueta="Qué pasó" required value={titulo} onChange={(e) => setTitulo(e.target.value)} className="min-h-campo" />
      <Area etiqueta="Detalle" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      <BuscadorRemoto etiqueta="Establecimiento" tabla="ubicaciones" valor={ubicacion} onCambio={setUbicacion} ayuda="Queda a cargo del jefe de sitio de ese lugar." />
      <BuscadorRemoto etiqueta="Asignar a otro jefe de sitio (opcional)" tabla="jefes" valor={jefe} onCambio={setJefe} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Quién avisa" value={reporta} onChange={(e) => setReporta(e.target.value)} />
        <Campo etiqueta="Teléfono de contacto" type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
      </div>
      <div className="space-y-2">
        <span className="etiqueta">Fotos</span>
        {fotos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {fotos.map((f) => (
              <li key={f} className="relative overflow-hidden rounded border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f} alt="Foto de la emergencia" className="aspect-square w-full object-cover" />
                <button type="button" aria-label="Quitar foto" onClick={() => setFotos((a) => a.filter((x) => x !== f))}
                  className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded bg-fondo/80 text-peligro">
                  <Trash2 className="h-5 w-5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input ref={entrada} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => agregarFotos(e.target.files)} />
        <Boton icono={Camera} cargando={subiendo} onClick={() => entrada.current?.click()}>Sacar foto</Boton>
      </div>
      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Siren} campo cargando={guardando} disabled={subiendo}>Reportar emergencia</Boton>
        <Boton variante="fantasma" campo onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
      </div>
    </form>
  );
}

function sonar() {
  try {
    const ctx = new AudioContext();
    [880, 660, 880].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gan = ctx.createGain();
      osc.frequency.value = hz;
      osc.connect(gan).connect(ctx.destination);
      gan.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.35);
      gan.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.35 + 0.3);
      osc.start(ctx.currentTime + i * 0.35);
      osc.stop(ctx.currentTime + i * 0.35 + 0.3);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    // Sin audio disponible: queda el aviso en pantalla.
  }
}

// Aviso en el momento cuando entra una emergencia nueva en el sector (sonido, vibración y cartel).
// Lo reciben quienes pueden atenderla: gerencia y jefes de sitio. La base filtra por sector (RLS).
export function AlertaEmergencias() {
  const { puedeValidar, perfil } = useSesion();
  const [alerta, setAlerta] = useState<Emergencia | null>(null);

  useEffect(() => {
    if (!puedeValidar || !perfil) return;
    const sb = supabase();
    const canal = sb
      .channel('emergencias-nuevas')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'emergencias' }, async (cambio) => {
        const fila = cambio.new as { id: string; created_by: string | null };
        if (fila.created_by === perfil.id) return;
        const { data } = await sb.from('v_emergencias').select('*').eq('id', fila.id).maybeSingle();
        if (!data) return;
        const e = data as Emergencia;
        setAlerta(e);
        sonar();
        navigator.vibrate?.([400, 150, 400, 150, 600]);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Nueva emergencia', { body: `${e.titulo} — ${e.ubicacion_nombre}`, tag: `emergencia-${e.id}`, requireInteraction: true });
        }
      })
      .subscribe();
    return () => {
      void sb.removeChannel(canal);
    };
  }, [puedeValidar, perfil]);

  useEffect(() => {
    if (!alerta) return;
    const t = setTimeout(() => setAlerta(null), 30000);
    return () => clearTimeout(t);
  }, [alerta]);

  if (!alerta) return null;
  return (
    <div role="alert" className="no-imprimir fixed right-3 top-3 z-50 w-[min(24rem,calc(100vw-1.5rem))] space-y-2 rounded-lg border border-peligro bg-superficie p-4 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-peligro"><Siren className="h-6 w-6" aria-hidden />Nueva emergencia</p>
        <button type="button" aria-label="Cerrar aviso" onClick={() => setAlerta(null)} className="flex h-11 w-11 items-center justify-center text-suave"><X className="h-5 w-5" aria-hidden /></button>
      </div>
      <p className="font-semibold">{alerta.titulo}</p>
      <p className="text-suave">{TIPOS_EMERGENCIA[alerta.tipo]} · {alerta.ubicacion_nombre}</p>
      <Link href="/gestion/emergencias" onClick={() => setAlerta(null)} className="inline-flex min-h-control items-center rounded bg-peligro/15 px-4 font-semibold text-peligro">
        Ver emergencia
      </Link>
    </div>
  );
}
