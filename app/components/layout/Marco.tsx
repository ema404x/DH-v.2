'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ClipboardList, HardHat, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSesion } from '@/lib/sesion';
import { GlobalSearch, NotificationBell, SectorSwitcher, UserMenu } from './Barra';
import { Sidebar, esRutaActiva, navGroups } from './Sidebar';

// Marco de la v1 (components/layout/AppLayout.jsx): menú lateral, barra superior y, en el teléfono,
// encabezado con "Atrás" y barra inferior con Órdenes / Emergencias / Mis Órdenes / Más.

const TITULOS: Record<string, string> = Object.fromEntries(
  navGroups.flatMap((g) => g.items.map((i) => [i.path, i.label.replace('🚨 ', '')])),
);
TITULOS['/gestion'] = 'Inicio';
TITULOS['/gestion/ots'] = 'Órdenes';
TITULOS['/gestion/ots/nueva'] = 'Crear OT';
TITULOS['/gestion/perfil'] = 'Mi perfil';

function tituloDe(ruta: string) {
  if (TITULOS[ruta]) return TITULOS[ruta];
  const rutas = Object.keys(TITULOS).filter((r) => r !== '/gestion').sort((a, b) => b.length - a.length);
  for (const r of rutas) if (ruta.startsWith(r)) return TITULOS[r];
  return 'DH1';
}

function MobileHeader() {
  const ruta = usePathname();
  const { entraAGestion } = useSesion();
  const router = useRouter();
  const isRoot = ruta === '/gestion' || (!entraAGestion && ruta === '/mis-ots');
  return (
    <header className="relative z-30 flex flex-shrink-0 items-center border-b border-border bg-card/95 px-2 backdrop-blur-xl lg:hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(3rem + env(safe-area-inset-top))' }}>
      {isRoot ? (
        <div className="z-10 flex h-11 items-center px-2">
          <span className="text-[15px] font-semibold tracking-[0.06em] text-foreground">DH1</span>
        </div>
      ) : (
        <button type="button" aria-label="Volver" onClick={() => (window.history.length > 1 ? router.back() : router.push('/gestion'))}
          className="z-10 -ml-1 flex h-11 items-center gap-1.5 rounded-lg px-2 transition-colors active:bg-muted">
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-medium tracking-wide text-foreground/80">Atrás</span>
        </button>
      )}
      {!isRoot && (
        <span className="pointer-events-none absolute left-1/2 max-w-[45%] -translate-x-1/2 truncate text-[15px] font-semibold tracking-[0.01em] text-foreground">
          {tituloDe(ruta)}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1 pr-1">
        <SectorSwitcher />
        {entraAGestion && <GlobalSearch variant="icon" />}
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}

const NAV_INFERIOR = [
  { label: 'Órdenes', icon: ClipboardList, path: '/gestion/ots' },
  { label: 'Emergencias', icon: AlertTriangle, path: '/gestion/emergencias' },
  { label: 'Mis Órdenes', icon: HardHat, path: '/mis-ots' },
];

function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const ruta = usePathname();
  const { entraAGestion } = useSesion();
  // El operario: Mis Órdenes y reportar una emergencia.
  const items = entraAGestion ? NAV_INFERIOR : [NAV_INFERIOR[2], { ...NAV_INFERIOR[1], path: '/emergencia' }];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Navegación principal">
      <div className="flex items-stretch border-t border-border/60 bg-card/95 shadow-[0_-4px_20px_rgba(0,0,0,0.25)] backdrop-blur-xl">
        {items.map((item) => {
          const active = esRutaActiva(ruta, item.path);
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path} aria-current={active ? 'page' : undefined}
              className="relative flex min-h-[56px] flex-1 select-none flex-col items-center justify-center gap-1.5 py-2.5 transition-colors active:bg-muted/40">
              <span className="relative flex h-9 w-16 items-center justify-center rounded-full">
                {active && <span className="absolute inset-0 rounded-full bg-primary/15" />}
                <Icon className={cn('relative h-5 w-5 transition-all duration-200', active ? 'scale-105 text-primary' : 'text-muted-foreground')} />
              </span>
              <span className={cn('max-w-full truncate px-1 text-[10px] leading-none tracking-wide transition-colors', active ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                {item.label}
              </span>
            </Link>
          );
        })}
        <button type="button" onClick={onMore} aria-label="Más módulos"
          className="relative flex min-h-[56px] flex-1 select-none flex-col items-center justify-center gap-1.5 py-2.5 transition-colors active:bg-muted/40">
          <span className="relative flex h-9 w-16 items-center justify-center rounded-full">
            <LayoutGrid className="h-5 w-5 text-muted-foreground" />
          </span>
          <span className="text-[10px] leading-none tracking-wide text-muted-foreground">Más</span>
        </button>
      </div>
    </nav>
  );
}

export function Marco({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { entraAGestion } = useSesion();
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0f1e34 55%, #091422 100%)' }}>
      {extra}
      <Sidebar open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileHeader />
        <header className="no-imprimir z-30 hidden h-14 flex-shrink-0 items-center gap-3 border-b border-white/8 pl-5 pr-5 lg:flex"
          style={{ background: 'rgba(10,22,40,0.85)', backdropFilter: 'blur(12px)' }}>
          <div className="max-w-md flex-1">
            {entraAGestion && <GlobalSearch />}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <SectorSwitcher />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="main-scroll flex-1 overflow-y-auto overflow-x-hidden p-4 pb-24 sm:p-5 lg:p-6 lg:pb-6" style={{ background: 'transparent' }}>
          <div className="space-y-5">{children}</div>
        </main>
      </div>
      <MobileBottomNav onMore={() => setMobileNavOpen(true)} />
    </div>
  );
}
