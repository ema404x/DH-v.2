'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { motion } from 'framer-motion';
import {
  AlertTriangle, Check, CheckCircle2, ChevronRight, Copy, Download, Filter, Layers, Loader2, MapPin, Plus, Printer, QrCode, RotateCcw, Trash2,
  User, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { borrarPlantilla, listarPlantillas } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';
import { esOtVencida, type FilaTablero, type PersonaSector } from '@/lib/tablero';
import type { Plantilla } from '@/lib/types';

// Piezas de la pantalla de órdenes de la v1 (components/workorders/*.jsx), sobre los datos de la v2.

export const STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  asignada: 'Asignada',
  en_progreso: 'En Progreso',
  obra: 'Obra',
  pendiente_validacion: 'Validación',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

export const TYPE_LABELS: Record<string, string> = {
  mantenimiento_preventivo: 'Preventivo', mantenimiento_correctivo: 'Correctivo', instalacion: 'Instalación',
  inspeccion: 'Inspección', reparacion: 'Reparación', emergencia: 'Emergencia',
};

export const lugarDe = (o: FilaTablero) => o.ubicacion_nombre ?? o.ubicacion_direccion ?? '';

// useResolveCreator.resolveOTOwner de la v1.
export function dueñoDe(o: FilaTablero, personas: Map<string, PersonaSector>): { name: string; label: string } {
  const creador = o.created_by ? personas.get(o.created_by)?.nombre : null;
  if (creador) return { name: creador, label: 'Creada por' };
  if (o.jefe_sitio_nombre?.trim()) return { name: o.jefe_sitio_nombre.trim(), label: 'Jefe de sitio' };
  return { name: 'Sin asignar', label: 'Responsable' };
}

// ------------------------------------------------------------------ EmptyState

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: {
  icon?: LucideIcon; title: string; description: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
      {Icon && (
        <div className="relative mb-5">
          <div className="absolute inset-0 scale-125 rounded-2xl bg-primary/5 blur-xl" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-border/60 bg-card shadow-xl">
            <Icon className="h-9 w-9 text-muted-foreground/60" />
          </div>
        </div>
      )}
      <h3 className="mb-1.5 text-base font-semibold text-foreground">{title}</h3>
      <p className="mb-6 max-w-xs text-sm leading-relaxed text-muted-foreground">{description}</p>
      {actionLabel && (
        <Button onClick={onAction} className="gap-2 shadow-lg shadow-primary/20">
          <Plus className="h-4 w-4" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ QR

export function WorkOrderQRButton({ order, onShowQR }: { order: FilaTablero; onShowQR: (o: FilaTablero) => void }) {
  return (
    <Button variant="ghost" size="icon" title="Ver QR de la orden" className="h-7 w-7 text-primary hover:bg-primary/10"
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); onShowQR(order); }}>
      <QrCode className="h-3.5 w-3.5" />
    </Button>
  );
}

export function QRCodeModal({ open, onClose, title, subtitle, value }: { open: boolean; onClose: () => void; title: string; subtitle?: string; value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [qrReady, setQrReady] = useState(false);

  useEffect(() => {
    if (!open || !value) return;
    setQrReady(false);
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      QRCode.toCanvas(canvas, value, { width: 220, margin: 2, color: { dark: '#0a1628', light: '#ffffff' }, errorCorrectionLevel: 'M' })
        .then(() => setQrReady(true)).catch(() => {});
    }, 100);
    return () => clearTimeout(timer);
  }, [open, value]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `QR_${(title || 'codigo').replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handlePrint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    win.document.write(`<html><head><title>QR - ${esc(title)}</title><style>
      body { margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: sans-serif; background: #fff; }
      .card { border: 2px solid #e2e8f0; border-radius: 16px; padding: 24px; text-align: center; max-width: 300px; }
      h2 { margin: 0 0 4px; color: #0a1628; font-size: 18px; } p { margin: 0 0 16px; color: #64748b; font-size: 13px; }
      img { width: 200px; height: 200px; } .footer { margin-top: 12px; font-size: 10px; color: #94a3b8; }
      </style></head><body><div class="card"><h2>${esc(title || '')}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
      <img src="${canvas.toDataURL()}" /><div class="footer">DH1 Software</div></div></body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 500);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-base">Código QR</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-border bg-white p-4 shadow-sm">
            <p className="text-center text-sm font-bold leading-tight text-foreground">{title}</p>
            {subtitle && <p className="text-center text-xs text-muted-foreground">{subtitle}</p>}
            <div className="relative" style={{ minWidth: 220, minHeight: 220 }}>
              <canvas ref={canvasRef} className="rounded-lg" />
              {!qrReady && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
                </div>
              )}
            </div>
          </div>
          <div className="grid w-full grid-cols-3 gap-2">
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={handleDownload}><Download className="h-3.5 w-3.5" /> Bajar</Button>
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={handlePrint}><Printer className="h-3.5 w-3.5" /> Imprimir</Button>
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Listo' : 'Copiar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Kanban

const COLUMNS = [
  { id: 'pendiente', label: 'Pendiente', color: 'border-t-yellow-500', dot: 'bg-yellow-500', count_bg: 'bg-yellow-500/20 text-yellow-400' },
  { id: 'asignada', label: 'Asignada', color: 'border-t-blue-500', dot: 'bg-blue-500', count_bg: 'bg-blue-500/20 text-blue-400' },
  { id: 'en_progreso', label: 'En Progreso', color: 'border-t-purple-500', dot: 'bg-purple-500', count_bg: 'bg-purple-500/20 text-purple-400' },
  { id: 'pendiente_validacion', label: 'Validación', color: 'border-t-amber-400', dot: 'bg-amber-400', count_bg: 'bg-amber-400/20 text-amber-300' },
  { id: 'completada', label: 'Completada', color: 'border-t-emerald-500', dot: 'bg-emerald-500', count_bg: 'bg-emerald-500/20 text-emerald-400' },
  { id: 'obra', label: 'Obra', color: 'border-t-pink-400', dot: 'bg-pink-400', count_bg: 'bg-pink-400/20 text-pink-300' },
  { id: 'cancelada', label: 'Cancelada', color: 'border-t-red-500', dot: 'bg-red-500', count_bg: 'bg-red-500/20 text-red-400' },
];

const priorityColors: Record<string, string> = {
  baja: 'bg-slate-700 text-slate-300',
  media: 'bg-blue-900/60 text-blue-300',
  alta: 'bg-orange-900/60 text-orange-300',
  urgente: 'bg-red-900/60 text-red-300 font-bold',
};

interface Comunes {
  onOpen: (o: FilaTablero) => void;
  onShowQR: (o: FilaTablero) => void;
  personas: Map<string, PersonaSector>;
}

function KanbanCard({ order, index, onOpen, onShowQR, readOnly, personas }: Comunes & { order: FilaTablero; index: number; readOnly: boolean }) {
  const isOverdue = esOtVencida(order);
  const { name: creadorPor, label: creadorLabel } = dueñoDe(order, personas);
  const lugar = lugarDe(order);
  return (
    <Draggable draggableId={order.id} index={index} isDragDisabled={readOnly}>
      {(provided, snapshot) => (
        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} onClick={() => onOpen(order)}
          className={`group cursor-pointer select-none rounded-xl border bg-card p-3 transition-all
            ${snapshot.isDragging ? 'rotate-1 scale-105 border-primary/50 shadow-2xl shadow-primary/30'
              : isOverdue ? 'border-red-500/30 hover:border-red-500/60' : 'border-border hover:border-primary/40'}`}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] capitalize ${priorityColors[order.prioridad] || priorityColors.media}`}>{order.prioridad}</span>
            <div onClick={(e) => e.stopPropagation()} className="opacity-0 transition-opacity group-hover:opacity-100">
              <WorkOrderQRButton order={order} onShowQR={onShowQR} />
            </div>
          </div>
          <p className="mb-2 line-clamp-2 text-sm font-semibold leading-tight text-foreground">{order.titulo}</p>
          <div className="space-y-1">
            {lugar ? (
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 flex-shrink-0" /><span className="truncate">{lugar}</span>
              </p>
            ) : null}
            {order.asignado_nombre && (
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <User className="h-3 w-3 flex-shrink-0" /><span className="truncate">{order.asignado_nombre}</span>
              </p>
            )}
            <p className="flex items-center gap-1 truncate text-[10px] text-muted-foreground/70">
              <Wrench className="h-2.5 w-2.5 flex-shrink-0" /><span className="truncate">{creadorLabel} {creadorPor}</span>
            </p>
          </div>
          {isOverdue && <div className="mt-2 inline-block rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400">VENCIDA</div>}
        </div>
      )}
    </Draggable>
  );
}

const KANBAN_VISIBLE_LIMIT = 40;

function KanbanColumn({ col, orders, readOnly, ...rest }: Comunes & { col: (typeof COLUMNS)[number]; orders: FilaTablero[]; readOnly: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? orders : orders.slice(0, KANBAN_VISIBLE_LIMIT);
  const hidden = orders.length - KANBAN_VISIBLE_LIMIT;
  return (
    <div className={`flex w-[240px] min-w-[240px] flex-shrink-0 flex-col rounded-xl border-t-2 bg-slate-900/50 ${col.color}`}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <div className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
        <span className="flex-1 text-sm font-semibold text-foreground">{col.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${col.count_bg}`}>{orders.length}</span>
      </div>
      <Droppable droppableId={col.id}>
        {(provided, snapshot) => (
          <div ref={provided.innerRef} {...provided.droppableProps}
            className={`max-h-[70vh] min-h-[120px] flex-1 space-y-2 overflow-y-auto rounded-b-xl p-2 transition-colors ${snapshot.isDraggingOver ? 'bg-primary/5' : ''}`}>
            {visible.map((order, index) => <KanbanCard key={order.id} order={order} index={index} readOnly={readOnly} {...rest} />)}
            {provided.placeholder}
            {orders.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border/50 text-xs text-muted-foreground/50">Sin órdenes</div>
            )}
            {!showAll && hidden > 0 && (
              <button type="button" onClick={() => setShowAll(true)}
                className="w-full rounded-lg border border-dashed border-slate-700 py-2 text-xs text-slate-400 transition-colors hover:text-white">
                + {hidden} más...
              </button>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}

export function KanbanBoard({ orders, onStatusChange, readOnly, ...rest }: Comunes & {
  orders: FilaTablero[]; onStatusChange: (id: string, to: string) => void; readOnly: boolean;
}) {
  const grouped = useMemo(() => Object.fromEntries(COLUMNS.map((c) => [c.id, orders.filter((o) => o.estado === c.id)])), [orders]);
  const handleDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return;
    onStatusChange(r.draggableId, r.destination.droppableId);
  };
  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex min-h-[500px] gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => <KanbanColumn key={col.id} col={col} orders={grouped[col.id] ?? []} readOnly={readOnly} {...rest} />)}
      </div>
    </DragDropContext>
  );
}

// ------------------------------------------------------------------ Grilla

export const WorkOrderCard = memo(function WorkOrderCard({ order, onOpen, onShowQR, onComplete, onStart, canComplete, personas }: Comunes & {
  order: FilaTablero; onComplete: (o: FilaTablero) => void; onStart: (o: FilaTablero) => void; canComplete: boolean;
}) {
  const isOverdue = esOtVencida(order);
  const { name: creadorPor, label: creadorLabel } = dueñoDe(order, personas);
  const isTerminal = ['completada', 'cancelada'].includes(order.estado);
  const lugar = lugarDe(order);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} onClick={() => onOpen(order)}
      className={`group relative cursor-pointer rounded-lg border bg-gradient-to-br from-slate-800/50 to-slate-900/50 p-4 backdrop-blur transition-all hover:-translate-y-1 ${isOverdue ? 'border-red-500/30 bg-red-500/5' : 'border-slate-700/50'}`}>
      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        <WorkOrderQRButton order={order} onShowQR={onShowQR} />
      </div>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-600">
          <Wrench className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-white">{order.titulo}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {order.activo_nombre && <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{order.activo_nombre}</span>}
            {lugar && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{lugar}</span>}
            {order.asignado_nombre && <span className="flex items-center gap-1"><User className="h-3 w-3" />{order.asignado_nombre}</span>}
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500"><User className="h-2.5 w-2.5" /> {creadorLabel} {creadorPor}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-slate-700/50 pt-3">
        <Badge className="bg-slate-700 text-xs text-slate-200">{STATUS_LABELS[order.estado] || order.estado}</Badge>
        <Badge variant="secondary" className="text-xs">{order.prioridad}</Badge>
        {isOverdue && <Badge className="bg-red-500/20 text-xs text-red-300">VENCIDA</Badge>}
        {canComplete && !isTerminal && ['pendiente', 'asignada'].includes(order.estado) && (
          <Button size="sm" className="ml-auto h-7 gap-1 bg-blue-600 px-3 text-xs text-white hover:bg-blue-500"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onStart(order); }}>
            <Zap className="h-3.5 w-3.5" /> Iniciar
          </Button>
        )}
        {canComplete && !isTerminal && ['en_progreso', 'pendiente_validacion', 'obra'].includes(order.estado) && (
          <Button size="sm" className="ml-auto h-7 gap-1 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-500"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onComplete(order); }}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            {order.estado === 'en_progreso' ? 'Finalizar' : order.estado === 'pendiente_validacion' ? 'Aprobar' : 'Completar'}
          </Button>
        )}
      </div>
    </motion.div>
  );
});

