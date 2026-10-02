'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Bell, Boxes, CircleHelp, Layers, LifeBuoy, MessagesSquare, Search, ShieldAlert, UserRound, Building2, Calculator, CalendarDays, ClipboardCheck, ClipboardCopy, ClipboardList, Construction, FileQuestion, FileSpreadsheet, FileText,
  HardHat, History, Inbox, LayoutDashboard, ListChecks, LogOut, Map, MapPin, Package, ShoppingCart, Siren, Smartphone, Thermometer, Truck, Users, Wallet, Wrench,
  type LucideIcon,
} from 'lucide-react';
import { obtenerBandeja } from '@/lib/control';
import { useSesion } from '@/lib/sesion';
import { ROLES } from '@/lib/types';
import { SectorSwitcher } from './SectorSwitcher';

interface Item {
  href: string;
  texto: string;
  icono: LucideIcon;
  soloGerencia?: boolean;
  soloAdmin?: boolean;
}

// Agrupado por tema (en la barra lateral se ven los títulos; en el teléfono, una sola fila deslizable).
const GRUPOS: { titulo: string; items: Item[] }[] = [
  { titulo: 'General', items: [
    { href: '/gestion', texto: 'Tablero', icono: LayoutDashboard },
    { href: '/gestion/alertas', texto: 'Alertas', icono: Bell },
    { href: '/gestion/calendario', texto: 'Calendario', icono: CalendarDays },
  ] },
  { titulo: 'Operación', items: [
    { href: '/gestion/ots', texto: 'Órdenes', icono: ClipboardList },
    { href: '/gestion/pendientes', texto: 'Pendientes SAP', icono: Inbox },
    { href: '/gestion/emergencias', texto: 'Emergencias', icono: Siren },
    { href: '/gestion/rutinas', texto: 'Rutinas', icono: ListChecks },
    { href: '/gestion/inspecciones', texto: 'Inspecciones', icono: ClipboardCheck },
    { href: '/gestion/calefaccion', texto: 'Infraestructura', icono: Thermometer },
    { href: '/gestion/plantillas', texto: 'Plantillas de orden', icono: ClipboardCopy },
    { href: '/gestion/riesgos', texto: 'Control de riesgos', icono: ShieldAlert },
  ] },
  { titulo: 'Gente y lugares', items: [
    { href: '/gestion/mapa', texto: 'Mapa', icono: Map },
    { href: '/gestion/empleados', texto: 'Empleados', icono: HardHat },
    { href: '/gestion/informacion', texto: 'Información general', icono: Building2 },
    { href: '/gestion/ubicaciones', texto: 'Ubicaciones', icono: MapPin },
    { href: '/gestion/activos', texto: 'Activos', icono: Boxes },
  ] },
  { titulo: 'Obras', items: [
    { href: '/gestion/obras', texto: 'Obras', icono: Construction },
    { href: '/gestion/cobros', texto: 'Cobro de obras', icono: Wallet },
    { href: '/gestion/solicitudes', texto: 'Solicitudes de certificado', icono: FileQuestion },
    { href: '/gestion/certificacion', texto: 'Certificación', icono: FileSpreadsheet },
    { href: '/gestion/presupuestos', texto: 'Presupuestos', icono: Calculator },
    { href: '/gestion/proveedores', texto: 'Proveedores', icono: Truck },
  ] },
  { titulo: 'Pañol', items: [
    { href: '/gestion/panol', texto: 'Stock y movimientos', icono: Package },
    { href: '/gestion/prestamos', texto: 'Préstamos', icono: Wrench },
    { href: '/gestion/requerimientos', texto: 'Requerimientos de compra', icono: ShoppingCart },
  ] },
  { titulo: 'Control', items: [
    { href: '/gestion/reportes', texto: 'Reportes', icono: BarChart3 },
    { href: '/gestion/informes', texto: 'Informes', icono: FileText },
    { href: '/gestion/auditoria', texto: 'Auditoría', icono: History, soloGerencia: true },
    { href: '/gestion/usuarios', texto: 'Usuarios', icono: Users, soloGerencia: true },
    { href: '/gestion/sectores', texto: 'Sectores', icono: Layers, soloAdmin: true },
  ] },
  { titulo: 'Equipo', items: [
    { href: '/gestion/foro', texto: 'Foro', icono: MessagesSquare },
    { href: '/gestion/sugerencias', texto: 'Sugerencias y problemas', icono: LifeBuoy },
    { href: '/gestion/ayuda', texto: 'Ayuda', icono: CircleHelp },
    { href: '/gestion/perfil', texto: 'Mi perfil', icono: UserRound },
  ] },
];

