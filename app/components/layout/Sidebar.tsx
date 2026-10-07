'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle, Award, BarChart2, Bell, BookOpen, Building2, Calculator, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  ClipboardCheck, ClipboardCopy, ClipboardList, FileCheck2, FileText, FolderKanban, HardHat, Info, LayoutDashboard, LifeBuoy, Lock,
  MapPin, MessageSquare, Package, RefreshCw, ShieldAlert, ShoppingCart, Truck, UserCog, Wallet, Wrench, X, Inbox,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { obtenerBandeja } from '@/lib/control';
import { useSesion } from '@/lib/sesion';

interface Item {
  label: string;
  icon: LucideIcon;
  path: string;
  soloGerencia?: boolean;
  soloAdmin?: boolean;
  // El operario no entra a gestión: ve solo estos, y Emergencias lo lleva a reportar una.
  todos?: boolean;
  pathOperario?: string;
}

export const LOGO_DH1 = 'https://media.base44.com/images/public/69bc7d2a6f0e7ed160c90003/7a2959dd1_image.png';

// Grupos y nombres de la v1 (components/layout/Sidebar.jsx). Las secciones que solo existen en la v2
// (Pendientes SAP, Plantillas, Ubicaciones, Préstamos, Compras, Cobros, Sugerencias) van en el grupo que les corresponde.
export const navGroups: { label: string; items: Item[] }[] = [
  {
    label: 'General',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, path: '/gestion' },
      { label: 'Calendario', icon: CalendarDays, path: '/gestion/calendario' },
      { label: 'Mis Órdenes de Trabajo', icon: HardHat, path: '/mis-ots', todos: true },
    ],
  },
  {
    label: 'Emergencias',
    items: [{ label: '🚨 Emergencias', icon: AlertTriangle, path: '/gestion/emergencias', todos: true, pathOperario: '/emergencia' }],
  },
  {
    label: 'Operaciones',
    items: [
      { label: 'Proyectos', icon: FolderKanban, path: '/gestion/obras' },
      { label: 'Órdenes de Trabajo', icon: ClipboardList, path: '/gestion/ots' },
      { label: 'Plantillas de OT', icon: ClipboardCopy, path: '/gestion/plantillas' },
      { label: 'Pendientes SAP', icon: Inbox, path: '/gestion/pendientes' },
      { label: 'Activos', icon: ClipboardCheck, path: '/gestion/activos' },
      { label: 'Informes', icon: ClipboardCheck, path: '/gestion/informes' },
      { label: 'Plan de Infraestructura', icon: Wrench, path: '/gestion/calefaccion' },
      { label: 'Rutinas de Mantenimiento', icon: RefreshCw, path: '/gestion/rutinas' },
      { label: 'Inspección de Colegios', icon: ClipboardCheck, path: '/gestion/inspecciones' },
      { label: 'Reportes & KPIs', icon: BarChart2, path: '/gestion/reportes' },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { label: 'Proveedores', icon: Truck, path: '/gestion/proveedores' },
      { label: 'Presupuestos Obra', icon: Calculator, path: '/gestion/presupuestos' },
      { label: 'Control de Riesgos', icon: ShieldAlert, path: '/gestion/riesgos' },
      { label: 'Certificados', icon: Award, path: '/gestion/certificacion' },
      { label: 'Aprobación Certificados', icon: FileCheck2, path: '/gestion/solicitudes' },
      { label: 'Centro Financiero', icon: Wallet, path: '/gestion/cobros' },
    ],
  },
  {
    label: 'Recursos',
    items: [
      { label: 'Información General', icon: Info, path: '/gestion/informacion' },
      { label: 'Empleados', icon: UserCog, path: '/gestion/empleados' },
      { label: 'Mapa de Ubicaciones', icon: MapPin, path: '/gestion/mapa' },
      { label: 'Ubicaciones', icon: MapPin, path: '/gestion/ubicaciones' },
      { label: 'Inventario', icon: Package, path: '/gestion/panol' },
      { label: 'Préstamos de herramientas', icon: Wrench, path: '/gestion/prestamos' },
      { label: 'Requerimientos de compra', icon: ShoppingCart, path: '/gestion/requerimientos' },
    ],
  },
  {
    label: 'Administración',
    items: [
      { label: 'Alertas Proactivas', icon: Bell, path: '/gestion/alertas' },
      { label: 'Control de Acceso', icon: Lock, path: '/gestion/usuarios', soloGerencia: true },
      { label: 'Auditoría', icon: FileText, path: '/gestion/auditoria', soloGerencia: true },
      { label: 'Sectores', icon: Building2, path: '/gestion/sectores', soloAdmin: true },
    ],
  },
  {
    label: 'Comunicación',
    items: [
      { label: 'Foro de Comunicaciones', icon: MessageSquare, path: '/gestion/foro', todos: true },
      { label: 'Sugerencias y problemas', icon: LifeBuoy, path: '/gestion/sugerencias', todos: true },
    ],
  },
  {
    label: 'Ayuda y Aprendizaje',
    items: [{ label: 'Centro de Aprendizaje', icon: BookOpen, path: '/gestion/ayuda', todos: true }],
  },
];

