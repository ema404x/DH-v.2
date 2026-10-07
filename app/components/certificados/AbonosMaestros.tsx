'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowUpDown, Calendar, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock, Cog, DollarSign,
  Droplets, FileText, Flame, FlaskConical, Folder, FolderOpen, Info, Link2, Loader2, MapPin, Pencil, Plus, Scissors, Sparkles, Thermometer,
  Trash2, Upload, Users, X, Zap, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialogo } from './Dialogo';
import { leerContratoPDF } from '@/lib/certificacion';
import { borrarAbono, certificarMes, COMUNAS, fmt, guardarAbono, listarAbonos, MESES_ES, mesesDe, parseMonto, type Abono, type AbonoItem, type ResultadoMes } from '@/lib/certificados';
import { subirDocumento } from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

// ------------------------------------------------------------------ rubros (los de la v1)

interface Rubro { value: string; label: string; Icon: LucideIcon; color: string; bg: string; border: string }
const RUBRO_PRESETS: Rubro[] = [
  { value: 'CORTE_DE_PASTO', label: 'Corte de Pasto', Icon: Scissors, color: 'text-exito', bg: 'bg-exito/10', border: 'border-exito/30' },
  { value: 'PRUEBAS_HERMETICIDAD', label: 'Pruebas de Hermeticidad', Icon: FlaskConical, color: 'text-info', bg: 'bg-info/10', border: 'border-info/30' },
  { value: 'SANEAMIENTO', label: 'Saneamiento', Icon: Droplets, color: 'text-info', bg: 'bg-info/10', border: 'border-info/30' },
  { value: 'CALEFACCION_REFRIGERACION', label: 'Calefacción / Refrigeración', Icon: Thermometer, color: 'text-alerta', bg: 'bg-alerta/10', border: 'border-alerta/30' },
  { value: 'TERMOMECANICA', label: 'Termomecánica', Icon: Cog, color: 'text-alerta', bg: 'bg-alerta/10', border: 'border-alerta/30' },
  { value: 'ASCENSORES', label: 'Ascensores', Icon: ArrowUpDown, color: 'text-primario', bg: 'bg-primario/10', border: 'border-primario/30' },
  { value: 'SISTEMAS_INCENDIOS', label: 'Sistemas contra Incendios', Icon: Flame, color: 'text-peligro', bg: 'bg-peligro/10', border: 'border-peligro/30' },
];
const rubroConfig = (v: string | null): Rubro =>
  RUBRO_PRESETS.find((r) => r.value === v) ?? { value: v || 'OTROS', label: v || 'Otros', Icon: Folder, color: 'text-suave', bg: 'bg-elevado', border: 'border-borde' };

