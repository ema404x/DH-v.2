'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Calendar, Camera, CheckSquare, ChevronDown, ClipboardX, Download, FileText, Layers, Loader2, MapPin, Navigation, Package,
  QrCode, RefreshCw, Save, User, Wrench, X, Zap, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { guardarPlantilla } from '@/lib/gestion';
import { descargarPDFOrden } from '@/lib/pdfOT';
import { limpiarError } from '@/lib/errores';
import { urlDeQR } from '@/lib/qr';
import { useSesion } from '@/lib/sesion';
import {
  actualizarOT, eliminarOT, getTransitionAction, obtenerFila, transicionar, type Accion, type FilaTablero, type PersonaSector,
} from '@/lib/tablero';
import type { MotivoIncompleto, TareaChecklist } from '@/lib/types';
import { CancelarOTModal, QRCodeModal, TYPE_LABELS, dueñoDe, lugarDe } from './piezas';
import {
  DeleteWorkOrderButton, LocationEditor, RechazoOTModal, ReporteOperarioResumen, WorkOrderChecklist, WorkOrderIncompleteReason,
  WorkOrderMaterials, WorkOrderPhotos, WorkOrderSignature, type Faltante,
} from './secciones';

// Panel de detalle de la v1 (components/workorders/WorkOrderDetailPanel.jsx) sobre los datos de la v2.

const PRIORITY_CFG: Record<string, { label: string; dot: string; pill: string }> = {
  baja: { label: 'Baja', dot: 'bg-slate-400', pill: 'bg-slate-700/60 text-slate-300 border-slate-600' },
  media: { label: 'Media', dot: 'bg-blue-400', pill: 'bg-blue-900/50 text-blue-300 border-blue-700' },
  alta: { label: 'Alta', dot: 'bg-orange-400', pill: 'bg-orange-900/50 text-orange-300 border-orange-700' },
  urgente: { label: 'Urgente', dot: 'bg-red-500 animate-pulse', pill: 'bg-red-900/50 text-red-300 border-red-700' },
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pendiente: { label: 'Pendiente', color: 'text-yellow-300', bg: 'bg-yellow-900/30 border-yellow-700/50' },
  asignada: { label: 'Asignada', color: 'text-blue-300', bg: 'bg-blue-900/30 border-blue-700/50' },
  en_progreso: { label: 'En Progreso', color: 'text-violet-300', bg: 'bg-violet-900/30 border-violet-700/50' },
  obra: { label: 'Obra', color: 'text-pink-300', bg: 'bg-pink-900/30 border-pink-700/50' },
  pendiente_validacion: { label: 'Validación', color: 'text-amber-300', bg: 'bg-amber-900/30 border-amber-700/50' },
  completada: { label: 'Completada', color: 'text-emerald-300', bg: 'bg-emerald-900/30 border-emerald-700/50' },
  cancelada: { label: 'Cancelada', color: 'text-red-300', bg: 'bg-red-900/30 border-red-700/50' },
};

const ACCIONES: Record<string, { accion: Accion; label: string; variant: string }[]> = {
  pendiente: [{ accion: 'asignar', label: 'Asignar', variant: 'blue' }],
  asignada: [{ accion: 'iniciar', label: 'Iniciar', variant: 'sky' }],
  en_progreso: [{ accion: 'finalizar', label: 'Finalizar', variant: 'emerald' }],
  pendiente_validacion: [{ accion: 'aprobar', label: 'Aprobar', variant: 'emerald' }, { accion: 'rechazar', label: 'Rechazar', variant: 'red' }],
  obra: [{ accion: 'completar', label: 'Completar', variant: 'emerald' }],
};
const ACTION_VARIANTS: Record<string, string> = {
  blue: 'bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30',
  sky: 'bg-sky-600/20 border border-sky-500/30 text-sky-300 hover:bg-sky-600/30',
  emerald: 'bg-emerald-600 text-white hover:bg-emerald-500',
  red: 'bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30',
};