export function esRutaActiva(ruta: string, path: string) {
  if (path === '/gestion') return ruta === '/gestion';
  return ruta === path || ruta.startsWith(`${path}/`);
}

const APROBACION = '/gestion/solicitudes';

const NavItem = memo(function NavItem({ item, collapsed, active, onClick, pendientesAprobacion }: {
  item: Item; collapsed: boolean; active: boolean; onClick: () => void; pendientesAprobacion: number;
}) {
  const showAprobacionBadge = item.path === APROBACION && pendientesAprobacion > 0 && !active;
  const Icon = item.icon;
  return (
    <div className="group relative">
      <Link
        href={item.path}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
          collapsed && 'mx-1 justify-center px-0',
          active ? 'bg-primary/20 text-white shadow-sm shadow-primary/10' : 'text-white/70 hover:bg-white/6 hover:text-white',
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_2px_rgba(59,130,246,0.4)]" />
        )}
        <div className="relative flex-shrink-0">
          <Icon className={cn('transition-transform duration-150', collapsed ? 'h-[18px] w-[18px]' : 'h-[16px] w-[16px]', active ? 'text-primary' : '')} />
          {showAprobacionBadge && (
            <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_3px_rgba(251,191,36,0.7)]" />
            </span>
          )}
        </div>
        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        {!collapsed && showAprobacionBadge && (
          <span className="ml-auto flex flex-shrink-0 items-center gap-1">
            <span className="animate-pulse rounded-full border border-amber-400/40 bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.3)]">
              {pendientesAprobacion}
            </span>
          </span>
        )}
      </Link>
      {collapsed && (
        <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#1a2d48] px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
          {item.label}
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#1a2d48]" />
        </div>
      )}
    </div>
  );
});

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn('flex items-center gap-3 border-b border-white/8 px-4 py-4', collapsed && 'justify-center px-2 py-4')}>
      <div className={cn('relative flex-shrink-0', collapsed ? 'h-8 w-8' : 'h-10')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={LOGO_DH1}
          alt="DH1 Software"
          className={cn('relative z-10 object-contain mix-blend-screen transition-all duration-300', collapsed ? 'h-8 w-8' : 'h-10')}
          style={{ filter: 'drop-shadow(0 0 6px rgba(0,180,255,0.7)) drop-shadow(0 0 14px rgba(0,220,130,0.45))' }}
        />
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight tracking-wide" style={{ color: '#e8f4ff', animation: 'glowPulse 2.8s ease-in-out infinite' }}>
            DH1 Software
          </p>
          <p className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40">Platform</p>
        </div>
      )}
    </div>
  );
}

const FONDO = 'linear-gradient(180deg, #0a1628 0%, #0f1e34 55%, #091422 100%)';
const CLAVE_GRUPOS = 'dh1-collapsed-nav';

