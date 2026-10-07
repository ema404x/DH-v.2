'use client';

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { formVacio, nuevoItem, totalItem, type FormCert } from './modelo';
import { fmt } from '@/lib/certificados';

function Field({ label, children, ancho = false }: { label: string; children: ReactNode; ancho?: boolean }) {
  return (
    <div className={ancho ? 'col-span-2' : ''}>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-suave">{label}</label>
      {children}
    </div>
  );
}
function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="tarjeta space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide">{titulo}</h3>
      <div className="grid grid-cols-2 gap-4">{children}</div>
    </div>
  );
}
const input = 'control w-full';
const num = (v: string) => (v === '' ? 0 : Number(v.replace(',', '.')) || 0);

// "Nuevo Certificado Manual" (AbonoManualForm de la v1): un certificado de abono mensual cargado a mano, que se
// emite y va a aprobación. Crea el contrato con sus ítems y lo certifica completo.
export function AbonoManualForm({ onGuardar, onCancelar, guardando }: {
  onGuardar: (f: FormCert) => void;
  onCancelar: () => void;
  guardando: boolean;
}) {
  const [form, setForm] = useState<FormCert>(() => ({ ...formVacio(), tipo: 'abono_mensual', items: [nuevoItem(1, 'GL')] }));
  const [notas, setNotas] = useState('');
  const set = <K extends keyof FormCert>(k: K, v: FormCert[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i: number, campo: 'descripcion' | 'um' | 'cantidad' | 'importe_unitario', v: string | number) =>
    setForm((f) => {
      const items = [...f.items];
      const it = { ...items[i], [campo]: v };
      it.presente = totalItem(it);
      items[i] = it;
      return { ...f, items };
    });

  const subtotal = form.items.reduce((a, it) => a + totalItem(it), 0);
  const anticipo = subtotal * (form.anticipo_pct || 0) / 100;
  const fondo = subtotal * (form.fondo_reparo_pct || 0) / 100;
  const neto = subtotal - anticipo - fondo;

  const guardar = () => onGuardar({ ...form, notas, fondo_reparo_aplicar: form.fondo_reparo_pct > 0 });
  const botonGuardar = (grande = false) => (
    <button type="button" onClick={guardar} disabled={!form.contratista.trim() || guardando}
      className={`inline-flex items-center gap-2 rounded bg-primario px-4 font-semibold text-sobre-primario disabled:opacity-50 ${grande ? 'min-h-campo text-base' : 'min-h-control text-sm'}`}>
      {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
      {guardando ? 'Guardando...' : 'Guardar Certificado'}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 border-b pb-4">
        <button type="button" onClick={onCancelar} aria-label="Volver" className="flex min-h-control min-w-control items-center justify-center rounded hover:bg-elevado"><ArrowLeft className="h-5 w-5" aria-hidden /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Nuevo Certificado Manual</h1>
          <p className="text-sm text-suave">Completá todos los campos del certificado de abono mensual</p>
        </div>
        {botonGuardar()}
      </div>

      <Seccion titulo="Datos del Contrato">
        <Field label="Contratista *" ancho><input className={input} placeholder="Nombre del contratista" value={form.contratista} onChange={(e) => set('contratista', e.target.value)} /></Field>
        <Field label="Emprendimiento"><input className={input} placeholder="Ej: EDUCACION COMUNA 8A" value={form.emprendimiento} onChange={(e) => set('emprendimiento', e.target.value)} /></Field>
        <Field label="Obra / Servicio"><input className={input} placeholder="Descripción del servicio" value={form.obra_servicio} onChange={(e) => set('obra_servicio', e.target.value)} /></Field>
        <Field label="N° ADA"><input className={input} placeholder="Ej: ADA-5678" value={form.ada_numero} onChange={(e) => set('ada_numero', e.target.value)} /></Field>
        <Field label="N° Orden de Compra"><input className={input} placeholder="Ej: OC-1234" value={form.oc_numero} onChange={(e) => set('oc_numero', e.target.value)} /></Field>
      </Seccion>

      <Seccion titulo="Período y Fechas">
        <Field label="Mes / Período"><input className={input} placeholder="Ej: Mayo 2026 o 2026-05" value={form.mes_periodo} onChange={(e) => set('mes_periodo', e.target.value)} /></Field>
        <Field label="Fecha del Certificado"><input type="date" className={input} value={form.fecha_certificado} onChange={(e) => set('fecha_certificado', e.target.value)} /></Field>
        <Field label="Fecha de Inicio"><input type="date" className={input} value={form.fecha_inicio} onChange={(e) => set('fecha_inicio', e.target.value)} /></Field>
        <Field label="Fecha de Finalización"><input type="date" className={input} value={form.fecha_finalizacion} onChange={(e) => set('fecha_finalizacion', e.target.value)} /></Field>
        <Field label="Plazo de Obra"><input className={input} placeholder="Ej: Mensual / 6 meses" value={form.plazo_obra} onChange={(e) => set('plazo_obra', e.target.value)} /></Field>
        <Field label="Plazo de Entrega"><input className={input} placeholder="Ej: 30 días" value={form.plazo_entrega} onChange={(e) => set('plazo_entrega', e.target.value)} /></Field>
        <Field label="N° de Recepción"><input className={input} placeholder="Número de recepción" value={form.numero_recepcion} onChange={(e) => set('numero_recepcion', e.target.value)} /></Field>
        <Field label="Base"><input className={input} placeholder="Base del certificado" value={form.base} onChange={(e) => set('base', e.target.value)} /></Field>
      </Seccion>

      <Seccion titulo="Montos y Avance">
        <Field label="Monto Contratado $"><input className={`${input} bg-elevado`} value={fmt(subtotal)} readOnly title="Es la suma de los ítems" /></Field>
        <Field label="Monto Obra Contratada $"><input className={input} inputMode="numeric" value={form.monto_obra_contratada} onChange={(e) => set('monto_obra_contratada', e.target.value.replace(/[^\d.,]/g, ''))} /></Field>
        <Field label="% Avance de Obra"><input type="number" min={0} max={100} className={input} value={form.porcentaje_avance} onChange={(e) => set('porcentaje_avance', Math.min(100, Math.max(0, num(e.target.value))))} /></Field>
        <Field label="Condiciones de Pago" ancho><textarea className="control h-16 w-full py-2" value={form.condiciones_pago} onChange={(e) => set('condiciones_pago', e.target.value)} /></Field>
      </Seccion>

      <div className="tarjeta space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide">Ítems del Certificado</h3>
          <button type="button" onClick={() => setForm((f) => ({ ...f, items: [...f.items, nuevoItem(f.items.length + 1, 'GL')] }))}
            className="inline-flex min-h-control items-center gap-2 rounded border bg-elevado px-3 text-sm font-semibold hover:bg-borde"><Plus className="h-3.5 w-3.5" aria-hidden />Agregar ítem</button>
        </div>
        {form.items.map((it, i) => (
          <div key={it.clave} className="grid grid-cols-12 items-end gap-2">
            <div className="col-span-12 md:col-span-5"><label className="text-xs text-suave">Descripción</label><input className={input} value={it.descripcion} onChange={(e) => setItem(i, 'descripcion', e.target.value)} /></div>
            <div className="col-span-3 md:col-span-1"><label className="text-xs text-suave">UM</label><input className={input} value={it.um} onChange={(e) => setItem(i, 'um', e.target.value)} /></div>
            <div className="col-span-4 md:col-span-2"><label className="text-xs text-suave">Cantidad</label><input type="number" className={input} value={it.cantidad} onChange={(e) => setItem(i, 'cantidad', num(e.target.value))} /></div>
            <div className="col-span-5 md:col-span-2"><label className="text-xs text-suave">P. Unitario $</label><input type="number" className={input} value={it.importe_unitario} onChange={(e) => setItem(i, 'importe_unitario', num(e.target.value))} /></div>
            <div className="col-span-9 md:col-span-1"><label className="text-xs text-suave">Total</label><div className="flex min-h-control items-center text-sm font-semibold">{fmt(totalItem(it))}</div></div>
            <div className="col-span-3 flex justify-end md:col-span-1">
              <button type="button" onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))} disabled={form.items.length === 1}
                aria-label="Quitar ítem" className="flex min-h-control min-w-control items-center justify-center rounded text-peligro hover:bg-peligro/10 disabled:opacity-30"><Trash2 className="h-4 w-4" aria-hidden /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="tarjeta space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide">Deducciones y Total</h3>
        <div className="ml-auto max-w-sm space-y-2">
          <div className="flex justify-between text-sm"><span className="text-suave">Subtotal:</span><span className="font-semibold">{fmt(subtotal)}</span></div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-suave">Anticipo/Desacopio %:</span>
            <input type="number" min={0} className="control w-20" value={form.anticipo_pct || ''} placeholder="0" onChange={(e) => set('anticipo_pct', Math.min(100, num(e.target.value)))} aria-label="Anticipo %" />
          </div>
          {anticipo > 0 && <div className="flex justify-between text-xs text-peligro"><span>Anticipo ({form.anticipo_pct}%):</span><span>-{fmt(anticipo)}</span></div>}
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-suave">Fondo de Reparo %:</span>
            <input type="number" min={0} className="control w-20" value={form.fondo_reparo_pct || ''} placeholder="0" onChange={(e) => set('fondo_reparo_pct', Math.min(100, num(e.target.value)))} aria-label="Fondo de reparo %" />
          </div>
          {fondo > 0 && <div className="flex justify-between text-xs text-peligro"><span>Fondo de Reparo ({form.fondo_reparo_pct}%):</span><span>-{fmt(fondo)}</span></div>}
          <div className="flex justify-between border-t pt-2 font-bold"><span>Total Neto:</span><span className="text-primario">{fmt(neto)}</span></div>
        </div>
      </div>

      <div className="tarjeta space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide">Notas / Observaciones</h3>
        <textarea className="control h-20 w-full py-2" placeholder="Observaciones adicionales..." value={notas} onChange={(e) => setNotas(e.target.value)} />
      </div>

      <div className="flex justify-end">{botonGuardar(true)}</div>
    </div>
  );
}
