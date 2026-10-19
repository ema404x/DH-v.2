'use client';

// Portal de operarios sin usuario = pages/PortalOperario.jsx + components/workorders/EjecutarOTEnPortal.jsx de la v1,
// con las reglas de la v2 (fase 16): la lista se ve recién después de la clave, el checklist se marca (o se dice
// por qué no), las fotos se suben comprimidas y todo lo controla la base. Entra desde el QR: /portal?t=<token>.

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  AlertTriangle, ArrowLeft, Building2, Camera, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, ClipboardList,
  FileText, Flag, Image as ImageIcon, Loader2, Lock, LogOut, MapPin, PenLine, Play, ShieldCheck, User, WifiOff, Wrench,
} from 'lucide-react';
import { FirmaCanvas } from '@/components/FirmaCanvas';
import { comprimirImagen } from '@/lib/imagen';
import {
  SinRed, aDataURL, entrar, listarOrdenes, nombreGuardado, olvidarPase, ordenesGuardadas, paseGuardado, posicion, salirPortal,
  type Ingreso, type OrdenPortal,
} from '@/lib/portal';
import { aplicarCola, colaDe, descartar, enviarCola, hacer, reintentar, type ItemCola, type OpPortal } from '@/lib/portal-cola';

const PRIORITY_STYLE: Record<string, { ring: string; chip: string; label: string }> = {
  baja: { ring: 'bg-slate-400', chip: 'bg-slate-500/15 text-slate-300 border-slate-500/25', label: 'Baja' },
  media: { ring: 'bg-blue-400', chip: 'bg-blue-500/15 text-blue-300 border-blue-500/25', label: 'Media' },
  alta: { ring: 'bg-orange-400', chip: 'bg-orange-500/15 text-orange-300 border-orange-500/25', label: 'Alta' },
  urgente: { ring: 'bg-red-500', chip: 'bg-red-500/15 text-red-300 border-red-500/25', label: 'Urgente' },
};
const TYPE_LABEL: Record<string, string> = {
  mantenimiento_preventivo: 'Mant. Preventivo', mantenimiento_correctivo: 'Mant. Correctivo', instalacion: 'Instalación',
  inspeccion: 'Inspección', reparacion: 'Reparación', emergencia: '🚨 Emergencia',
};
const cardVariants = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } } };
const stagger = { show: { transition: { staggerChildren: 0.05 } } };
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Como canActOn de la v1: pendiente/asignada la empieza cualquiera; en curso, solo quien la empezó.
function puedeActuar(o: OrdenPortal, nombre: string): { canAct: boolean; reason?: string } {
  if (o.estado === 'pendiente' || o.estado === 'asignada') return { canAct: true };
  if (o.estado === 'en_progreso') {
    if (o.portal_nombre && norm(o.portal_nombre) === norm(nombre)) return { canAct: true };
    return { canAct: false, reason: `La trabaja ${o.portal_nombre || o.asignado_nombre || 'otro operario'}` };
  }
  return { canAct: false, reason: o.estado === 'pendiente_validacion' ? 'En validación' : 'No disponible' };
}

