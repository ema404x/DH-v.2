'use client';

import { Children, Fragment, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Clock, Flag, History, Loader2, Lock, MapPin, Play, QrCode, ScanLine, Search, Siren,
  Users, WifiOff, X, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { DetalleOT } from '@/components/DetalleOT';
import { TarjetaFichaje } from '@/components/Fichaje';
import { ScannerModal } from '@/components/ScannerModal';
import { Marco } from '@/components/layout/Marco';
import { BodyPortal, ReporteForm, type Reporte } from '@/components/operario/ReporteForm';
import { limpiarError } from '@/lib/errores';
import {
  finalizarOT, iniciarOT, listarHistorialMio, listarMisOTs, posicionActual, resolverQRLocal, type OTLocal, type Quien,
} from '@/lib/ot';
import { descartar, reintentar } from '@/lib/offline/cola';
import { useCola } from '@/lib/offline/useCola';
import { cargarMaterialOT } from '@/lib/panol';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { useTablet } from '@/lib/tablet';
import type { OT } from '@/lib/types';

// "Mis Órdenes de Trabajo" de la v1 (pages/PortalOperarioApp.jsx) con el motor sin señal de la v2:
// lo que hace el operario se guarda en el teléfono y se envía solo cuando vuelve la señal.

function irA(params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  window.history.pushState(null, '', q ? `/mis-ots?${q}` : '/mis-ots');
}

const STEPS = [
  { key: 'asignada', label: 'Asignada', color: '#3b82f6' },
  { key: 'en_progreso', label: 'En Progreso', color: '#0ea5e9' },
  { key: 'validacion', label: 'Validación', color: '#f59e0b' },
  { key: 'completada', label: 'Completada', color: '#10b981' },
];
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pendiente: { label: 'Pendiente', cls: 'bg-blue-400/10 text-blue-400 border-blue-400/20' },
  asignada: { label: 'Asignada', cls: 'bg-blue-400/10 text-blue-400 border-blue-400/20' },
  en_progreso: { label: 'En Progreso', cls: 'bg-sky-400/10 text-sky-400 border-sky-400/20' },
  pendiente_validacion: { label: 'En Validación', cls: 'bg-amber-400/10 text-amber-400 border-amber-400/20' },
  completada: { label: 'Completada', cls: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' },
  cancelada: { label: 'Cancelada', cls: 'bg-red-400/10 text-red-400 border-red-400/20' },
};
const LANE: Record<string, string> = {
  pendiente: '#3b82f6', asignada: '#3b82f6', en_progreso: '#0ea5e9', pendiente_validacion: '#f59e0b', completada: '#10b981', cancelada: '#ef4444',
};
const PRIORITY: Record<string, { label: string; cls: string }> = {
  urgente: { label: 'Urgente', cls: 'bg-orange-500 text-white' },
  alta: { label: 'Alta', cls: 'bg-red-500/80 text-white' },
  media: { label: 'Media', cls: 'bg-slate-600 text-white' },
  baja: { label: 'Baja', cls: 'bg-slate-700 text-slate-300' },
};
const TYPE_LABEL: Record<string, string> = {
  mantenimiento_preventivo: 'Mant. Preventivo', mantenimiento_correctivo: 'Mant. Correctivo', instalacion: 'Instalación',
  inspeccion: 'Inspección', reparacion: 'Reparación', emergencia: 'Emergencia',
};
const TIPOS = [{ value: 'todos', label: 'Todos los tipos' }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))];
const PRIORIDADES = [
  { value: 'todos', label: 'Toda prioridad' }, { value: 'urgente', label: 'Urgente' }, { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Media' }, { value: 'baja', label: 'Baja' },
];
const cardVariants = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } } };
const norm = (s?: string | null) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const lugarDe = (o: OT) => o.ubicacion_nombre ?? o.ubicacion_direccion ?? '';

function Seccion({ titulo, subtitulo, icon: Icon, color, children }: { titulo: string; subtitulo: string; icon: LucideIcon; color: string; children: ReactNode }) {
  const colorHex = ({ blue: '#3b82f6', sky: '#0ea5e9', amber: '#f59e0b' } as Record<string, string>)[color] || '#3b82f6';
  const count = Children.count(children);
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="h-7 w-1 rounded-full" style={{ backgroundColor: colorHex }} />
        <Icon className="h-4 w-4" style={{ color: colorHex }} />
        <h2 className="text-sm font-bold text-white">{titulo}</h2>
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-400">{count}</span>
        <span className="truncate text-xs text-slate-500">· {subtitulo}</span>
      </div>
      <motion.div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
        {Children.map(children, (child) => <motion.div variants={cardVariants}>{child}</motion.div>)}
      </motion.div>
    </div>
  );
}

