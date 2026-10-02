'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { AlarmClock, CheckCircle2, Download, Hand, PackageX, Undo2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo } from '@/components/Campos';
import { AvisoBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Indicador, Indicadores, Pestanas, descargarCSV } from '@/components/gestion/Piezas';
import { ESTADOS_PRESTAMO, cant, darPorPerdido, devolver, listarPrestamos, prestar, type Prestamo } from '@/lib/panol';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

const dia = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : null);

function Prestar({ onListo }: { onListo: () => void }) {
  const [material, setMaterial] = useState<ResultadoBusqueda | null>(null);
  const [empleado, setEmpleado] = useState<ResultadoBusqueda | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const [devolverEl, setDevolverEl] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const n = Number(cantidad.replace(',', '.'));
    if (!material || !empleado) {
      toast.error('Elegí la herramienta y a quién se le presta.');
      return;
    }
    if (!(n > 0)) {
      toast.error('La cantidad tiene que ser mayor a cero.');
      return;
    }
    setGuardando(true);
    try {
      await prestar({ material: material.id, cantidad: n, empleado: empleado.id, devolverEl: devolverEl || null, ot: null, notas: notas.trim() || null });
      toast.success(`${material.etiqueta} prestado a ${empleado.etiqueta}.`);
      setMaterial(null); setEmpleado(null); setCantidad('1'); setDevolverEl(''); setNotas('');
      onListo();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="tarjeta space-y-4">
      <h2>Prestar una herramienta</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <BuscadorRemoto etiqueta="Herramienta" tabla="materiales" valor={material} onCambio={setMaterial} ayuda="Tiene que estar marcada como herramienta que se presta." />
        <BuscadorRemoto etiqueta="A quién" tabla="empleados" valor={empleado} onCambio={setEmpleado} />
        <Campo etiqueta="Cantidad" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        <Campo etiqueta="La devuelve el (opcional)" type="date" value={devolverEl} onChange={(e) => setDevolverEl(e.target.value)} />
      </div>
      <Campo etiqueta="Para qué (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
      <Boton type="submit" variante="primario" icono={Hand} cargando={guardando}>Prestar</Boton>
    </form>
  );
}

// Préstamo de herramientas (nuevo en v2: la v1 no lo tenía). Sale con nombre y fecha; vuelve o se da por perdida.
export default function Prestamos() {
  const { puedeValidar, esGerencia } = useSesion();
  const [pestana, setPestana] = useState<'abiertos' | 'todos'>('abiertos');
  const carga = useCarga(() => listarPrestamos(pestana === 'abiertos'), [pestana]);
  const [texto, setTexto] = useState('');
  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (carga.datos ?? []).filter((p) => !t || [p.material_nombre, p.material_codigo, p.empleado_nombre, p.ot_codigo, p.obra_titulo].some((v) => v?.toLowerCase().includes(t)));
  }, [carga.datos, texto]);
  const abiertos = (carga.datos ?? []).filter((p) => p.estado === 'prestado');
  const vencidos = abiertos.filter((p) => p.vencido).length;

  async function accion(fn: () => Promise<void>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  function volvio(p: Prestamo) {
    const notas = window.prompt(`${p.material_nombre} vuelve de ${p.empleado_nombre}. ¿Alguna observación? (opcional)`, '');
    if (notas === null) return;
    void accion(() => devolver(p.id, notas.trim() || null), 'Devuelta: vuelve al stock.');
  }

  function perdida(p: Prestamo) {
    const motivo = window.prompt(`¿Qué pasó con ${p.material_nombre}? (se da por perdida; el stock no vuelve)`, '');
    if (!motivo?.trim()) return;
    void accion(() => darPorPerdido(p.id, motivo.trim()), 'Préstamo cerrado como perdido.');
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Préstamo de herramientas</h1>
        <Boton icono={Download} disabled={lista.length === 0} onClick={() => descargarCSV('prestamos.csv',
          ['N°', 'Herramienta', 'Cantidad', 'Quién', 'Prestada', 'Devolver el', 'Estado', 'Vencido', 'Cerrado', 'Notas', 'Cierre'],
          lista.map((p) => [p.numero, p.material_nombre, Number(p.cantidad), p.empleado_nombre, dia(p.created_at), p.devolver_el, ESTADOS_PRESTAMO[p.estado], p.vencido ? 'Sí' : 'No',
            dia(p.devuelto_at), p.notas, p.notas_cierre]))}>Exportar</Boton>
      </header>

      <Indicadores>
        <Indicador titulo="Prestadas ahora" valor={abiertos.length} icono={Wrench} />
        <Indicador titulo="Vencidas" valor={vencidos} icono={AlarmClock} tono={vencidos > 0 ? 'peligro' : 'neutro'} />
        <Indicador titulo="Personas con herramientas" valor={new Set(abiertos.map((p) => p.empleado_id)).size} icono={Hand} />
        <Indicador titulo="Devueltas (en la lista)" valor={(carga.datos ?? []).filter((p) => p.estado === 'devuelto').length} icono={CheckCircle2} tono="exito" />
      </Indicadores>

      {puedeValidar && <Prestar onListo={carga.recargar} />}

      <Pestanas activa={pestana} onCambio={setPestana} pestanas={[{ id: 'abiertos', texto: 'Prestadas', cuenta: abiertos.length }, { id: 'todos', texto: 'Historial' }]} />
      <Campo etiqueta="Buscar por herramienta, persona u orden" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />

      {carga.cargando && !carga.datos ? <Esqueleto filas={4} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : lista.length === 0 ? (
          <Vacio icono={Wrench} titulo={pestana === 'abiertos' ? 'No hay herramientas prestadas' : 'Todavía no hubo préstamos'}
            texto="Las herramientas que se prestan se marcan en el pañol como “herramienta que se presta”." />
        ) : (
          <ul className="space-y-2">
            {lista.map((p) => (
              <li key={p.id} className={`tarjeta flex flex-wrap items-center justify-between gap-3 ${p.vencido ? 'border-peligro/60' : ''}`}>
                <div className="min-w-0">
                  <p className="font-medium">{p.material_nombre} · {cant(p.cantidad, p.material_unidad)}</p>
                  <p className="text-sm text-suave">
                    {[p.empleado_nombre, `desde el ${dia(p.created_at)}`, p.devolver_el && `devolver el ${dia(p.devolver_el)}`, p.ot_codigo && `Orden ${p.ot_codigo}`, p.notas].filter(Boolean).join(' · ')}
                  </p>
                  {p.estado !== 'prestado' && <p className="text-sm">{ESTADOS_PRESTAMO[p.estado]} el {dia(p.devuelto_at)}{p.notas_cierre && ` · ${p.notas_cierre}`}</p>}
                  {p.vencido && <div className="mt-1"><AvisoBadge texto="Venció la fecha de devolución" tono="peligro" /></div>}
                </div>
                {p.estado === 'prestado' && puedeValidar && (
                  <div className="flex flex-wrap gap-2">
                    <Boton icono={Undo2} onClick={() => volvio(p)}>Volvió</Boton>
                    {esGerencia && <Boton variante="peligro" icono={PackageX} onClick={() => perdida(p)}>Perdida</Boton>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