// ------------------------------------------------------------------ Cancelar

export function CancelarOTModal({ open, onClose, onConfirm, loading, otTitle }: {
  open: boolean; onClose: () => void; onConfirm: () => void; loading?: boolean; otTitle?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-red-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/15">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Cancelar orden de trabajo</h3>
            <p className="text-[11px] text-slate-400">Esta acción no se puede deshacer</p>
          </div>
        </div>
        <p className="mb-1 text-sm leading-relaxed text-slate-300">¿Estás seguro de que querés cancelar esta OT?</p>
        {otTitle && <p className="mb-4 line-clamp-2 text-xs leading-snug text-slate-500">«{otTitle}»</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose}
            className="h-10 flex-1 rounded-lg border border-slate-700 bg-slate-800 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700">No, volver</button>
          <button type="button" onClick={onConfirm} disabled={loading}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 text-sm font-bold text-white transition-colors hover:bg-red-500 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Sí, cancelar OT
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Plantillas

export function OTTemplateSelector({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (v: boolean) => void; onSelect: (t: Plantilla) => void }) {
  const [templates, setTemplates] = useState<Plantilla[]>([]);
  const cargar = () => listarPlantillas().then(setTemplates).catch((e) => toast.error(limpiarError(e)));
  useEffect(() => { if (open) cargar(); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Plantillas de OT</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 space-y-3 overflow-y-auto">
          {templates.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No hay plantillas aún. Guardá una OT como plantilla desde el panel de detalle.</p>
          )}
          {templates.map((t) => (
            <div key={t.id} className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{t.nombre}</p>
                <p className="truncate text-xs text-muted-foreground">{t.titulo}</p>
                <div className="mt-1 flex gap-2">
                  <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[t.tipo] || t.tipo}</Badge>
                  <Badge variant="outline" className="text-[10px]">{t.prioridad}</Badge>
                  {t.checklist?.length > 0 && <Badge variant="outline" className="text-[10px]">{t.checklist.length} tareas</Badge>}
                  {t.requiere_fotos && <Badge variant="outline" className="text-[10px] text-amber-600">📷 Fotos req.</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); borrarPlantilla(t.id).then(cargar).catch((err) => toast.error(limpiarError(err))); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => { onSelect(t); onOpenChange(false); }}>
                  Usar <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Filtros avanzados

export interface FiltrosAvanzados {
  priority: string; type: string; assigned_to: string; jefe_sitio: string; date_from: string; date_to: string; overdue_only: boolean;
}
export const SIN_FILTROS: FiltrosAvanzados = { priority: '', type: '', assigned_to: '', jefe_sitio: '', date_from: '', date_to: '', overdue_only: false };

const PRIORIDADES = [
  { value: '', label: 'Todas' }, { value: 'baja', label: 'Baja' }, { value: 'media', label: 'Media' }, { value: 'alta', label: 'Alta' }, { value: 'urgente', label: 'Urgente' },
];
const TIPOS = [{ value: '', label: 'Todos' }, ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))];
const SELECT = 'w-full h-9 rounded-md border border-slate-700/50 bg-slate-800/50 text-white text-sm px-3 focus:outline-none focus:ring-1 focus:ring-primary';
const ETIQ = 'text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1 block';

// Operario y jefe se eligen por persona (id): en la v2 la asignación es a un usuario, no texto libre.
export function AdvancedFilters({ filters, onChange, onReset, orders, personas }: {
  filters: FiltrosAvanzados; onChange: (f: FiltrosAvanzados) => void; onReset: () => void; orders: FilaTablero[]; personas: PersonaSector[];
}) {
  const { priority, type, assigned_to, jefe_sitio, date_from, date_to, overdue_only } = filters;
  const operarios = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) if (o.asignado_a && o.asignado_nombre) m.set(o.asignado_a, o.asignado_nombre);
    for (const p of personas) if (p.activo && p.rol !== 'jefe_sitio' && !m.has(p.id)) m.set(p.id, p.nombre);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [orders, personas]);
  const jefes = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of personas) if (p.rol === 'jefe_sitio') m.set(p.id, p.nombre);
    for (const o of orders) if (o.jefe_sitio_id && o.jefe_sitio_nombre && !m.has(o.jefe_sitio_id)) m.set(o.jefe_sitio_id, o.jefe_sitio_nombre);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [orders, personas]);

  const activeCount = [priority, type, assigned_to, jefe_sitio, date_from, date_to].filter(Boolean).length + (overdue_only ? 1 : 0);
  const update = <K extends keyof FiltrosAvanzados>(field: K, value: FiltrosAvanzados[K]) => onChange({ ...filters, [field]: value });

  return (
    <div className="space-y-4 rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800/50 to-slate-900/50 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-white">Filtros Avanzados</h3>
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">{activeCount} activo{activeCount !== 1 ? 's' : ''}</span>
          )}
        </div>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onReset} className="gap-1 text-xs text-slate-400 hover:text-white"><RotateCcw className="h-3 w-3" /> Limpiar</Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={ETIQ}>Prioridad</label>
          <select value={priority} onChange={(e) => update('priority', e.target.value)} className={SELECT}>
            {PRIORIDADES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className={ETIQ}>Tipo de Trabajo</label>
          <select value={type} onChange={(e) => update('type', e.target.value)} className={SELECT}>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={ETIQ}>Operario</label>
          <select value={assigned_to} onChange={(e) => update('assigned_to', e.target.value)} className={SELECT}>
            <option value="">Todos</option>
            {operarios.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className={ETIQ}>Jefe de Sitio</label>
          <select value={jefe_sitio} onChange={(e) => update('jefe_sitio', e.target.value)} className={SELECT}>
            <option value="">Todos</option>
            {jefes.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className={ETIQ}>Fecha creación desde</label>
          <Input type="date" value={date_from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('date_from', e.target.value)} className="border-slate-700/50 bg-slate-800/50 text-white" />
        </div>
        <div>
          <label className={ETIQ}>Fecha creación hasta</label>
          <Input type="date" value={date_to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('date_to', e.target.value)} className="border-slate-700/50 bg-slate-800/50 text-white" />
        </div>
      </div>
      <label className="flex cursor-pointer select-none items-center gap-2">
        <input type="checkbox" checked={overdue_only} onChange={(e) => update('overdue_only', e.target.checked)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-primary focus:ring-primary" />
        <span className="text-sm text-slate-300">Solo vencidas</span>
      </label>
    </div>
  );
}
