'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle, AlertTriangle, Bell, Building2, Check, CheckCheck, ChevronDown, ClipboardList, Clock, Eye, Info, LogOut, Package, Search,
  UserCircle, Wrench, X, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { listarAlertas, type Alerta } from '@/lib/control';
import { cambiarSectorActivo, setVerTodos } from '@/lib/gestion';
import { limpiarError } from '@/lib/errores';
import { useSesion } from '@/lib/sesion';
import { ROLES } from '@/lib/types';

// Piezas de la barra superior de la v1 (GlobalSearch, SectorSwitcher, NotificationBell, UserMenu).

export function GlobalSearch({ variant = 'bar' }: { variant?: 'bar' | 'icon' }) {
  // El buscador en sí es BuscadorGlobal (montado en el marco); este botón solo lo abre.
  const abrir = () => window.dispatchEvent(new Event('dh1:buscar'));
  if (variant === 'icon') {
    return (
      <button type="button" onClick={abrir} aria-label="Buscar"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 active:bg-muted">
        <Search className="h-5 w-5" />
      </button>
    );
  }
  return (
    <button type="button" onClick={abrir}
      className="flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
      <Search className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="flex-1 text-left">Buscar...</span>
      <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline-flex">⌘K</kbd>
    </button>
  );
}