const mesLabel = (iso: string | null) => (iso ? `${MESES_ES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '—');
const mensualDe = (a: Abono) => { const m = mesesDe(a); return m > 0 ? Number(a.monto_contratado) / m : 0; };

// ------------------------------------------------------------------ formulario

interface ItemForm { clave: string; id: string | null; descripcion: string; um: string; cantidad: string; importe_unitario: string }
interface FormAbono {
  id: string | null; rubro: string; comuna: string; contratista: string; oc_numero: string; ada_numero: string; obra_servicio: string;
  emprendimiento: string; monto_total: string; fecha_oc_emision: string; duracion_meses: string; plazo: string; condiciones_pago: string;
  anticipo_pct: string; fondo_reparo_pct: string; estado: 'activo' | 'pausado' | 'completado'; notas: string; ada_pdf_url: string | null; items: ItemForm[];
}
const itemVacio = (): ItemForm => ({ clave: crypto.randomUUID(), id: null, descripcion: '', um: 'MES', cantidad: '1', importe_unitario: '' });
const formVacio = (rubro = 'CORTE_DE_PASTO'): FormAbono => ({
  id: null, rubro, comuna: '8A', contratista: '', oc_numero: '', ada_numero: '', obra_servicio: '', emprendimiento: '', monto_total: '',
  fecha_oc_emision: '', duracion_meses: '', plazo: '', condiciones_pago: '', anticipo_pct: '0', fondo_reparo_pct: '0', estado: 'activo', notas: '',
  ada_pdf_url: null, items: [itemVacio()],
});
const totalItemForm = (it: ItemForm) => parseMonto(it.cantidad) * parseMonto(it.importe_unitario);

function formDesdeAbono(a: Abono, items: AbonoItem[]): FormAbono {
  const meses = mesesDe(a) || 1;
  return {
    id: a.id, rubro: a.rubro || 'OTROS', comuna: a.comuna || '8A', contratista: a.contratista, oc_numero: a.oc_numero ?? '', ada_numero: a.ada_numero ?? '',
    obra_servicio: a.obra_servicio, emprendimiento: a.emprendimiento ?? '', monto_total: Number(a.monto_contratado) ? String(Math.round(Number(a.monto_contratado))) : '',
    fecha_oc_emision: a.fecha_oc_emision ?? '', duracion_meses: mesesDe(a) ? String(mesesDe(a)) : '', plazo: a.plazo ?? '', condiciones_pago: a.condiciones_pago ?? '',
    anticipo_pct: String(Number(a.anticipo_pct ?? 0)), fondo_reparo_pct: String(Number(a.fondo_reparo_pct ?? 0)),
    estado: a.estado === 'cerrado' ? 'completado' : a.estado, notas: a.notas ?? '', ada_pdf_url: a.ada_pdf_url,
    items: items.length ? items.map((it) => ({ clave: it.id, id: it.id, descripcion: it.descripcion, um: it.um, cantidad: String(Math.round((Number(it.cantidad) / meses) * 10000) / 10000), importe_unitario: String(Number(it.importe_unitario)) })) : [itemVacio()],
  };
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <div className="space-y-3"><h4 className="text-xs font-bold uppercase tracking-wide text-suave">{titulo}</h4><div className="grid grid-cols-2 gap-3">{children}</div></div>;
}
function F({ label, children, ancho }: { label: string; children: ReactNode; ancho?: boolean }) {
  return <div className={ancho ? 'col-span-2' : ''}><label className="mb-1 block text-xs font-semibold text-suave">{label}</label>{children}</div>;
}

function AbonoMaestroForm({ form, setForm, onGuardar, onCancelar, guardando }: {
  form: FormAbono; setForm: (f: FormAbono | ((f: FormAbono) => FormAbono)) => void; onGuardar: () => void; onCancelar: () => void; guardando: boolean;
}) {
  const { sectorEfectivo } = useSesion();
  const [extrayendo, setExtrayendo] = useState(false);
  const set = <K extends keyof FormAbono>(k: K, v: FormAbono[K]) => setForm((f) => ({ ...f, [k]: v }));
  const monto = parseMonto(form.monto_total);
  const meses = parseInt(form.duracion_meses, 10) || 0;
  const mensual = monto && meses ? monto / meses : 0;
  const inicio = form.fecha_oc_emision ? (() => { const [y, m] = form.fecha_oc_emision.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; })() : null;
  const fin = inicio && meses ? (() => { const [y, m] = inicio.split('-').map(Number); const d = new Date(y, m - 1 + meses, 0); return d.toLocaleDateString('sv-SE'); })() : null;
  const sumaItems = form.items.reduce((a, it) => a + totalItemForm(it), 0);
  const ant = parseMonto(form.anticipo_pct), fr = parseMonto(form.fondo_reparo_pct);

  async function extraer(archivo: File | undefined) {
    if (!archivo) return;
    if (archivo.type !== 'application/pdf' && !archivo.name.toLowerCase().endsWith('.pdf')) { toast.error('Solo se aceptan archivos PDF'); return; }
    if (!sectorEfectivo) { toast.error('Elegí un sector para cargar abonos.'); return; }
    setExtrayendo(true);
    try {
      const doc = await subirDocumento(sectorEfectivo.id, 'contratos', archivo);
      const { datos: d, validacion } = await leerContratoPDF(doc.path, 'abono_mensual');
      setForm((f) => ({
        ...f,
        contratista: d.contratista || f.contratista, oc_numero: d.oc_numero || f.oc_numero, ada_numero: d.ada_numero || f.ada_numero,
        obra_servicio: d.obra_servicio || f.obra_servicio, emprendimiento: d.emprendimiento || f.emprendimiento,
        monto_total: validacion.total_items ? String(Math.round(validacion.total_items)) : f.monto_total,
        fecha_oc_emision: d.fecha_inicio || f.fecha_oc_emision, plazo: d.plazo || f.plazo, condiciones_pago: d.condiciones_pago || f.condiciones_pago,
        ada_pdf_url: doc.path,
        items: d.items.length ? d.items.map((it) => ({ clave: crypto.randomUUID(), id: null, descripcion: it.descripcion, um: it.um || 'MES', cantidad: String(it.cantidad || 1), importe_unitario: String(it.importe_unitario) })) : f.items,
      }));
      toast.success('Datos extraídos del PDF');
    } catch (err) {
      toast.error('Error al extraer: ' + limpiarError(err));
    } finally {
      setExtrayendo(false);
    }
  }

  const autoFill = () => {
    if (!mensual) { toast.error('Ingresá primero el monto total y la duración'); return; }
    setForm((f) => ({ ...f, items: [{ clave: crypto.randomUUID(), id: f.items[0]?.id ?? null, descripcion: f.obra_servicio || 'Abono mensual de mantenimiento', um: 'MES', cantidad: '1', importe_unitario: String(Math.round(mensual * 100) / 100) }] }));
    toast.success('Ítem generado automáticamente');
  };

  const puedeGuardar = form.contratista.trim() && monto > 0 && form.fecha_oc_emision && meses > 0;
  const inp = 'control w-full';

  return (
    <div className="space-y-5">
      <label className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-4 ${extrayendo ? 'border-primario/40 bg-primario/5' : 'border-borde hover:border-primario/50'}`}>
        <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={extrayendo} onChange={(e) => { extraer(e.target.files?.[0]); e.target.value = ''; }} />
        {extrayendo ? <><Loader2 className="h-5 w-5 animate-spin text-primario" aria-hidden /><span className="text-sm">Extrayendo datos del PDF...</span></> : <>
          <span className="flex h-9 w-9 items-center justify-center rounded bg-primario/10"><Sparkles className="h-4 w-4 text-primario" aria-hidden /></span>
          <span className="flex-1"><span className="block text-sm font-semibold">Subir OC / ADA (PDF)</span><span className="text-xs text-suave">La IA completa los campos automáticamente</span></span>
          <Upload className="h-4 w-4 text-suave" aria-hidden />
        </>}
      </label>

      <Seccion titulo="Contrato">
        <F label="Contratista *" ancho><input className={inp} placeholder="Nombre del contratista" value={form.contratista} onChange={(e) => set('contratista', e.target.value)} /></F>
        <F label="N° ADA *"><input className={`${inp} ${!form.ada_numero ? 'border-alerta/60' : ''}`} placeholder="Ej: 4500012345" value={form.ada_numero} onChange={(e) => set('ada_numero', e.target.value)} /></F>
        <F label="N° OC"><input className={inp} placeholder="Ej: OC-1234" value={form.oc_numero} onChange={(e) => set('oc_numero', e.target.value)} /></F>
        <F label="Obra / Servicio" ancho><input className={inp} placeholder="Descripción del servicio contratado" value={form.obra_servicio} onChange={(e) => set('obra_servicio', e.target.value)} /></F>
        <F label="Emprendimiento" ancho><input className={inp} placeholder="Ej: EDUCACION COMUNA 8A" value={form.emprendimiento} onChange={(e) => set('emprendimiento', e.target.value)} /></F>
        <F label="Rubro / Carpeta">
          <select className={inp} value={form.rubro} onChange={(e) => set('rubro', e.target.value)}>
            {!RUBRO_PRESETS.some((r) => r.value === form.rubro) && <option value={form.rubro}>{rubroConfig(form.rubro).label}</option>}
            {RUBRO_PRESETS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </F>
        <F label="Comuna"><select className={inp} value={form.comuna} onChange={(e) => set('comuna', e.target.value)}>{COMUNAS.map((c) => <option key={c} value={c}>Comuna {c}</option>)}</select></F>
        <F label="Estado"><select className={inp} value={form.estado} onChange={(e) => set('estado', e.target.value as FormAbono['estado'])}><option value="activo">Activo</option><option value="pausado">Pausado</option><option value="completado">Completado</option></select></F>
      </Seccion>

      <Seccion titulo="Montos y Vigencia">
        <F label="Monto Total *">
          <input className={`${inp} ${monto === 0 ? 'border-alerta/60' : ''}`} inputMode="numeric" placeholder="Ej: 3060000" value={form.monto_total} onChange={(e) => set('monto_total', e.target.value)} />
          {monto > 0 && <p className="mt-1 text-xs text-suave">{fmt(monto)}</p>}
        </F>
        <F label="Duración (meses) *"><input type="number" min={1} className={`${inp} ${!meses ? 'border-alerta/60' : ''}`} placeholder="Ej: 12" value={form.duracion_meses} onChange={(e) => set('duracion_meses', e.target.value)} /></F>
        <F label="Fecha de emisión OC *" ancho>
          <input type="date" className={inp} value={form.fecha_oc_emision} onChange={(e) => set('fecha_oc_emision', e.target.value)} />
          {inicio && <p className="mt-1 text-xs text-suave">El contrato comienza en: <strong>{mesLabel(inicio)}</strong></p>}
        </F>
        <F label="Anticipo / Desacopio %"><input type="number" min={0} max={100} className={inp} placeholder="0" value={form.anticipo_pct} onChange={(e) => set('anticipo_pct', e.target.value)} /></F>
        <F label="Fondo de Reparo %"><input type="number" min={0} max={100} className={inp} placeholder="0" value={form.fondo_reparo_pct} onChange={(e) => set('fondo_reparo_pct', e.target.value)} /></F>
      </Seccion>

      {inicio && mensual > 0 && (
        <div className="space-y-2 rounded-lg border border-primario/25 bg-primario/5 p-3 text-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-suave">Resumen del contrato</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded bg-superficie p-2"><p className="text-xs text-suave">Inicio</p><p className="font-semibold">{mesLabel(inicio)}</p></div>
            <div className="rounded bg-superficie p-2"><p className="text-xs text-suave">Fin</p><p className="font-semibold">{mesLabel(fin)}</p></div>
            <div className="col-span-2 rounded border border-exito/30 bg-exito/10 p-2"><p className="text-xs text-suave">Monto mensual calculado</p><p className="text-base font-bold text-exito">{fmt(mensual)}</p></div>
          </div>
          {(ant > 0 || fr > 0) && (
            <div className="space-y-0.5 text-xs">
              {ant > 0 && <p>- Anticipo ({ant}%): -{fmt(mensual * ant / 100)}</p>}
              {fr > 0 && <p>- Fondo de Reparo ({fr}%): -{fmt(mensual * fr / 100)}</p>}
              <p className="font-bold">= Neto: {fmt(mensual - mensual * (ant + fr) / 100)}</p>
            </div>
          )}
        </div>
      )}

      <Seccion titulo="Plazos y Condiciones">
        <F label="Plazo de Obra"><input className={inp} placeholder="Ej: Mensual / 12 meses" value={form.plazo} onChange={(e) => set('plazo', e.target.value)} /></F>
        <div />
        <F label="Condiciones de Pago" ancho><textarea className="control h-14 w-full py-2" placeholder="Ej: 30 días hábiles desde presentación de factura..." value={form.condiciones_pago} onChange={(e) => set('condiciones_pago', e.target.value)} /></F>
      </Seccion>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wide text-suave">Ítems del Certificado</h4>
          <div className="flex gap-2">
            {mensual > 0 && <button type="button" onClick={autoFill} className="inline-flex min-h-control items-center gap-1 rounded px-2 text-sm font-semibold text-primario hover:bg-elevado"><Sparkles className="h-4 w-4" aria-hidden />Auto-fill</button>}
            <button type="button" onClick={() => setForm((f) => ({ ...f, items: [...f.items, itemVacio()] }))} className="inline-flex min-h-control items-center gap-1 rounded border bg-elevado px-3 text-sm font-semibold"><Plus className="h-4 w-4" aria-hidden />Agregar</button>
          </div>
        </div>
        {sumaItems > 0 && mensual > 0 && Math.abs(sumaItems - mensual) >= 1 && (
          <p className="flex items-center gap-2 rounded border border-alerta/40 bg-alerta/10 p-2 text-xs"><AlertTriangle className="h-4 w-4 shrink-0 text-alerta" aria-hidden />La suma de ítems ({fmt(sumaItems)}) no coincide con el monto mensual ({fmt(mensual)})</p>
        )}
        {sumaItems > 0 && mensual > 0 && Math.abs(sumaItems - mensual) < 1 && (
          <p className="flex items-center gap-2 rounded border border-exito/40 bg-exito/10 p-2 text-xs"><CheckCircle2 className="h-4 w-4 shrink-0 text-exito" aria-hidden />Ítems coinciden con monto mensual ✓</p>
        )}
        {form.items.map((it, i) => (
          <div key={it.clave} className="grid grid-cols-12 items-end gap-2">
            <div className="col-span-12 sm:col-span-5"><label className="text-xs text-suave">Descripción</label><input className={inp} placeholder="Descripción del ítem" value={it.descripcion} onChange={(e) => setForm((f) => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x) }))} /></div>
            <div className="col-span-3 sm:col-span-1"><label className="text-xs text-suave">UM</label><input className={inp} value={it.um} onChange={(e) => setForm((f) => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, um: e.target.value } : x) }))} /></div>
            <div className="col-span-4 sm:col-span-2"><label className="text-xs text-suave">Cant.</label><input type="number" step="any" className={inp} value={it.cantidad} onChange={(e) => setForm((f) => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x) }))} /></div>
            <div className="col-span-5 sm:col-span-2"><label className="text-xs text-suave">P. Unit.</label><input type="number" step="any" className={inp} value={it.importe_unitario} onChange={(e) => setForm((f) => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, importe_unitario: e.target.value } : x) }))} /></div>
            <div className="col-span-9 sm:col-span-1"><label className="text-xs text-suave">Total</label><div className="flex min-h-control items-center text-xs font-semibold">{fmt(totalItemForm(it))}</div></div>
            <div className="col-span-3 flex justify-end sm:col-span-1"><button type="button" aria-label="Quitar ítem" disabled={form.items.length === 1} onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))} className="flex min-h-control min-w-control items-center justify-center rounded text-peligro hover:bg-peligro/10 disabled:opacity-30"><X className="h-4 w-4" aria-hidden /></button></div>
          </div>
        ))}
      </div>

      <F label="Notas internas" ancho><textarea className="control h-16 w-full py-2" placeholder="Observaciones..." value={form.notas} onChange={(e) => set('notas', e.target.value)} /></F>

      {!form.id && (
        <p className="flex items-start gap-2 rounded border border-info/40 bg-info/10 p-3 text-xs"><Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />Al crear el abono, cada mes se certifica con &quot;Certificar Mes&quot; o con la emisión automática del último día hábil.</p>
      )}

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-superficie pt-3">
        <button type="button" onClick={onCancelar} className="min-h-control rounded border px-4 text-sm font-semibold">Cancelar</button>
        <button type="button" onClick={onGuardar} disabled={!puedeGuardar || guardando} className="inline-flex min-h-control items-center gap-2 rounded bg-primario px-4 text-sm font-semibold text-sobre-primario disabled:opacity-50">
          {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{form.id ? 'Actualizar' : 'Crear Abono'}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tarjeta

function AbonoMaestroCard({ abono, items, onEditar, onBorrar, onVerCertificados }: { abono: Abono; items: AbonoItem[]; onEditar: () => void; onBorrar: () => void; onVerCertificados: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const total = mesesDe(abono) || 1;
  const emitidos = abono.certificados_total || 0;
  const progreso = Math.min(100, (emitidos / total) * 100);
  const completo = progreso >= 100 || abono.estado === 'cerrado';
  const problemas = [
    !abono.ada_numero && 'Sin N° ADA', !Number(abono.monto_contratado) && 'Monto en $0', !mesesDe(abono) && 'Duración inválida', !abono.fecha_inicio && 'Sin fecha de inicio',
  ].filter(Boolean) as string[];
  const estado = abono.estado === 'cerrado' ? 'completado' : abono.estado;
  const tonoEstado = estado === 'activo' ? 'border-exito/30 bg-exito/15 text-exito' : estado === 'completado' ? 'border-info/30 bg-info/15 text-info' : 'border-alerta/30 bg-alerta/15 text-alerta';
  const meses = mesesDe(abono) || 1;

  return (
    <div className={`overflow-hidden rounded-lg border bg-superficie ${problemas.length ? 'border-alerta/40' : ''} ${completo ? 'border-exito/30' : ''}`}>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><p className="truncate text-sm font-bold">{abono.contratista || '—'}</p><p className="truncate text-xs text-suave">{abono.obra_servicio}</p></div>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${tonoEstado}`}>{estado}</span>
        </div>
        {problemas.length > 0 && (
          <div className="space-y-0.5 rounded border border-alerta/30 bg-alerta/10 p-2 text-xs text-alerta">{problemas.map((p) => <p key={p} className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" aria-hidden />{p}</p>)}</div>
        )}
        <div className="flex flex-wrap gap-1.5 text-xs">
          {abono.ada_numero && <span className="rounded-full bg-primario/10 px-2 py-0.5 font-mono font-semibold text-primario">ADA {abono.ada_numero}</span>}
          {abono.oc_numero && <span className="rounded-full bg-elevado px-2 py-0.5 font-mono">OC {abono.oc_numero}</span>}
          {abono.comuna && <span className="rounded-full border border-primario/30 bg-primario/10 px-2 py-0.5 text-primario">Comuna {abono.comuna}</span>}
          {abono.emprendimiento && <span className="rounded-full bg-elevado px-2 py-0.5">{abono.emprendimiento}</span>}
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><p className="text-xs text-suave">Mensual</p><p className="font-semibold text-exito">{fmt(mensualDe(abono))}</p></div>
          <div><p className="text-xs text-suave">Total contrato</p><p className="font-semibold text-primario">{fmt(abono.monto_contratado)}</p></div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs"><span>{emitidos} de {total} meses certificados</span><span className={completo ? 'text-exito' : 'text-primario'}>{completo ? '✓ Completo' : `${Math.round(progreso)}%`}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-elevado"><div className={`h-2 ${completo ? 'bg-exito' : 'bg-primario'}`} style={{ width: `${progreso}%` }} /></div>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-suave"><Calendar className="h-3.5 w-3.5" aria-hidden />{mesLabel(abono.fecha_inicio)} → {mesLabel(abono.fecha_fin)}<Clock className="h-3.5 w-3.5" aria-hidden /></p>
        {items.length > 0 && (
          <div>
            <button type="button" onClick={() => setAbierto((v) => !v)} className="flex min-h-control w-full items-center gap-1.5 text-xs text-suave">
              <FileText className="h-3.5 w-3.5" aria-hidden />{items.length} ítem{items.length === 1 ? '' : 's'} de certificado{abierto ? <ChevronUp className="ml-auto h-4 w-4" aria-hidden /> : <ChevronDown className="ml-auto h-4 w-4" aria-hidden />}
            </button>
            {abierto && (
              <ul className="space-y-1 text-xs">{items.map((it, i) => <li key={it.id} className="flex justify-between gap-2"><span className="truncate">{it.descripcion || `Ítem ${i + 1}`}</span><span className="text-primario">{fmt(Number(it.importe_total) / meses)}</span></li>)}</ul>
            )}
          </div>
        )}
      </div>
      <div className="flex gap-1 border-t bg-elevado/40 p-2">
        <button type="button" onClick={onVerCertificados} className="inline-flex min-h-control flex-1 items-center justify-center gap-1.5 rounded border bg-superficie text-xs font-semibold"><Link2 className="h-3.5 w-3.5" aria-hidden />Ver certificados</button>
        <button type="button" onClick={onEditar} aria-label="Editar" className="flex min-h-control min-w-control items-center justify-center rounded hover:bg-elevado"><Pencil className="h-4 w-4" aria-hidden /></button>
        <button type="button" onClick={onBorrar} aria-label="Eliminar" className="flex min-h-control min-w-control items-center justify-center rounded text-peligro hover:bg-peligro/10"><Trash2 className="h-4 w-4" aria-hidden /></button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ certificar mes

function ultimos12(): { value: string; label: string }[] {
  const hoy = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MESES_ES[d.getMonth()]} ${d.getFullYear()}` };
  });
}

