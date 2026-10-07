'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertOctagon, AlertTriangle, Camera, CheckCircle2, CheckSquare, Circle, ClipboardX, Clock, Image as ImageIcon, Loader2, MapPin,
  MessageSquare, MessageSquareWarning, Navigation, Package, PenTool, Plus, Search, Trash2, User, X, XCircle, ZoomIn,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { buscar } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';
import { borrarFoto, listarFotos } from '@/lib/ot';
import { cargarMaterialOT, materialesDeOT, quitarMaterialOT, type MaterialOT } from '@/lib/panol';
import { subirFoto, type FilaTablero } from '@/lib/tablero';
import type { FotoOT, MotivoIncompleto, ResultadoBusqueda, TareaChecklist } from '@/lib/types';

// Secciones del panel de detalle de la v1 (WorkOrderChecklist, WorkOrderMaterials, WorkOrderPhotos,
// WorkOrderIncompleteReason, ReporteOperarioResumen, RechazoOTModal, LocationEditor, DeleteWorkOrderButton).

export interface Faltante {
  material: string;
  cantidad: number;
  motivo?: string;
}

const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);

// ------------------------------------------------------------------ Checklist

export function WorkOrderChecklist({ checklist, onChange }: { checklist: TareaChecklist[]; onChange: (v: TareaChecklist[]) => void }) {
  const [newTask, setNewTask] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const addTask = () => {
    if (!newTask.trim()) return;
    onChange([...checklist, { id: crypto.randomUUID(), tarea: newTask.trim(), hecho: false, nota: '' }]);
    setNewTask('');
  };
  const done = checklist.filter((t) => t.hecho).length;
  const pct = checklist.length > 0 ? Math.round((done / checklist.length) * 100) : 0;

  return (
    <div className="space-y-3">
      {checklist.length > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>{done} de {checklist.length} completadas</span>
            <span className={pct === 100 ? 'font-bold text-emerald-400' : ''}>{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <div className="space-y-2">
        {checklist.map((task) => {
          const expanded = expandedId === task.id;
          return (
            <div key={task.id} className={`overflow-hidden rounded-xl border transition-all duration-200 ${task.hecho ? 'border-emerald-700/40 bg-emerald-950/30' : 'border-slate-700/50 bg-slate-800/40'}`}>
              <div className="flex min-h-[52px] items-center gap-3 px-3 py-3">
                <button type="button" aria-label={task.hecho ? 'Desmarcar tarea' : 'Marcar tarea'}
                  onClick={() => onChange(checklist.map((t) => (t.id === task.id ? { ...t, hecho: !t.hecho } : t)))}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-all active:scale-90">
                  {task.hecho ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <Circle className="h-6 w-6 text-slate-500" />}
                </button>
                <span onClick={() => setExpandedId(expanded ? null : task.id)}
                  className={`flex-1 cursor-pointer select-none text-sm leading-tight ${task.hecho ? 'text-slate-500 line-through' : 'font-medium text-slate-100'}`}>
                  {task.tarea}
                </span>
                <button type="button" aria-label="Ver detalle de la tarea" onClick={() => setExpandedId(expanded ? null : task.id)}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-slate-300">
                  <svg className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              {expanded && (
                <div className="space-y-2.5 border-t border-slate-700/40 px-3 pb-3 pt-3">
                  <Input placeholder="Nota de esta tarea (opcional)..." value={task.nota || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(checklist.map((t) => (t.id === task.id ? { ...t, nota: e.target.value } : t)))}
                    className="h-9 border-slate-700/50 bg-slate-900/60 text-xs text-slate-200 placeholder:text-slate-600" />
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="Borrar tarea" onClick={() => { onChange(checklist.filter((t) => t.id !== task.id)); setExpandedId(null); }}
                      className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl border border-red-900/40 bg-red-950/40 text-red-400 transition-colors hover:bg-red-900/50 active:scale-90">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 pt-1">
        <Input placeholder="Nueva tarea..." value={newTask} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTask(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && addTask()}
          className="h-10 border-slate-700/50 bg-slate-800/60 text-sm text-white placeholder:text-slate-600" />
        <button type="button" aria-label="Agregar tarea" onClick={addTask} disabled={!newTask.trim()}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition-colors hover:bg-indigo-500 active:scale-90 disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Motivos de incompleto

const MOTIVOS_COMUNES = [
  'Faltó material', 'No había acceso al lugar', 'Faltó herramienta o equipo', 'Clima no permitió trabajar',
  'Problema con el equipo/instalación más grave de lo esperado', 'Faltó personal', 'El establecimiento estaba cerrado',
  'Se necesita otro tipo de trabajo primero',
];

export function WorkOrderIncompleteReason({ motivos, onChange }: { motivos: MotivoIncompleto[]; onChange: (v: MotivoIncompleto[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [texto, setTexto] = useState('');
  const add = (m: string) => {
    if (!m.trim() || motivos.some((x) => x.texto === m.trim())) return;
    onChange([...motivos, { id: crypto.randomUUID(), texto: m.trim() }]);
    setTexto('');
    setAdding(false);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardX className="h-4 w-4 text-red-400" />
          <span className="text-sm font-semibold">¿Por qué no se terminó?</span>
          {motivos.length > 0 && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">{motivos.length} motivo{motivos.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-red-400 hover:text-red-300" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> Agregar motivo
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Si la OT quedó incompleta, contanos por qué. Esto ayuda al supervisor a tomar acción.</p>
      {motivos.length > 0 && (
        <div className="space-y-1.5">
          {motivos.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-sm">
              <AlertOctagon className="h-3.5 w-3.5 flex-shrink-0 text-red-400" />
              <span className="flex-1">{m.texto}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0 text-destructive" onClick={() => onChange(motivos.filter((x) => x.id !== m.id))}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-xs font-semibold uppercase text-red-400">Seleccioná o escribí el motivo</p>
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_COMUNES.filter((mc) => !motivos.some((m) => m.texto === mc)).map((mc) => (
              <button key={mc} type="button" onClick={() => add(mc)}
                className="rounded-full border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-red-500/40 hover:bg-red-500/20 hover:text-red-300">
                {mc}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input className="h-8 flex-1 text-xs" placeholder="O escribí tu propio motivo..." value={texto}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTexto(e.target.value)} onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && add(texto)} />
            <Button size="sm" className="h-8 bg-red-600 px-3 text-xs hover:bg-red-700" onClick={() => add(texto)} disabled={!texto.trim()}>Agregar</Button>
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-full text-xs text-muted-foreground" onClick={() => setAdding(false)}>Cancelar</Button>
        </div>
      )}
      {motivos.length === 0 && !adding && <p className="py-1 text-center text-xs text-muted-foreground">Sin motivos de incompleto — ¡bien! ✓</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Materiales

// "Materiales a usar" van a ot_materiales (del pañol o anotados); "Faltantes" a la columna materiales_faltantes.
export function WorkOrderMaterials({ otId, puedeDescontar, faltantes, onChangeFaltantes, onCount }: {
  otId: string; puedeDescontar: boolean; faltantes: Faltante[]; onChangeFaltantes: (v: Faltante[]) => void; onCount?: (n: number) => void;
}) {
  const [materials, setMaterials] = useState<MaterialOT[]>([]);
  const [addingPlan, setAddingPlan] = useState(false);
  const [addingFalt, setAddingFalt] = useState(false);
  const [inventario, setInventario] = useState<ResultadoBusqueda[]>([]);
  const [q, setQ] = useState('');
  const [elegido, setElegido] = useState<ResultadoBusqueda | null>(null);
  const [newItem, setNewItem] = useState({ material_name: '', quantity: '1', unit_cost: '0' });
  const [newFalt, setNewFalt] = useState({ material: '', cantidad: '1', motivo: '' });
  const [guardando, setGuardando] = useState(false);

  const cargar = () => materialesDeOT(otId).then((m) => { setMaterials(m); onCount?.(m.length); }).catch(() => setMaterials([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [otId]);
  useEffect(() => {
    if (!addingPlan || q.trim().length < 2) { setInventario([]); return; }
    const t = setTimeout(() => buscar('materiales', q).then(setInventario).catch(() => setInventario([])), 250);
    return () => clearTimeout(t);
  }, [q, addingPlan]);

  const total = materials.reduce((s, m) => s + Number(m.total || 0), 0);

  const addPlanned = async () => {
    const n = Number(newItem.quantity.replace(',', '.')) || 1;
    if (!elegido && !newItem.material_name.trim()) return;
    setGuardando(true);
    try {
      await cargarMaterialOT({
        ot_id: otId, material_id: elegido?.id ?? null, descripcion: elegido ? '' : newItem.material_name.trim(), cantidad: n,
        costo_unitario: elegido ? 0 : Number(newItem.unit_cost.replace(',', '.')) || 0, descontar: !!elegido && puedeDescontar,
      });
      setNewItem({ material_name: '', quantity: '1', unit_cost: '0' });
      setElegido(null);
      setQ('');
      setAddingPlan(false);
      await cargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (m: MaterialOT) => {
    try { await quitarMaterialOT(m.id); await cargar(); } catch (e) { toast.error(limpiarError(e)); }
  };

  const addFaltante = () => {
    if (!newFalt.material.trim()) return;
    onChangeFaltantes([...faltantes, { material: newFalt.material.trim(), cantidad: Number(newFalt.cantidad.replace(',', '.')) || 1, motivo: newFalt.motivo.trim() }]);
    setNewFalt({ material: '', cantidad: '1', motivo: '' });
    setAddingFalt(false);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-indigo-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-200">Materiales a usar</span>
            {materials.length > 0 && <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">{materials.length}</span>}
          </div>
          <button type="button" onClick={() => { setAddingPlan(true); setAddingFalt(false); }}
            className="flex items-center gap-1 rounded-lg border border-indigo-500/30 px-2.5 py-1 text-[11px] text-indigo-400 transition-colors hover:border-indigo-400/50 hover:text-indigo-300">
            <Plus className="h-3 w-3" /> Agregar
          </button>
        </div>
        <div className="space-y-2">
          {materials.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl border border-slate-700/40 bg-slate-800/50 p-3">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-100">{m.descripcion}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {m.cantidad} {m.unidad || 'u.'}
                  {Number(m.costo_unitario) > 0 && <> · {fmt(Number(m.costo_unitario))}/u · <span className="font-semibold text-slate-400">{fmt(Number(m.total))}</span></>}
                  {m.descontar && <> · salió del pañol</>}
                </p>
              </div>
              <button type="button" aria-label={`Quitar ${m.descripcion}`} onClick={() => quitar(m)}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-red-950/30 hover:text-red-400 active:scale-90">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {total > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-indigo-800/30 bg-indigo-950/30 px-3 py-2">
              <span className="text-xs text-slate-400">Total estimado</span>
              <span className="text-sm font-bold text-indigo-300">{fmt(total)}</span>
            </div>
          )}
          {materials.length === 0 && !addingPlan && <p className="py-3 text-center text-xs text-slate-600">Sin materiales registrados</p>}
        </div>
        {addingPlan && (
          <div className="space-y-2.5 rounded-xl border border-indigo-700/30 bg-indigo-950/20 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300">Nuevo material</p>
              <button type="button" aria-label="Cerrar" onClick={() => setAddingPlan(false)} className="text-slate-500 hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
            </div>
            {elegido ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-800/80 px-3 py-2 text-xs text-white">
                <Package className="h-3.5 w-3.5 text-indigo-400" />
                <span className="flex-1 truncate">{elegido.etiqueta}{elegido.detalle ? ` — ${elegido.detalle}` : ''}</span>
                <button type="button" aria-label="Quitar" onClick={() => setElegido(null)} className="text-slate-500 hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <>
                <Input className="h-10 border-slate-700/50 bg-slate-800/80 text-xs text-white placeholder:text-slate-600" placeholder="Del inventario..."
                  value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} />
                {inventario.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-700/60 bg-slate-900">
                    {inventario.map((m) => (
                      <button key={m.id} type="button" onClick={() => { setElegido(m); setInventario([]); }}
                        className="block w-full truncate px-3 py-2 text-left text-xs text-white hover:bg-indigo-600/15">
                        {m.etiqueta}{m.detalle ? ` — ${m.detalle}` : ''}
                      </button>
                    ))}
                  </div>
                )}
                <Input className="h-10 border-slate-700/50 bg-slate-800/80 text-sm text-white placeholder:text-slate-600" placeholder="O escribir nombre..."
                  value={newItem.material_name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewItem((p) => ({ ...p, material_name: e.target.value }))} />
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-[10px] text-slate-500">Cantidad</p>
                <Input inputMode="decimal" className="h-10 border-slate-700/50 bg-slate-800/80 text-sm text-white" value={newItem.quantity}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewItem((p) => ({ ...p, quantity: e.target.value }))} />
              </div>
              {!elegido && (
                <div>
                  <p className="mb-1 text-[10px] text-slate-500">Costo unit. (opc.)</p>
                  <Input inputMode="decimal" className="h-10 border-slate-700/50 bg-slate-800/80 text-sm text-white" value={newItem.unit_cost}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewItem((p) => ({ ...p, unit_cost: e.target.value }))} />
                </div>
              )}
            </div>
            {elegido && !puedeDescontar && <p className="text-[11px] text-slate-500">Queda anotado. El jefe de sitio lo descuenta del pañol.</p>}
            <div className="flex gap-2">
              <button type="button" onClick={addPlanned} disabled={guardando || (!elegido && !newItem.material_name.trim())}
                className="h-10 flex-1 rounded-xl bg-indigo-600 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-40">
                {guardando ? 'Guardando...' : 'Agregar'}
              </button>
              <button type="button" onClick={() => setAddingPlan(false)}
                className="h-10 rounded-xl border border-slate-700 px-4 text-sm text-slate-400 transition-colors hover:border-slate-500 hover:text-white">Cancelar</button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-700/40" />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-200">Faltantes</span>
            {faltantes.length > 0 && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">{faltantes.length}</span>}
          </div>
          <button type="button" onClick={() => { setAddingFalt(true); setAddingPlan(false); }}
            className="flex items-center gap-1 rounded-lg border border-amber-600/30 px-2.5 py-1 text-[11px] text-amber-400 transition-colors hover:border-amber-500/50 hover:text-amber-300">
            <Plus className="h-3 w-3" /> Reportar
          </button>
        </div>
        <p className="text-[11px] text-slate-600">Registrá materiales que te faltaron durante la tarea.</p>
        <div className="space-y-2">
          {faltantes.map((f, idx) => (
            <div key={idx} className="flex items-start gap-3 rounded-xl border border-amber-700/30 bg-amber-950/20 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-100">{f.material}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Faltó: {f.cantidad} u.{f.motivo && <> · <span className="text-amber-300/70">{f.motivo}</span></>}</p>
              </div>
              <button type="button" aria-label="Quitar faltante" onClick={() => onChangeFaltantes(faltantes.filter((_, i) => i !== idx))}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-red-950/30 hover:text-red-400 active:scale-90">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {faltantes.length === 0 && !addingFalt && <p className="py-2 text-center text-xs text-slate-600">Sin faltantes reportados ✓</p>}
        </div>
        {addingFalt && (
          <div className="space-y-2.5 rounded-xl border border-amber-700/30 bg-amber-950/15 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">¿Qué te faltó?</p>
              <button type="button" aria-label="Cerrar" onClick={() => setAddingFalt(false)} className="text-slate-500 hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
            </div>
            <Input className="h-10 border-slate-700/50 bg-slate-800/80 text-sm text-white placeholder:text-slate-600" placeholder="Nombre del material..."
              value={newFalt.material} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewFalt((p) => ({ ...p, material: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-[10px] text-slate-500">Cantidad</p>
                <Input inputMode="decimal" className="h-10 border-slate-700/50 bg-slate-800/80 text-sm text-white" value={newFalt.cantidad}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewFalt((p) => ({ ...p, cantidad: e.target.value }))} />
              </div>
              <div>
                <p className="mb-1 text-[10px] text-slate-500">Motivo (opc.)</p>
                <Input className="h-10 border-slate-700/50 bg-slate-800/80 text-sm text-white placeholder:text-slate-600" placeholder="¿Por qué?"
                  value={newFalt.motivo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewFalt((p) => ({ ...p, motivo: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={addFaltante} disabled={!newFalt.material.trim()}
                className="h-10 flex-1 rounded-xl bg-amber-600 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:opacity-40">Reportar</button>
              <button type="button" onClick={() => setAddingFalt(false)}
                className="h-10 rounded-xl border border-slate-700 px-4 text-sm text-slate-400 transition-colors hover:border-slate-500 hover:text-white">Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Fotos

export function WorkOrderPhotos({ ot, onCount }: { ot: FilaTablero; onCount?: (n: number) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<FotoOT[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const cargar = () => listarFotos(ot.id).then((f) => { setPhotos(f); onCount?.(f.length); }).catch(() => setPhotos([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [ot.id]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        try { await subirFoto(ot, file); } catch (e) { toast.error(limpiarError(e)); }
      }
      await cargar();
    } finally {
      setUploading(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async (f: FotoOT) => {
    try { await borrarFoto(f); await cargar(); } catch (e) { toast.error(limpiarError(e)); }
  };

  return (
    <>
      <div className="space-y-3">
        {photos.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((f) => (
              <div key={f.id} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-700/50 bg-slate-800/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-colors group-hover:bg-black/40 group-hover:opacity-100">
                  <button type="button" aria-label="Ampliar" onClick={() => setLightbox(f.url)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition-colors hover:bg-white/30"><ZoomIn className="h-4 w-4" /></button>
                  <button type="button" aria-label="Quitar foto" onClick={() => removePhoto(f)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600/80 text-white backdrop-blur transition-colors hover:bg-red-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <button type="button" aria-label="Quitar foto" onClick={() => removePhoto(f)}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white sm:hidden"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={uploading}
            className="flex h-14 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-indigo-500/40 bg-indigo-500/5 font-medium text-indigo-400 transition-all hover:bg-indigo-500/10 active:bg-indigo-500/20 disabled:opacity-40">
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            <span className="text-xs">Cámara</span>
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex h-14 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-600/60 text-slate-400 transition-all hover:border-slate-500 hover:text-slate-300 active:bg-slate-800/40 disabled:opacity-40">
            <ImageIcon className="h-5 w-5" />
            <span className="text-xs">Galería</span>
          </button>
        </div>
        {uploading && <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Subiendo fotos...</p>}
        {photos.length > 0 && !uploading && <p className="text-center text-[10px] text-slate-600">{photos.length} foto{photos.length !== 1 ? 's' : ''}</p>}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" />
          <button type="button" aria-label="Cerrar" onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"><X className="h-5 w-5" /></button>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Reporte del operario (validación)

function fmtFecha(fecha?: string | null) {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ReporteOperarioResumen({ ot, checklist, faltantes, motivos, notas, onAprobar, onRechazar, loading }: {
  ot: FilaTablero; checklist: TareaChecklist[]; faltantes: Faltante[]; motivos: MotivoIncompleto[]; notas: string;
  onAprobar: () => void; onRechazar: () => void; loading: boolean;
}) {
  const [fotos, setFotos] = useState<FotoOT[]>([]);
  const [materiales, setMateriales] = useState<MaterialOT[]>([]);
  useEffect(() => {
    listarFotos(ot.id).then(setFotos).catch(() => setFotos([]));
    materialesDeOT(ot.id).then(setMateriales).catch(() => setMateriales([]));
  }, [ot.id]);

  const done = checklist.filter((t) => t.hecho).length;
  const total = checklist.length;
  const pct = total ? Math.round((done / total) * 100) : 100;
  const conTexto = motivos.filter((m) => m.texto?.trim());
  const gpsOk = ot.gps_lat != null && ot.gps_lng != null;
  const todoCompleto = total === 0 || done === total;
  const fotosOk = !ot.requiere_fotos || fotos.length > 0;

  return (
    <div className="overflow-hidden rounded-xl border border-amber-500/40 bg-amber-950/15">
      <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-900/30 px-4 py-2.5">
        <ClipboardX className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-amber-300">Reporte del Operario — esperando tu validación</span>
      </div>
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
          <span className="flex items-center gap-1"><User className="h-3 w-3 text-slate-500" /> {ot.asignado_nombre || 'Sin asignar'}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-slate-500" /> Inicio real: {fmtFecha(ot.fecha_inicio_real)}</span>
        </div>
        {total > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-slate-700/40 bg-slate-900/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <CheckSquare className={`h-4 w-4 ${todoCompleto ? 'text-emerald-400' : 'text-amber-400'}`} />
              <span className="text-xs font-semibold text-slate-200">Checklist</span>
            </div>
            <div className="text-right">
              <p className={`text-sm font-bold ${todoCompleto ? 'text-emerald-300' : 'text-amber-300'}`}>{done}/{total}</p>
              <p className="text-[10px] text-slate-500">{pct}% completado</p>
            </div>
          </div>
        )}
        {materiales.length > 0 && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500"><Package className="h-3 w-3" /> Materiales usados ({materiales.length})</p>
            <ul className="space-y-1">
              {materiales.map((m) => (
                <li key={m.id} className="flex justify-between rounded bg-slate-900/40 px-2 py-1 text-xs text-slate-300">
                  <span>{m.descripcion}</span>
                  <span className="tabular-nums text-slate-500">{m.cantidad}{Number(m.costo_unitario) ? ` · $${m.costo_unitario}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {faltantes.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-2.5">
            <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-red-400"><AlertTriangle className="h-3 w-3" /> Materiales faltantes ({faltantes.length})</p>
            <ul className="space-y-1">
              {faltantes.map((m, i) => (
                <li key={i} className="text-xs text-red-200">
                  <span className="font-medium">{m.material}</span>{m.cantidad != null ? ` — faltaron ${m.cantidad}` : ''}
                  {m.motivo ? <span className="block text-[11px] text-red-300/80">Motivo: {m.motivo}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
        {fotos.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500"><Camera className="h-3 w-3" /> Fotos del trabajo ({fotos.length})</p>
            <div className="grid grid-cols-4 gap-1.5">
              {fotos.map((f, i) => (
                <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer"
                  className="aspect-square overflow-hidden rounded-md border border-slate-700/50 transition-colors hover:border-amber-500/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}
        {gpsOk && (
          <div className="flex items-center justify-between rounded-lg border border-slate-700/40 bg-slate-900/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <Navigation className="h-3.5 w-3.5 text-emerald-400" />
              <div>
                <p className="font-mono text-xs text-emerald-300">{ot.gps_lat!.toFixed(5)}, {ot.gps_lng!.toFixed(5)}</p>
                <p className="text-[10px] text-slate-500">Precisión: {ot.gps_precision ? `±${Math.round(ot.gps_precision)}m` : 'N/D'}</p>
              </div>
            </div>
            <a href={`https://www.google.com/maps?q=${ot.gps_lat},${ot.gps_lng}`} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-indigo-500/30 bg-indigo-600/20 px-2.5 py-1 text-[11px] text-indigo-300 transition-colors hover:bg-indigo-600/40">Ver mapa</a>
          </div>
        )}
        {notas.trim() && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500"><MessageSquare className="h-3 w-3" /> Notas del operario</p>
            <p className="whitespace-pre-wrap rounded-lg border border-slate-700/40 bg-slate-900/40 px-2.5 py-2 text-xs leading-relaxed text-slate-200">{notas}</p>
          </div>
        )}
        {conTexto.length > 0 && (
          <div className="rounded-lg border border-orange-500/30 bg-orange-950/20 p-2.5">
            <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-orange-400"><ClipboardX className="h-3 w-3" /> Motivos de trabajo incompleto</p>
            <ul className="space-y-0.5">{conTexto.map((m) => <li key={m.id} className="text-xs text-orange-200">• {m.texto}</li>)}</ul>
          </div>
        )}
        {ot.rechazo_comentario && (
          <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-2.5">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-red-400">Rechazo anterior</p>
            <p className="text-xs text-red-200">{ot.rechazo_comentario}</p>
          </div>
        )}
        {(!todoCompleto || !fotosOk) && (
          <div className="flex items-start gap-2 rounded-lg border border-orange-500/40 bg-orange-950/30 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
            <p className="text-[11px] leading-snug text-orange-200">
              {!todoCompleto && `Faltan ${total - done} tarea(s) del checklist. `}
              {!fotosOk && 'La OT requiere al menos una foto. '}
              Si hay motivos de incompleto registrados el sistema permite aprobar; si no, rechazá y devolvé al operario.
            </p>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onRechazar} disabled={loading}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-600/15 text-sm font-bold text-red-300 transition-colors hover:bg-red-600/25 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            Rechazar y devolver
          </button>
          <button type="button" onClick={onAprobar} disabled={loading}
            className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-bold text-white shadow-lg shadow-emerald-950/40 transition-colors hover:bg-emerald-500 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Aprobar y completar
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Rechazo

export function RechazoOTModal({ open, onClose, onConfirm, loading }: { open: boolean; onClose: () => void; onConfirm: (c: string) => void; loading?: boolean }) {
  const [comentario, setComentario] = useState('');
  useEffect(() => { if (open) setComentario(''); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-red-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/15">
            <MessageSquareWarning className="h-4 w-4 text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Rechazar OT y devolver al operario</h3>
            <p className="text-[11px] text-slate-400">El operario verá este motivo al reabrir la OT</p>
          </div>
        </div>
        <textarea autoFocus value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Explicá qué falta o qué hay que corregir…"
          className="min-h-[110px] w-full resize-none rounded-lg border border-slate-700/60 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-red-500/50" />
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose}
            className="h-10 flex-1 rounded-lg border border-slate-700 bg-slate-800 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700">Cancelar</button>
          <button type="button" onClick={() => comentario.trim() && onConfirm(comentario)} disabled={!comentario.trim() || loading}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 text-sm font-bold text-white transition-colors hover:bg-red-500 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Rechazar y devolver
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Ubicación

export function LocationEditor({ onSave }: { onSave: (u: ResultadoBusqueda) => void }) {
  const [query, setQuery] = useState('');
  const [showList, setShowList] = useState(false);
  const [suggestions, setSuggestions] = useState<ResultadoBusqueda[]>([]);
  const [selected, setSelected] = useState<ResultadoBusqueda | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.trim().length < 2 || selected) { setSuggestions([]); return; }
    const t = setTimeout(() => buscar('ubicaciones', query).then(setSuggestions).catch(() => setSuggestions([])), 250);
    return () => clearTimeout(t);
  }, [query, selected]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input ref={inputRef} type="text" value={query} placeholder="Buscar por dirección o establecimiento…"
          onChange={(e) => { setQuery(e.target.value); setSelected(null); setShowList(true); }}
          onFocus={() => query.trim().length >= 2 && setShowList(true)}
          className="w-full rounded-lg border border-slate-600/60 bg-slate-800/80 py-2 pl-8 pr-8 text-sm text-white outline-none transition-all placeholder:text-slate-500 focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/30" />
        {query && (
          <button type="button" aria-label="Borrar" onClick={() => { setQuery(''); setSelected(null); inputRef.current?.focus(); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
        )}
      </div>
      {showList && suggestions.length > 0 && (
        <div className="max-h-56 overflow-hidden overflow-y-auto rounded-xl border border-slate-700/60 bg-slate-900 shadow-2xl">
          {suggestions.map((loc) => (
            <button key={loc.id} type="button" onMouseDown={(e) => { e.preventDefault(); setSelected(loc); setQuery(loc.etiqueta); setShowList(false); }}
              className="flex w-full items-start gap-3 border-b border-slate-800/60 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-indigo-600/15">
              <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-indigo-400" />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-white">{loc.etiqueta}</p>
                {loc.detalle && <p className="truncate text-[10px] text-slate-500">{loc.detalle}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
      {showList && !selected && query.trim().length >= 2 && suggestions.length === 0 && <p className="px-1 text-xs text-slate-500">Sin resultados para &quot;{query}&quot;</p>}
      {selected && (
        <div className="space-y-1.5 rounded-xl border border-indigo-500/30 bg-indigo-950/30 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-indigo-400" />
            <p className="truncate text-xs font-medium text-white">{selected.etiqueta}</p>
          </div>
          <button type="button" onClick={() => onSave(selected)}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-950/50 transition-all hover:bg-indigo-500 active:bg-indigo-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Confirmar ubicación
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Eliminar

export function DeleteWorkOrderButton({ titulo, asignado, onDelete }: { titulo: string; asignado?: string | null; onDelete: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-red-600 hover:bg-red-50 hover:text-red-700">
          <Trash2 className="h-4 w-4" /> Eliminar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar orden de trabajo?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminará permanentemente: <strong>{titulo}</strong>
            {asignado && ` (Asignada a ${asignado})`}
          </AlertDialogDescription>
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">Esta acción no se puede deshacer.</div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete} className="bg-red-600 hover:bg-red-700">Eliminar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ------------------------------------------------------------------ Firma (WorkOrderSignature de la v1)
// La firma se guarda como imagen PNG en la orden (fase 15); la fecha la pone la base.

export function WorkOrderSignature({ signatureUrl, signatureName, onChange }: {
  signatureUrl?: string | null; signatureName?: string | null; onChange: (v: { firma_url: string | null; firma_nombre: string | null }) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [name, setName] = useState(signatureName || '');
  const [saving, setSaving] = useState(false);

  const pintarFondo = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  };
  useEffect(() => { pintarFondo(); }, [signatureUrl]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => { e.preventDefault(); drawing.current = true; lastPos.current = getPos(e); };
  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !lastPos.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getPos(e);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    lastPos.current = pos;
    setHasDrawn(true);
  };
  const stopDraw = () => { drawing.current = false; };

  const guardar = async (v: { firma_url: string | null; firma_nombre: string | null }) => {
    setSaving(true);
    try { await onChange(v); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <PenTool className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Firma Digital</span>
      </div>
      {signatureUrl ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={signatureUrl} alt="Firma" className="max-h-24 rounded bg-white object-contain" />
            {signatureName && <p className="mt-1 text-xs text-muted-foreground">Firmado por: {signatureName}</p>}
          </div>
          <Button variant="outline" size="sm" className="gap-2 text-destructive" disabled={saving}
            onClick={() => { setHasDrawn(false); void guardar({ firma_url: null, firma_nombre: null }); }}>
            <Trash2 className="h-3.5 w-3.5" /> Borrar firma
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Input placeholder="Nombre del firmante" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} className="text-sm" />
          <div className="overflow-hidden rounded-lg border-2 border-dashed border-border">
            <canvas ref={canvasRef} width={400} height={120} aria-label="Área para firmar" className="w-full cursor-crosshair touch-none"
              onPointerDown={startDraw} onPointerMove={draw} onPointerUp={stopDraw} onPointerLeave={stopDraw} />
          </div>
          <p className="text-center text-xs text-muted-foreground">Dibujá la firma en el área de arriba</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => { pintarFondo(); setHasDrawn(false); }}>
              <Trash2 className="h-3.5 w-3.5" /> Limpiar
            </Button>
            <Button size="sm" className="flex-1 gap-1" disabled={!hasDrawn || saving}
              onClick={() => void guardar({ firma_url: canvasRef.current!.toDataURL('image/png'), firma_nombre: name.trim() || null })}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Guardar Firma
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
