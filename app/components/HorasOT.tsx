'use client';

import { useState, type FormEvent } from 'react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from './Boton';
import { Campo, Selector, oNull } from './Campos';
import { BuscadorRemoto } from './gestion/BuscadorRemoto';
import { limpiarError } from '@/lib/errores';
import { TIPOS_HORA, borrarHoras, cargarHoras, horasDeOT, type TipoHora } from '@/lib/gente';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

const pesos = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const cant = (n: number) => `${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`;
const hoy = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Horas trabajadas en una orden: quién, cuántas y de qué tipo. El costo lo ve solo quien puede leer el
// costo por hora (gerencia). Necesita conexión.
export function HorasOT({ otId }: { otId: string }) {
  const { perfil, puedeValidar } = useSesion();
  const carga = useCarga(() => horasDeOT(otId), [otId]);
  const [agregando, setAgregando] = useState(false);
  const [empleado, setEmpleado] = useState<ResultadoBusqueda | null>(null);
  const [nombre, setNombre] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [horas, setHoras] = useState('1');
  const [tipo, setTipo] = useState<TipoHora>('normal');
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);

  const filas = carga.datos ?? [];
  const total = filas.reduce((t, h) => t + Number(h.horas), 0);
  const costos = filas.filter((h) => h.costo !== null);
  const costo = costos.reduce((t, h) => t + Number(h.costo), 0);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const n = Number(horas.replace(',', '.'));
    if (!empleado && !nombre.trim()) {
      toast.error('Indicá quién hizo las horas.');
      return;
    }
    if (!(n > 0 && n <= 24)) {
      toast.error('Las horas tienen que estar entre 0 y 24.');
      return;
    }
    setGuardando(true);
    try {
      await cargarHoras({ ot_id: otId, empleado_id: empleado?.id ?? null, empleado_nombre: empleado ? null : nombre.trim(), fecha, horas: n, tipo, descripcion: oNull(descripcion) });
      toast.success('Horas cargadas.');
      setAgregando(false);
      setEmpleado(null);
      setNombre('');
      setHoras('1');
      setDescripcion('');
      await carga.recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    try {
      await borrarHoras(id);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  // Sin señal (o antes de aplicar la fase 8 en la base) esta sección no aparece: no frena el trabajo de la orden.
  if (carga.error) return null;

  return (
    <section className="tarjeta space-y-3" aria-label="Horas trabajadas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2"><Clock className="h-5 w-5" aria-hidden />Horas trabajadas</h2>
        {filas.length > 0 && (
          <p className="text-sm text-suave">
            {cant(total)}{costos.length > 0 ? ` · ${pesos(costo)}` : ''}
          </p>
        )}
      </div>

      {filas.length === 0 && !agregando && <p className="text-suave">{carga.cargando ? 'Cargando' : 'Todavía no se cargaron horas en esta orden.'}</p>}
      {filas.length > 0 && (
        <ul className="divide-y">
          {filas.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-medium">{h.empleado_nombre}</p>
                <p className="text-sm text-suave">
                  {[new Date(`${h.fecha}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }), h.tipo !== 'normal' ? TIPOS_HORA[h.tipo] : null, h.descripcion].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="num font-semibold">{cant(h.horas)}</span>
                {(puedeValidar || h.created_by === perfil?.id) && (
                  <button type="button" onClick={() => borrar(h.id)} aria-label={`Borrar las horas de ${h.empleado_nombre}`}
                    className="flex h-11 w-11 items-center justify-center rounded text-suave hover:bg-elevado hover:text-peligro">
                    <Trash2 className="h-5 w-5" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {agregando ? (
        <form onSubmit={guardar} className="space-y-3 rounded border bg-elevado/40 p-3">
          <BuscadorRemoto etiqueta="Quién" tabla="empleados" valor={empleado} onCambio={setEmpleado} />
          {!empleado && <Campo etiqueta="O escribí el nombre (si no tiene ficha)" value={nombre} onChange={(e) => setNombre(e.target.value)} />}
          <div className="grid grid-cols-3 gap-3">
            <Campo etiqueta="Fecha" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <Campo etiqueta="Horas" inputMode="decimal" required value={horas} onChange={(e) => setHoras(e.target.value)} />
            <Selector etiqueta="Tipo" opciones={TIPOS_HORA} value={tipo} onChange={(e) => setTipo(e.target.value as TipoHora)} />
          </div>
          <Campo etiqueta="Qué se hizo (opcional)" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Boton type="submit" icono={Plus} cargando={guardando}>Cargar horas</Boton>
            <Boton variante="fantasma" onClick={() => setAgregando(false)} disabled={guardando}>Cancelar</Boton>
          </div>
        </form>
      ) : (
        <Boton icono={Plus} onClick={() => setAgregando(true)}>Cargar horas</Boton>
      )}
    </section>
  );
}