function CertificacionMensualDialog({ abierto, onCerrar, abonos, onCertificar }: { abierto: boolean; onCerrar: () => void; abonos: Abono[]; onCertificar: (mes: string, comunas: string[], regenerar: boolean) => void }) {
  const meses = useMemo(ultimos12, []);
  const [mes, setMes] = useState(meses[0].value);
  const [comunas, setComunas] = useState<string[]>([]);
  const [regenerar, setRegenerar] = useState(false);
  const etiqueta = meses.find((m) => m.value === mes)?.label ?? mes;
  const objetivo = Number(mes.replace('-', ''));
  const candidatos = abonos.filter((a) => a.estado === 'activo' && (!comunas.length || (a.comuna && comunas.includes(a.comuna))));
  const califican: Abono[] = [];
  const omitidos: { a: Abono; motivo: string }[] = [];
  for (const a of candidatos) {
    if (!a.fecha_inicio || !a.fecha_fin) { omitidos.push({ a, motivo: 'Sin fechas de validez' }); continue; }
    const ini = Number(a.fecha_inicio.slice(0, 7).replace('-', '')), fin = Number(a.fecha_fin.slice(0, 7).replace('-', ''));
    if (objetivo < ini || objetivo > fin) omitidos.push({ a, motivo: 'Fuera del contrato' }); else califican.push(a);
  }
  const chip = (activo: boolean) => `min-h-control rounded-full border px-4 text-sm font-semibold ${activo ? 'border-primario/50 bg-primario/10 text-primario' : 'text-suave'}`;

  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo="Certificar Mes" icono={Calendar}
      pie={<>
        <button type="button" onClick={onCerrar} className="min-h-control rounded border px-4 text-sm font-semibold">Cancelar</button>
        <button type="button" disabled={!califican.length} onClick={() => onCertificar(mes, comunas, regenerar)} className="inline-flex min-h-control items-center gap-2 rounded bg-exito px-4 text-sm font-semibold text-sobre-primario disabled:opacity-50">
          <Zap className="h-4 w-4" aria-hidden />Certificar {etiqueta}
        </button>
      </>}>
      <div className="space-y-5">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-suave">Mes a certificar</p>
          <select className="control w-full" value={mes} onChange={(e) => setMes(e.target.value)}>{meses.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
          <p className="mt-1 flex items-center gap-1 text-xs text-suave"><Clock className="h-3.5 w-3.5" aria-hidden />Solo se certifican meses ya iniciados — no se pueden certificar meses futuros</p>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-suave"><MapPin className="h-3.5 w-3.5" aria-hidden />Comunas (opcional)</p>
          <div className="flex flex-wrap gap-2">
            {COMUNAS.map((c) => (
              <button key={c} type="button" className={chip(!comunas.length || comunas.includes(c))} aria-pressed={comunas.includes(c)}
                onClick={() => setComunas((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]))}>{c}</button>
            ))}
          </div>
          {!comunas.length && <p className="mt-1 text-xs text-suave">Todas las comunas</p>}
        </div>
        <div className="space-y-3 rounded-lg bg-elevado/50 p-4">
          {califican.length ? (<>
            <div className="flex items-end justify-between">
              <div><p className="text-xs text-suave">Se certificarán</p><p className="text-2xl font-bold text-exito">{califican.length}</p></div>
              <div className="text-right"><p className="text-xs text-suave">Monto total del mes</p><p className="font-bold">{fmt(califican.reduce((t, a) => t + mensualDe(a), 0))}</p></div>
            </div>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">{califican.map((a) => <li key={a.id} className="flex justify-between gap-2"><span className="truncate">{a.contratista}</span><span className="text-exito">{fmt(mensualDe(a))}</span></li>)}</ul>
          </>) : (
            <p className="flex items-center gap-2 text-sm text-suave"><AlertCircle className="h-4 w-4" aria-hidden />No hay abonos para certificar en {etiqueta}</p>
          )}
          {omitidos.length > 0 && (
            <ul className="space-y-1 border-t pt-2 text-xs">{omitidos.map(({ a, motivo }) => <li key={a.id} className="flex justify-between gap-2"><span className="truncate">{a.contratista}</span><span className="text-alerta">{motivo}</span></li>)}</ul>
          )}
        </div>
        <button type="button" onClick={() => setRegenerar((v) => !v)} aria-pressed={regenerar}
          className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left ${regenerar ? 'border-alerta/40 bg-alerta/5' : ''}`}>
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${regenerar ? 'border-alerta bg-alerta text-fondo' : ''}`}>{regenerar && '✓'}</span>
          <span><span className="block text-sm font-semibold">Regenerar si ya existe</span>
            <span className="text-xs text-suave">Descarta y vuelve a crear los borradores abiertos de {etiqueta}. Los certificados ya emitidos no se tocan.</span></span>
        </button>
      </div>
    </Dialogo>
  );
}

