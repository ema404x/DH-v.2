'use client';

import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Chips } from '@/components/gestion/Piezas';
import {
  ESTADOS_PRESUPUESTO, abrirDocumento, borrarPresupuesto, cambiarEstadoPresupuesto, crearPresupuesto, fmtTamano, listarPresupuestos, subirDocumento,
  type EstadoPresupuesto, type Presupuesto,
} from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

const TONO: Record<EstadoPresupuesto, string> = { borrador: 'text-suave', enviado: 'text-info', aprobado: 'text-exito', rechazado: 'text-peligro' };

function Subir({ onListo }: { onListo: (cambio: boolean) => void }) {
  const { sectorEfectivo } = useSesion();
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [nombre, setNombre] = useState('');
  const [obra, setObra] = useState<ResultadoBusqueda | null>(null);
  const [obraTexto, setObraTexto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  async function subir() {
    if (!archivo || !sectorEfectivo) return;
    if (archivo.size > 25 * 1024 * 1024) {
      toast.error('El archivo pasa de 25 MB.');
      return;
    }
    setSubiendo(true);
    try {
      const doc = await subirDocumento(sectorEfectivo.id, 'presupuestos', archivo);
      await crearPresupuesto({ nombre: nombre.trim() || archivo.name.replace(/\.[^.]+$/, ''), obra_id: obra?.id ?? null, obra_texto: obra ? null : obraTexto.trim() || null, descripcion: descripcion.trim() || null, archivo: doc });
      toast.success('Presupuesto subido.');
      onListo(true);
    } catch (e) {
      toast.error(limpiarError(e));
      setSubiendo(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Subir un presupuesto</h1>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Volver a la lista</Boton>
      </header>
      <section className="tarjeta max-w-3xl space-y-4">
        <input ref={entrada} type="file" accept=".xlsx,.xls,.xlsm,.csv,.pdf,.ods" hidden onChange={(e) => { const a = e.target.files?.[0] ?? null; setArchivo(a); if (a && !nombre) setNombre(a.name.replace(/\.[^.]+$/, '')); }} />
        <div className="flex flex-wrap items-center gap-3">
          <Boton icono={Paperclip} onClick={() => entrada.current?.click()}>{archivo ? 'Cambiar archivo' : 'Elegir la planilla'}</Boton>
          {archivo && <span className="text-sm">{archivo.name} · {fmtTamano(archivo.size)}</span>}
        </div>
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <BuscadorRemoto etiqueta="Obra" tabla="obras" valor={obra} onCambio={setObra} />
        {!obra && <Campo etiqueta="O, si la obra no está cargada, su nombre" value={obraTexto} onChange={(e) => setObraTexto(e.target.value)} />}
        <Area etiqueta="Descripción" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        <Boton variante="primario" icono={Upload} cargando={subiendo} disabled={!archivo} onClick={subir}>Subir presupuesto</Boton>
      </section>
    </div>
  );
}

// Presupuestos de obra: un repositorio de planillas con su estado. En la v1 esto era lo único que funcionaba
// del módulo de presupuestos (el cálculo por ítems nunca se terminó de conectar).
export default function Presupuestos() {
  const { puedeValidar, esGerencia } = useSesion();
  const carga = useCarga(listarPresupuestos, []);
  const [subiendo, setSubiendo] = useState(false);
  const [estado, setEstado] = useState<EstadoPresupuesto | null>(null);
  const [texto, setTexto] = useState('');
  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (carga.datos ?? []).filter((p) => (!estado || p.estado === estado) && (!t || [p.nombre, p.obra_titulo, p.obra_texto, p.archivo_nombre].some((v) => v?.toLowerCase().includes(t))));
  }, [carga.datos, estado, texto]);

  async function cambiar(p: Presupuesto, nuevo: EstadoPresupuesto) {
    try {
      await cambiarEstadoPresupuesto(p.id, nuevo);
      carga.setDatos((carga.datos ?? []).map((x) => (x.id === p.id ? { ...x, estado: nuevo } : x)));
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  async function borrar(p: Presupuesto) {
    if (!window.confirm(`¿Borrar "${p.nombre}" y su archivo? No se puede deshacer.`)) return;
    try {
      await borrarPresupuesto(p);
      toast.success('Presupuesto borrado.');
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  if (subiendo) return <Subir onListo={(cambio) => { setSubiendo(false); if (cambio) void carga.recargar(); }} />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Presupuestos de obra</h1>
        {puedeValidar && <Boton variante="primario" icono={Plus} onClick={() => setSubiendo(true)}>Subir presupuesto</Boton>}
      </header>
      <Chips opciones={(Object.keys(ESTADOS_PRESUPUESTO) as EstadoPresupuesto[]).map((e) => ({ id: e, texto: ESTADOS_PRESUPUESTO[e] }))} valor={estado} onCambio={setEstado} />
      <Campo etiqueta="Buscar por nombre u obra" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={4} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : lista.length === 0 ? (
        <Vacio icono={FileSpreadsheet} titulo={(carga.datos ?? []).length === 0 ? 'Todavía no hay presupuestos' : 'No hay presupuestos con ese filtro'}
          texto={(carga.datos ?? []).length === 0 ? 'Subí las planillas de presupuesto de cada obra para tenerlas en un solo lugar, con su estado.' : 'Probá con otro estado u otro texto.'} />
      ) : (
        <ul className="space-y-2">
          {lista.map((p) => (
            <li key={p.id} className="tarjeta flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <button type="button" className="min-h-control text-left font-medium text-primario hover:underline"
                  onClick={() => abrirDocumento(p.archivo_path).catch((e) => toast.error(limpiarError(e)))}>
                  {p.nombre}
                </button>
                <p className="text-sm text-suave">
                  {[p.obra_titulo ?? p.obra_texto, p.archivo_nombre, fmtTamano(p.archivo_tamano), p.creado_por_nombre, new Date(p.created_at).toLocaleDateString('es-AR')].filter(Boolean).join(' · ')}
                </p>
                {p.descripcion && <p className="text-sm">{p.descripcion}</p>}
              </div>
              <div className="flex items-end gap-2">
                {puedeValidar ? (
                  <div className="w-40"><Selector etiqueta="Estado" value={p.estado} opciones={ESTADOS_PRESUPUESTO} onChange={(e) => cambiar(p, e.target.value as EstadoPresupuesto)} /></div>
                ) : (
                  <span className={`font-medium ${TONO[p.estado]}`}>{ESTADOS_PRESUPUESTO[p.estado]}</span>
                )}
                {esGerencia && (
                  <button type="button" aria-label={`Borrar ${p.nombre}`} onClick={() => borrar(p)}
                    className="flex min-h-control min-w-control items-center justify-center rounded text-suave hover:bg-elevado hover:text-peligro">
                    <Trash2 className="h-5 w-5" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