// ── Pantalla de clave ───────────────────────────────────────────────────────
function PantallaClave({ token, onSuccess }: { token: string; onSuccess: (i: Ingreso) => void }) {
  const [clave, setClave] = useState('');
  const [nombre, setNombre] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setNombre(nombreGuardado()), []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clave.trim()) return;
    if (!nombre.trim()) { setError('Ingresá tu nombre para registrar tu trabajo.'); return; }
    setChecking(true);
    setError('');
    try {
      onSuccess(await entrar(token, clave, nombre));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clave incorrecta. Consultá con tu supervisor.');
      setClave('');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-5"
      style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))', paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
      <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="bg-card border border-border/60 rounded-3xl p-8 w-full max-w-sm shadow-2xl">
        <div className="text-center mb-7">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/25">
            <Lock className="h-8 w-8 text-white" />
          </div>
          <h1 className="font-bold text-2xl text-foreground">Portal Operarios</h1>
          <p className="text-muted-foreground text-sm mt-1.5">Ingresá para ver las órdenes de este lugar.</p>
        </div>
        {/* No es un login: que el navegador no ofrezca usuarios ni contraseñas guardadas. */}
        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
          <div>
            <label htmlFor="portal-nombre" className="block text-sm font-semibold text-muted-foreground mb-2">Tu nombre</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
              <input id="portal-nombre" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Juan Pérez" name="dh1-portal-nombre" autoComplete="off" data-1p-ignore data-lpignore="true"
                className="w-full h-14 rounded-2xl border-2 border-border bg-background/60 pl-12 pr-4 text-base font-medium text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors" />
            </div>
            <p className="text-xs text-muted-foreground/60 mt-1.5">Se registra en cada OT que toqués para trazabilidad.</p>
          </div>
          <div>
            <label htmlFor="portal-clave" className="block text-sm font-semibold text-muted-foreground mb-2">Clave de acceso</label>
            <input id="portal-clave" type="password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="••••••••" name="dh1-portal-clave" autoComplete="new-password" data-1p-ignore data-lpignore="true"
              className="w-full h-14 rounded-2xl border-2 border-border bg-background/60 px-4 text-xl font-bold text-center tracking-[0.3em] text-foreground placeholder:tracking-[0.3em] placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors" />
          </div>
          {error && (
            <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} role="alert"
              className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </motion.div>
          )}
          <button type="submit" disabled={checking || !clave.trim() || !nombre.trim()}
            className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center gap-3 disabled:opacity-40 active:scale-[0.98] transition-all shadow-lg shadow-primary/25">
            {checking ? <Loader2 className="h-5 w-5 animate-spin" /> : <><ShieldCheck className="h-5 w-5" /> Ingresar</>}
          </button>
        </form>
        <a href={`/login?volver=${encodeURIComponent(`/q?t=${token}`)}`} className="block text-center text-sm text-primary mt-6">Tengo usuario de DH1</a>
      </motion.div>
    </div>
  );
}