// Cambio de sector: solo admin y gerente general. Después de cambiar se recarga todo.
export function SectorSwitcher() {
  const { perfil, sectores, sectorEfectivo } = useSesion();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!perfil || !(perfil.rol === 'admin' || perfil.rol === 'gerente_general')) return null;
  const actual = sectorEfectivo?.nombre ?? 'Sin sector';

  async function aplicar(id: string, accion: () => Promise<void>, aviso?: string) {
    setSwitching(id);
    try {
      await accion();
      if (aviso) toast.success(aviso);
      window.location.reload();
    } catch (e) {
      toast.error('Error al cambiar de sector: ' + limpiarError(e));
      setSwitching(null);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center gap-2 rounded-lg border border-border bg-card/50 text-sm transition-colors hover:bg-accent lg:h-9 lg:w-auto lg:px-3">
        <span className="text-base leading-none">🏢</span>
        <span className="hidden max-w-[100px] truncate font-medium lg:inline">{actual}</span>
        <span className="hidden items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary lg:inline-flex">
          Viendo: {perfil.ver_todos ? 'todos' : actual}
        </span>
        <ChevronDown className={cn('hidden h-3.5 w-3.5 transition-transform lg:block', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
          <div className="border-b border-border p-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3 w-3" /> Cambiar de sector
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {sectores.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">Sin sectores</div>
            ) : sectores.map((s) => {
              const isCurrent = s.id === sectorEfectivo?.id;
              return (
                <button key={s.id} type="button" disabled={isCurrent || switching === s.id || !s.activo}
                  onClick={() => aplicar(s.id, () => cambiarSectorActivo(s.id), `Cambiaste al sector: ${s.nombre}`)}
                  className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors', isCurrent ? 'bg-primary/10' : 'hover:bg-accent', !s.activo && !isCurrent && 'opacity-40')}>
                  <span className="flex-shrink-0 text-lg leading-none">🏢</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.nombre}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{s.clave}</p>
                  </div>
                  {switching === s.id && <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
                  {isCurrent && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
          {perfil.rol === 'admin' && (
            <label className="flex cursor-pointer items-center gap-2 border-t border-border px-3 py-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-cyan-500" checked={perfil.ver_todos} disabled={!!switching}
                onChange={(e) => aplicar('todos', () => setVerTodos(e.target.checked))} />
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              Ver todos los sectores
            </label>
          )}
        </div>
      )}
    </div>
  );
}

const TYPE_CONFIG: Record<string, { icon: LucideIcon; bg: string; icon_color: string; border: string; dot: string }> = {
  info: { icon: Info, bg: 'bg-blue-500/15', icon_color: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-400' },
  warning: { icon: AlertTriangle, bg: 'bg-amber-500/15', icon_color: 'text-amber-400', border: 'border-amber-500/30', dot: 'bg-amber-400' },
  error: { icon: AlertCircle, bg: 'bg-red-500/15', icon_color: 'text-red-400', border: 'border-red-500/30', dot: 'bg-red-400' },
};
const TIPO_UI: Record<string, { icon: LucideIcon; single: string; plural: string }> = {
  ot_vencida: { icon: ClipboardList, single: 'OT vencida', plural: 'OTs vencidas' },
  pendiente_vencido: { icon: Clock, single: 'Pendiente vencido', plural: 'Pendientes vencidos' },
  garantia: { icon: Wrench, single: 'Garantía por vencer', plural: 'Garantías por vencer' },
  mantenimiento: { icon: Wrench, single: 'Mantenimiento vencido', plural: 'Mantenimientos vencidos' },
  stock: { icon: Package, single: 'Material con stock bajo', plural: 'Materiales con stock bajo' },
};
const RANK: Record<string, number> = { critica: 0, aviso: 1, info: 2 };
const nivelATipo = (n: string) => (n === 'critica' ? 'error' : n === 'aviso' ? 'warning' : 'info');

// Campana: las alertas del sistema agrupadas por tipo (la visibilidad la resuelve la base).
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [alertas, setAlertas] = useState<Alerta[]>([]);

  const cargar = () => listarAlertas().then(setAlertas).catch(() => setAlertas([]));
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const grupos = useMemo(() => {
    const g: Record<string, Alerta[]> = {};
    for (const a of alertas) (g[a.tipo] ??= []).push(a);
    return Object.entries(g).map(([tipo, items]) => {
      const ui = TIPO_UI[tipo] ?? { icon: AlertTriangle, single: tipo, plural: tipo };
      const peor = items.reduce((acc, a) => ((RANK[a.nivel] ?? 3) < (RANK[acc.nivel] ?? 3) ? a : acc), items[0]);
      const criticas = items.filter((i) => i.nivel === 'critica').length;
      const plural = items.length > 1;
      return {
        tipo, icon: ui.icon, enlace: plural ? '/gestion/alertas' : peor.enlace,
        title: `${items.length} ${plural ? ui.plural : ui.single}`,
        message: plural ? `${items.length} casos en tu ámbito (${criticas} crítico${criticas !== 1 ? 's' : ''})` : (peor.detalle ?? peor.titulo),
        type: nivelATipo(peor.nivel),
      };
    });
  }, [alertas]);
  const unread = grupos.length;

  return (
    <div className="relative">
      <button type="button" aria-label="Notificaciones" onClick={() => { setOpen(!open); if (!open) cargar(); }}
        className={cn('relative flex h-11 w-11 items-center justify-center rounded-lg transition-all duration-200 lg:h-9 lg:w-9',
          open ? 'bg-primary/15 text-primary' : 'text-slate-400 hover:bg-white/8 hover:text-slate-200')}>
        <Bell className={cn('h-[18px] w-[18px] transition-transform duration-200', open && 'scale-110')} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] animate-pulse items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white shadow-md shadow-red-500/40">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="fixed right-2 top-14 z-[70] w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl shadow-black/30 sm:absolute sm:right-0 sm:top-11 sm:w-[340px]">
            <div className="flex items-center justify-between border-b border-border/50 bg-muted/20 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <Bell className="h-4 w-4 text-foreground/70" />
                  {unread > 0 && <div className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" />}
                </div>
                <div>
                  <span className="text-sm font-semibold text-foreground">Notificaciones</span>
                  {unread > 0 && <span className="ml-2 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">{unread} nuevas</span>}
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {grupos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/40">
                    <CheckCheck className="h-5 w-5 opacity-50" />
                  </div>
                  <p className="text-sm font-medium">Todo al día</p>
                  <p className="mt-1 text-xs opacity-60">Sin notificaciones pendientes</p>
                </div>
              ) : (
                <div className="space-y-1 p-2">
                  <div className="px-2 pb-0.5 pt-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Sistema</span>
                  </div>
                  {grupos.map((n) => {
                    const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info;
                    const Icon = n.icon;
                    return (
                      <button key={n.tipo} type="button" onClick={() => { router.push(n.enlace); setOpen(false); }}
                        className={cn('flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all hover:scale-[1.01] active:scale-[0.99]', cfg.bg, cfg.border)}>
                        <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', cfg.bg)}>
                          <Icon className={cn('h-3.5 w-3.5', cfg.icon_color)} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold leading-tight text-foreground">{n.title}</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{n.message}</p>
                        </div>
                        <div className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', cfg.dot)} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function UserMenu() {
  const router = useRouter();
  const { perfil, salir } = useSesion();
  const [open, setOpen] = useState(false);
  const displayName = perfil?.nombre ?? '';
  const initials = displayName.trim()
    ? displayName.trim().split(/\s+/).map((n) => n[0] || '').join('').toUpperCase().slice(0, 2) || '?'
    : '?';

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label="Menú de usuario"
        className="flex h-11 w-11 items-center justify-center gap-2 rounded-lg transition-colors hover:bg-white/10 lg:h-9 lg:w-auto lg:px-2">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{initials}</div>
        <span className="hidden max-w-[120px] truncate text-sm font-medium text-slate-300 lg:block">{displayName}</span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-slate-500 lg:block" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} style={{ touchAction: 'none' }} />
          <div className="fixed right-2 top-14 z-[70] w-56 overflow-hidden rounded-xl border border-border bg-popover py-1.5 shadow-2xl">
            <div className="mb-1 border-b border-border px-3 py-2.5">
              <div className="truncate text-sm font-semibold text-popover-foreground">{displayName}</div>
              <div className="truncate text-xs text-muted-foreground">{perfil?.email}</div>
              <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {perfil ? ROLES[perfil.rol] : 'user'}
              </span>
            </div>
            <button type="button" onClick={() => { router.push('/gestion/perfil'); setOpen(false); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-popover-foreground transition-colors hover:bg-accent">
              <UserCircle className="h-4 w-4 text-muted-foreground" />
              Mi perfil
            </button>
            <div className="mx-2 my-1 border-t border-border" />
            <button type="button" onClick={() => { setOpen(false); salir(); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-popover-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
              <LogOut className="h-4 w-4 text-muted-foreground" />
              Cerrar sesión
            </button>
          </div>
        </>
      )}
    </div>
  );
}
