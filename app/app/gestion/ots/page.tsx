'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle, CheckCircle2, ClipboardList, Clock, HardHat, History, Kanban, Layers, LayoutGrid, Loader, Plus, Search, SlidersHorizontal,
  Smartphone, UserCheck, WifiOff, X, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AdvancedFilters, CancelarOTModal, EmptyState, KanbanBoard, OTTemplateSelector, QRCodeModal, SIN_FILTROS, STATUS_LABELS, WorkOrderCard, lugarDe,
  type FiltrosAvanzados,
} from '@/components/ordenes/piezas';
import { HistorialEstablecimiento, ModoCampo } from '@/components/ordenes/extras';
import { WorkOrderDetailPanel } from '@/components/ordenes/DetallePanel';
import { limpiarError } from '@/lib/errores';
import { urlDeQR } from '@/lib/qr';
import { useSesion } from '@/lib/sesion';
import {
  crearDesdePlantilla, esOtVencida, estaArchivada, getTransitionAction, listarPersonas, listarTablero, transicionar,
  type Accion, type FilaTablero, type PersonaSector,
} from '@/lib/tablero';

// Pantalla "Órdenes de Trabajo" de la v1 (pages/WorkOrders.jsx), con los datos y las reglas de la v2.

const GRID_VISIBLE_LIMIT = 60;
const norm = (s?: string | null) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fechaLocal = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function WorkOrders() {
  const router = useRouter();
  const params = useSearchParams();
  const { perfil, esGerencia: isGerente, puedeValidar } = useSesion();
  const canCompleteOT = puedeValidar;
  const canCreate = puedeValidar;

  const [orders, setOrders] = useState<FilaTablero[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [personasLista, setPersonasLista] = useState<PersonaSector[]>([]);
  const [isOnline, setIsOnline] = useState(true);

  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState('all');
  const [viewMode, setViewMode] = useState<'kanban' | 'grid'>('kanban');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qrOrder, setQrOrder] = useState<FilaTablero | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [historialOpen, setHistorialOpen] = useState(false);
  const [modoCampo, setModoCampo] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAllGrid, setShowAllGrid] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<FilaTablero | null>(null);
  const [advFilters, setAdvFilters] = useState<FiltrosAvanzados>(SIN_FILTROS);
  // Desde el mapa: las órdenes de un lugar.
  const [ubicacion, setUbicacion] = useState(params.get('ubicacion') ?? '');

  const cargar = useCallback(async () => {
    try {
      setOrders(await listarTablero());
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    listarPersonas().then(setPersonasLista).catch(() => setPersonasLista([]));
    // Como la v1 (staleTime 30 s + refetch al volver a la pestaña).
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
    const t = setInterval(cargar, 30_000);
    document.addEventListener('visibilitychange', alVolver);
    const red = () => setIsOnline(navigator.onLine);
    red();
    window.addEventListener('online', red);
    window.addEventListener('offline', red);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('online', red);
      window.removeEventListener('offline', red);
    };
  }, [cargar]);

  const personas = useMemo(() => new Map(personasLista.map((p) => [p.id, p])), [personasLista]);

  const ejecutar = useCallback(async (o: FilaTablero, accion: Accion, extra = {}) => {
    try {
      toast.success(await transicionar(o, accion, extra));
    } catch (err) {
      toast.error(limpiarError(err));
    }
    cargar();
  }, [cargar]);

  const handleStart = useCallback((o: FilaTablero) => {
    if (!navigator.onLine) { toast.info('Sin conexión — modo offline. No se puede iniciar la OT hasta reconectar.'); return; }
    ejecutar(o, 'iniciar');
  }, [ejecutar]);

  // "Completar" de la grilla avanza por el flujo formal: en progreso → finalizar, validación → aprobar.
  const handleComplete = useCallback((o: FilaTablero) => {
    if (!navigator.onLine) { toast.info('Sin conexión — modo offline. No se puede cambiar el estado hasta reconectar.'); return; }
    ejecutar(o, o.estado === 'pendiente_validacion' ? 'aprobar' : o.estado === 'obra' ? 'completar' : 'finalizar');
  }, [ejecutar]);

  const handleStatusChange = (id: string, newStatus: string) => {
    if (!isOnline) { toast.info('Sin conexión — modo offline. No se puede mover la OT hasta reconectar.'); return; }
    const order = orders.find((o) => o.id === id);
    if (!order || order.estado === newStatus) return;
    const action = getTransitionAction(order.estado, newStatus);
    if (!action) {
      toast.error('Esa transición de estado no está permitida');
      return;
    }
    if (action === 'cancelar') { setPendingCancel(order); return; }
    ejecutar(order, action);
  };

  const confirmarCancelacion = async () => {
    if (!pendingCancel) return;
    const o = pendingCancel;
    setPendingCancel(null);
    await ejecutar(o, 'cancelar');
  };

  const visibleOrders = useMemo(() => orders.filter((o) => !estaArchivada(o) && (!ubicacion || o.ubicacion_id === ubicacion)), [orders, ubicacion]);
  const archivedCount = useMemo(() => orders.filter((o) => estaArchivada(o)).length, [orders]);

  const searchable = useMemo(() => visibleOrders.map((o) => ({
    o,
    fields: [o.titulo, lugarDe(o), o.ubicacion_direccion, o.obra_titulo, o.activo_nombre, o.asignado_nombre, o.codigo, o.jefe_sitio_nombre,
      o.created_by ? personas.get(o.created_by)?.nombre : null].map(norm),
  })), [visibleOrders, personas]);

  const filtered = useMemo(() => {
    const q = norm(search);
    const f = advFilters;
    return searchable.filter(({ o, fields }) => {
      if (q && !fields.some((x) => x.includes(q))) return false;
      if (viewMode === 'grid' && statusTab !== 'all' && o.estado !== statusTab) return false;
      if (f.priority && o.prioridad !== f.priority) return false;
      if (f.type && o.tipo !== f.type) return false;
      if (f.assigned_to && o.asignado_a !== f.assigned_to) return false;
      if (f.jefe_sitio && o.jefe_sitio_id !== f.jefe_sitio && o.created_by !== f.jefe_sitio) return false;
      const cd = fechaLocal(o.created_at);
      if (f.date_from && cd < f.date_from) return false;
      if (f.date_to && cd > f.date_to) return false;
      if (f.overdue_only && !esOtVencida(o)) return false;
      return true;
    }).map(({ o }) => o);
  }, [searchable, search, statusTab, viewMode, advFilters]);

  const stats = useMemo(() => ({
    total: filtered.length,
    pendientes: filtered.filter((o) => o.estado === 'pendiente').length,
    asignadas: filtered.filter((o) => o.estado === 'asignada').length,
    en_progreso: filtered.filter((o) => o.estado === 'en_progreso').length,
    validacion: filtered.filter((o) => o.estado === 'pendiente_validacion').length,
    obra: filtered.filter((o) => o.estado === 'obra').length,
    completadas: filtered.filter((o) => o.estado === 'completada').length,
    canceladas: filtered.filter((o) => o.estado === 'cancelada').length,
  }), [filtered]);

  const crearDePlantilla = async (t: Parameters<typeof crearDesdePlantilla>[0]) => {
    try {
      await crearDesdePlantilla(t);
      cargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  };

  const selectedOrder = selectedId ? orders.find((o) => o.id === selectedId) ?? null : null;
  const nombreLugar = ubicacion ? params.get('nombre') ?? orders.find((o) => o.ubicacion_id === ubicacion)?.ubicacion_nombre : null;

  return (
    <div className="min-h-screen space-y-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span><strong>Modo offline</strong> — tablero en solo lectura. Las OTs nuevas se guardan localmente y se sincronizan al reconectar.</span>
        </div>
      )}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -right-40 -top-40 h-96 w-96 animate-pulse rounded-full bg-purple-500/30 opacity-20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 animate-pulse rounded-full bg-pink-500/20 opacity-20 blur-3xl" style={{ animationDelay: '2s' }} />
      </div>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 sm:h-12 sm:w-12">
              <ClipboardList className="h-5 w-5 text-white sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-white sm:text-3xl">Órdenes de Trabajo</h1>
              <p className="text-xs text-slate-400 sm:text-sm">
                {stats.total} activas{archivedCount > 0 ? ` · ${archivedCount} archivadas (Historial)` : ''}{!isOnline && ' • Offline'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <div className="flex items-center rounded-lg border border-slate-700/50 bg-slate-800/50 p-0.5">
              <button type="button" onClick={() => setViewMode('kanban')}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${viewMode === 'kanban' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>
                <Kanban className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Kanban</span>
              </button>
              <button type="button" onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${viewMode === 'grid' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>
                <LayoutGrid className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Grilla</span>
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setModoCampo((v) => !v)}
              className={`gap-1 border-slate-700 px-2 text-xs text-slate-300 hover:text-white ${modoCampo ? 'border-emerald-500/50 bg-emerald-600/20 text-emerald-300' : ''}`}>
              <Smartphone className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{modoCampo ? 'Escritorio' : 'Campo'}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setHistorialOpen(true)} className="gap-1 border-slate-700 px-2 text-xs text-slate-300 hover:text-white">
              <History className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Historial</span>
            </Button>
            {isGerente && (
              <Button variant="outline" size="sm" onClick={() => setShowAdvanced((v) => !v)}
                className={`gap-1 px-2 text-xs ${showAdvanced ? 'border-primary/50 bg-primary/20 text-primary' : 'border-slate-700 text-slate-300 hover:text-white'}`}>
                <SlidersHorizontal className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Filtros</span>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setTemplateOpen(true)} className="gap-1 border-slate-700 px-2 text-xs text-slate-300 hover:text-white">
              <Layers className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Plantillas</span>
            </Button>
            {canCreate && (
              <Link href="/gestion/ots/nueva">
                <Button size="sm" className="gap-1 bg-gradient-to-r from-purple-500 to-pink-600 px-2 text-xs shadow-purple-500/50 transition-all hover:shadow-lg">
                  <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Nueva OT</span><span className="sm:hidden">Nueva</span>
                </Button>
              </Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8">
          {[
            { label: 'Total', value: stats.total, icon: ClipboardList, color: 'from-slate-400' },
            { label: 'Pendientes', value: stats.pendientes, icon: Clock, color: 'from-yellow-500' },
            { label: 'Asignadas', value: stats.asignadas, icon: UserCheck, color: 'from-blue-500' },
            { label: 'En Progreso', value: stats.en_progreso, icon: Loader, color: 'from-purple-500' },
            { label: 'Validación', value: stats.validacion, icon: AlertCircle, color: 'from-amber-400' },
            { label: 'Obra', value: stats.obra, icon: HardHat, color: 'from-pink-400' },
            { label: 'Completadas', value: stats.completadas, icon: CheckCircle2, color: 'from-emerald-500' },
            { label: 'Canceladas', value: stats.canceladas, icon: XCircle, color: 'from-red-500' },
          ].map((stat) => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="rounded-lg border border-slate-700/50 bg-gradient-to-br from-slate-800/50 to-slate-900/50 p-4 backdrop-blur">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase text-slate-400">{stat.label}</p>
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${stat.color} to-transparent`}>
                    <stat.icon className="h-4 w-4 text-white" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-white">{stat.value}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {ubicacion && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 py-1 pl-4 pr-1 text-sm text-sky-300">
          <p className="min-w-0 truncate">Órdenes de <strong>{nombreLugar ?? 'un lugar'}</strong></p>
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => { setUbicacion(''); router.replace('/gestion/ots'); }}>
            <X className="h-3.5 w-3.5" /> Ver todas
          </Button>
        </div>
      )}

      {isGerente && showAdvanced && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <AdvancedFilters filters={advFilters} onChange={setAdvFilters} onReset={() => setAdvFilters(SIN_FILTROS)} orders={visibleOrders} personas={personasLista} />
        </motion.div>
      )}

      {modoCampo && perfil && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800/50 to-slate-900/50 p-5 backdrop-blur">
          <ModoCampo orders={orders} miId={perfil.id} miNombre={perfil.nombre} onOpenOrder={(o) => setSelectedId(o.id)}
            onIniciar={(o) => ejecutar(o, 'iniciar')}
            onFinalizar={(o) => {
              const faltan = o.tareas_total - o.tareas_hechas;
              if (faltan > 0) { toast.warning(`Faltan ${faltan} tarea(s) del checklist`); setSelectedId(o.id); return; }
              if (o.requiere_fotos && o.fotos_total === 0) { toast.warning('Esta OT requiere al menos una foto'); setSelectedId(o.id); return; }
              ejecutar(o, 'finalizar');
            }} />
        </motion.div>
      )}

      {!modoCampo && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input placeholder="Buscar por establecimiento, ubicación, título..." value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              className="border-slate-700/50 bg-slate-800/50 pl-10 text-white placeholder:text-slate-500" />
          </div>
          {viewMode === 'grid' && (
            <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-700/50 bg-slate-800/50 p-1">
              {['all', 'pendiente', 'asignada', 'en_progreso', 'obra', 'pendiente_validacion', 'completada', 'cancelada'].map((tab) => (
                <button key={tab} type="button" onClick={() => setStatusTab(tab)}
                  className={`whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-all ${statusTab === tab ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>
                  {tab === 'all' ? 'Todas' : STATUS_LABELS[tab] || tab.replace('_', ' ')}
                </button>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {!modoCampo && viewMode === 'kanban' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {filtered.length === 0 && !isLoading ? (
            <EmptyState icon={ClipboardList} title="No hay órdenes" description="Creá una nueva orden de trabajo" actionLabel="Nueva OT" onAction={() => router.push('/gestion/ots/nueva')} />
          ) : (
            <KanbanBoard orders={filtered} onOpen={(o) => setSelectedId(o.id)} onShowQR={setQrOrder} onStatusChange={handleStatusChange} readOnly={!isOnline} personas={personas} />
          )}
        </motion.div>
      )}

      {!modoCampo && viewMode === 'grid' && (filtered.length === 0 && !isLoading ? (
        <EmptyState icon={ClipboardList} title="No hay órdenes" description="Creá una nueva orden de trabajo" actionLabel="Nueva OT" onAction={() => router.push('/gestion/ots/nueva')} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {filtered.slice(0, showAllGrid ? filtered.length : GRID_VISIBLE_LIMIT).map((order) => (
              <WorkOrderCard key={order.id} order={order} onOpen={(o) => setSelectedId(o.id)} onShowQR={setQrOrder} personas={personas}
                onComplete={handleComplete} onStart={handleStart} canComplete={canCompleteOT && isOnline} />
            ))}
          </div>
          {!showAllGrid && filtered.length > GRID_VISIBLE_LIMIT && (
            <button type="button" onClick={() => setShowAllGrid(true)}
              className="w-full rounded-lg border border-dashed border-slate-700 py-3 text-sm text-slate-400 transition-colors hover:text-white">
              + {filtered.length - GRID_VISIBLE_LIMIT} órdenes más...
            </button>
          )}
        </>
      ))}

      <OTTemplateSelector open={templateOpen} onOpenChange={setTemplateOpen} onSelect={crearDePlantilla} />

      <HistorialEstablecimiento open={historialOpen} onOpenChange={setHistorialOpen} onOpenOrder={(o) => setSelectedId(o.id)}
        orders={orders} personas={personas} isGerente={isGerente} />

      {selectedOrder && (
        <WorkOrderDetailPanel order={selectedOrder} personas={personasLista} onClose={() => setSelectedId(null)} onChanged={cargar} />
      )}

      {qrOrder && (
        <QRCodeModal open onClose={() => setQrOrder(null)} title={qrOrder.titulo} subtitle={lugarDe(qrOrder) || `OT ${qrOrder.codigo}`}
          value={qrOrder.ubicacion_qr_token ? urlDeQR(qrOrder.ubicacion_qr_token) : `${window.location.origin}/ot/${qrOrder.id}`} />
      )}

      <CancelarOTModal open={!!pendingCancel} otTitle={pendingCancel?.titulo} onClose={() => setPendingCancel(null)} onConfirm={confirmarCancelacion} />
    </div>
  );
}

export default function Pagina() {
  return (
    <Suspense fallback={null}>
      <WorkOrders />
    </Suspense>
  );
}