// Navegación de gestión: barra lateral en escritorio, fila deslizable arriba en el teléfono.
export function Nav() {
  const ruta = usePathname();
  const { perfil, esGerencia, salir } = useSesion();
  const activo = (href: string) => (href === '/gestion' ? ruta === href : ruta === href || ruta.startsWith(`${href}/`));
  const lista = useRef<HTMLElement>(null);
  const [alertas, setAlertas] = useState<{ total: number; criticas: number } | null>(null);

  // La lista de secciones se desplaza sola: la sección abierta tiene que quedar a la vista.
  useEffect(() => {
    lista.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [ruta]);

  // Cantidad de alertas al lado de "Alertas" (se actualiza al cambiar de sección). Sin la fase 11, no se muestra.
  useEffect(() => {
    let vivo = true;
    obtenerBandeja().then((b) => { if (vivo) setAlertas({ total: b.alertas, criticas: b.alertas_criticas }); }).catch(() => { if (vivo) setAlertas(null); });
    return () => { vivo = false; };
  }, [ruta]);

  return (
    <aside className="no-imprimir flex flex-col gap-3 border-b bg-barra p-3 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-3 lg:block">
        <p className="text-lg font-bold text-primario">DH1</p>
        {perfil && (
          <p className="truncate text-sm text-suave lg:mt-1">
            {perfil.nombre} · {ROLES[perfil.rol]}
          </p>
        )}
      </div>

      <SectorSwitcher />

      <button type="button" onClick={() => window.dispatchEvent(new Event('dh1:buscar'))}
        className="flex min-h-control items-center gap-2 rounded border bg-elevado px-3 text-sm text-suave hover:text-texto">
        <Search className="h-4 w-4" aria-hidden />
        <span className="flex-1 text-left">Buscar</span>
        <kbd className="hidden rounded border px-1 text-xs lg:inline">Ctrl K</kbd>
      </button>

      <nav ref={lista} aria-label="Secciones" className="flex gap-1 overflow-x-auto lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-visible">
        {GRUPOS.map((g) => {
          const items = g.items.filter((i) => (!i.soloGerencia || esGerencia) && (!i.soloAdmin || perfil?.rol === 'admin'));
          if (items.length === 0) return null;
          return (
            <div key={g.titulo} className="flex shrink-0 gap-1 lg:flex-col">
              <p className="hidden px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-suave/80 lg:block">{g.titulo}</p>
              {items.map(({ href, texto, icono: Icono }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={activo(href) ? 'page' : undefined}
                  className={`flex min-h-control shrink-0 items-center gap-2 rounded px-3 text-sm font-medium transition-colors ${
                    activo(href) ? 'bg-primario/15 text-primario' : 'text-suave hover:bg-elevado hover:text-texto'
                  }`}
                >
                  <Icono className="h-5 w-5" aria-hidden />
                  <span className="flex-1">{texto}</span>
                  {href === '/gestion/alertas' && alertas && alertas.total > 0 && (
                    <span className={`num rounded px-1.5 text-xs ${alertas.criticas > 0 ? 'bg-peligro/15 text-peligro' : 'bg-elevado text-suave'}`}
                      aria-label={`${alertas.total} alertas${alertas.criticas ? `, ${alertas.criticas} críticas` : ''}`}>{alertas.total}</span>
                  )}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="flex gap-1 lg:flex-col">
        <Link href="/mis-ots" className="flex min-h-control items-center gap-2 rounded px-3 text-sm font-medium text-suave hover:bg-elevado hover:text-texto">
          <Smartphone className="h-5 w-5" aria-hidden />
          Vista de campo
        </Link>
        <button type="button" onClick={salir} className="flex min-h-control items-center gap-2 rounded px-3 text-sm font-medium text-suave hover:bg-elevado hover:text-texto">
          <LogOut className="h-5 w-5" aria-hidden />
          Salir
        </button>
      </div>
    </aside>
  );
}
