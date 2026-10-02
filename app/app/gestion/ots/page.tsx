'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, Plus, X } from 'lucide-react';
import { Boton, BotonEnlace } from '@/components/Boton';
import { Campo, Selector } from '@/components/Campos';
import { AvisoBadge, EstadoOTBadge, PrioridadBadge, TEXTO_ESTADO_OT } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { fmtFecha } from '@/components/OTCard';
import { Tabla, type Columna } from '@/components/gestion/Tabla';
import { listarOTs, type FiltroOTs } from '@/lib/gestion';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { TIPOS_OT, type OT } from '@/lib/types';

const ESTADOS = { abiertas: 'Abiertas', todas: 'Todas', ...TEXTO_ESTADO_OT };

const COLUMNAS: Columna<OT>[] = [
  {
    titulo: 'Orden',
    celda: (o) => (
      <Link href={`/ot/${o.id}`} className="block min-h-control font-medium text-primario hover:underline">
        {o.titulo}
        <span className="block text-xs font-normal text-suave">{o.codigo} · {TIPOS_OT[o.tipo]}</span>
      </Link>
    ),
  },
  {
    titulo: 'Estado',
    celda: (o) => (
      <div className="flex flex-col items-start gap-1">
        <EstadoOTBadge estado={o.estado} />
        {o.vencida && <AvisoBadge texto="Vencida" tono="peligro" />}
      </div>
    ),
  },
  { titulo: 'Prioridad', celda: (o) => <PrioridadBadge prioridad={o.prioridad} />, secundaria: true },
  { titulo: 'Ubicación', celda: (o) => o.ubicacion_nombre ?? '—', secundaria: true },
  { titulo: 'Asignada a', celda: (o) => o.asignado_nombre ?? 'Sin asignar', secundaria: true },
  { titulo: 'Programada', celda: (o) => fmtFecha(o.fecha_programada) ?? '—', secundaria: true },
];

function Ordenes() {
  const { puedeValidar } = useSesion();
  const params = useSearchParams();
  const inicial = params.get('estado');
  // Desde el mapa: las órdenes de un lugar.
  const [ubicacion, setUbicacion] = useState(params.get('ubicacion') ?? '');
  const nombreLugar = params.get('nombre');
  const [estado, setEstado] = useState<FiltroOTs['estado']>(inicial && inicial in ESTADOS ? (inicial as FiltroOTs['estado']) : 'abiertas');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(0);

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(texto);
      setPagina(0);
    }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  const carga = useCarga(() => listarOTs({ estado, q, pagina, ubicacion: ubicacion || undefined }), [estado, q, pagina, ubicacion]);
  const filtrando = q.trim() !== '' || estado !== 'todas' || !!ubicacion;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Órdenes de trabajo</h1>
        {puedeValidar && (
          <BotonEnlace href="/gestion/ots/nueva" variante="primario" icono={Plus}>
            Nueva orden
          </BotonEnlace>
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <Selector etiqueta="Estado" value={estado} opciones={ESTADOS}
          onChange={(e) => { setEstado(e.target.value as FiltroOTs['estado']); setPagina(0); }} />
        <Campo etiqueta="Buscar por título" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>
      {ubicacion && (
        <div className="flex items-center justify-between gap-2 rounded border border-info/40 bg-info/10 py-1 pl-3 text-info">
          <p className="min-w-0 truncate">Órdenes de <strong>{nombreLugar ?? 'un lugar'}</strong></p>
          <Boton variante="fantasma" icono={X} onClick={() => { setUbicacion(''); setPagina(0); }}>Ver todas</Boton>
        </div>
      )}

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error || !carga.datos ? (
        <ErrorVista mensaje={carga.error ?? 'No se pudieron cargar las órdenes.'} onReintentar={carga.recargar} />
      ) : carga.datos.filas.length === 0 ? (
        <Vacio
          icono={ClipboardList}
          titulo={filtrando ? 'No hay órdenes con ese filtro' : 'Todavía no hay órdenes'}
          texto={filtrando ? 'Probá con otro estado o con otro texto de búsqueda.' : 'Creá la primera orden de trabajo del sector para empezar a asignar tareas.'}
        />
      ) : (
        <Tabla columnas={COLUMNAS} filas={carga.datos.filas} clave={(o) => o.id} total={carga.datos.total} pagina={pagina} onPagina={setPagina} />
      )}
    </>
  );
}

export default function Pagina() {
  return (
    <Suspense fallback={<Esqueleto filas={5} />}>
      <Ordenes />
    </Suspense>
  );
}
