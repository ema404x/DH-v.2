'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Download, Plus, Save, Star, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Selector, oNull } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { descargarCSV } from '@/components/gestion/Piezas';
import { Tabla, type Columna } from '@/components/gestion/Tabla';
import { ESTADOS_PROVEEDOR, RUBROS, borrarProveedor, guardarProveedor, listarProveedores, type EstadoProveedor, type Proveedor } from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

function Estrellas({ n }: { n: number | null }) {
  if (!n) return <span className="text-suave">—</span>;
  return (
    <span className="inline-flex" aria-label={`${n} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`h-4 w-4 ${i <= n ? 'fill-alerta text-alerta' : 'text-borde'}`} aria-hidden />)}
    </span>
  );
}

function Formulario({ proveedor, puedeEditar, onListo }: { proveedor: Proveedor | null; puedeEditar: boolean; onListo: (cambio: boolean) => void }) {
  const p = proveedor;
  const [f, setF] = useState({
    nombre: p?.nombre ?? '', rubro: p?.rubro ?? 'otro', zona: p?.zona ?? '', cuit: p?.cuit ?? '', contacto: p?.contacto ?? '',
    email: p?.email ?? '', telefono: p?.telefono ?? '', direccion: p?.direccion ?? '', localidad: p?.localidad ?? '',
    estado: p?.estado ?? ('activo' as EstadoProveedor), valoracion: p?.valoracion ? String(p.valoracion) : '',
    notas_valoracion: p?.notas_valoracion ?? '', notas: p?.notas ?? '',
  });
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value })) });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await guardarProveedor(p?.id ?? null, {
        nombre: f.nombre.trim(), rubro: f.rubro, zona: oNull(f.zona), cuit: oNull(f.cuit), contacto: oNull(f.contacto), email: oNull(f.email),
        telefono: oNull(f.telefono), direccion: oNull(f.direccion), localidad: oNull(f.localidad), estado: f.estado,
        valoracion: f.valoracion ? Number(f.valoracion) : null, notas_valoracion: oNull(f.notas_valoracion), notas: oNull(f.notas),
      });
      toast.success(p ? 'Proveedor guardado.' : 'Proveedor creado.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!p || !window.confirm(`¿Borrar a ${p.nombre}? Si tiene obras asociadas, no se va a poder: en ese caso marcalo como inactivo.`)) return;
    try {
      await borrarProveedor(p.id);
      toast.success('Proveedor borrado.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>{p ? p.nombre : 'Nuevo proveedor'}</h1>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Volver a la lista</Boton>
      </header>
      <fieldset disabled={!puedeEditar} className="space-y-4">
        <section className="tarjeta space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Campo etiqueta="Razón social o nombre" required {...campo('nombre')} />
            <Selector etiqueta="Rubro" opciones={RUBROS} {...campo('rubro')} />
            <Selector etiqueta="Estado" opciones={ESTADOS_PROVEEDOR} {...campo('estado')} />
            <Campo etiqueta="CUIT" {...campo('cuit')} />
            <Campo etiqueta="Persona de contacto" {...campo('contacto')} />
            <Campo etiqueta="Zona o comuna" {...campo('zona')} />
            <Campo etiqueta="Teléfono" type="tel" {...campo('telefono')} />
            <Campo etiqueta="Correo" type="email" {...campo('email')} />
            <Campo etiqueta="Localidad" {...campo('localidad')} />
          </div>
          <Campo etiqueta="Dirección" {...campo('direccion')} />
        </section>
        <section className="tarjeta space-y-4">
          <h2>Valoración</h2>
          <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
            <Selector etiqueta="Puntaje" opciones={{ '': 'Sin valorar', 1: '1 — Malo', 2: '2 — Regular', 3: '3 — Bueno', 4: '4 — Muy bueno', 5: '5 — Excelente' }} {...campo('valoracion')} />
            <Campo etiqueta="Por qué" {...campo('notas_valoracion')} />
          </div>
          <Area etiqueta="Notas" {...campo('notas')} />
        </section>
      </fieldset>
      {puedeEditar && (
        <div className="flex flex-wrap justify-between gap-3">
          <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar proveedor</Boton>
          {p && <Boton variante="peligro" icono={Trash2} onClick={borrar}>Borrar</Boton>}
        </div>
      )}
    </form>
  );
}

// Directorio de proveedores. En la v1 esta pantalla se llamaba "Clientes", pero guardaba proveedores.
export default function Proveedores() {
  const { esGerencia } = useSesion();
  const carga = useCarga(listarProveedores, []);
  const [vista, setVista] = useState<{ proveedor: Proveedor | null } | null>(null);
  const [texto, setTexto] = useState('');
  const [rubro, setRubro] = useState('');
  const [estado, setEstado] = useState('activo');

  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (carga.datos ?? []).filter((p) => (!rubro || p.rubro === rubro) && (!estado || p.estado === estado)
      && (!t || [p.nombre, p.cuit, p.contacto, p.email, p.localidad].some((v) => v?.toLowerCase().includes(t))));
  }, [carga.datos, texto, rubro, estado]);

  const columnas: Columna<Proveedor>[] = [
    {
      titulo: 'Proveedor',
      celda: (p) => (
        <button type="button" className="block min-h-control text-left font-medium text-primario hover:underline" onClick={() => setVista({ proveedor: p })}>
          {p.nombre}
          <span className="block text-xs font-normal text-suave">{[RUBROS[p.rubro], p.cuit && `CUIT ${p.cuit}`].filter(Boolean).join(' · ')}</span>
        </button>
      ),
    },
    { titulo: 'Contacto', celda: (p) => <>{p.contacto ?? '—'}<span className="block text-xs text-suave">{[p.telefono, p.email].filter(Boolean).join(' · ')}</span></>, secundaria: true },
    { titulo: 'Localidad', celda: (p) => p.localidad ?? '—', secundaria: true },
    { titulo: 'Valoración', celda: (p) => <Estrellas n={p.valoracion} /> },
    { titulo: 'Estado', celda: (p) => <span className={p.estado === 'activo' ? 'text-exito' : p.estado === 'suspendido' ? 'text-peligro' : 'text-suave'}>{ESTADOS_PROVEEDOR[p.estado]}</span> },
  ];

  if (vista) {
    return <Formulario proveedor={vista.proveedor} puedeEditar={esGerencia} onListo={(cambio) => { setVista(null); if (cambio) void carga.recargar(); }} />;
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Proveedores</h1>
        <div className="flex flex-wrap gap-2">
          <Boton icono={Download} disabled={lista.length === 0} onClick={() => descargarCSV('proveedores.csv',
            ['Nombre', 'Rubro', 'CUIT', 'Contacto', 'Teléfono', 'Correo', 'Dirección', 'Localidad', 'Zona', 'Estado', 'Valoración'],
            lista.map((p) => [p.nombre, RUBROS[p.rubro], p.cuit, p.contacto, p.telefono, p.email, p.direccion, p.localidad, p.zona, ESTADOS_PROVEEDOR[p.estado], p.valoracion]))}>
            Exportar
          </Boton>
          {esGerencia && <Boton variante="primario" icono={Plus} onClick={() => setVista({ proveedor: null })}>Nuevo proveedor</Boton>}
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-[1fr_14rem_12rem]">
        <Campo etiqueta="Buscar por nombre, CUIT, contacto o localidad" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <Selector etiqueta="Rubro" value={rubro} opciones={{ '': 'Todos', ...RUBROS }} onChange={(e) => setRubro(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} opciones={{ '': 'Todos', ...ESTADOS_PROVEEDOR }} onChange={(e) => setEstado(e.target.value)} />
      </div>

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : lista.length === 0 ? (
        <Vacio icono={Truck} titulo={(carga.datos ?? []).length === 0 ? 'Todavía no hay proveedores' : 'No hay proveedores con ese filtro'}
          texto={(carga.datos ?? []).length === 0 ? 'Cargá los proveedores con los que trabajás. Después se eligen desde cada obra.' : 'Probá con otro rubro, otro estado u otro texto.'} />
      ) : (
        <Tabla columnas={columnas} filas={lista} clave={(p) => p.id} />
      )}
    </>
  );
}
