'use client';

import { useState, type FormEvent } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '../Boton';
import { Area, Campo, Casilla, Selector, oNull } from '../Campos';
import { agregarItemContrato, borrarItemContrato, fmtPesos, guardarContrato, guardarItemContrato } from '@/lib/certificacion';
import { limpiarError } from '@/lib/errores';
import type { Contrato, ItemContrato } from '@/lib/types';

const num = (v: string) => Number(v.replace(/\./g, '').replace(',', '.'));

function FilaItem({ item, onCambio }: { item: ItemContrato; onCambio: () => Promise<void> }) {
  const [f, setF] = useState({ descripcion: item.descripcion, um: item.um, cantidad: String(Number(item.cantidad)), precio: String(Number(item.importe_unitario)) });
  const [trabajando, setTrabajando] = useState(false);
  const cambiado = f.descripcion !== item.descripcion || f.um !== item.um || num(f.cantidad) !== Number(item.cantidad) || num(f.precio) !== Number(item.importe_unitario);

  async function guardar() {
    if (!(num(f.cantidad) > 0) || !(num(f.precio) >= 0) || !f.descripcion.trim()) {
      toast.error('Revisá el ítem: descripción, cantidad mayor a cero y precio.');
      return;
    }
    setTrabajando(true);
    try {
      await guardarItemContrato(item.id, { descripcion: f.descripcion.trim(), um: f.um.trim() || 'u', cantidad: num(f.cantidad), importe_unitario: num(f.precio) });
      toast.success(`Ítem ${item.numero} guardado.`);
      await onCambio();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setTrabajando(false);
    }
  }

  async function borrar() {
    if (!window.confirm(`¿Borrar el ítem ${item.numero}?`)) return;
    setTrabajando(true);
    try {
      await borrarItemContrato(item.id);
      await onCambio();
    } catch (e) {
      toast.error(limpiarError(e));
      setTrabajando(false);
    }
  }

  return (
    <tr className="border-b last:border-b-0 align-top">
      <td className="py-2 pr-2">{item.numero}</td>
      <td className="py-2 pr-2"><input className="control" aria-label="Descripción" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></td>
      <td className="py-2 pr-2"><input className="control w-20" aria-label="Unidad" value={f.um} onChange={(e) => setF({ ...f, um: e.target.value })} /></td>
      <td className="py-2 pr-2"><input className="control w-24 text-right" inputMode="decimal" aria-label="Cantidad" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: e.target.value })} /></td>
      <td className="py-2 pr-2"><input className="control w-32 text-right" inputMode="decimal" aria-label="Precio unitario" value={f.precio} onChange={(e) => setF({ ...f, precio: e.target.value })} /></td>
      <td className="num py-2 pr-2">{fmtPesos(num(f.cantidad) * num(f.precio) || 0)}</td>
      <td className="whitespace-nowrap py-2">
        {cambiado && <Boton icono={Save} cargando={trabajando} onClick={guardar}>Guardar</Boton>}
        <button type="button" aria-label={`Borrar el ítem ${item.numero}`} onClick={borrar} disabled={trabajando}
          className="inline-flex min-h-control min-w-control items-center justify-center rounded text-suave hover:bg-elevado hover:text-peligro">
          <Trash2 className="h-5 w-5" aria-hidden />
        </button>
      </td>
    </tr>
  );
}