export function Sidebar({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const ruta = usePathname();
  const { perfil, esGerencia, entraAGestion } = useSesion();
  const [collapsed, setCollapsed] = useState(false);
  const [pendientesAprobacion, setPendientesAprobacion] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(navGroups.map((g) => g.label)));

  // Grupos plegados: se recuerdan en este navegador, como en la v1.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CLAVE_GRUPOS) ?? 'null');
      if (Array.isArray(saved)) setCollapsedGroups(new Set(saved));
    } catch { /* sin almacenamiento: quedan todos plegados */ }
  }, []);
  const guardar = (s: Set<string>) => { try { localStorage.setItem(CLAVE_GRUPOS, JSON.stringify([...s])); } catch { /* ignorar */ } };

  const isActive = useCallback((path: string) => esRutaActiva(ruta, path), [ruta]);

  // Se despliega solo el grupo de la sección abierta.
  useEffect(() => {
    if (collapsed) return;
    setCollapsedGroups((prev) => {
      const activeGroup = navGroups.find((g) => g.items.some((it) => isActive(it.path)));
      if (!activeGroup || !prev.has(activeGroup.label)) return prev;
      const next = new Set(prev);
      next.delete(activeGroup.label);
      guardar(next);
      return next;
    });
  }, [ruta, collapsed, isActive]);

  // Certificados esperando aprobación (punto ámbar al lado de "Aprobación Certificados").
  useEffect(() => {
    let vivo = true;
    obtenerBandeja()
      .then((b) => { if (vivo) setPendientesAprobacion((b.solicitudes_por_revisar ?? 0) + (b.certificados_por_aprobar ?? 0)); })
      .catch(() => { if (vivo) setPendientesAprobacion(0); });
    return () => { vivo = false; };
  }, [ruta]);

  const toggleGroup = (label: string) => setCollapsedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(label)) next.delete(label); else next.add(label);
    guardar(next);
    return next;
  });

  const visibleGroups = useMemo(() => navGroups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((i) => (entraAGestion || i.todos) && (!i.soloGerencia || esGerencia) && (!i.soloAdmin || perfil?.rol === 'admin'))
        .map((i) => (!entraAGestion && i.pathOperario ? { ...i, path: i.pathOperario } : i)),
    }))
    .filter((g) => g.items.length > 0), [esGerencia, entraAGestion, perfil?.rol]);

  const cerrarMovil = useCallback(() => onOpenChange(false), [onOpenChange]);

  // En el teléfono, el cajón muestra solo General, Emergencias y Operaciones (como la v1).
  const mobileGroups = visibleGroups.filter((g) => ['General', 'Emergencias', 'Operaciones'].includes(g.label));

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={cerrarMovil} />
          <div className="absolute bottom-0 left-0 top-0 w-64 shadow-2xl" style={{ background: FONDO }}>
            <button type="button" onClick={cerrarMovil} aria-label="Cerrar menú"
              className="absolute right-3 top-4 z-10 rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <div className="flex h-full flex-col">
              <Logo collapsed={false} />
              <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
                {mobileGroups.map((group) => (
                  <div key={group.label}>
                    <div className="mb-1.5 mt-1 flex items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-sidebar-foreground/70">
                      <span className="flex-shrink-0">{group.label}</span>
                      <div className="h-px flex-1 bg-border/40" />
                      <span className="shrink-0 text-[9px] tabular-nums text-sidebar-foreground/50">{group.items.length}</span>
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item) => (
                        <NavItem key={item.path} item={item} collapsed={false} active={isActive(item.path)} onClick={cerrarMovil} pendientesAprobacion={pendientesAprobacion} />
                      ))}
                    </div>
                  </div>
                ))}
              </nav>
            </div>
          </div>
        </div>
      )}

      <aside className={cn('no-imprimir hidden flex-shrink-0 flex-col border-r border-white/8 transition-all duration-300 lg:flex', collapsed ? 'w-[58px]' : 'w-[228px]')}
        style={{ background: FONDO }}>
        <div className="flex h-full flex-col">
          <Logo collapsed={collapsed} />
          <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Secciones">
            {visibleGroups.map((group) => {
              const isGroupCollapsed = collapsedGroups.has(group.label);
              const groupPending = pendientesAprobacion > 0 && group.items.some((it) => it.path === APROBACION) ? pendientesAprobacion : 0;
              const wrapperCls = collapsed
                ? 'space-y-0.5'
                : cn('space-y-0.5 overflow-hidden transition-all duration-200', isGroupCollapsed ? 'max-h-0 opacity-0' : 'max-h-[600px] opacity-100');
              return (
                <div key={group.label}>
                  {!collapsed ? (
                    <button type="button" onClick={() => toggleGroup(group.label)} aria-expanded={!isGroupCollapsed}
                      className={cn('mb-1 mt-1 flex w-full items-center gap-2 px-3 text-[9px] font-bold uppercase tracking-[0.14em] transition-colors',
                        groupPending > 0 && isGroupCollapsed ? 'text-amber-400 hover:text-amber-300' : 'text-sidebar-foreground/60 hover:text-sidebar-foreground/90')}>
                      <ChevronDown className={cn('h-3 w-3 flex-shrink-0 transition-transform duration-200', isGroupCollapsed && '-rotate-90')} />
                      <span className="flex-shrink-0">{group.label}</span>
                      <div className="h-px flex-1 bg-white/12" />
                      {groupPending > 0 && isGroupCollapsed ? (
                        <span className="flex shrink-0 items-center">
                          <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.6)]" />
                          </span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-[8px] tabular-nums text-sidebar-foreground/40">{group.items.length}</span>
                      )}
                    </button>
                  ) : (
                    <div className="mx-2 my-2 h-px bg-white/5" />
                  )}
                  <div className={wrapperCls}>
                    {group.items.map((item) => (
                      <NavItem key={item.path} item={item} collapsed={collapsed} active={isActive(item.path)} onClick={cerrarMovil} pendientesAprobacion={pendientesAprobacion} />
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="hidden border-t border-sidebar-border/30 p-3 lg:flex">
            <button type="button" onClick={() => setCollapsed((c) => !c)}
              className="group flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs text-sidebar-foreground/30 transition-all duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/70">
              {collapsed ? <ChevronRight className="h-4 w-4 transition-transform group-hover:scale-110" /> : (
                <>
                  <ChevronLeft className="h-4 w-4 transition-transform group-hover:scale-110" />
                  <span className="tracking-wide">Colapsar</span>
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
