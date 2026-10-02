'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ClipboardList, Copy, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Casilla, Selector, oNull } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { Tabla, type Columna } from '@/components/gestion/Tabla';
import { borrarPlantilla, guardarPlantilla, listarPlantillas } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { PRIORIDADES, TIPOS_OT, type Plantilla, type Prioridad, type TareaChecklist, type TipoOT } from '@/lib/types';

function Formulario({ plantilla, copia, puedeEditar, onListo }: { plantilla: Plantilla | null; copia: boolean; puedeEditar: boolean; onListo: (cambio: boolean) => void }) {
  const p = plantilla;
  const [nombre, setNombre] = useState(p ? (copia ? `${p.nombre} (copia)` : p.nombre) : '');
  const [titulo, setTitulo] = useState(p?.titulo ?? '');
  const [tipo, setTipo] = useState<TipoOT>(p?.tipo ?? 'mantenimiento_correctivo');
  const [prioridad, setPrioridad] = useState<Prioridad>(p?.prioridad ?? 'media');
  const [descripcion, setDescripcion] = useState(p?.descripcion ?? '');
  const [horas, setHoras] = useState(p?.horas_estimadas ? String(p.horas_estimadas) : '');
  const [fotos, setFotos] = useState(p?.requiere_fotos ?? false);
  const [tareas, setTareas] = useState<TareaChecklist[]>((p?.checklist ?? []).map((t) => ({ id: t.id ?? crypto.randomUUID(), tarea: t.tarea, hecho: false })));
  const [nueva, setNueva] = useState('');
  const [guardando, setGuardando] = useState(false);
  const id = p && !copia ? p.id : null;

  function agregar() {
    const t = nueva.trim();
    if (!t) return;
    setTareas((a) => [...a, { id: crypto.randomUUID(), tarea: t, hecho: false }]);
    setNueva('');
  }
  const mover = (i: number, d: -1 | 1) => setTareas((a) => {
    const b = [...a];
    [b[i], b[i + d]] = [b[i + d], b[i]];
    return b;
  });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const h = horas.trim() ? Number(horas.replace(',', '.')) : null;
    if (h !== null && (Number.isNaN(h) || h <= 0)) {
      toast.error('Las horas estimadas tienen que ser un número mayor a cero.');
      return;
    }
    setGuardando(true);
    try {
      await guardarPlantilla(id, {
        nombre: nombre.trim(), titulo: titulo.trim(), tipo, prioridad, descripcion: oNull(descripcion), horas_estimadas: h,
        checklist: tareas.map((t) => ({ id: t.id, tarea: t.tarea, hecho: false })), requiere_fotos: fotos,
      });
      toast.success(id ? 'Plantilla guardada.' : 'Plantilla creada.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!id || !window.confirm(`¿Borrar la plantilla "${p?.nombre}"? Las órdenes ya creadas con ella no cambian.`)) return;
    try {
      await borrarPlantilla(id);
      toast.success('Plantilla borrada.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  return (
    <form onSubmit={guardar} className="max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>{id ? p?.nombre : copia ? 'Copia de plantilla' : 'Nueva plantilla'}</h1>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Volver a la lista</Boton>
      </header>
      <fieldset disabled={!puedeEditar} className="space-y-4">
        <section className="tarjeta space-y-4">
          <Campo etiqueta="Nombre de la plantilla" required value={nombre} onChange={(e) => setNombre(e.target.value)} ayuda="Cómo la buscás al crear una orden." />
          <Campo etiqueta="Título de la orden" required value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Selector etiqueta="Tipo de trabajo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoOT)} opciones={TIPOS_OT} />
            <Selector etiqueta="Prioridad" value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)} opciones={PRIORIDADES} />
            <Campo etiqueta="Horas estimadas" inputMode="decimal" value={horas} onChange={(e) => setHoras(e.target.value)} />
          </div>
          <Area etiqueta="Descripción del trabajo" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          <Casilla etiqueta="Pedir al menos una foto para poder finalizar" checked={fotos} onChange={(e) => setFotos(e.target.checked)} />
        </section>
        <section className="tarjeta space-y-4">
          <h2>Lista de tareas</h2>
          {tareas.length === 0 ? <p className="text-suave">Sin tareas.</p> : (
            <ol className="space-y-2">
              {tareas.map((t, i) => (
                <li key={t.id} className="flex items-center gap-1 rounded border bg-elevado/40 pl-3">
                  <span className="flex-1">{i + 1}. {t.tarea}</span>
                  <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)} className="flex min-h-control min-w-control items-center justify-center rounded text-suave hover:bg-elevado disabled:opacity-30"><ArrowUp className="h-5 w-5" aria-hidden /></button>
                  <button type="button" aria-label="Bajar" disabled={i === tareas.length - 1} onClick={() => mover(i, 1)} className="flex min-h-control min-w-control items-center justify-center rounded text-suave hover:bg-elevado disabled:opacity-30"><ArrowDown className="h-5 w-5" aria-hidden /></button>
                  <button type="button" aria-label={`Quitar ${t.tarea}`} onClick={() => setTareas((a) => a.filter((x) => x.id !== t.id))} className="flex min-h-control min-w-control items-center justify-center rounded text-suave hover:bg-elevado hover:text-peligro"><Trash2 className="h-5 w-5" aria-hidden /></button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Campo etiqueta="Nueva tarea" value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } }} />
            </div>
            <Boton icono={Plus} onClick={agregar}>Agregar</Boton>
          </div>
        </section>
      </fieldset>
      {puedeEditar && (
        <div className="flex flex-wrap justify-between gap-3">
          <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>{id ? 'Guardar plantilla' : 'Crear plantilla'}</Boton>
          {id && <Boton variante="peligro" icono={Trash2} onClick={borrar}>Borrar</Boton>}
        </div>
      )}
    </form>
  );
}

// Plantillas de orden de trabajo: título, tipo, prioridad y lista de tareas listos para reusar al crear una orden.
export default function Plantillas() {
  const { esGerencia } = useSesion();
  const carga = useCarga(listarPlantillas, []);
  const [vista, setVista] = useState<{ plantilla: Plantilla | null; copia: boolean } | null>(null);
  const [texto, setTexto] = useState('');
  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (carga.datos ?? []).filter((p) => !t || p.nombre.toLowerCase().includes(t) || p.titulo.toLowerCase().includes(t));
  }, [carga.datos, texto]);

  const columnas: Columna<Plantilla>[] = [
    {
      titulo: 'Plantilla',
      celda: (p) => (
        <button type="button" className="block min-h-control text-left font-medium text-primario hover:underline" onClick={() => setVista({ plantilla: p, copia: false })}>
          {p.nombre}
          <span className="block text-xs font-normal text-suave">{p.titulo}</span>
        </button>
      ),
    },
    { titulo: 'Tipo', celda: (p) => TIPOS_OT[p.tipo], secundaria: true },
    { titulo: 'Tareas', celda: (p) => p.checklist.length, numerica: true },
    { titulo: 'Horas', celda: (p) => (p.horas_estimadas ? Number(p.horas_estimadas).toLocaleString('es-AR') : '—'), numerica: true, secundaria: true },
    {
      titulo: '',
      celda: (p) => esGerencia && (
        <button type="button" aria-label={`Duplicar ${p.nombre}`} onClick={() => setVista({ plantilla: p, copia: true })}
          className="flex min-h-control min-w-control items-center justify-center rounded text-suave hover:bg-elevado hover:text-texto">
          <Copy className="h-5 w-5" aria-hidden />
        </button>
      ),
    },
  ];

  if (vista) return <Formulario plantilla={vista.plantilla} copia={vista.copia} puedeEditar={esGerencia} onListo={(cambio) => { setVista(null); if (cambio) void carga.recargar(); }} />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Plantillas de orden</h1>
        {esGerencia && <Boton variante="primario" icono={Plus} onClick={() => setVista({ plantilla: null, copia: false })}>Nueva plantilla</Boton>}
      </header>
      <Campo etiqueta="Buscar por nombre o título" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
      {carga.cargando && !carga.datos ? <Esqueleto filas={4} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : lista.length === 0 ? (
          <Vacio icono={ClipboardList} titulo={(carga.datos ?? []).length === 0 ? 'Todavía no hay plantillas' : 'No hay plantillas con ese texto'}
            texto="Una plantilla guarda el título, el tipo y la lista de tareas de un trabajo que se repite. Al crear una orden se elige y se completa sola." />
        ) : <Tabla columnas={columnas} filas={lista} clave={(p) => p.id} />}
    </>
  );
}