// Edición de un contrato (gerencia): cabecera e ítems. La base frena lo que ya no se puede cambiar (un ítem con
// certificados emitidos no cambia cantidad ni precio) y recalcula el monto contratado.
export function EditarContrato({ contrato: k, items, onCambio, onCerrar }: { contrato: Contrato; items: ItemContrato[]; onCambio: () => Promise<void>; onCerrar: () => void }) {
  const [f, setF] = useState({
    contratista: k.contratista, contratista_cuit: k.contratista_cuit ?? '', obra_servicio: k.obra_servicio, ada_numero: k.ada_numero ?? '', oc_numero: k.oc_numero ?? '',
    fecha_inicio: k.fecha_inicio ?? '', fecha_fin: k.fecha_fin ?? '', condiciones_pago: k.condiciones_pago ?? '', anticipo_pct: String(Number(k.anticipo_pct)),
    fondo_reparo_pct: String(Number(k.fondo_reparo_pct)), notas: k.notas ?? '', tipo: k.tipo, estado: k.estado,
  });
  const [aplicar, setAplicar] = useState(k.fondo_reparo_aplicar);
  const [nuevo, setNuevo] = useState({ descripcion: '', um: 'u', cantidad: '1', precio: '' });
  const [guardando, setGuardando] = useState(false);
  const campo = (c: keyof typeof f) => ({ value: f[c], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [c]: e.target.value })) });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await guardarContrato(k.id, {
        tipo: f.tipo, estado: f.estado, contratista: f.contratista.trim(), contratista_cuit: oNull(f.contratista_cuit), obra_servicio: f.obra_servicio.trim(),
        ada_numero: oNull(f.ada_numero), oc_numero: oNull(f.oc_numero), fecha_inicio: oNull(f.fecha_inicio), fecha_fin: oNull(f.fecha_fin),
        condiciones_pago: oNull(f.condiciones_pago), anticipo_pct: num(f.anticipo_pct) || 0, fondo_reparo_pct: num(f.fondo_reparo_pct) || 0,
        fondo_reparo_aplicar: aplicar, notas: oNull(f.notas),
      });
      toast.success('Contrato guardado.');
      await onCambio();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function agregar(e: FormEvent) {
    e.preventDefault();
    if (!nuevo.descripcion.trim() || !(num(nuevo.cantidad) > 0) || !(num(nuevo.precio) >= 0)) {
      toast.error('Completá descripción, cantidad y precio del ítem nuevo.');
      return;
    }
    try {
      await agregarItemContrato(k.id, Math.max(0, ...items.map((i) => i.numero)) + 1,
        { descripcion: nuevo.descripcion.trim(), um: nuevo.um.trim() || 'u', cantidad: num(nuevo.cantidad), importe_unitario: num(nuevo.precio) });
      setNuevo({ descripcion: '', um: 'u', cantidad: '1', precio: '' });
      await onCambio();
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={guardar} className="tarjeta space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2>Editar el contrato</h2>
          <Boton variante="fantasma" onClick={onCerrar}>Cerrar edición</Boton>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Campo etiqueta="Contratista" required {...campo('contratista')} />
          <Campo etiqueta="CUIT" {...campo('contratista_cuit')} />
          <Campo etiqueta="Obra o servicio" required {...campo('obra_servicio')} />
          <Selector etiqueta="Tipo" opciones={{ abono_mensual: 'Abono mensual', obra: 'Obra' }} {...campo('tipo')} />
          <Campo etiqueta="N° de ADA" {...campo('ada_numero')} />
          <Campo etiqueta="N° de orden de compra" {...campo('oc_numero')} />
          <Campo etiqueta="Inicio" type="date" {...campo('fecha_inicio')} />
          <Campo etiqueta="Fin" type="date" {...campo('fecha_fin')} ayuda="Para los abonos: define los meses a certificar." />
          <Selector etiqueta="Estado" opciones={{ activo: 'Activo', cerrado: 'Cerrado (no admite certificados nuevos)' }} {...campo('estado')} />
          <Campo etiqueta="Anticipo (%)" inputMode="decimal" {...campo('anticipo_pct')} />
          <Campo etiqueta="Fondo de reparo (%)" inputMode="decimal" {...campo('fondo_reparo_pct')} />
          <Campo etiqueta="Condiciones de pago" {...campo('condiciones_pago')} />
        </div>
        <Casilla etiqueta="Aplicar el fondo de reparo en los certificados" checked={aplicar} onChange={(e) => setAplicar(e.target.checked)} />
        <Area etiqueta="Notas" {...campo('notas')} />
        <p className="text-sm text-suave">El anticipo y el fondo de reparo se toman al crear cada certificado: los ya emitidos no cambian.</p>
        <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar contrato</Boton>
      </form>

      <section className="tarjeta space-y-3">
        <h2>Ítems</h2>
        <p className="text-sm text-suave">Un ítem que ya tiene certificados emitidos solo cambia su descripción. El monto contratado se recalcula solo.</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b text-left text-suave">
              <th className="py-2 pr-2 font-medium">N°</th><th className="py-2 pr-2 font-medium">Descripción</th><th className="py-2 pr-2 font-medium">Unidad</th>
              <th className="py-2 pr-2 font-medium">Cantidad</th><th className="py-2 pr-2 font-medium">Precio unitario</th><th className="num py-2 pr-2 font-medium">Total</th><th />
            </tr></thead>
            <tbody>{items.map((i) => <FilaItem key={`${i.id}-${i.cantidad}-${i.importe_unitario}-${i.descripcion}`} item={i} onCambio={onCambio} />)}</tbody>
          </table>
        </div>
        <form onSubmit={agregar} className="grid gap-3 rounded border bg-elevado/40 p-3 md:grid-cols-[1fr_6rem_7rem_9rem_auto] md:items-end">
          <Campo etiqueta="Ítem nuevo" value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
          <Campo etiqueta="Unidad" value={nuevo.um} onChange={(e) => setNuevo({ ...nuevo, um: e.target.value })} />
          <Campo etiqueta="Cantidad" inputMode="decimal" value={nuevo.cantidad} onChange={(e) => setNuevo({ ...nuevo, cantidad: e.target.value })} />
          <Campo etiqueta="Precio unitario" inputMode="decimal" value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} />
          <Boton type="submit" icono={Plus}>Agregar</Boton>
        </form>
      </section>
    </div>
  );
}