// ── Lista de OTs ────────────────────────────────────────────────────────────
function ListaOTs({ orders, ingreso, onSelect, onSalir }: { orders: OrdenPortal[]; ingreso: Ingreso; onSelect: (o: OrdenPortal) => void; onSalir: () => void }) {
  const activas = orders.filter((o) => !['completada', 'cancelada', 'pendiente_validacion'].includes(o.estado));
  const enValidacion = orders.filter((o) => o.estado === 'pendiente_validacion');
  const completadas = orders.filter((o) => o.estado === 'completada');
  const total = activas.length + enValidacion.length + completadas.length;
  const progress = total === 0 ? 100 : Math.round(((completadas.length + enValidacion.length) / total) * 100);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-gradient-to-br from-primary to-indigo-600 px-5 pb-6 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-indigo-400/20 blur-2xl" />
        <div className="relative max-w-md mx-auto" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-11 w-11 bg-white/15 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/20">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-white font-bold text-lg leading-tight truncate">{ingreso.lugar.nombre}</h1>
              {ingreso.lugar.direccion && <p className="text-white/60 text-xs truncate flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{ingreso.lugar.direccion}</p>}
            </div>
            <button type="button" onClick={onSalir} aria-label="Salir del portal" className="h-11 w-11 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white/80 active:bg-white/20">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
          <p className="text-white/70 text-xs mb-3 flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> {ingreso.nombre}</p>
          {total > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-white/15 overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.6, ease: 'easeOut' }}
                  className="h-full rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]" />
              </div>
              <span className="text-white/80 text-xs font-semibold tabular-nums shrink-0">{progress}%</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 px-4 py-5 max-w-md mx-auto w-full space-y-6" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
        {total === 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-16">
            <div className="h-20 w-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            </div>
            <p className="font-bold text-foreground text-lg">¡Todo al día!</p>
            <p className="text-muted-foreground text-sm mt-1">No hay órdenes pendientes para este establecimiento.</p>
          </motion.div>
        )}

        {activas.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <p className="text-xs font-bold text-foreground uppercase tracking-wider">
                {activas.length} orden{activas.length !== 1 ? 'es' : ''} pendiente{activas.length !== 1 ? 's' : ''}
              </p>
            </div>
            <motion.div className="space-y-3" initial="hidden" animate="show" variants={stagger}>
              {activas.map((order) => {
                const pr = PRIORITY_STYLE[order.prioridad] || PRIORITY_STYLE.media;
                const action = puedeActuar(order, ingreso.nombre);
                const locked = !action.canAct;
                return (
                  <motion.button key={order.id} variants={cardVariants} onClick={() => !locked && onSelect(order)} disabled={locked}
                    className={`w-full bg-card rounded-2xl p-4 border text-left flex items-center gap-4 transition-all shadow-sm relative overflow-hidden ${locked ? 'border-border/40 opacity-60 cursor-not-allowed' : 'border-border active:scale-[0.98]'}`}>
                    <div className="absolute left-0 top-0 bottom-0 w-1.5"><span className={`block h-full ${pr.ring}`} /></div>
                    <div className="h-12 w-12 bg-primary/10 rounded-xl flex items-center justify-center shrink-0 ml-1">
                      <Wrench className={`h-6 w-6 ${locked ? 'text-muted-foreground/50' : 'text-primary'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-foreground text-sm leading-tight">{order.titulo}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{TYPE_LABEL[order.tipo] || order.tipo} · {order.codigo}</p>
                      {locked ? (
                        <span className="inline-flex items-center gap-1.5 mt-2 px-2 py-0.5 rounded-full text-xs font-semibold border bg-muted/30 text-muted-foreground border-border/50">
                          <Lock className="h-3 w-3" /> {action.reason || 'No disponible'}
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 mt-2 px-2 py-0.5 rounded-full text-xs font-semibold border ${pr.chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${pr.ring}`} />
                          {order.estado === 'en_progreso' ? 'En progreso' : pr.label}
                        </span>
                      )}
                    </div>
                    {locked ? <Lock className="h-4 w-4 text-muted-foreground/40 shrink-0" /> : <ChevronRight className="h-5 w-5 text-muted-foreground/60 shrink-0" />}
                  </motion.button>
                );
              })}
            </motion.div>
          </div>
        )}

        {enValidacion.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">En validación ({enValidacion.length})</p>
            </div>
            <div className="space-y-2">
              {enValidacion.map((order) => (
                <div key={order.id} className="bg-amber-500/10 rounded-2xl p-4 border border-amber-500/20 flex items-center gap-3">
                  <ClipboardList className="h-6 w-6 text-amber-400 shrink-0" />
                  <p className="text-amber-200 text-sm font-medium">{order.titulo}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {completadas.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Completadas ({completadas.length})</p>
            </div>
            <div className="space-y-2">
              {completadas.map((order) => (
                <div key={order.id} className="bg-card/40 rounded-2xl p-4 border border-border/50 flex items-center gap-3 opacity-60">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0" />
                  <p className="text-muted-foreground text-sm font-medium line-through">{order.titulo}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Ejecutar una OT ─────────────────────────────────────────────────────────
function EjecutarOT({ token, order, ingreso, onBack, onListo, onVencido, onCola }: {
  token: string; order: OrdenPortal; ingreso: Ingreso; onBack: () => void; onListo: () => void; onVencido: (msg: string) => void; onCola: () => void;
}) {
  const [estado, setEstado] = useState(order.estado);
  const [hechas, setHechas] = useState<Set<string>>(new Set(order.checklist.filter((t) => t.hecho).map((t) => t.id)));
  const [motivo, setMotivo] = useState('');
  const [notas, setNotas] = useState('');
  const [firma, setFirma] = useState<string | null>(null);
  const [verFirma, setVerFirma] = useState(false);
  // url (enviada) o data URL (guardada en el teléfono, esperando señal)
  const [fotos, setFotos] = useState<{ src: string; pendiente: boolean }[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDesc, setShowDesc] = useState(true);
  const [error, setError] = useState('');
  const archivo = useRef<HTMLInputElement>(null);

  const enCurso = estado === 'en_progreso';
  const pendientes = order.checklist.filter((t) => !hechas.has(t.id));
  // Como decideSteps de la v1: con tareas o fotos obligatorias, primero se inicia.
  const dosPasos = order.checklist.some((t) => !t.hecho) || order.requiere_fotos;
  const showStartButton = !enCurso && dosPasos;
  const needsPhoto = order.requiere_fotos && fotos.length === 0;
  const needsMotivo = enCurso && pendientes.length > 0 && !motivo.trim();
  const pr = PRIORITY_STYLE[order.prioridad] || PRIORITY_STYLE.media;
  const isUrgente = order.prioridad === 'urgente';

  const fallo = (e: unknown) => {
    const msg = e instanceof Error ? e.message : 'No se pudo completar.';
    if (/venció/.test(msg)) onVencido(msg);
    else setError(msg);
  };

  // Con señal va directo; sin señal queda guardado en el teléfono y se envía solo (lib/portal-cola.ts).
  const hacerOp = async (op: OpPortal) => {
    const r = await hacer(token, ingreso.pase, op);
    if (r === 'en_cola') onCola();
    return r;
  };
  const iniciarOT = async () => {
    await hacerOp({ tipo: 'iniciar', ot: order.id, gps: await posicion() });
    setEstado('en_progreso');
  };

  async function handleIniciar() {
    setSaving(true); setError('');
    try { await iniciarOT(); } catch (e) { fallo(e); } finally { setSaving(false); }
  }

  async function agregarFotos(lista: FileList | null) {
    if (!lista?.length) return;
    setSubiendo(true); setError('');
    try {
      // Las fotos se cargan con la orden en curso (1 paso: se inicia sola al sacar la primera).
      if (!enCurso) await iniciarOT();
      for (const f of Array.from(lista)) {
        const imagen = await aDataURL(await comprimirImagen(f));
        const r = await hacerOp({ tipo: 'foto', ot: order.id, foto_id: crypto.randomUUID(), imagen });
        setFotos((p) => [...p, { src: imagen, pendiente: r === 'en_cola' }]);
      }
    } catch (e) { fallo(e); } finally {
      setSubiendo(false);
      if (archivo.current) archivo.current.value = '';
    }
  }

  async function handleFinalizar() {
    setSaving(true); setError('');
    try {
      if (!enCurso) await iniciarOT();
      await hacerOp({ tipo: 'finalizar', ot: order.id, hechas: [...hechas], motivo, notas, firma_url: firma, gps: await posicion() });
      onListo();
    } catch (e) { fallo(e); } finally { setSaving(false); }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className={`${isUrgente ? 'bg-gradient-to-br from-red-600 to-rose-600' : 'bg-gradient-to-br from-primary to-indigo-600'} px-5 pb-6 relative overflow-hidden`}>
        <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-white/5 blur-2xl" />
        <div className="relative max-w-md mx-auto" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
          <button onClick={onBack} className="flex items-center gap-2 text-white/70 text-sm mb-4 active:text-white transition-colors">
            <ArrowLeft className="h-4 w-4" /> Volver a la lista
          </button>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold mb-3 border bg-white/15 border-white/20 text-white backdrop-blur-sm">
            {isUrgente ? '🚨 URGENTE' : pr.label}
          </span>
          <h1 className="text-white font-bold text-2xl leading-snug">{order.titulo}</h1>
          <p className="text-white/70 text-sm mt-1.5 flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {ingreso.lugar.nombre}</p>
          {enCurso && (
            <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-400/20 text-emerald-200 border border-emerald-400/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> En progreso
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 px-4 py-5 max-w-md mx-auto w-full space-y-4">
        {order.descripcion && (
          <div className="rounded-2xl border border-border overflow-hidden bg-card">
            <button onClick={() => setShowDesc((v) => !v)} className="w-full flex items-center justify-between px-4 py-3.5 font-bold text-sm text-foreground active:bg-card/60 transition-colors">
              <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Instrucciones</span>
              {showDesc ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showDesc && (
              <div className="px-4 pb-4 pt-1 border-t border-border/50">
                <p className="text-muted-foreground text-base leading-relaxed whitespace-pre-wrap">{order.descripcion}</p>
              </div>
            )}
          </div>
        )}

        {order.fotos.length > 0 && (
          <div className="rounded-2xl border border-border p-4 bg-card">
            <p className="font-bold text-sm text-foreground mb-3 flex items-center gap-2"><ImageIcon className="h-4 w-4 text-primary" /> Fotos de referencia</p>
            <div className="grid grid-cols-2 gap-2">
              {order.fotos.map((url) => (
                <div key={url} className="aspect-video rounded-xl overflow-hidden border border-border/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}

        {order.checklist.length > 0 && (
          <div className="rounded-2xl border border-border p-4 bg-card">
            <p className="font-bold text-sm text-foreground mb-3">Tareas del checklist</p>
            <div className="space-y-1">
              {order.checklist.map((task) => {
                const hecho = hechas.has(task.id);
                return (
                  <button key={task.id} type="button" disabled={!enCurso || task.hecho}
                    onClick={() => setHechas((p) => { const n = new Set(p); if (n.has(task.id)) n.delete(task.id); else n.add(task.id); return n; })}
                    className="w-full min-h-[44px] flex items-start gap-3 rounded-xl px-2 py-2 text-left text-sm active:bg-muted/30 disabled:active:bg-transparent">
                    <CheckCircle2 className={`h-5 w-5 mt-0.5 shrink-0 ${hecho ? 'text-emerald-400' : 'text-muted-foreground/40'}`} />
                    <span className={hecho ? 'text-muted-foreground line-through' : 'text-foreground'}>{task.tarea}</span>
                  </button>
                );
              })}
            </div>
            {!enCurso && <p className="text-xs text-muted-foreground mt-2">Iniciá la orden para marcar las tareas.</p>}
            {enCurso && pendientes.length > 0 && (
              <div className="mt-3">
                <label htmlFor="portal-motivo" className="block text-xs font-semibold text-orange-400 mb-1.5">
                  {pendientes.length === 1 ? 'Queda 1 tarea sin hacer' : `Quedan ${pendientes.length} tareas sin hacer`}: contá por qué
                </label>
                <textarea id="portal-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ej: no había repuesto"
                  className="w-full rounded-xl border-2 border-border bg-background/60 px-3 py-2 text-base text-foreground focus:outline-none focus:border-primary" />
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-border p-4 bg-card">
          <p className="font-bold text-sm text-foreground mb-3 flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" /> Fotos del trabajo realizado{order.requiere_fotos ? ' *' : ' (opcional)'}
          </p>
          {fotos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {fotos.map((f, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden border-2 border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.src} alt="" className="w-full h-full object-cover" />
                  {f.pendiente && (
                    <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/80 text-white">Pendiente</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <input ref={archivo} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => agregarFotos(e.target.files)} />
          <button type="button" onClick={() => archivo.current?.click()} disabled={subiendo || (showStartButton && !enCurso)}
            className="w-full h-16 rounded-2xl border-2 border-dashed border-border bg-card/40 active:bg-card/60 flex items-center justify-center gap-3 text-foreground font-bold text-base transition-colors disabled:opacity-50">
            {subiendo ? <><Loader2 className="h-5 w-5 animate-spin text-primary" /> Subiendo...</>
              : <><Camera className="h-6 w-6 text-primary" /> {fotos.length > 0 ? 'Agregar otra foto' : 'Sacar foto'}</>}
          </button>
          {showStartButton && <p className="text-xs text-muted-foreground mt-2">Iniciá la orden para cargar fotos.</p>}
        </div>

        {(enCurso || !dosPasos) && (
          <div className="rounded-2xl border border-border p-4 bg-card space-y-3">
            <label htmlFor="portal-notas" className="font-bold text-sm text-foreground flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Notas (opcional)</label>
            <textarea id="portal-notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Lo que el jefe tenga que saber"
              className="w-full rounded-xl border-2 border-border bg-background/60 px-3 py-2 text-base text-foreground focus:outline-none focus:border-primary" />
            {verFirma ? (
              <div className="space-y-2">
                <p className="font-bold text-sm text-foreground flex items-center gap-2"><PenLine className="h-4 w-4 text-primary" /> Firma de conformidad</p>
                <div className="rounded-xl bg-white"><FirmaCanvas onCambio={setFirma} /></div>
              </div>
            ) : (
              <button type="button" onClick={() => setVerFirma(true)} className="text-sm font-semibold text-primary flex items-center gap-2 min-h-[44px]">
                <PenLine className="h-4 w-4" /> Agregar firma de conformidad
              </button>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t border-border px-4 py-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="max-w-md mx-auto">
          {error && (
            <p role="alert" className="text-center text-sm text-destructive font-medium mb-3 flex items-center justify-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</p>
          )}
          {enCurso && needsPhoto && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-center text-sm text-orange-400 font-medium mb-3 flex items-center justify-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Esta OT requiere al menos una foto
            </motion.p>
          )}
          {showStartButton ? (
            <button onClick={handleIniciar} disabled={saving}
              className="w-full h-16 rounded-2xl bg-blue-600 disabled:bg-muted disabled:text-muted-foreground text-white font-bold text-xl flex items-center justify-center gap-3 shadow-lg shadow-blue-600/30 active:scale-[0.98] transition-all">
              {saving ? <><Loader2 className="h-6 w-6 animate-spin" /> Iniciando...</> : <><Play className="h-7 w-7" /> Iniciar Orden</>}
            </button>
          ) : (
            <button onClick={handleFinalizar} disabled={saving || subiendo || needsPhoto || needsMotivo}
              className="w-full h-16 rounded-2xl bg-emerald-500 disabled:bg-muted disabled:text-muted-foreground text-white font-bold text-xl flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/30 active:scale-[0.98] transition-all">
              {saving ? <><Loader2 className="h-6 w-6 animate-spin" /> Guardando...</>
                : <><Flag className="h-7 w-7" /> {enCurso ? 'Finalizar y Enviar' : 'Finalizar y Enviar al Jefe'}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Aviso de señal y de lo que espera en el teléfono (como el banner de la v1) ──
function AvisoCola({ online, enviando, cola, onReintentar, onDescartar }: {
  online: boolean; enviando: boolean; cola: ItemCola[]; onReintentar: (id: number) => void; onDescartar: (id: number) => void;
}) {
  const rechazadas = cola.filter((i) => i.error);
  const esperando = cola.length - rechazadas.length;
  if (online && cola.length === 0) return null;
  const QUE: Record<string, string> = { iniciar: 'Iniciar', foto: 'Foto', finalizar: 'Enviar al jefe' };
  return (
    <div className="sticky top-0 z-50 space-y-1 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-xs font-medium text-amber-300" role="status"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
      <p className="flex items-center gap-2">
        {enviando ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <WifiOff className="h-4 w-4 shrink-0" />}
        {enviando ? `Enviando ${esperando} ${esperando === 1 ? 'cosa guardada' : 'cosas guardadas'}...`
          : !online ? 'Sin conexión: lo que hagas queda guardado en el teléfono y se envía solo al volver la señal.'
            : esperando > 0 ? `${esperando} ${esperando === 1 ? 'cosa guardada' : 'cosas guardadas'} esperando para enviarse.` : 'Hay cosas que no se pudieron enviar.'}
      </p>
      {rechazadas.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive/15 px-2 py-1.5 text-destructive">
          <span className="flex-1">No se pudo enviar ({QUE[i.op.tipo]}): {i.error}</span>
          <button type="button" onClick={() => onReintentar(i.id!)} className="min-h-[36px] rounded-md bg-white/10 px-2 font-semibold">Probar de nuevo</button>
          <button type="button" onClick={() => onDescartar(i.id!)} className="min-h-[36px] rounded-md px-2 underline">Descartar</button>
        </div>
      ))}
    </div>
  );
}

// ── Pantalla principal ──────────────────────────────────────────────────────
function Portal() {
  const token = useSearchParams().get('t') ?? '';
  const [phase, setPhase] = useState<'loading' | 'pin' | 'list' | 'execute' | 'error'>('loading');
  const [ingreso, setIngreso] = useState<Ingreso | null>(null);
  const [orders, setOrders] = useState<OrdenPortal[]>([]);
  const [selected, setSelected] = useState<OrdenPortal | null>(null);
  const [aviso, setAviso] = useState('');
  const [cola, setCola] = useState<ItemCola[]>([]);
  const [online, setOnline] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const ingresoRef = useRef<Ingreso | null>(null);
  ingresoRef.current = ingreso;

  const leerCola = useCallback(async () => { const c = await colaDe(token); setCola(c); return c; }, [token]);

  // El pase venció (o se apagó el portal): se pide la clave de nuevo. Lo guardado no se pierde.
  const vencido = useCallback(async (msg: string) => {
    olvidarPase(token);
    setIngreso(null); setSelected(null);
    const n = (await colaDe(token)).length;
    setAviso(n ? `${msg} Tenés ${n} ${n === 1 ? 'cosa guardada' : 'cosas guardadas'}: se envían cuando entres.` : msg);
    setPhase('pin');
  }, [token]);

  const cargar = useCallback(async (i: Ingreso) => {
    const c = await leerCola();
    try {
      setOrders(aplicarCola(await listarOrdenes(token, i.pase), c, i.nombre));
      setPhase('list');
    } catch (e) {
      if (e instanceof SinRed) {
        // Sin señal: la última lista guardada, con lo que está esperando aplicado.
        setOrders(aplicarCola(ordenesGuardadas(token) ?? [], c, i.nombre));
        setPhase('list');
        return;
      }
      const msg = e instanceof Error ? e.message : 'No se pudieron cargar las órdenes.';
      if (/venció/.test(msg)) await vencido(msg);
      else { setAviso(msg); setPhase('list'); }
    }
  }, [token, leerCola, vencido]);

  // Envía lo guardado: al abrir, al volver la señal, al volver a la app y cada 30 s.
  const enviar = useCallback(async () => {
    const i = ingresoRef.current;
    if (!i || !navigator.onLine) return;
    const c = await colaDe(token);
    if (!c.some((x) => !x.error)) { setCola(c); return; }
    setEnviando(true);
    const r = await enviarCola(token, i.pase).finally(() => setEnviando(false));
    if (r === 'vencido') { await vencido('Tu ingreso venció. Poné la clave de nuevo.'); return; }
    await cargar(i);
  }, [token, cargar, vencido]);

  useEffect(() => {
    if (!token) { setPhase('error'); return; }
    setOnline(navigator.onLine);
    const g = paseGuardado(token);
    if (g) { setIngreso(g); ingresoRef.current = g; cargar(g).then(enviar); } else { leerCola(); setPhase('pin'); }
    const on = () => { setOnline(true); enviar(); };
    const off = () => setOnline(false);
    const vis = () => { if (document.visibilityState === 'visible') enviar(); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', vis);
    const t = setInterval(enviar, 30_000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', vis); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const banner = (
    <AvisoCola online={online} enviando={enviando} cola={cola}
      onReintentar={async (id) => { await reintentar(id); await leerCola(); enviar(); }}
      onDescartar={async (id) => { await descartar(id); const i = ingresoRef.current; if (i) await cargar(i); else await leerCola(); }} />
  );

  if (phase === 'loading') return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-12 w-12 text-primary/40 animate-spin" /></div>;

  if (phase === 'error') return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-3xl p-8 max-w-xs w-full text-center">
        <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4"><AlertTriangle className="h-8 w-8 text-destructive" /></div>
        <h2 className="font-bold text-xl text-foreground mb-1">QR no válido</h2>
        <p className="text-muted-foreground text-sm">Escaneá de nuevo el código del lugar.</p>
      </motion.div>
    </div>
  );

  if (phase === 'pin' || !ingreso) return (
    <>
      {aviso && <div role="status" className="fixed top-0 inset-x-0 z-50 bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-xs font-medium px-4 py-2 text-center">{aviso}</div>}
      <PantallaClave token={token} onSuccess={(i) => { setAviso(''); setIngreso(i); ingresoRef.current = i; cargar(i).then(enviar); }} />
    </>
  );

  if (phase === 'execute' && selected) return (
    <>
      {banner}
      <EjecutarOT token={token} order={selected} ingreso={ingreso}
        onBack={() => { setSelected(null); cargar(ingreso); }}
        onListo={() => { setSelected(null); cargar(ingreso).then(enviar); }}
        onVencido={vencido}
        onCola={leerCola} />
    </>
  );

  return (
    <>
      {banner}
      {aviso && <p role="alert" className="bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">{aviso}</p>}
      <ListaOTs orders={orders} ingreso={ingreso} onSelect={(o) => { setAviso(''); setSelected(o); setPhase('execute'); }}
        onSalir={() => {
          if (cola.length) { setAviso('Tenés cosas guardadas sin enviar. Esperá a tener señal antes de salir.'); return; }
          salirPortal(token); setIngreso(null); setOrders([]); setPhase('pin');
        }} />
    </>
  );
}

export default function PaginaPortal() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <Portal />
    </Suspense>
  );
}
