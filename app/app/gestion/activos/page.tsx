'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Boxes, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo, Selector, oNull } from '@/components/Campos';
import { AvisoBadge, EstadoActivoBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { fmtFecha } from '@/components/OTCard';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Tabla, type Columna } from '@/components/gestion/Tabla';
import { crearActivo, listarActivos } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { CRITICIDADES, TIPOS_ACTIVO, type Activo, type Criticidad, type ResultadoBusqueda, type TipoActivo } from '@/lib/types';

const COLUMNAS: Columna<Activo>[] = [
  {
    titulo: 'Activo',
    celda: (a) => (
      <Link href={`/gestion/activos/${a.id}`} className="block min-h-control font-medium text-primario hover:underline">
        {a.nombre}
        <span className="block text-xs font-normal text-suave">{[a.codigo, TIPOS_ACTIVO[a.tipo]].filter(Boolean).join(' · ')}</span>
      </Link>
    ),
  },
  { titulo: 'Estado', celda: (a) => <EstadoActivoBadge estado={a.estado} /> },
  { titulo: 'Ubicación', celda: (a) => a.ubicacion_nombre ?? '—', secundaria: true },
  {
    titulo: 'Próximo mantenimiento',
    secundaria: true,
    celda: (a) =>
      a.proximo_mantenimiento ? (
        <span className="flex flex-wrap items-center gap-2">
          {fmtFecha(a.proximo_mantenimiento)}
          {a.mantenimiento_vencido && <AvisoBadge texto="Vencido" tono="peligro" />}
        </span>
      ) : (
        '—'
      ),
  },
  { titulo: 'Órdenes abiertas', celda: (a) => a.ots_abiertas, numerica: true, secundaria: true },
];

function FormActivo({ onCancelar }: { onCancelar: () => void }) {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [tipo, setTipo] = useState<TipoActivo>('otro');
  const [criticidad, setCriticidad] = useState<Criticidad>('media');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [serie, setSerie] = useState('');
  const [ubicacion, setUbicacion] = useState<ResultadoBusqueda | null>(null);
  const [padre, setPadre] = useState<ResultadoBusqueda | null>(null);
  const [frecuencia, setFrecuencia] = useState('');
  const [proximo, setProximo] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const id = await crearActivo({
        nombre: nombre.trim(),
        codigo: oNull(codigo),
        tipo,
        criticidad,
        marca: oNull(marca),
        modelo: oNull(modelo),
        numero_serie: oNull(serie),
        ubicacion_id: ubicacion?.id ?? null,
        padre_id: padre?.id ?? null,
        frecuencia_mant_dias: frecuencia ? Number(frecuencia) : null,
        proximo_mantenimiento: oNull(proximo),
      });
      toast.success('Activo creado.');
      router.push(`/gestion/activos/${id}`);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="tarjeta space-y-4">
      <h2>Nuevo activo</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Campo etiqueta="Nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Campo etiqueta="Código interno" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoActivo)} opciones={TIPOS_ACTIVO} />
        <Selector etiqueta="Criticidad" value={criticidad} onChange={(e) => setCriticidad(e.target.value as Criticidad)} opciones={CRITICIDADES} />
        <Campo etiqueta="Marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
        <Campo etiqueta="Modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} />
        <Campo etiqueta="Número de serie" value={serie} onChange={(e) => setSerie(e.target.value)} />
        <BuscadorRemoto etiqueta="Ubicación" tabla="ubicaciones" valor={ubicacion} onCambio={setUbicacion} />
        <BuscadorRemoto etiqueta="Es parte de (opcional)" tabla="activos" valor={padre} onCambio={setPadre}
          ayuda="Por ejemplo: el quemador es parte de la caldera." />
        <Campo etiqueta="Mantenimiento preventivo cada (días)" inputMode="numeric" value={frecuencia} onChange={(e) => setFrecuencia(e.target.value.replace(/\D/g, ''))} />
        <Campo etiqueta="Próximo mantenimiento" type="date" value={proximo} onChange={(e) => setProximo(e.target.value)}
          ayuda="Con esta fecha se generan solas las órdenes preventivas." />
      </div>
      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>
          Guardar activo
        </Boton>
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

export default function Activos() {
  const { puedeValidar } = useSesion();
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(0);
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(texto);
      setPagina(0);
    }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  const carga = useCarga(() => listarActivos(q, pagina), [q, pagina]);

  if (creando) return <FormActivo onCancelar={() => setCreando(false)} />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Activos</h1>
        {puedeValidar && (
          <Boton variante="primario" icono={Plus} onClick={() => setCreando(true)}>
            Nuevo activo
          </Boton>
        )}
      </header>

      <Campo etiqueta="Buscar por nombre" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error || !carga.datos ? (
        <ErrorVista mensaje={carga.error ?? 'No se pudieron cargar los activos.'} onReintentar={carga.recargar} />
      ) : carga.datos.filas.length === 0 ? (
        <Vacio
          icono={Boxes}
          titulo={q ? 'No hay activos con ese nombre' : 'Todavía no hay activos'}
          texto={q ? 'Probá con otra palabra.' : 'Cargá los equipos e instalaciones del sector para llevar su historial y programar el preventivo.'}
        />
      ) : (
        <Tabla columnas={COLUMNAS} filas={carga.datos.filas} clave={(a) => a.id} total={carga.datos.total} pagina={pagina} onPagina={setPagina} />
      )}
    </>
  );
}
