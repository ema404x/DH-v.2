'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { MapPin, Pencil, Plus, QrCode, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo, Casilla, oNull } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { QRImprimible } from '@/components/gestion/QRImprimible';
import { Tabla, type Columna } from '@/components/gestion/Tabla';
import { crearUbicacion, guardarUbicacion, listarUbicaciones } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { Ubicacion } from '@/lib/types';

function FormUbicacion({ ubicacion, onGuardada, onCancelar }: { ubicacion: Ubicacion | null; onGuardada: (u: Ubicacion) => void; onCancelar: () => void }) {
  const u0 = ubicacion;
  const [nombre, setNombre] = useState(u0?.nombre ?? '');
  const [codigo, setCodigo] = useState(u0?.codigo ?? '');
  const [direccion, setDireccion] = useState(u0?.direccion ?? '');
  const [zona, setZona] = useState(u0?.zona ?? '');
  const [activa, setActiva] = useState(u0?.activa ?? true);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const datos = { nombre: nombre.trim(), codigo: oNull(codigo), direccion: oNull(direccion), zona: oNull(zona) };
    try {
      const u = u0 ? await guardarUbicacion(u0.id, { ...datos, activa }) : await crearUbicacion(datos);
      toast.success(u0 ? 'Ubicación guardada.' : 'Ubicación creada. Ya podés imprimir su QR.');
      onGuardada(u);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="tarjeta space-y-4">
      <h2>{u0 ? `Editar ${u0.nombre}` : 'Nueva ubicación'}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Campo etiqueta="Nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Campo etiqueta="Código o ubicación técnica" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        <Campo etiqueta="Dirección" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
        <Campo etiqueta="Zona o comuna" value={zona} onChange={(e) => setZona(e.target.value)} />
      </div>
      {u0 && <Casilla etiqueta="Activa (desmarcala si el lugar ya no se atiende: deja de aparecer al buscar; su QR y su historia siguen)" checked={activa} onChange={(e) => setActiva(e.target.checked)} />}
      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>
          Guardar ubicación
        </Boton>
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

export default function Ubicaciones() {
  const { esGerencia } = useSesion();
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(0);
  const [formulario, setFormulario] = useState<{ ubicacion: Ubicacion | null } | null>(null);
  const [conQR, setConQR] = useState<Ubicacion | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(texto);
      setPagina(0);
    }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  const carga = useCarga(() => listarUbicaciones(q, pagina), [q, pagina]);

  const columnas: Columna<Ubicacion>[] = [
    {
      titulo: 'Ubicación',
      celda: (u) => (
        <>
          <span className={`font-medium ${u.activa ? '' : 'text-suave line-through'}`}>{u.nombre}</span>
          {u.codigo && <span className="block text-xs text-suave">{u.codigo}{u.activa ? '' : ' · inactiva'}</span>}
        </>
      ),
    },
    { titulo: 'Dirección', celda: (u) => u.direccion ?? '—', secundaria: true },
    { titulo: 'Zona', celda: (u) => u.zona ?? '—', secundaria: true },
    {
      titulo: 'Acciones',
      celda: (u) => (
        <div className="flex flex-wrap gap-1">
          <Boton variante="fantasma" icono={QrCode} onClick={() => setConQR(u)}>
            Ver QR
          </Boton>
          {esGerencia && (
            <Boton variante="fantasma" icono={Pencil} onClick={() => setFormulario({ ubicacion: u })}>
              Editar
            </Boton>
          )}
        </div>
      ),
    },
  ];

  if (formulario) {
    return (
      <FormUbicacion
        ubicacion={formulario.ubicacion}
        onCancelar={() => setFormulario(null)}
        onGuardada={(u) => {
          const nueva = !formulario.ubicacion;
          setFormulario(null);
          if (nueva) setConQR(u);
          void carga.recargar();
        }}
      />
    );
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Ubicaciones</h1>
        {esGerencia && (
          <Boton variante="primario" icono={Plus} onClick={() => setFormulario({ ubicacion: null })}>
            Nueva ubicación
          </Boton>
        )}
      </header>

      {conQR && (
        <section className="tarjeta space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2>{conQR.nombre}</h2>
              <p className="text-suave">Pegá este QR en el lugar. Al escanearlo, el operario ve las órdenes abiertas de esta ubicación.</p>
            </div>
            <Boton variante="fantasma" icono={X} onClick={() => setConQR(null)}>
              Cerrar
            </Boton>
          </div>
          <QRImprimible token={conQR.qr_token} titulo={conQR.nombre} subtitulo={conQR.direccion} />
        </section>
      )}

      <Campo etiqueta="Buscar por nombre" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error || !carga.datos ? (
        <ErrorVista mensaje={carga.error ?? 'No se pudieron cargar las ubicaciones.'} onReintentar={carga.recargar} />
      ) : carga.datos.filas.length === 0 ? (
        <Vacio
          icono={MapPin}
          titulo={q ? 'No hay ubicaciones con ese nombre' : 'Todavía no hay ubicaciones'}
          texto={q ? 'Probá con otra palabra.' : 'Cargá los edificios o lugares donde se trabaja. Cada uno tiene su QR para pegar en el sitio.'}
        />
      ) : (
        <Tabla columnas={columnas} filas={carga.datos.filas} clave={(u) => u.id} total={carga.datos.total} pagina={pagina} onPagina={setPagina} />
      )}
    </>
  );
}