function CollapseSection({ icon: Icon, title, badge, defaultOpen = true, accent, children }: {
  icon: LucideIcon; title: string; badge?: ReactNode; defaultOpen?: boolean; accent?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`overflow-hidden rounded-xl border transition-all ${accent ? 'border-orange-700/40' : 'border-slate-700/50'}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`flex w-full items-center justify-between px-4 py-3 transition-colors ${accent ? 'bg-orange-900/20 hover:bg-orange-900/30' : 'bg-slate-800/60 hover:bg-slate-800/90'}`}>
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${accent ? 'text-orange-400' : 'text-slate-400'}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${accent ? 'text-orange-300' : 'text-slate-300'}`}>{title}</span>
          {badge != null && badge !== 0 && badge !== '' && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${accent ? 'bg-orange-500/20 text-orange-300' : 'bg-indigo-500/20 text-indigo-300'}`}>{badge}</span>
          )}
        </div>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="bg-slate-900/40 px-4 py-3">{children}</div>}
    </div>
  );
}

function MiniRing({ value, total, color = '#6366f1' }: { value: number; total: number; color?: string }) {
  if (!total) return null;
  const pct = Math.round((value / total) * 100);
  const r = 14;
  const circ = 2 * Math.PI * r;
  return (
    <svg width="36" height="36" className="-rotate-90" aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" stroke="#1e293b" strokeWidth="3" />
      <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${(pct / 100) * circ} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.5s ease' }} />
      <text x="18" y="18" textAnchor="middle" dominantBaseline="central" className="fill-white font-bold" transform="rotate(90, 18, 18)" style={{ fontSize: 9 }}>{pct}%</text>
    </svg>
  );
}

// Campos que el panel edita (lo demás lo pone la base).
interface Editable {
  checklist: TareaChecklist[];
  notas: string | null;
  motivos_incompleto: MotivoIncompleto[];
  materiales_faltantes: Faltante[];
  fecha_programada: string | null;
  asignado_a: string | null;
  ubicacion_id: string | null;
}
const editables = (o: FilaTablero): Editable => ({
  checklist: o.checklist ?? [], notas: o.notas, motivos_incompleto: o.motivos_incompleto ?? [], materiales_faltantes: o.materiales_faltantes ?? [],
  fecha_programada: o.fecha_programada, asignado_a: o.asignado_a, ubicacion_id: o.ubicacion_id,
});

export function WorkOrderDetailPanel({ order, personas, onClose, onChanged }: {
  order: FilaTablero; personas: PersonaSector[]; onClose: () => void; onChanged: () => void;
}) {
  const { esGerencia, puedeValidar } = useSesion();
  const [fresh, setFresh] = useState<FilaTablero>(order);
  const [data, setData] = useState<Editable>(() => editables(order));
  const [loadingFresh, setLoadingFresh] = useState(true);
  const [qrOpen, setQrOpen] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [rechazoOpen, setRechazoOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [stateActionLoading, setStateActionLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generandoPDF, setGenerandoPDF] = useState(false);
  const [nFotos, setNFotos] = useState(order.fotos_total);
  const [nMateriales, setNMateriales] = useState(0);

  const personasMap = new Map(personas.map((p) => [p.id, p]));
  const { name: creadorPor, label: creadorLabel } = dueñoDe(fresh, personasMap);
  // Un jefe de sitio no asigna a otros jefes; gerencia, a cualquiera (como la v1).
  const asignables = personas.filter((p) => p.activo && (esGerencia || p.rol !== 'jefe_sitio' || p.id === data.asignado_a));

  // ── autoguardado: solo los campos tocados, 400 ms después del último cambio (como la v1)
  const dirty = useRef(new Set<keyof Editable>());
  const latest = useRef(data);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const cerrarAlGuardar = useRef(false);

  const recargar = useCallback(async () => {
    setLoadingFresh(true);
    try {
      const f = await obtenerFila(order.id);
      setFresh(f);
      if (dirty.current.size === 0) { setData(editables(f)); latest.current = editables(f); }
    } catch { /* se queda con lo que tenía */ } finally {
      setLoadingFresh(false);
    }
  }, [order.id]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recargar(); }, [order.id]);

  const flushDirty = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (dirty.current.size === 0) return;
    const patch: Record<string, unknown> = {};
    dirty.current.forEach((k) => { patch[k] = latest.current[k]; });
    dirty.current.clear();
    setSaving(true);
    try {
      await actualizarOT(order.id, patch);
      toast.success('Guardado');
      onChanged();
      if (cerrarAlGuardar.current) { cerrarAlGuardar.current = false; onClose(); return; }
      if (mounted.current) recargar();
    } catch (err) {
      toast.error(limpiarError(err));
      cerrarAlGuardar.current = false;
      if (mounted.current) recargar();
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [order.id, onChanged, onClose, recargar]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (dirty.current.size > 0) void flushDirty(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveFields = useCallback((fields: Partial<Editable>) => {
    setData((p) => {
      const next = { ...p, ...fields };
      latest.current = next;
      (Object.keys(fields) as (keyof Editable)[]).forEach((k) => dirty.current.add(k));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (mounted.current) void flushDirty(); }, 400);
      return next;
    });
  }, [flushDirty]);

  // ── estados
  const ejecutar = async (accion: Accion, extra = {}) => {
    setStateActionLoading(true);
    if (dirty.current.size > 0) await flushDirty();
    try {
      toast.success(await transicionar({ ...fresh, asignado_a: data.asignado_a }, accion, extra));
      onChanged();
      if (['aprobar', 'cancelar', 'rechazar', 'convertir_obra', 'completar'].includes(accion)) onClose();
      else await recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      if (mounted.current) setStateActionLoading(false);
    }
  };

  const handleStateAction = (accion: Accion) => {
    if (accion === 'rechazar') { setRechazoOpen(true); return; }
    if (accion === 'cancelar') { setCancelOpen(true); return; }
    void ejecutar(accion);
  };

  const handleStatusDropdownChange = (newStatus: string) => {
    if (newStatus === fresh.estado) return;
    const action = getTransitionAction(fresh.estado, newStatus);
    if (!action) {
      toast.error(`Transición no válida: ${STATUS_CFG[fresh.estado]?.label ?? fresh.estado} → ${STATUS_CFG[newStatus]?.label ?? newStatus}`);
      return;
    }
    handleStateAction(action);
  };

  const handleSaveAsTemplate = async () => {
    const nombre = window.prompt('Nombre de la plantilla:', fresh.titulo);
    if (!nombre) return;
    setSavingTemplate(true);
    try {
      await guardarPlantilla(null, {
        nombre, titulo: fresh.titulo, tipo: fresh.tipo, prioridad: fresh.prioridad, descripcion: fresh.descripcion, horas_estimadas: fresh.horas_estimadas,
        checklist: data.checklist.map((t) => ({ ...t, hecho: false })), requiere_fotos: nFotos > 0,
      });
      toast.success('Plantilla guardada');
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setSavingTemplate(false);
    }
  };

  // Botón "Obra" de la v1: crea el pendiente de tipo obra y deja la orden en "obra".
  const convertirEnObra = () => {
    if (!window.confirm('¿Convertir esta OT a Futura Obra? Se creará un pendiente de tipo obra y la OT quedará en estado "Obra".')) return;
    void ejecutar('convertir_obra');
  };

  const guardarFirma = async (v: { firma_url: string | null; firma_nombre: string | null }) => {
    try {
      await actualizarOT(fresh.id, v);
      toast.success(v.firma_url ? 'Firma guardada' : 'Firma borrada');
      await recargar();
      onChanged();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  };

  const borrar = async () => {
    try {
      await eliminarOT(fresh.id);
      toast.success('OT eliminada correctamente');
      onChanged();
      onClose();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  };

  const checklist = data.checklist;
  const doneCount = checklist.filter((t) => t.hecho).length;
  const checklistBlocked = checklist.length > 0 && doneCount < checklist.length;
  const photosBlocked = fresh.requiere_fotos && nFotos === 0;
  const pCfg = PRIORITY_CFG[fresh.prioridad] || PRIORITY_CFG.media;
  const sCfg = STATUS_CFG[fresh.estado] || STATUS_CFG.pendiente;
  const lugar = lugarDe(fresh);
  const acciones = ACCIONES[fresh.estado] ?? [];
  const asignadoNombre = data.asignado_a ? personasMap.get(data.asignado_a)?.nombre ?? fresh.asignado_nombre : null;

  const save = () => {
    if (checklistBlocked) { toast.warning(`Faltan ${checklist.length - doneCount} tarea(s)`); return; }
    if (photosBlocked) { toast.warning('Falta foto obligatoria'); return; }
    if (dirty.current.size === 0) { onClose(); return; }
    cerrarAlGuardar.current = true;
    void flushDirty();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => { if (!saving) onClose(); }} />
        <div role="dialog" aria-modal="true" aria-label={fresh.titulo}
          className="relative z-10 flex w-full flex-col overflow-hidden rounded-t-2xl border border-white/8 bg-[#0d1117] shadow-2xl sm:mx-4 sm:max-w-lg sm:rounded-2xl"
          style={{ height: '93dvh', maxHeight: 'calc(100dvh - 12px)' }}>

          <div className="relative flex-shrink-0 overflow-hidden" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #1e3a5f 100%)' }}>
            <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 -translate-y-1/2 translate-x-1/2 rounded-full bg-indigo-500/10 blur-2xl" />
            <div className="pointer-events-none absolute bottom-0 left-0 h-24 w-24 -translate-x-1/2 translate-y-1/2 rounded-full bg-blue-500/10 blur-xl" />
            <div className="relative px-5 pb-4 pr-14 pt-5">
              <p className="mb-1 font-mono text-[10px] tracking-widest text-white/40">{fresh.codigo}</p>
              <h2 className="mb-3 line-clamp-2 text-base font-bold leading-snug text-white sm:text-[17px]">{fresh.titulo}</h2>
              <div className="flex flex-wrap gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${pCfg.pill}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${pCfg.dot}`} />{pCfg.label}
                </span>
                <span className="rounded-full border border-white/15 bg-white/8 px-2.5 py-0.5 text-[11px] font-medium text-white/70">{TYPE_LABELS[fresh.tipo] || fresh.tipo}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${sCfg.color} ${sCfg.bg}`}>{sCfg.label}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {lugar && <span className="flex items-center gap-1 text-[11px] text-white/55"><MapPin className="h-3 w-3 flex-shrink-0 text-white/30" />{lugar}</span>}
                {asignadoNombre && <span className="flex items-center gap-1 text-[11px] text-white/55"><User className="h-3 w-3 flex-shrink-0 text-white/30" />{asignadoNombre}</span>}
                {data.fecha_programada && <span className="flex items-center gap-1 text-[11px] text-white/55"><Calendar className="h-3 w-3 flex-shrink-0 text-white/30" />{data.fecha_programada}</span>}
                <span className="flex items-center gap-1 text-[11px] text-white/55"><User className="h-3 w-3 flex-shrink-0 text-white/30" />{creadorLabel} {creadorPor}</span>
              </div>
            </div>
            <button type="button" aria-label="Cerrar" onClick={onClose}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition-all hover:bg-white/20 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            {loadingFresh && <div className="absolute right-14 top-4"><RefreshCw className="h-3.5 w-3.5 animate-spin text-white/30" /></div>}
          </div>

          <div className="grid flex-shrink-0 grid-cols-3 gap-2 border-b border-white/6 bg-slate-900/80 px-4 py-3">
            <div>
              <p className="mb-1.5 text-[9px] uppercase tracking-widest text-slate-500">Estado</p>
              <Select value={fresh.estado} onValueChange={handleStatusDropdownChange}>
                <SelectTrigger className="h-8 rounded-lg border-white/10 bg-slate-800/80 text-[11px] text-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CFG).map(([val, cfg]) => <SelectItem key={val} value={val} className="text-xs">{cfg.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {checklistBlocked && (
                <p className="mt-1 flex items-center gap-0.5 text-[9px] text-orange-400"><AlertTriangle className="h-2.5 w-2.5" />{doneCount}/{checklist.length} hechas</p>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-[9px] uppercase tracking-widest text-slate-500">Responsable</p>
              <select value={data.asignado_a ?? ''} disabled={!puedeValidar} aria-label="Responsable"
                onChange={(e) => saveFields({ asignado_a: e.target.value || null })}
                className="h-8 w-full rounded-lg border border-white/10 bg-slate-800/80 px-2 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60">
                <option value="">Nombre del responsable…</option>
                {asignables.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-[9px] uppercase tracking-widest text-slate-500">Fecha</p>
              <Input type="date" value={data.fecha_programada ?? ''} disabled={!puedeValidar}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => saveFields({ fecha_programada: e.target.value || null })}
                className="h-8 rounded-lg border-white/10 bg-slate-800/80 px-2 text-[11px] text-white" />
            </div>
          </div>

          {acciones.length > 0 && fresh.estado !== 'pendiente_validacion' && (
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/6 bg-slate-900/80 px-4 py-2.5">
              {acciones.map((act) => (
                <button key={act.accion} type="button" onClick={() => handleStateAction(act.accion)} disabled={stateActionLoading}
                  className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50 ${ACTION_VARIANTS[act.variant]}`}>
                  {stateActionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {act.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
            {fresh.estado === 'pendiente_validacion' && (
              <ReporteOperarioResumen ot={fresh} checklist={checklist} faltantes={data.materiales_faltantes} motivos={data.motivos_incompleto}
                notas={data.notas ?? ''} loading={stateActionLoading} onAprobar={() => handleStateAction('aprobar')} onRechazar={() => setRechazoOpen(true)} />
            )}

            {!fresh.ubicacion_id && puedeValidar && (
              <div className="overflow-hidden rounded-xl border border-amber-500/40 bg-amber-950/20">
                <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-900/30 px-4 py-2.5">
                  <MapPin className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">Asignar ubicación</span>
                </div>
                <div className="px-4 py-3">
                  <LocationEditor onSave={(u) => { saveFields({ ubicacion_id: u.id }); toast.success('Ubicación asignada correctamente'); }} />
                </div>
              </div>
            )}

            {fresh.descripcion && (
              <CollapseSection icon={FileText} title="Instrucciones" defaultOpen>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{fresh.descripcion}</p>
              </CollapseSection>
            )}

            <CollapseSection icon={CheckSquare} title="Checklist" badge={checklist.length > 0 ? `${doneCount}/${checklist.length}` : null} defaultOpen>
              {checklist.length > 0 && (
                <div className="mb-3 flex items-center gap-3">
                  <MiniRing value={doneCount} total={checklist.length} color={doneCount === checklist.length ? '#10b981' : '#6366f1'} />
                  <div>
                    <p className="text-xs font-semibold text-slate-200">{doneCount === checklist.length ? '¡Todo completado!' : `${checklist.length - doneCount} tarea(s) pendiente(s)`}</p>
                    <p className="text-[10px] text-slate-500">{Math.round((doneCount / checklist.length) * 100)}% del trabajo listo</p>
                  </div>
                </div>
              )}
              <WorkOrderChecklist checklist={checklist} onChange={(v) => saveFields({ checklist: v })} />
            </CollapseSection>

            {fresh.gps_lat != null && fresh.gps_lng != null && (
              <CollapseSection icon={Navigation} title="Ubicación GPS" defaultOpen={false}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm text-emerald-300">{fresh.gps_lat.toFixed(5)}, {fresh.gps_lng.toFixed(5)}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">Precisión: {fresh.gps_precision ? `±${Math.round(fresh.gps_precision)}m` : 'N/D'}</p>
                  </div>
                  <a href={`https://www.google.com/maps?q=${fresh.gps_lat},${fresh.gps_lng}`} target="_blank" rel="noopener noreferrer"
                    className="rounded-lg border border-indigo-500/30 bg-indigo-600/20 px-3 py-1.5 text-[11px] text-indigo-300 transition-colors hover:bg-indigo-600/40">Ver mapa</a>
                </div>
              </CollapseSection>
            )}

            <CollapseSection icon={Package} title="Materiales" badge={nMateriales || null} defaultOpen={false}>
              <WorkOrderMaterials otId={fresh.id} puedeDescontar={puedeValidar} faltantes={data.materiales_faltantes}
                onChangeFaltantes={(v) => saveFields({ materiales_faltantes: v })} onCount={setNMateriales} />
            </CollapseSection>

            <CollapseSection icon={Camera} title="Fotos & Firma" badge={nFotos || null} defaultOpen={false}>
              <div className="space-y-4">
                <WorkOrderPhotos ot={fresh} onCount={setNFotos} />
                <div className="border-t border-slate-700/50 pt-4">
                  <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Firma de conformidad</p>
                  <WorkOrderSignature signatureUrl={fresh.firma_url} signatureName={fresh.firma_nombre} onChange={guardarFirma} />
                </div>
              </div>
            </CollapseSection>

            <CollapseSection icon={Zap} title="Notas" defaultOpen={false}>
              <textarea value={data.notas ?? ''} onChange={(e) => saveFields({ notas: e.target.value })} placeholder="Agregar observaciones..."
                className="min-h-[90px] w-full resize-none rounded-lg border border-slate-700/50 bg-slate-950/50 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50" />
            </CollapseSection>

            <CollapseSection icon={ClipboardX} title="Motivos Incompleto" accent defaultOpen={false}>
              <WorkOrderIncompleteReason motivos={data.motivos_incompleto} onChange={(v) => saveFields({ motivos_incompleto: v })} />
            </CollapseSection>
          </div>

          <div className="flex-shrink-0 border-t border-white/6 bg-slate-900/90 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button type="button" title="PDF" aria-label="PDF" disabled={generandoPDF}
                  onClick={async () => { setGenerandoPDF(true); try { await descargarPDFOrden(fresh); } catch (e) { toast.error(limpiarError(e)); } finally { setGenerandoPDF(false); } }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40">
                  {generandoPDF ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                </button>
                {puedeValidar && (
                  <button type="button" onClick={handleSaveAsTemplate} disabled={savingTemplate} title="Guardar plantilla" aria-label="Guardar plantilla"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40">
                    {savingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                  </button>
                )}
                <button type="button" onClick={() => setQrOpen(true)} title="QR" aria-label="QR"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:border-white/20 hover:text-white">
                  <QrCode className="h-3.5 w-3.5" />
                </button>
                {puedeValidar && !['completada', 'cancelada', 'obra'].includes(fresh.estado) && (
                  <button type="button" onClick={convertirEnObra} disabled={stateActionLoading} title="Convertir a Futura Obra"
                    className="flex h-8 items-center gap-1 rounded-lg border border-amber-500/30 px-2 text-[10px] font-semibold text-amber-400 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10 disabled:opacity-40">
                    {stateActionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                    Obra
                  </button>
                )}
                {esGerencia && <DeleteWorkOrderButton titulo={fresh.titulo} asignado={asignadoNombre} onDelete={borrar} />}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 transition-colors hover:border-white/20 hover:text-white">Cerrar</button>
                <button type="button" onClick={save} disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-950/50 transition-all hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50">
                  {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Guardando</> : <><Save className="h-3.5 w-3.5" />Guardar</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <QRCodeModal open={qrOpen} onClose={() => setQrOpen(false)} title={fresh.titulo} subtitle={lugar || fresh.activo_nombre || `OT ${fresh.codigo}`}
        value={fresh.ubicacion_qr_token ? urlDeQR(fresh.ubicacion_qr_token) : `${typeof window !== 'undefined' ? window.location.origin : ''}/ot/${fresh.id}`} />
      <RechazoOTModal open={rechazoOpen} onClose={() => setRechazoOpen(false)} loading={stateActionLoading}
        onConfirm={(c) => { setRechazoOpen(false); void ejecutar('rechazar', { rechazo_comentario: c }); }} />
      <CancelarOTModal open={cancelOpen} otTitle={fresh.titulo} loading={stateActionLoading} onClose={() => setCancelOpen(false)}
        onConfirm={() => { setCancelOpen(false); void ejecutar('cancelar'); }} />
    </>
  );
}
