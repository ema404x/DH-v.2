'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, FileText, Play, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { fmtFecha } from '@/components/OTCard';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Chips, Indicador, Indicadores } from '@/components/gestion/Piezas';
import { borrarInspeccion, crearInspeccion, listarInspecciones, type Inspeccion } from '@/lib/operacion';
import { supabase } from '@/lib/supabase/client';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import type { ResultadoBusqueda } from '@/lib/types';

const ESTADOS = { en_progreso: 'En progreso', generando: 'Generando informe', completado: 'Completada' } as const;
const TONO = { en_progreso: 'border-alerta/40 bg-alerta/10 text-alerta', generando: 'border-info/40 bg-info/10 text-info', completado: 'border-exito/40 bg-exito/10 text-exito' } as const;
const hoy = () => new Date().toISOString().slice(0, 10);

function Nueva({ onCancelar }: { onCancelar: () => void }) {
  const router = useRouter();
  const [lugar, setLugar] = useState<ResultadoBusqueda | null>(null);
  const [titulo, setTitulo] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [creando, setCreando] = useState(false);

  async function iniciar(e: FormEvent) {
    e.preventDefault();
    if (!lugar) return toast.error('Elegí el establecimiento.');
    setCreando(true);
    try {
      // Dirección y zona se toman del establecimiento elegido.
      const { data: u } = await supabase().from('v_ubicaciones').select('domicilio,zona').eq('id', lugar.id).maybeSingle();
      const id = await crearInspeccion({
        ubicacion_id: lugar.id, establecimiento: lugar.etiqueta, direccion: u?.domicilio ?? null, zona: u?.zona ?? null, fecha_inspeccion: fecha,
        titulo: titulo.trim() || `Inspección ${lugar.etiqueta} — ${new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR')}`,
      });
      router.push(`/gestion/inspecciones/${id}`);
    } catch (err) {
      toast.error(limpiarError(err));
      setCreando(false);
    }
  }

  return (
    <form onSubmit={iniciar} className="tarjeta max-w-2xl space-y-4">
      <h2>Nueva inspección</h2>
      <BuscadorRemoto etiqueta="Establecimiento" tabla="ubicaciones" valor={lugar} onCambio={setLugar} />
      <Campo etiqueta="Título del informe (opcional)" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      <Campo etiqueta="Fecha" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Play} cargando={creando}>Iniciar recorrido</Boton>
        <Boton variante="fantasma" onClick={onCancelar}>Cancelar</Boton>
      </div>
    </form>
  );
}

// Inspecciones edilicias: recorrido por secciones con notas, fotos y nivel de urgencia, e informe técnico.
export default function Inspecciones() {
  const carga = useCarga(listarInspecciones, []);
  const [creando, setCreando] = useState(false);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<Inspeccion['estado'] | null>(null);

  if (creando) return <Nueva onCancelar={() => setCreando(false)} />;

  const todas = carga.datos ?? [];
  const t = q.trim().toLowerCase();
  const lista = todas.filter((i) => (!estado || i.estado === estado) && (!t || i.establecimiento.toLowerCase().includes(t) || i.titulo.toLowerCase().includes(t)));

  async function borrar(i: Inspeccion) {
    if (!window.confirm(`¿Borrar la inspección "${i.titulo}"? No se puede deshacer.`)) return;
    try {
      await borrarInspeccion(i.id);
      toast.success('Inspección borrada.');
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Inspecciones</h1>
        <Boton variante="primario" icono={Plus} onClick={() => setCreando(true)}>Nueva inspección</Boton>
      </header>

      {carga.cargando && !carga.datos ? <Esqueleto filas={4} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} /> : todas.length === 0 ? (
        <Vacio icono={ClipboardCheck} titulo="Todavía no hay inspecciones" texto="Iniciá una para recorrer el establecimiento sección por sección, con notas por voz y fotos, y generar el informe técnico." />
      ) : (
        <>
          <Indicadores>
            <Indicador titulo="Inspecciones" valor={todas.length} icono={ClipboardCheck} />
            <Indicador titulo="En progreso" valor={todas.filter((i) => i.estado === 'en_progreso').length} icono={Play} tono="alerta" />
            <Indicador titulo="Completadas" valor={todas.filter((i) => i.estado === 'completado').length} icono={ClipboardCheck} tono="exito" />
            <Indicador titulo="Con informe" valor={todas.filter((i) => i.informe_generado).length} icono={FileText} />
          </Indicadores>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <Campo etiqueta="Buscar por establecimiento o título" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
            <Chips opciones={(Object.keys(ESTADOS) as Inspeccion['estado'][]).map((e) => ({ id: e, texto: ESTADOS[e] }))} valor={estado} onCambio={setEstado} todos="Todas" />
          </div>
          {lista.length === 0 ? <Vacio icono={Search} titulo="Ninguna inspección coincide" texto="Probá con otro texto u otro estado." /> : (
            <ul className="grid gap-3 md:grid-cols-2">
              {lista.map((i) => {
                const hechas = i.secciones.filter((s) => s.completada).length;
                const pct = i.secciones.length ? Math.round((hechas * 100) / i.secciones.length) : 0;
                return (
                  <li key={i.id} className="tarjeta space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/gestion/inspecciones/${i.id}`} className="min-w-0 flex-1 hover:text-primario">
                        <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${TONO[i.estado]}`}>{ESTADOS[i.estado]}</span>
                        <span className="mt-1 block font-semibold">{i.titulo}</span>
                        <span className="block text-sm text-suave">{i.establecimiento} · {fmtFecha(i.fecha_inspeccion)}{i.informe_generado ? ' · con informe' : ''}</span>
                      </Link>
                      <Boton variante="fantasma" icono={Trash2} onClick={() => borrar(i)}>Borrar</Boton>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 flex-1 rounded bg-elevado"><span className={`block h-2 rounded ${pct === 100 ? 'bg-exito' : 'bg-primario'}`} style={{ width: `${pct}%` }} /></span>
                      <span className="text-sm text-suave">{hechas}/{i.secciones.length} secciones</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