// ------------------------------------------------------------------ panel

export function AbonosMaestros({ onCambio, onVerCertificados }: { onCambio: () => void; onVerCertificados: (contratista: string) => void }) {
  const { esGerencia, sectorEfectivo } = useSesion();
  const carga = useCarga(listarAbonos, []);
  const [vista, setVista] = useState<'folders' | 'rubro'>('folders');
  const [rubro, setRubro] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState<FormAbono | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [extrayendo, setExtrayendo] = useState(false);
  const [mensualAbierto, setMensualAbierto] = useState(false);
  const [certificando, setCertificando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoMes | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const abonos = carga.datos?.abonos ?? [];
  const items = carga.datos?.items ?? {};

  async function guardar() {
    if (!form) return;
    setGuardando(true);
    try {
      await guardarAbono({
        id: form.id, rubro: form.rubro, comuna: form.comuna, contratista: form.contratista, oc_numero: form.oc_numero, ada_numero: form.ada_numero,
        obra_servicio: form.obra_servicio, emprendimiento: form.emprendimiento, fecha_oc_emision: form.fecha_oc_emision, duracion_meses: parseInt(form.duracion_meses, 10) || 1,
        plazo: form.plazo, condiciones_pago: form.condiciones_pago, anticipo_pct: parseMonto(form.anticipo_pct), fondo_reparo_pct: parseMonto(form.fondo_reparo_pct),
        estado: form.estado, notas: form.notas, ada_pdf_url: form.ada_pdf_url,
        items: form.items.filter((it) => it.descripcion.trim()).map((it) => ({ id: it.id, descripcion: it.descripcion, um: it.um, cantidad: parseMonto(it.cantidad), importe_unitario: parseMonto(it.importe_unitario) })),
      });
      toast.success(form.id ? 'Abono actualizado' : 'Abono creado correctamente');
      setForm(null);
      carga.recargar();
      onCambio();
    } catch (err) {
      toast.error('Error: ' + limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(a: Abono) {
    if (!window.confirm(`¿Eliminar el abono de ${a.contratista}?`)) return;
    try {
      await borrarAbono(a.id);
      toast.success('Abono eliminado');
      carga.recargar();
    } catch (err) {
      toast.error(a.certificados_total ? 'El abono ya tiene certificados: no se elimina. Pasalo a Completado.' : limpiarError(err));
    }
  }

  async function subirADA(archivo: File | undefined) {
    if (!archivo) return;
    if (archivo.type !== 'application/pdf' && !archivo.name.toLowerCase().endsWith('.pdf')) { toast.error('Solo se aceptan archivos PDF'); return; }
    if (!sectorEfectivo) { toast.error('Elegí un sector para cargar abonos.'); return; }
    setExtrayendo(true);
    try {
      const doc = await subirDocumento(sectorEfectivo.id, 'contratos', archivo);
      const { datos: d, validacion } = await leerContratoPDF(doc.path, 'abono_mensual');
      setForm({
        ...formVacio(rubro || 'OTROS'), contratista: d.contratista, oc_numero: d.oc_numero, ada_numero: d.ada_numero, obra_servicio: d.obra_servicio,
        emprendimiento: d.emprendimiento, monto_total: validacion.total_items ? String(Math.round(validacion.total_items)) : '', fecha_oc_emision: d.fecha_inicio,
        plazo: d.plazo, condiciones_pago: d.condiciones_pago, ada_pdf_url: doc.path,
        items: d.items.length ? d.items.map((it) => ({ clave: crypto.randomUUID(), id: null, descripcion: it.descripcion, um: it.um || 'MES', cantidad: String(it.cantidad || 1), importe_unitario: String(it.importe_unitario) })) : [itemVacio()],
      });
      toast.success('Datos extraídos del PDF — revisá y guardá');
    } catch (err) {
      toast.error('Error al extraer: ' + limpiarError(err));
    } finally {
      setExtrayendo(false);
    }
  }

  async function certificar(mes: string, comunas: string[], regenerar: boolean) {
    setMensualAbierto(false);
    setCertificando(true);
    try {
      const r = await certificarMes(mes, comunas, regenerar);
      const n = r.contratos.filter((x) => x.resultado === 'emitido').length;
      toast.success(`${n} certificado${n === 1 ? '' : 's'} generado${n === 1 ? '' : 's'}`);
      setResultado(r);
      carga.recargar();
      onCambio();
    } catch (err) {
      toast.error('Error: ' + limpiarError(err));
    } finally {
      setCertificando(false);
    }
  }

  // ---- vista de carpetas
  const carpetas = useMemo(() => {
    const custom = [...new Set(abonos.map((a) => a.rubro).filter((r): r is string => !!r && !RUBRO_PRESETS.some((p) => p.value === r)))];
    return [...RUBRO_PRESETS.map((r) => r.value), ...custom];
  }, [abonos]);

  const delRubro = abonos.filter((a) => (a.rubro || 'OTROS') === rubro);
  const q = busqueda.toLowerCase();
  const filtrados = delRubro.filter((a) => [a.contratista, a.ada_numero, a.oc_numero, a.obra_servicio].some((v) => (v ?? '').toLowerCase().includes(q)));
  const activos = delRubro.filter((a) => a.estado === 'activo');
  const sinCertificar = activos.filter((a) => !a.certificados_total).length;
  const cfg = rubroConfig(rubro);

  if (carga.cargando && !carga.datos) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-suave" aria-hidden /></div>;

  return (
    <div className="space-y-5">
      <input ref={entrada} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => { subirADA(e.target.files?.[0]); e.target.value = ''; }} />

      {vista === 'folders' ? (<>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold"><FolderOpen className="h-4 w-4 text-primario" aria-hidden />Rubros</h2>
            <p className="text-xs text-suave">Seleccioná un rubro para gestionar sus abonos o cargar un ADA/OC</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMensualAbierto(true)} disabled={certificando || !abonos.some((a) => a.estado === 'activo')}
              className="inline-flex min-h-control items-center gap-2 rounded bg-exito px-3 text-xs font-semibold text-sobre-primario disabled:opacity-50">
              {certificando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Calendar className="h-4 w-4" aria-hidden />}{certificando ? 'Certificando...' : 'Certificar Mes'}
            </button>
            {esGerencia && <button type="button" onClick={() => setForm(formVacio())} className="inline-flex min-h-control items-center gap-2 rounded border bg-elevado px-3 text-xs font-semibold"><Plus className="h-4 w-4" aria-hidden />Nuevo Abono</button>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {carpetas.map((r) => {
            const c = rubroConfig(r);
            const lista = abonos.filter((a) => a.rubro === r);
            const act = lista.filter((a) => a.estado === 'activo');
            const totalMensual = act.reduce((t, a) => t + mensualDe(a), 0);
            const sinLote = act.filter((a) => !a.certificados_total).length;
            const proveedores = [...new Set(lista.map((a) => a.contratista).filter(Boolean))];
            return (
              <button key={r} type="button" onClick={() => { setRubro(r); setVista('rubro'); setBusqueda(''); }}
                className="group rounded-lg border bg-superficie p-4 text-left transition-colors hover:border-primario/40">
                <div className="flex items-start justify-between">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl border ${c.bg} ${c.border}`}><c.Icon className={`h-5 w-5 ${c.color}`} aria-hidden /></span>
                  <span className="rounded-full bg-elevado px-2 text-xs font-bold">{lista.length}</span>
                </div>
                <p className="mt-3 text-sm font-semibold">{c.label}</p>
                <div className="flex justify-between text-xs text-suave"><span>{lista.length} abono{lista.length === 1 ? '' : 's'}</span>{sinLote > 0 && <span className="text-alerta">{sinLote} sin lote</span>}</div>
                <p className={`mt-1 flex items-center gap-1 text-xs ${proveedores.length > 1 ? 'text-primario' : 'text-suave'}`}><Users className="h-3 w-3" aria-hidden />{proveedores.length} proveedor{proveedores.length === 1 ? '' : 'es'}</p>
                {proveedores.length > 0 && <p className="truncate text-xs text-suave">{proveedores.join(' · ')}</p>}
                {totalMensual > 0 && <p className="mt-1 text-sm font-bold text-exito">{fmt(totalMensual)}<span className="text-xs font-normal text-suave">/mes</span></p>}
                <p className="mt-2 flex items-center gap-1 text-xs text-primario opacity-0 transition-opacity group-hover:opacity-100">Abrir carpeta<ChevronRight className="h-3 w-3" aria-hidden /></p>
              </button>
            );
          })}
        </div>
      </>) : (<>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setVista('folders')} className="inline-flex min-h-control items-center gap-1 rounded px-2 text-sm font-semibold text-suave hover:bg-elevado"><ArrowLeft className="h-4 w-4" aria-hidden />Rubros</button>
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${cfg.bg} ${cfg.border}`}><cfg.Icon className={`h-5 w-5 ${cfg.color}`} aria-hidden /></span>
            <div><h2 className="font-bold">{cfg.label}</h2><p className="text-xs text-suave">{delRubro.length} abono{delRubro.length === 1 ? '' : 's'} · {activos.length} activo{activos.length === 1 ? '' : 's'}</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded bg-elevado px-3 py-1 text-right"><p className="text-xs text-suave">Total mensual</p><p className="font-bold text-primario">{fmt(activos.reduce((t, a) => t + mensualDe(a), 0))}</p></div>
            {sinCertificar > 0 && <div className="rounded border border-alerta/40 bg-alerta/10 px-3 py-1 text-right"><p className="text-xs text-suave">Sin certificar</p><p className="font-bold text-alerta">{sinCertificar}</p></div>}
            <input type="search" className="control w-40" placeholder="Buscar..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar abonos" />
            {esGerencia && <>
              <button type="button" onClick={() => setForm(formVacio(rubro || 'OTROS'))} className="inline-flex min-h-control items-center gap-1 rounded border bg-elevado px-3 text-sm font-semibold"><Plus className="h-4 w-4" aria-hidden />Nuevo</button>
              <button type="button" onClick={() => entrada.current?.click()} disabled={extrayendo} className="inline-flex min-h-control items-center gap-2 rounded bg-primario px-3 text-sm font-semibold text-sobre-primario disabled:opacity-50">
                {extrayendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}{extrayendo ? 'Extrayendo...' : 'Subir ADA / OC'}
              </button>
            </>}
          </div>
        </div>
        {delRubro.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed p-10 text-center">
            <span className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl border ${cfg.bg} ${cfg.border}`}><cfg.Icon className={`h-6 w-6 ${cfg.color}`} aria-hidden /></span>
            <p className="font-semibold">No hay abonos en {cfg.label}</p>
            <p className="mb-4 text-sm text-suave">Subí el ADA u OC en PDF y la IA completa los datos del contrato automáticamente</p>
            {esGerencia && <button type="button" onClick={() => entrada.current?.click()} disabled={extrayendo} className="inline-flex min-h-control items-center gap-2 rounded bg-primario px-4 text-sm font-semibold text-sobre-primario disabled:opacity-50">
              <Sparkles className="h-4 w-4" aria-hidden />{extrayendo ? 'Extrayendo datos...' : 'Subir ADA / OC'}
            </button>}
          </div>
        ) : filtrados.length === 0 ? (
          <div className="tarjeta text-center text-sm text-suave">Sin resultados para tu búsqueda</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtrados.map((a) => (
              <AbonoMaestroCard key={a.id} abono={a} items={items[a.id] ?? []} onEditar={() => setForm(formDesdeAbono(a, items[a.id] ?? []))} onBorrar={() => borrar(a)} onVerCertificados={() => onVerCertificados(a.contratista)} />
            ))}
          </div>
        )}
      </>)}

      <Dialogo abierto={!!form} onCerrar={() => setForm(null)} titulo={form?.id ? 'Editar Abono Maestro' : 'Nuevo Abono Maestro'} icono={DollarSign} bloqueado={guardando}>
        {form && <AbonoMaestroForm form={form} setForm={(f) => setForm((prev) => (typeof f === 'function' ? f(prev!) : f))} onGuardar={guardar} onCancelar={() => setForm(null)} guardando={guardando} />}
      </Dialogo>

      <CertificacionMensualDialog abierto={mensualAbierto} onCerrar={() => setMensualAbierto(false)} abonos={abonos} onCertificar={certificar} />

      <Dialogo abierto={!!resultado} onCerrar={() => setResultado(null)} titulo={`Certificación de ${resultado?.periodo ?? 'Mes'} Completada`} icono={CheckCircle2} ancho="max-w-lg"
        pie={<button type="button" onClick={() => setResultado(null)} className="min-h-control w-full rounded border px-4 text-sm font-semibold">Cerrar</button>}>
        {resultado && (() => {
          const generados = resultado.contratos.filter((x) => x.resultado === 'emitido');
          const grupos = ['8A', '8B', '10A', '—'].filter((g) => resultado.contratos.some((x) => x.comuna === g));
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-exito/30 bg-exito/10 p-3 text-center"><p className="text-2xl font-bold text-exito">{generados.length}</p><p className="text-xs text-suave">Generados</p></div>
                <div className="rounded border bg-elevado p-3 text-center"><p className="text-2xl font-bold">{resultado.contratos.length - generados.length}</p><p className="text-xs text-suave">Omitidos</p></div>
              </div>
              <div className="max-h-64 space-y-3 overflow-y-auto">
                {grupos.map((g) => {
                  const lista = resultado.contratos.filter((x) => x.comuna === g);
                  return (
                    <div key={g} className="space-y-1">
                      <div className="flex justify-between text-xs font-bold text-primario"><span>● Comuna {g}</span><span>{fmt(lista.filter((x) => x.resultado === 'emitido').reduce((t, x) => t + Number(x.monto ?? 0), 0))}</span></div>
                      {lista.map((x) => (
                        <div key={x.contrato_id} className="flex items-center justify-between gap-2 rounded bg-elevado/50 px-2 py-1.5 text-sm">
                          <div className="min-w-0"><p className="truncate font-semibold">{x.contrato}</p><p className="text-xs text-suave">{x.resultado === 'emitido' ? `N° ${x.numero} · ${x.mes}` : x.detalle || 'Omitido'}</p></div>
                          <span className={x.resultado === 'emitido' ? 'text-exito' : 'text-suave'}>{x.resultado === 'emitido' ? fmt(x.monto) : '—'}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </Dialogo>
    </div>
  );
}