function OTCard({ ot, onIniciar, onFinalizar, onAbrir, processing, locked }: {
  ot: OTLocal; onIniciar?: () => void; onFinalizar?: () => void; onAbrir: () => void; processing: boolean; locked?: boolean;
}) {
  const badge = STATUS_BADGE[ot.estado] || STATUS_BADGE.pendiente;
  const prio = PRIORITY[ot.prioridad];
  const lugar = lugarDe(ot);
  return (
    <div className="card-lift relative flex flex-col gap-3 overflow-hidden rounded-xl border border-white/5 bg-[#1a2333] py-4 pl-5 pr-4">
      <div className="absolute bottom-0 left-0 top-0 w-1.5" style={{ backgroundColor: LANE[ot.estado] || '#3b82f6' }} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
          {ot.sinEnviar > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
              <WifiOff className="h-2.5 w-2.5" /> Pendiente sync
            </span>
          )}
          {ot.rechazadas > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/20 px-1.5 py-0.5 text-[9px] font-bold text-red-300">
              <AlertTriangle className="h-2.5 w-2.5" /> No se pudo enviar
            </span>
          )}
        </div>
        {prio && <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${prio.cls}`}>{prio.label}</span>}
      </div>
      <button type="button" onClick={onAbrir} className="min-w-0 flex-1 text-left">
        <h3 className="text-sm font-semibold leading-snug text-white">{ot.titulo}</h3>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
          {TYPE_LABEL[ot.tipo] && <span className="font-medium text-slate-400">{TYPE_LABEL[ot.tipo]}</span>}
          {ot.codigo && <span className="tabular-nums">· {ot.codigo}</span>}
        </div>
        {lugar && (
          <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-400">
            <MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{lugar}</span>
          </div>
        )}
        {ot.rechazo_comentario && ot.estado === 'en_progreso' && (
          <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2">
            <p className="text-[10px] font-semibold uppercase text-red-400">Rechazada por el Jefe:</p>
            <p className="mt-0.5 text-xs text-red-300">{ot.rechazo_comentario}</p>
          </div>
        )}
        {ot.rechazadas > 0 && ot.errorEnvio && <p className="mt-2 text-xs text-red-300">{ot.errorEnvio}</p>}
      </button>
      <div className="mt-auto">
        {locked ? (
          <div className="flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 text-sm font-medium text-slate-500">
            <Lock className="h-4 w-4" /> Esperando validación
          </div>
        ) : onIniciar ? (
          <button type="button" onClick={onIniciar} disabled={processing}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#2563eb] text-sm font-bold text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-50">
            {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />} Iniciar
          </button>
        ) : onFinalizar ? (
          <button type="button" onClick={onFinalizar} disabled={processing}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#059669] text-sm font-bold text-white transition-colors hover:bg-[#047857] disabled:opacity-50">
            {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Flag className="h-5 w-5" />} Finalizar y Reportar
          </button>
        ) : null}
      </div>
    </div>
  );
}

function HistorialCard({ ot }: { ot: OT }) {
  const badge = STATUS_BADGE[ot.estado] || STATUS_BADGE.completada;
  const lugar = lugarDe(ot);
  const fecha = ot.fecha_validacion ?? ot.fecha_fin_real;
  return (
    <div className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-white/5 bg-[#1a2333] py-4 pl-5 pr-4">
      <div className="absolute bottom-0 left-0 top-0 w-1.5" style={{ backgroundColor: LANE[ot.estado] || '#10b981' }} />
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
        {fecha && <span className="text-[11px] tabular-nums text-slate-500">{new Date(fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>}
      </div>
      <h3 className="text-sm font-semibold leading-snug text-white">{ot.titulo}</h3>
      {lugar && <div className="flex items-center gap-1 text-xs text-slate-400"><MapPin className="h-3 w-3" /><span className="truncate">{lugar}</span></div>}
      {ot.validado_nombre && <p className="text-[11px] text-slate-500">Validado por {ot.validado_nombre}</p>}
    </div>
  );
}

function ConfirmDialog({ ot, onConfirm, onCancel, processing, offline }: { ot: OTLocal; onConfirm: () => void; onCancel: () => void; processing: boolean; offline: boolean }) {
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
        <div className="relative w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl" role="dialog" aria-modal="true">
          <h3 className="mb-2 text-base font-bold text-white">¿Iniciar orden de trabajo?</h3>
          <p className="mb-1 text-sm text-slate-400">Se registrará tu ubicación GPS y la hora de inicio. No podrás deshacer esta acción.</p>
          <p className="mb-4 truncate text-sm font-medium text-white">&quot;{ot.titulo}&quot;</p>
          {offline && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-amber-400">
              <WifiOff className="h-3.5 w-3.5" /> Sin conexión: la acción se guardará y se sincronizará al volver online.
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} disabled={processing}
              className="h-11 flex-1 rounded-lg border border-slate-700 bg-slate-800 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700">Cancelar</button>
            <button type="button" onClick={onConfirm} disabled={processing}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-50">
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sí, Iniciar'}
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}

function MisOrdenes() {
  const router = useRouter();
  const params = useSearchParams();
  const { perfil, cargando: cargandoSesion, error: errorSesion, puedeValidar } = useSesion();
  const cola = useCola(perfil?.id);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [reporteOT, setReporteOT] = useState<OTLocal | null>(null);
  const [confirmOT, setConfirmOT] = useState<OTLocal | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [filtros, setFiltros] = useState({ texto: '', tipo: 'todos', prioridad: 'todos' });
  const [vista, setVista] = useState<'activas' | 'historial'>('activas');
  const [historial, setHistorial] = useState<OT[]>([]);
  const [isOnline, setIsOnline] = useState(true);

  const abierta = params.get('ot');
  const ubicacion = params.get('ubicacion') ?? undefined;
  const activo = params.get('activo') ?? undefined;
  const nombreFiltro = params.get('nombre');
  const conFiltro = !!(ubicacion || activo);

  useEffect(() => {
    const red = () => setIsOnline(navigator.onLine);
    red();
    window.addEventListener('online', red);
    window.addEventListener('offline', red);
    return () => { window.removeEventListener('online', red); window.removeEventListener('offline', red); };
  }, []);

  // Sin sesión: al ingreso. (Esta página no pasa por el control del servidor para poder abrir sin señal.)
  useEffect(() => {
    if (!cargandoSesion && !errorSesion && !perfil) router.replace('/login');
  }, [cargandoSesion, errorSesion, perfil, router]);

  const quien = useMemo<Quien | null>(() => (perfil ? { id: perfil.id, nombre: perfil.nombre } : null), [perfil]);
  // Tablet de cuadrilla: en vez de "mis órdenes", las de los lugares de su jefe de sitio.
  const { tablet, lista: tabletLista } = useTablet(perfil?.id);
  const jefe = tablet?.jefe_sitio_id;
  const carga = useCarga(
    async () => (quien && tabletLista ? listarMisOTs(quien, { ubicacion, activo, jefe }) : null),
    [quien, tabletLista, jefe, ubicacion, activo, cola.version, abierta === null],
  );

  useEffect(() => {
    if (vista !== 'historial' || !quien) return;
    listarHistorialMio(quien).then(setHistorial).catch(() => setHistorial([]));
  }, [vista, quien, cola.version]);

  const misOTs = carga.datos?.ots ?? [];

  const aplicarFiltros = useCallback(<T extends OT>(lista: T[]) => {
    const q = norm(filtros.texto);
    return lista.filter((ot) => {
      if (q && !norm([ot.titulo, lugarDe(ot), ot.codigo, ot.activo_nombre].filter(Boolean).join(' ')).includes(q)) return false;
      if (filtros.tipo !== 'todos' && ot.tipo !== filtros.tipo) return false;
      if (filtros.prioridad !== 'todos' && ot.prioridad !== filtros.prioridad) return false;
      return true;
    });
  }, [filtros]);

  const filtradas = useMemo(() => aplicarFiltros(misOTs), [misOTs, aplicarFiltros]);
  const historialFiltrado = useMemo(() => aplicarFiltros(historial), [historial, aplicarFiltros]);
  const { porIniciar, enProgreso, enValidacion } = useMemo(() => {
    const ini: OTLocal[] = [], prog: OTLocal[] = [], val: OTLocal[] = [];
    for (const ot of filtradas) {
      if (ot.estado === 'pendiente_validacion') val.push(ot);
      else if (ot.estado === 'en_progreso') prog.push(ot);
      else ini.push(ot);
    }
    return { porIniciar: ini, enProgreso: prog, enValidacion: val };
  }, [filtradas]);

  const limpiarFiltros = () => { setFiltros({ texto: '', tipo: 'todos', prioridad: 'todos' }); setVista('activas'); };
  const hayFiltros = !!filtros.texto || filtros.tipo !== 'todos' || filtros.prioridad !== 'todos';

  const handleIniciar = async (ot: OTLocal) => {
    if (!quien) return;
    setProcessing(ot.id);
    try {
      const destino = await iniciarOT(quien, ot, navigator.onLine ? await posicionActual() : null);
      toast.success(destino === 'enviado' ? 'OT iniciada correctamente' : 'OT iniciada (sin conexión). Se sincronizará al volver online.');
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setProcessing(null);
      setConfirmOT(null);
    }
  };

  const handleReporteSaved = async (ot: OTLocal, r: Reporte) => {
    if (!quien) return;
    const faltan = r.checklist.some((t) => !t.hecho);
    // Los materiales usados se cargan en la orden (necesitan señal); sin señal quedan escritos en las notas.
    let notas = r.notas.trim();
    if (r.usados.length && !navigator.onLine) {
      notas = [notas, `Materiales usados: ${r.usados.map((m) => `${m.material} (${m.cantidad})`).join(', ')}`].filter(Boolean).join('\n');
    }
    const destino = await finalizarOT(quien, ot, {
      checklist: r.checklist,
      notas: notas || null,
      motivos_incompleto: faltan && r.motivo.trim() ? [{ id: 'm1', texto: r.motivo.trim() }] : [],
      materiales_faltantes: r.faltantes,
    });
    if (r.usados.length && navigator.onLine) {
      for (const m of r.usados) {
        try {
          await cargarMaterialOT({ ot_id: ot.id, material_id: null, descripcion: m.material, cantidad: m.cantidad, costo_unitario: 0, descontar: false });
        } catch { toast.error(`No se pudo cargar el material ${m.material}`); }
      }
    }
    toast.success(destino === 'enviado' ? 'OT enviada a validación' : 'Reporte guardado (sin conexión). Se enviará al jefe al volver online.');
    setReporteOT(null);
    await carga.recargar();
  };

  // QR: primero en las órdenes guardadas en el teléfono (sirve sin señal); si no, lo resuelve el servidor.
  const alLeer = useCallback(async (token: string) => {
    setScannerOpen(false);
    const local = await resolverQRLocal(token).catch(() => null);
    if (local) irA({ [local.tipo]: local.id, nombre: local.nombre });
    else if (navigator.onLine) router.push(`/q?t=${encodeURIComponent(token)}`);
    else toast.error('Sin señal: ese QR no es de ninguna de las órdenes guardadas en el teléfono.');
  }, [router]);
  const cerrarScanner = useCallback(() => setScannerOpen(false), []);

  if (abierta) {
    return (
      <div className="mx-auto max-w-xl">
        <DetalleOT id={abierta} onVolver={() => irA(conFiltro ? { ...(ubicacion ? { ubicacion } : {}), ...(activo ? { activo } : {}), ...(nombreFiltro ? { nombre: nombreFiltro } : {}) } : {})} />
      </div>
    );
  }

  if (cargandoSesion || !tabletLista || (carga.cargando && !carga.datos)) {
    return (
      <div className="flex min-h-screen flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="skeleton h-11 w-11 rounded-xl" />
          <div className="flex-1 space-y-2"><div className="skeleton h-5 w-56 rounded" /><div className="skeleton h-3 w-40 rounded" /></div>
          <div className="skeleton h-11 w-11 rounded-xl" />
        </div>
        <div className="skeleton h-11 rounded-xl" />
        <div className="skeleton h-14 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-40 rounded-xl" style={{ animationDelay: `${i * 80}ms` }} />)}
        </div>
      </div>
    );
  }

  const pendientesCola = cola.pendientes;
  const rechazadasCola = cola.rechazadas;
  const displayName = tablet ? tablet.nombre : perfil?.nombre ?? '';

  return (
    <div className="flex min-h-screen flex-col gap-5">
      {(!isOnline || pendientesCola > 0) && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-300">
          {cola.enviando ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <WifiOff className="h-4 w-4 shrink-0" />}
          {cola.enviando
            ? `Sincronizando ${pendientesCola} acción(es) pendiente(s)...`
            : !isOnline
              ? `Sin conexión — trabajando con cache. ${pendientesCola > 0 ? `${pendientesCola} acción(es) esperando sincronizar.` : 'Tus OTs se guardan y se envían al volver online.'}`
              : `${pendientesCola} acción(es) pendiente(s) de sincronizar.`}
        </div>
      )}
      {rechazadasCola > 0 && quien && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{rechazadasCola} acción(es) no se pudieron aplicar. Lo cargado sigue en el teléfono.</span>
          {misOTs.filter((o) => o.rechazadas > 0).slice(0, 1).map((o) => (
            <Fragment key={o.id}>
              <button type="button" className="rounded border border-red-400/40 px-2 py-1 font-semibold" onClick={() => reintentar(quien.id, o.id).then(carga.recargar)}>Reintentar</button>
              <button type="button" className="rounded border border-red-400/40 px-2 py-1" onClick={() => window.confirm('¿Descartar lo que no se pudo enviar de esta orden? Se pierde.') && descartar(quien.id, o.id).then(carga.recargar)}>Descartar</button>
            </Fragment>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#6366f1] shadow-lg shadow-blue-500/20">
          <ClipboardList className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-white">{tablet ? 'Órdenes de la cuadrilla' : 'Mis Órdenes de Trabajo'}</h1>
          <p className="text-xs tabular-nums text-slate-400">{displayName} · {misOTs.length} activa{misOTs.length !== 1 ? 's' : ''}</p>
        </div>
        <button type="button" onClick={() => setScannerOpen(true)} title="Escanear QR" aria-label="Escanear QR"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2563eb] shadow-lg shadow-blue-500/20 transition-colors hover:bg-[#1d4ed8]">
          <ScanLine className="h-5 w-5 text-white" />
        </button>
      </div>

      {/* Lo propio de la v2 en campo: fichaje, cuadrilla y emergencia. */}
      {perfil && !tablet && (
        <TarjetaFichaje usuarioId={perfil.id} lugar={ubicacion ? { id: ubicacion, nombre: nombreFiltro ?? 'este lugar' } : undefined} />
      )}
      <div className="flex flex-wrap gap-2">
        {(tablet || puedeValidar) && (
          <Link href="/cuadrilla" className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-300 hover:bg-white/10">
            <Users className="h-4 w-4" /> {tablet ? 'Fichar a la cuadrilla' : 'Fichar a mi gente'}
          </Link>
        )}
        <Link href="/emergencia" className="flex h-10 items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-sm font-semibold text-red-300 hover:bg-red-500/20">
          <Siren className="h-4 w-4" /> Reportar una emergencia
        </Link>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-white/5 bg-[#111827] p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {STEPS.map((s, i) => (
          <Fragment key={s.key}>
            <div className="flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color, boxShadow: `0 0 8px ${s.color}80` }} />
              <span className="whitespace-nowrap text-xs font-medium text-slate-300">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />}
          </Fragment>
        ))}
      </div>

      {conFiltro && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 py-1 pl-3 pr-1 text-sm text-sky-300">
          <p className="min-w-0 truncate"><QrCode className="mr-2 inline h-4 w-4" />Órdenes de: <strong>{nombreFiltro ?? 'lo que escaneaste'}</strong></p>
          <button type="button" onClick={() => irA({})} className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs hover:bg-white/5"><X className="h-3.5 w-3.5" /> Ver todas</button>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex gap-1 rounded-xl border border-white/5 bg-[#111827] p-1">
          {(['activas', 'historial'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVista(v)}
              className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${vista === v ? 'bg-[#2563eb] text-white shadow-lg shadow-blue-600/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
              {v === 'activas' ? <ClipboardList className="h-4 w-4" /> : <History className="h-4 w-4" />}
              {v === 'activas' ? 'Activas' : 'Historial'}
              <span className="tabular-nums opacity-70">({v === 'activas' ? misOTs.length : historial.length})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[160px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input value={filtros.texto} onChange={(e) => setFiltros({ ...filtros, texto: e.target.value })} placeholder="Buscar por título, ubicación o código…"
              className="h-10 w-full rounded-lg border border-white/5 bg-[#111827] pl-9 pr-3 text-sm text-white transition-colors placeholder:text-slate-500 focus:border-[#2563eb] focus:outline-none" />
          </div>
          <select value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })} aria-label="Tipo"
            className="h-10 rounded-lg border border-white/5 bg-[#111827] px-3 text-sm text-white transition-colors focus:border-[#2563eb] focus:outline-none">
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={filtros.prioridad} onChange={(e) => setFiltros({ ...filtros, prioridad: e.target.value })} aria-label="Prioridad"
            className="h-10 rounded-lg border border-white/5 bg-[#111827] px-3 text-sm text-white transition-colors focus:border-[#2563eb] focus:outline-none">
            {PRIORIDADES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <button type="button" onClick={limpiarFiltros}
            className={`flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${hayFiltros ? 'border-white/20 text-white hover:bg-white/10' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
            <X className="h-4 w-4" /> Limpiar panel
          </button>
        </div>
      </div>

      {carga.error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{carga.error}</p>}

      {vista === 'historial' ? (
        historialFiltrado.length > 0 ? (
          <motion.div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.04 } } }}>
            {historialFiltrado.map((ot) => <motion.div key={ot.id} variants={cardVariants}><HistorialCard ot={ot} /></motion.div>)}
          </motion.div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500">
            <History className="h-12 w-12 text-slate-700" />
            <p className="text-sm font-medium">{historial.length === 0 ? (isOnline ? 'Todavía no completaste ninguna orden' : 'El historial se ve con señal') : 'Ninguna orden coincide con los filtros'}</p>
            {historial.length > 0 && <button type="button" onClick={limpiarFiltros} className="text-xs text-primary hover:underline">Limpiar filtros</button>}
          </div>
        )
      ) : (
        <>
          {enProgreso.length > 0 && (
            <Seccion titulo="En Progreso" subtitulo="Terminá estas antes de empezar nuevas" icon={Clock} color="sky">
              {enProgreso.map((ot) => (
                <OTCard key={ot.id} ot={ot} processing={processing === ot.id} onFinalizar={() => setReporteOT(ot)} onAbrir={() => irA({ ot: ot.id })} />
              ))}
            </Seccion>
          )}
          {porIniciar.length > 0 && (
            <Seccion titulo="Para Empezar" subtitulo="Tocá Iniciar cuando llegues al sitio" icon={Play} color="blue">
              {porIniciar.map((ot) => (
                <OTCard key={ot.id} ot={ot} processing={processing === ot.id} onIniciar={() => setConfirmOT(ot)} onAbrir={() => irA({ ot: ot.id })} />
              ))}
            </Seccion>
          )}
          {enValidacion.length > 0 && (
            <Seccion titulo="Enviadas al Jefe" subtitulo="Esperando validación del Jefe de Sitio" icon={Lock} color="amber">
              {enValidacion.map((ot) => <OTCard key={ot.id} ot={ot} processing={false} locked onAbrir={() => irA({ ot: ot.id })} />)}
            </Seccion>
          )}
          {filtradas.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500">
              <CheckCircle2 className="h-12 w-12 text-slate-700" />
              <p className="text-sm font-medium">
                {misOTs.length === 0 ? (conFiltro ? 'No hay órdenes abiertas acá' : 'No tenés órdenes asignadas') : 'Ninguna orden coincide con los filtros'}
              </p>
              {misOTs.length > 0 && <button type="button" onClick={limpiarFiltros} className="text-xs text-primary hover:underline">Limpiar filtros</button>}
            </div>
          )}
        </>
      )}

      {reporteOT && quien && (
        <ReporteForm ot={reporteOT} quien={quien} onClose={() => setReporteOT(null)} onSaved={(r) => handleReporteSaved(reporteOT, r)} />
      )}
      {confirmOT && (
        <ConfirmDialog ot={confirmOT} onConfirm={() => handleIniciar(confirmOT)} onCancel={() => setConfirmOT(null)} processing={processing === confirmOT.id} offline={!isOnline} />
      )}
      {scannerOpen && <ScannerModal onToken={alLeer} onCerrar={cerrarScanner} />}
    </div>
  );
}

function ConMarco() {
  const { perfil } = useSesion();
  // Sin sesión todavía no hay menú que mostrar (y sin señal la sesión sale del teléfono).
  if (!perfil) return <main className="p-4"><MisOrdenes /></main>;
  return <Marco><MisOrdenes /></Marco>;
}

export default function Pagina() {
  return (
    <Suspense fallback={null}>
      <ConMarco />
    </Suspense>
  );
}
