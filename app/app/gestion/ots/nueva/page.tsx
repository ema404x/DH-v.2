'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton, BotonEnlace } from '@/components/Boton';
import { Area, Campo, Casilla, Selector, oNull } from '@/components/Campos';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { crearOT, obtenerPlantilla } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';
import { useSesion } from '@/lib/sesion';
import { PRIORIDADES, TIPOS_OT, type Prioridad, type ResultadoBusqueda, type TareaChecklist, type TipoOT } from '@/lib/types';

// Alta de una orden. Ubicación, activo, operario y plantilla se eligen con búsqueda remota
// (10 resultados por vez): no se baja ninguna tabla entera para armar el formulario.
export default function NuevaOrden() {
  const router = useRouter();
  const { sectorEfectivo } = useSesion();
  const [plantilla, setPlantilla] = useState<ResultadoBusqueda | null>(null);
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipo, setTipo] = useState<TipoOT>('mantenimiento_correctivo');
  const [prioridad, setPrioridad] = useState<Prioridad>('media');
  const [ubicacion, setUbicacion] = useState<ResultadoBusqueda | null>(null);
  const [activo, setActivo] = useState<ResultadoBusqueda | null>(null);
  const [asignado, setAsignado] = useState<ResultadoBusqueda | null>(null);
  const [fecha, setFecha] = useState('');
  const [horas, setHoras] = useState('');
  const [tareas, setTareas] = useState<TareaChecklist[]>([]);
  const [nuevaTarea, setNuevaTarea] = useState('');
  const [fotos, setFotos] = useState(false);
  const [obra, setObra] = useState<ResultadoBusqueda | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Desde una obra: /gestion/ots/nueva?obra=<id>&obraTitulo=<título>&ubicacion=<id>&ubicacionNombre=<nombre>
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const id = p.get('obra');
    if (id) setObra({ id, etiqueta: p.get('obraTitulo') ?? 'Obra', detalle: null });
    const u = p.get('ubicacion');
    if (u) setUbicacion({ id: u, etiqueta: p.get('ubicacionNombre') ?? 'Ubicación', detalle: null });
  }, []);

  async function usarPlantilla(p: ResultadoBusqueda | null) {
    setPlantilla(p);
    if (!p) return;
    try {
      const t = await obtenerPlantilla(p.id);
      setTitulo(t.titulo);
      setDescripcion(t.descripcion ?? '');
      setTipo(t.tipo);
      setPrioridad(t.prioridad);
      setHoras(t.horas_estimadas ? String(t.horas_estimadas) : '');
      setFotos(t.requiere_fotos);
      setTareas((t.checklist ?? []).map((c) => ({ id: crypto.randomUUID(), tarea: c.tarea, hecho: false })));
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  function agregarTarea() {
    const texto = nuevaTarea.trim();
    if (!texto) return;
    setTareas((a) => [...a, { id: crypto.randomUUID(), tarea: texto, hecho: false }]);
    setNuevaTarea('');
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const id = await crearOT({
        titulo: titulo.trim(),
        descripcion: oNull(descripcion),
        tipo,
        prioridad,
        ubicacion_id: ubicacion?.id ?? null,
        activo_id: activo?.id ?? null,
        asignado_a: asignado?.id ?? null,
        fecha_programada: oNull(fecha),
        horas_estimadas: horas ? Number(horas.replace(',', '.')) : null,
        checklist: tareas,
        requiere_fotos: fotos,
        obra_id: obra?.id ?? null,
      });
      toast.success('Orden creada.');
      router.push(`/ot/${id}`);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <>
      <BotonEnlace href="/gestion/ots" variante="fantasma" icono={ArrowLeft}>
        Órdenes
      </BotonEnlace>
      <header>
        <h1>Nueva orden de trabajo</h1>
        <p className="text-suave">Se crea en el sector {sectorEfectivo?.nombre ?? '(sin sector)'}.</p>
      </header>

      <form onSubmit={guardar} className="max-w-3xl space-y-5">
        <section className="tarjeta space-y-4">
          <BuscadorRemoto etiqueta="Plantilla (opcional)" tabla="plantillas_ot" valor={plantilla} onCambio={usarPlantilla}
            ayuda="Completa el título, el tipo y la lista de tareas. Después se puede ajustar." />
          <Campo etiqueta="Título" required value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Selector etiqueta="Tipo de trabajo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoOT)} opciones={TIPOS_OT} />
            <Selector etiqueta="Prioridad" value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)} opciones={PRIORIDADES} />
          </div>
          <Area etiqueta="Descripción del trabajo" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </section>

        <section className="tarjeta space-y-4">
          <h2>Dónde y quién</h2>
          <BuscadorRemoto etiqueta="Ubicación" tabla="ubicaciones" valor={ubicacion} onCambio={setUbicacion} />
          <BuscadorRemoto etiqueta="Obra (opcional)" tabla="obras" valor={obra} onCambio={setObra} ayuda="La orden queda dentro de la obra y se cuenta en ella." />
          <BuscadorRemoto etiqueta="Activo o equipo (opcional)" tabla="activos" valor={activo} onCambio={setActivo} />
          <BuscadorRemoto etiqueta="Asignar a (opcional)" tabla="perfiles" valor={asignado} onCambio={setAsignado}
            ayuda="Si queda sin asignar, la toma el primero que la inicie." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Fecha programada" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <Campo etiqueta="Horas estimadas" inputMode="decimal" value={horas} onChange={(e) => setHoras(e.target.value)} />
          </div>
        </section>

        <section className="tarjeta space-y-4">
          <h2>Lista de tareas</h2>
          {tareas.length === 0 ? (
            <p className="text-suave">Sin tareas. El operario va a poder finalizar la orden sin marcar nada.</p>
          ) : (
            <ol className="space-y-2">
              {tareas.map((t, n) => (
                <li key={t.id} className="flex items-center justify-between gap-2 rounded border bg-elevado/40 pl-3">
                  <span>{n + 1}. {t.tarea}</span>
                  <Boton variante="fantasma" icono={Trash2} onClick={() => setTareas((a) => a.filter((x) => x.id !== t.id))}>
                    Quitar
                  </Boton>
                </li>
              ))}
            </ol>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Campo etiqueta="Nueva tarea" value={nuevaTarea} onChange={(e) => setNuevaTarea(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarTarea(); } }} />
            </div>
            <Boton icono={Plus} onClick={agregarTarea}>Agregar</Boton>
          </div>
          <Casilla etiqueta="Pedir al menos una foto para poder finalizar" checked={fotos} onChange={(e) => setFotos(e.target.checked)} />
        </section>

        <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>
          Crear orden
        </Boton>
      </form>
    </>
  );
}
