'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, Layers, Loader2, Plus, Save, Send, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { HistorialAcumulados } from './HistorialAcumulados';
import { calcular, nuevoItem, totalItem, type FormCert, type ItemEd } from './modelo';
import { fmt, parseMesPeriodo, TIPO_LABEL, type TipoCert } from '@/lib/certificados';
import { useSesion } from '@/lib/sesion';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-suave">{label}</label>
      {children}
    </div>
  );
}

const input = 'control w-full';
const chico = 'control min-h-[2.25rem] text-sm';
const num = (v: string) => (v === '' ? 0 : Number(v.replace(',', '.')) || 0);

const TONO_TIPO: Record<TipoCert, string> = {
  abono_mensual: 'border-info/40 bg-info/15 text-info',
  informe: 'border-alerta/40 bg-alerta/15 text-alerta',
  obra: 'border-exito/40 bg-exito/15 text-exito',
};

// Editor del certificado (CertificadoEditor de la v1): cabecera, ítems con "A certificar $", cantidad masiva,
// % de avance con "Aplicar", deducciones en % o en $, y los totales. Guardar borrador, vista previa o emitir.
export function CertificadoEditor({ inicial, onBorrador, onEmitir, onCancelar, onVistaPrevia, guardando, emitiendo }: {
  inicial: FormCert;
  onBorrador: (f: FormCert) => void;
  onEmitir: (f: FormCert) => void;
  onCancelar: () => void;
  onVistaPrevia: (f: FormCert) => void;
  guardando: boolean;
  emitiendo: boolean;
}) {
  const { esGerencia } = useSesion();
  const [form, setForm] = useState<FormCert>(inicial);
  const [masivo, setMasivo] = useState('');
  const c = calcular(form);
  // Contrato nuevo o de gerencia: se editan los ítems. Un jefe de sitio solo carga lo que certifica.
  const editaItems = esGerencia;

  const set = <K extends keyof FormCert>(k: K, v: FormCert[K]) => setForm((f) => {
    const nuevo = { ...f, [k]: v };
    // En abono mensual, el mes completa la fecha de inicio y el plazo (como la v1).
    if (k === 'mes_periodo' && f.tipo === 'abono_mensual') {
      const inicio = parseMesPeriodo(String(v));
      if (inicio) { nuevo.fecha_inicio = inicio; nuevo.plazo_obra = 'Mensual'; }
    }
    return nuevo;
  });

  const setItem = (i: number, campo: keyof ItemEd, v: string | number) => setForm((f) => {
    const items = [...f.items];
    const it = { ...items[i], [campo]: v } as ItemEd;
    if ((campo === 'cantidad' || campo === 'importe_unitario') && !it.editado) {
      it.presente = Math.max(0, totalItem(it) - it.anterior);
    }
    if (campo === 'presente') it.editado = true;
    items[i] = it;
    return { ...f, items };
  });

  const agregarItem = () => setForm((f) => ({ ...f, items: [...f.items, nuevoItem(Math.max(0, ...f.items.map((x) => x.numero)) + 1)] }));
  const quitarItem = (i: number) => setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  // "Cantidad masiva": la misma cantidad para todos los ítems, y se certifica todo (v1).
  const aplicarCantidadMasiva = () => {
    if (masivo === '') return;
    const cant = num(masivo);
    setForm((f) => ({
      ...f,
      items: f.items.map((it) => it.bloqueado ? it : { ...it, cantidad: cant, presente: Math.max(0, totalItem({ cantidad: cant, importe_unitario: it.importe_unitario }) - it.anterior), editado: true }),
    }));
    setMasivo('');
  };

  // "% Avance de Obra" → Aplicar: reparte ese porcentaje del total del contrato entre los ítems, en orden.
  const aplicarAvance = () => {
    const pct = (form.porcentaje_avance || 0) / 100;
    if (!pct) { toast.error('Ingresá un % de avance mayor a 0 antes de aplicar.'); return; }
    if (!c.subtotal) { toast.error('Los ítems no tienen importes calculados. Revisá cantidad y precio unitario.'); return; }
    let objetivo = c.subtotal * pct - c.anterior;
    setForm((f) => ({
      ...f,
      items: f.items.map((it) => {
        const disponible = Math.max(0, totalItem(it) - it.anterior);
        const presente = Math.max(0, Math.min(disponible, Math.round(objetivo)));
        objetivo -= presente;
        return { ...it, presente, editado: true };
      }),
    }));
  };

  const validacion = useMemo(() => {
    if (!form.total_documento) return null;
    const diff = Math.abs(c.subtotal - form.total_documento);
    return { docTotal: form.total_documento, diff, coincide: diff / form.total_documento <= 0.005 };
  }, [c.subtotal, form.total_documento]);

  const ocupado = guardando || emitiendo;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 border-b pb-4">
        <button type="button" onClick={onCancelar} aria-label="Volver" className="flex min-h-control min-w-control items-center justify-center rounded hover:bg-elevado"><ArrowLeft className="h-5 w-5" aria-hidden /></button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Editar Certificado</h1>
          <p className="mt-1 text-xs text-suave">Revisá y ajustá los datos extraídos por la IA</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONO_TIPO[form.tipo]}`}>{form.tipo === 'informe' ? 'Informe' : TIPO_LABEL[form.tipo]}</span>
          <button type="button" className="inline-flex min-h-control items-center gap-2 rounded border bg-elevado px-4 text-sm font-semibold hover:bg-borde" onClick={() => onVistaPrevia(form)}>
            <Eye className="h-4 w-4" aria-hidden />Vista previa
          </button>
          <button type="button" className="inline-flex min-h-control items-center gap-2 rounded border bg-elevado px-4 text-sm font-semibold hover:bg-borde disabled:opacity-50" onClick={() => onBorrador(form)} disabled={ocupado}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {guardando ? 'Guardando...' : 'Guardar borrador'}
          </button>
          <button type="button" className="inline-flex min-h-control items-center gap-2 rounded bg-exito px-4 text-sm font-semibold text-sobre-primario hover:bg-exito/90 disabled:opacity-50" onClick={() => onEmitir(form)} disabled={ocupado}>
            {emitiendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {emitiendo ? 'Emitiendo...' : 'Emitir certificado'}
          </button>
        </div>
      </div>

      <HistorialAcumulados contratoId={form.contrato_id} montoContratado={c.subtotal} />

      {validacion && (
        <div className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${validacion.coincide ? 'border-exito/40 bg-exito/10' : 'border-alerta/40 bg-alerta/10'}`}>
          {validacion.coincide ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-exito" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-alerta" aria-hidden />}
          <div>
            {validacion.coincide
              ? <span>Subtotal validado: la suma de ítems coincide con el total del documento ({fmt(validacion.docTotal)}).</span>
              : <span>⚠️ Discrepancia detectada: suma de ítems <strong>{fmt(c.subtotal)}</strong> vs total del documento <strong>{fmt(validacion.docTotal)}</strong> (diferencia: {fmt(validacion.diff)}). Revisá si hay ítems de más o faltantes.</span>}
          </div>
        </div>
      )}

      <div className="tarjeta space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide">Datos del Encabezado</h3>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Field label="Tipo">
            <select className={input} value={form.tipo} disabled={!esGerencia} onChange={(e) => set('tipo', e.target.value as TipoCert)}>
              <option value="abono_mensual">Abono Mensual</option>
              <option value="obra">Obra</option>
              <option value="informe">Informe / Certificado</option>
            </select>
          </Field>
          <Field label="Certificado N°">
            <input className={`${input} bg-elevado`} value={form.numero ?? form.numeroPrevisto} readOnly title="Lo asigna la base al emitir" />
          </Field>
          <Field label="Emprendimiento"><input className={input} value={form.emprendimiento} disabled={!esGerencia} onChange={(e) => set('emprendimiento', e.target.value)} /></Field>
          <Field label="Obra / Servicio"><input className={input} value={form.obra_servicio} disabled={!esGerencia} onChange={(e) => set('obra_servicio', e.target.value)} /></Field>
          <Field label="Contratista"><input className={input} value={form.contratista} disabled={!esGerencia} onChange={(e) => set('contratista', e.target.value)} /></Field>
          <Field label="ADA N°"><input className={input} value={form.ada_numero} disabled={!esGerencia} onChange={(e) => set('ada_numero', e.target.value)} /></Field>
          <Field label="OC N°"><input className={input} value={form.oc_numero} disabled={!esGerencia} onChange={(e) => set('oc_numero', e.target.value)} /></Field>
          <Field label="Mes / Período"><input className={input} value={form.mes_periodo} onChange={(e) => set('mes_periodo', e.target.value)} /></Field>
          <Field label="Fecha de Inicio"><input type="date" className={input} value={form.fecha_inicio} disabled={!esGerencia} onChange={(e) => set('fecha_inicio', e.target.value)} /></Field>
          <Field label="Plazo de Obra"><input className={input} value={form.plazo_obra} disabled={!esGerencia} onChange={(e) => set('plazo_obra', e.target.value)} /></Field>
          <Field label="Plazo de Entrega"><input className={input} value={form.plazo_entrega} disabled={!esGerencia} onChange={(e) => set('plazo_entrega', e.target.value)} /></Field>
          <Field label="Fecha de Finalización"><input type="date" className={input} value={form.fecha_finalizacion} disabled={!esGerencia} onChange={(e) => set('fecha_finalizacion', e.target.value)} /></Field>
          <Field label="Monto Contratado $">
            <input className={`${input} bg-elevado`} value={fmt(c.subtotal)} readOnly title="Es la suma de los ítems" />
            <p className="mt-1 text-xs text-suave">Suma de los ítems</p>
          </Field>
          <Field label="Monto Obra Contratada $"><input className={input} inputMode="numeric" value={form.monto_obra_contratada} disabled={!esGerencia} onChange={(e) => set('monto_obra_contratada', e.target.value.replace(/[^\d.,]/g, ''))} /></Field>
          <Field label="% Avance de Obra">
            <div className="flex gap-2">
              <input type="number" min={0} max={100} className={input} value={form.porcentaje_avance} onChange={(e) => set('porcentaje_avance', Math.min(100, Math.max(0, num(e.target.value))))} />
              <button type="button" onClick={aplicarAvance} title="Distribuir el % de avance sobre los ítems"
                className="inline-flex min-h-control shrink-0 items-center gap-1.5 rounded border bg-elevado px-3 text-xs font-semibold hover:bg-borde">
                <Wand2 className="h-3.5 w-3.5" aria-hidden />Aplicar
              </button>
            </div>
          </Field>
          <Field label="Fecha del Certificado"><input type="date" className={input} value={form.fecha_certificado} onChange={(e) => set('fecha_certificado', e.target.value)} /></Field>
          <Field label="N° de Recepción"><input className={input} value={form.numero_recepcion} onChange={(e) => set('numero_recepcion', e.target.value)} /></Field>
        </div>
        <Field label="Condiciones de Pago">
          <textarea className="control h-16 w-full resize-none py-2 text-sm" value={form.condiciones_pago} disabled={!esGerencia} onChange={(e) => set('condiciones_pago', e.target.value)} placeholder="Ej: 30 días hábiles desde presentación de factura..." />
        </Field>
      </div>

      {c.hasMedicion && (
        <div className="space-y-3 rounded-lg border border-info/40 bg-info/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-info">Resumen de certificación</span>
            <span className="text-2xl font-bold text-info">{c.pct.toFixed(1)}%</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-info/20">
            <div className="h-3 rounded-full bg-info transition-all" style={{ width: `${Math.min(100, c.pct)}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-md border bg-superficie p-2 text-center"><div className="mb-0.5 text-suave">Total contrato</div><div className="font-bold">{fmt(c.subtotal)}</div></div>
            <div className="rounded-md bg-info p-2 text-center text-sobre-primario"><div className="mb-0.5 opacity-80">Certificado (presente)</div><div className="font-bold">{fmt(c.presente)}</div></div>
            <div className="rounded-md border border-alerta/40 bg-superficie p-2 text-center"><div className="mb-0.5 text-suave">Saldo pendiente</div><div className="font-bold text-alerta">{fmt(c.saldo)}</div></div>
          </div>
          <div className="flex justify-between border-t border-info/30 pt-1 text-xs font-medium text-info"><span>Total Neto a cobrar:</span><span className="font-bold">{fmt(c.neto)}</span></div>
        </div>
      )}

      <div className="tarjeta space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide">Ítems</h3>
          {editaItems && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2">
                <Layers className="h-4 w-4 shrink-0 text-alerta" aria-hidden />
                <div className="flex flex-col leading-none">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-alerta">Cantidad masiva</span>
                  <span className="text-[0.7rem] text-suave">Aplica a todos los ítems</span>
                </div>
                <input type="number" min={0} placeholder="ej: 1" value={masivo} onChange={(e) => setMasivo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); aplicarCantidadMasiva(); } }} className={`${chico} w-20`} aria-label="Cantidad masiva" />
                <button type="button" onClick={aplicarCantidadMasiva} disabled={masivo === ''}
                  className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded bg-alerta px-3 text-xs font-semibold text-fondo disabled:opacity-50">
                  <Wand2 className="h-3 w-3" aria-hidden /> Aplicar
                </button>
              </div>
              <button type="button" onClick={agregarItem} className="inline-flex min-h-control items-center gap-2 rounded border bg-elevado px-3 text-sm font-semibold hover:bg-borde">
                <Plus className="h-3.5 w-3.5" aria-hidden />Agregar ítem
              </button>
            </div>
          )}
        </div>
        <div className="space-y-3">
          {form.items.map((item, i) => {
            const fijo = !editaItems || item.bloqueado;
            return (
              <div key={item.clave} className="grid grid-cols-2 items-start gap-2 rounded-lg border bg-elevado/40 p-3 md:grid-cols-[3rem_minmax(0,1fr)_4rem_6rem_8rem_8rem_9rem]">
                <div><label className="text-xs text-suave">N°</label><input className={`${chico} mt-1 w-full bg-elevado`} value={item.numero} readOnly /></div>
                <div className="col-span-2 md:col-span-1"><label className="text-xs text-suave">Descripción</label><input className={`${chico} mt-1 w-full`} value={item.descripcion} disabled={!editaItems} onChange={(e) => setItem(i, 'descripcion', e.target.value)} /></div>
                <div><label className="text-xs text-suave">UM</label><input className={`${chico} mt-1 w-full`} value={item.um} disabled={fijo} onChange={(e) => setItem(i, 'um', e.target.value)} /></div>
                <div><label className="text-xs text-suave">Cantidad</label><input type="number" className={`${chico} mt-1 w-full`} value={item.cantidad} disabled={fijo} onChange={(e) => setItem(i, 'cantidad', num(e.target.value))} /></div>
                <div><label className="text-xs text-suave">P. Unitario</label><input type="number" className={`${chico} mt-1 w-full`} value={item.importe_unitario} disabled={fijo} onChange={(e) => setItem(i, 'importe_unitario', num(e.target.value))} /></div>
                <div><label className="text-xs text-suave">Total contrato</label><div className="mt-1 flex min-h-[2.25rem] items-center rounded border bg-superficie px-3 text-xs font-medium">{fmt(totalItem(item))}</div></div>
                <div>
                  <label className="text-xs font-semibold text-info">A certificar $</label>
                  <input type="number" className={`${chico} mt-1 w-full border-info/60`} value={item.presente || 0} onChange={(e) => setItem(i, 'presente', Math.max(0, num(e.target.value)))} />
                  {item.anterior > 0 && <p className="mt-1 text-[0.7rem] text-suave">Ya certificado: {fmt(item.anterior)}</p>}
                </div>
                {editaItems && !item.bloqueado && (
                  <div className="col-span-2 flex justify-end md:col-span-7">
                    <button type="button" onClick={() => quitarItem(i)} aria-label={`Quitar el ítem ${item.numero}`} className="flex h-8 w-8 items-center justify-center rounded text-peligro hover:bg-peligro/10">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="tarjeta space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide">Totales y Deducciones</h3>
        <div className="ml-auto flex max-w-sm flex-col items-end gap-2">
          {c.hasMedicion && <div className="flex w-full justify-between text-xs text-suave"><span>Total contrato:</span><span>{fmt(c.subtotal)}</span></div>}
          <div className="flex w-full justify-between text-sm"><span className="text-suave">{c.hasMedicion ? 'Importe certificado:' : 'Subtotal:'}</span><span className="font-semibold text-info">{fmt(c.presente)}</span></div>
          {c.hasMedicion && c.saldo > 0 && <div className="flex w-full justify-between text-xs"><span className="text-suave">Saldo pendiente:</span><span className="font-semibold text-alerta">{fmt(c.saldo)}</span></div>}

          <div className="flex w-full items-center justify-between gap-2 text-sm">
            <span className="shrink-0 text-suave">Anticipo/Desacopio:</span>
            <ModoMonto fijo={form.anticipo_monto_manual != null} onPct={() => set('anticipo_monto_manual', null)} onFijo={() => set('anticipo_monto_manual', Math.round(c.anticipo))} />
            {form.anticipo_monto_manual == null
              ? <input type="number" min={0} className={`${chico} w-20`} placeholder="0" value={form.anticipo_pct || ''} onChange={(e) => set('anticipo_pct', Math.min(100, num(e.target.value)))} aria-label="Anticipo %" />
              : <input type="number" min={0} className={`${chico} w-28 border-alerta/60`} value={form.anticipo_monto_manual} onChange={(e) => set('anticipo_monto_manual', num(e.target.value))} aria-label="Anticipo $" />}
          </div>
          {c.anticipo > 0 && (
            <div className="flex w-full justify-between text-xs text-suave">
              <span>Anticipo {form.anticipo_monto_manual == null ? `(${form.anticipo_pct}%)` : '(monto fijo)'}:</span>
              <span className="text-peligro">-{fmt(c.anticipo)}</span>
            </div>
          )}

          <div className="flex w-full items-center justify-between gap-2 text-sm">
            <input className={`${chico} w-36 shrink-0`} placeholder="Fondo de Reparo" value={form.fondo_reparo_label} onChange={(e) => set('fondo_reparo_label', e.target.value)} aria-label="Nombre del fondo de reparo" />
            <ModoMonto fijo={form.fondo_reparo_monto_manual != null} onPct={() => set('fondo_reparo_monto_manual', null)} onFijo={() => set('fondo_reparo_monto_manual', Math.round(c.fondoCalculado))} />
            {form.fondo_reparo_monto_manual == null
              ? <input type="number" min={0} className={`${chico} w-20`} placeholder="0" value={form.fondo_reparo_pct || ''} onChange={(e) => set('fondo_reparo_pct', Math.min(100, num(e.target.value)))} aria-label="Fondo de reparo %" />
              : <input type="number" min={0} className={`${chico} w-28 border-alerta/60`} value={form.fondo_reparo_monto_manual} onChange={(e) => set('fondo_reparo_monto_manual', num(e.target.value))} aria-label="Fondo de reparo $" />}
          </div>
          {c.fondoCalculado > 0 && (
            <div className="flex w-full items-center justify-between text-xs">
              <span className="text-suave">
                {form.fondo_reparo_label || 'Fondo de Reparo'} {form.fondo_reparo_monto_manual == null ? `(${form.fondo_reparo_pct}%)` : '(monto fijo)'}: <span className="font-semibold">{fmt(c.fondoCalculado)}</span>
              </span>
              <button type="button" onClick={() => set('fondo_reparo_aplicar', !form.fondo_reparo_aplicar)}
                className={`min-h-[2rem] rounded border px-2.5 text-xs font-semibold ${form.fondo_reparo_aplicar ? 'border-peligro/40 bg-peligro/10 text-peligro' : 'bg-elevado text-suave'}`}>
                {form.fondo_reparo_aplicar ? `✓ Descontando -${fmt(c.fondoCalculado)}` : 'Aplicar descuento'}
              </button>
            </div>
          )}
          <div className="flex w-full justify-between border-t pt-2 font-bold"><span>Total Neto:</span><span className="text-primario">{fmt(c.neto)}</span></div>
          <p className="text-right text-xs text-suave">El % de anticipo y de fondo de reparo se calcula sobre lo certificado en el período.</p>
        </div>
      </div>
    </div>
  );
}

function ModoMonto({ fijo, onPct, onFijo }: { fijo: boolean; onPct: () => void; onFijo: () => void }) {
  const clase = (activo: boolean) => `min-h-[1.75rem] rounded px-2 text-xs font-semibold ${activo ? 'bg-primario text-sobre-primario' : 'bg-elevado text-suave hover:text-texto'}`;
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <button type="button" className={clase(!fijo)} onClick={onPct} aria-pressed={!fijo}>%</button>
      <button type="button" className={clase(fijo)} onClick={onFijo} aria-pressed={fijo}>$</button>
    </div>
  );
}
