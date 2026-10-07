'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, Archive, CheckCircle2, ChevronRight, Clock, FileClock, History, MapPin, Search, Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { estaArchivada, fechaArchivo, type FilaTablero, type PersonaSector } from '@/lib/tablero';
import { lugarDe } from './piezas';

const norm = (s?: string | null) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ');
const fecha = (s?: string | null) => (s ? format(parseISO(s), 'dd/MM/yyyy', { locale: es }) : null);

const statusColors: Record<string, string> = {
  pendiente: 'bg-yellow-100 text-yellow-700',
  asignada: 'bg-blue-100 text-blue-700',
  en_progreso: 'bg-purple-100 text-purple-700',
  completada: 'bg-emerald-100 text-emerald-700',
  cancelada: 'bg-gray-100 text-gray-500',
};

// HistorialEstablecimiento de la v1: todas las órdenes por establecimiento, y las archivadas
// (en la v2: completadas hace más de 30 días).
export function HistorialEstablecimiento({ open, onOpenChange, onOpenOrder, orders, personas, isGerente }: {
  open: boolean; onOpenChange: (v: boolean) => void; onOpenOrder: (o: FilaTablero) => void;
  orders: FilaTablero[]; personas: Map<string, PersonaSector>; isGerente: boolean;
}) {
  const [tab, setTab] = useState<'establecimiento' | 'archivadas'>('establecimiento');
  const [search, setSearch] = useState('');
  const [selectedEstab, setSelectedEstab] = useState('');
  const [selectedJefe, setSelectedJefe] = useState('');

  const creador = (o: FilaTablero) => (o.created_by ? personas.get(o.created_by)?.nombre ?? '' : '');
  const archivadas = useMemo(() => orders.filter((o) => estaArchivada(o)), [orders]);
  const establecimientos = useMemo(() => [...new Set(orders.map(lugarDe).filter(Boolean))].sort(), [orders]);
  const jefes = useMemo(() => [...personas.values()].filter((p) => p.rol === 'jefe_sitio').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [personas]);

  const matchSearch = (o: FilaTablero, q: string) => !q || [o.titulo, lugarDe(o), o.asignado_nombre, o.jefe_sitio_nombre, creador(o), o.codigo].some((f) => norm(f).includes(q));
  const deJefe = (o: FilaTablero) => !selectedJefe || o.jefe_sitio_id === selectedJefe;

  const filtered = useMemo(() => {
    const q = norm(search);
    if (tab === 'archivadas') {
      return archivadas.filter((o) => matchSearch(o, q) && deJefe(o))
        .sort((a, b) => (fechaArchivo(b) ?? '').localeCompare(fechaArchivo(a) ?? ''));
    }
    return orders.filter((o) => (!selectedEstab || lugarDe(o) === selectedEstab) && matchSearch(o, q));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, archivadas, search, selectedEstab, selectedJefe, tab]);

  const stats = useMemo(() => {
    if (tab === 'archivadas') {
      const base = archivadas.filter(deJefe);
      return { total: base.length, completadas: base.length, pendientes: 0 };
    }
    const base = selectedEstab ? orders.filter((o) => lugarDe(o) === selectedEstab) : orders;
    return { total: base.length, completadas: base.filter((o) => o.estado === 'completada').length, pendientes: base.filter((o) => o.estado === 'pendiente').length };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, archivadas, selectedEstab, selectedJefe, tab]);

  const SEL = 'flex h-9 flex-1 items-center rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Historial</DialogTitle>
        </DialogHeader>
        <div className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-muted/50 p-1">
          <button type="button" onClick={() => setTab('establecimiento')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${tab === 'establecimiento' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <History className="h-3.5 w-3.5" /> Por Establecimiento
          </button>
          <button type="button" onClick={() => setTab('archivadas')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${tab === 'archivadas' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <Archive className="h-3.5 w-3.5" /> Archivadas
            {archivadas.length > 0 && <Badge className="h-4 px-1.5 text-[10px]">{archivadas.length}</Badge>}
          </button>
        </div>

        <div className="flex-shrink-0 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total', value: stats.total, icon: tab === 'archivadas' ? Archive : History, color: 'text-primary' },
              { label: 'Completadas', value: stats.completadas, icon: CheckCircle2, color: 'text-emerald-600' },
              { label: 'Pendientes', value: stats.pendientes, icon: tab === 'archivadas' ? FileClock : Clock, color: 'text-amber-600' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border bg-card p-3 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            {tab === 'establecimiento' && (
              <select value={selectedEstab} onChange={(e) => setSelectedEstab(e.target.value)} className={SEL} aria-label="Establecimiento">
                <option value="">Todos los establecimientos...</option>
                {establecimientos.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            )}
            {tab === 'archivadas' && isGerente && (
              <select value={selectedJefe} onChange={(e) => setSelectedJefe(e.target.value)} className={SEL} aria-label="Jefe de sitio">
                <option value="">Todos los jefes...</option>
                {jefes.map((j) => <option key={j.id} value={j.id}>{j.nombre}</option>)}
              </select>
            )}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={tab === 'archivadas' ? 'Buscar archivadas (jefe, creador, establecimiento...)' : 'Buscar...'}
                value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
        </div>

        <div className="mt-1 flex-1 space-y-2 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tab === 'archivadas' ? 'Sin OTs archivadas para este filtro. Las OTs completadas se archivan automáticamente a los 30 días.' : 'Sin órdenes para mostrar'}
            </p>
          ) : filtered.map((o) => {
            const c = creador(o);
            const lugar = lugarDe(o);
            return (
              <div key={o.id} onClick={() => onOpenOrder(o)} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/30">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">{o.titulo}</p>
                    <Badge className={`text-[10px] ${statusColors[o.estado] || 'bg-gray-100 text-gray-600'}`}>{o.estado.replace(/_/g, ' ')}</Badge>
                    {tab === 'archivadas' && <Badge className="flex items-center gap-1 bg-slate-200 text-[10px] text-slate-600"><Archive className="h-3 w-3" /> Archivada</Badge>}
                    {o.prioridad === 'urgente' && <Badge className="bg-red-100 text-[10px] text-red-700">Urgente</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {lugar && <span>📍 {lugar}</span>}
                    {o.asignado_nombre && <span>👤 {o.asignado_nombre}</span>}
                    {o.jefe_sitio_nombre && <span>🧑‍💼 {o.jefe_sitio_nombre}</span>}
                    {c && <span>✍️ {c}</span>}
                    {o.created_at && <span>📅 {fecha(o.created_at)}</span>}
                    {o.estado === 'completada' && o.fecha_validacion && <span className="text-emerald-600">✅ {fecha(o.fecha_validacion)}</span>}
                    {tab === 'archivadas' && fechaArchivo(o) && <span className="text-slate-500">🗄️ {fecha(fechaArchivo(o))}</span>}
                  </div>
                  {o.descripcion && <p className="mt-1 truncate text-xs text-muted-foreground">{o.descripcion}</p>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="flex-shrink-0 text-center text-xs text-muted-foreground">{filtered.length} órdenes</p>
      </DialogContent>
    </Dialog>
  );
}

const priorityConfig: Record<string, { bg: string; border: string; dot: string }> = {
  urgente: { bg: 'bg-red-500/20', border: 'border-red-500/40', dot: 'bg-red-400' },
  alta: { bg: 'bg-orange-500/20', border: 'border-orange-500/40', dot: 'bg-orange-400' },
  media: { bg: 'bg-blue-500/20', border: 'border-blue-500/40', dot: 'bg-blue-400' },
  baja: { bg: 'bg-slate-500/20', border: 'border-slate-500/40', dot: 'bg-slate-400' },
};

// ModosCampo de la v1: mis órdenes asignadas, con Iniciar / Completar a mano.
export function ModoCampo({ orders, miId, miNombre, onOpenOrder, onIniciar, onFinalizar }: {
  orders: FilaTablero[]; miId: string; miNombre: string; onOpenOrder: (o: FilaTablero) => void;
  onIniciar: (o: FilaTablero) => void; onFinalizar: (o: FilaTablero) => void;
}) {
  const mias = orders.filter((o) => o.asignado_a === miId);
  const activas = mias.filter((o) => !['completada', 'cancelada'].includes(o.estado));
  const completadas = mias.filter((o) => o.estado === 'completada').slice(0, 5);
  const hoy = new Date().toISOString().slice(0, 10);
  const vencidaCampo = (o: FilaTablero) => !!o.fecha_programada && o.fecha_programada.slice(0, 10) < hoy;
  const urgentes = activas.filter((o) => o.prioridad === 'urgente').length;
  const vencidas = activas.filter(vencidaCampo).length;
  const orden: Record<string, number> = { urgente: 0, alta: 1, media: 2, baja: 3 };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
        <Smartphone className="h-5 w-5 flex-shrink-0 text-emerald-400" />
        <div>
          <p className="text-sm font-semibold text-emerald-300">Modo Campo Activo</p>
          <p className="text-xs text-emerald-400/70">Mostrando mis OTs asignadas · {miNombre}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card/50 p-3 text-center">
          <p className="text-2xl font-bold">{activas.length}</p><p className="text-xs text-muted-foreground">Activas</p>
        </div>
        <div className={`rounded-xl border p-3 text-center ${urgentes > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-border bg-card/50'}`}>
          <p className={`text-2xl font-bold ${urgentes > 0 ? 'text-red-400' : ''}`}>{urgentes}</p><p className="text-xs text-muted-foreground">Urgentes</p>
        </div>
        <div className={`rounded-xl border p-3 text-center ${vencidas > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-card/50'}`}>
          <p className={`text-2xl font-bold ${vencidas > 0 ? 'text-amber-400' : ''}`}>{vencidas}</p><p className="text-xs text-muted-foreground">Vencidas</p>
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Mis órdenes activas</h3>
        {activas.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-500 opacity-50" />
            <p className="text-sm">¡Todo al día! Sin OTs pendientes.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {[...activas].sort((a, b) => (orden[a.prioridad] ?? 2) - (orden[b.prioridad] ?? 2)).map((order) => {
              const cfg = priorityConfig[order.prioridad] || priorityConfig.media;
              const isOverdue = vencidaCampo(order);
              const lugar = lugarDe(order);
              return (
                <motion.div key={order.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} onClick={() => onOpenOrder(order)}
                  className={`cursor-pointer rounded-xl border p-4 transition-all hover:brightness-110 ${cfg.bg} ${cfg.border}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${cfg.dot}`} />
                        <p className="truncate text-sm font-semibold">{order.titulo}</p>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {lugar && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{lugar}</span>}
                        {order.fecha_programada && (
                          <span className={`flex items-center gap-1 ${isOverdue ? 'font-semibold text-red-400' : ''}`}>
                            {isOverdue ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                            {format(parseISO(order.fecha_programada), 'dd/MM', { locale: es })}
                            {isOverdue && ' ⚠ Vencida'}
                          </span>
                        )}
                      </div>
                      <Badge className="mt-2 bg-white/10 text-[10px] text-white/70">{order.estado.replace(/_/g, ' ')}</Badge>
                    </div>
                    <div className="flex flex-shrink-0 flex-col gap-1.5">
                      {order.estado === 'pendiente' && (
                        <Button size="sm" className="h-7 bg-blue-600 text-xs hover:bg-blue-700"
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onIniciar(order); }}>Iniciar</Button>
                      )}
                      {order.estado === 'en_progreso' && (
                        <Button size="sm" className="h-7 bg-emerald-600 text-xs hover:bg-emerald-700"
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onFinalizar(order); }}>Completar</Button>
                      )}
                      <ChevronRight className="h-4 w-4 self-center text-muted-foreground" />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
      {completadas.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Últimas completadas</h3>
          <div className="space-y-1.5">
            {completadas.map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
                <p className="flex-1 truncate text-sm">{o.titulo}</p>
                {o.fecha_validacion && <p className="flex-shrink-0 text-xs text-muted-foreground">{format(parseISO(o.fecha_validacion), 'dd/MM', { locale: es })}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
