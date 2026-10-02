'use client';

import Link from 'next/link';
import { Loader2, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Un solo botón primario por pantalla: es la acción que se espera del usuario.
// Todo lo demás va en secundario o fantasma. "peligro" es para cancelar, rechazar o borrar.
type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma';

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-primario text-sobre-primario hover:bg-primario/90',
  secundario: 'border bg-elevado text-texto hover:bg-borde',
  peligro: 'border border-peligro/60 bg-peligro/10 text-peligro hover:bg-peligro/20',
  fantasma: 'text-suave hover:bg-elevado hover:text-texto',
};

interface Comun {
  variante?: Variante;
  icono?: LucideIcon;
  // campo: 48 px de alto, para usar con guantes o al sol
  campo?: boolean;
  ancho?: boolean;
  children: ReactNode;
}

function clases({ variante = 'secundario', campo, ancho }: Pick<Comun, 'variante' | 'campo' | 'ancho'>) {
  return [
    'inline-flex select-none items-center justify-center gap-2 rounded px-4 font-semibold transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-50',
    campo ? 'min-h-campo text-base' : 'min-h-control text-sm',
    ancho ? 'w-full' : '',
    VARIANTES[variante],
  ].join(' ');
}

interface PropsBoton extends Comun, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  cargando?: boolean;
}

export function Boton({ variante, icono: Icono, campo, ancho, cargando, children, disabled, type = 'button', ...resto }: PropsBoton) {
  return (
    <button type={type} className={clases({ variante, campo, ancho })} disabled={disabled || cargando} {...resto}>
      {cargando ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : Icono ? <Icono className="h-5 w-5" aria-hidden /> : null}
      <span>{children}</span>
    </button>
  );
}

interface PropsEnlace extends Comun {
  href: string;
}

export function BotonEnlace({ variante, icono: Icono, campo, ancho, href, children }: PropsEnlace) {
  return (
    <Link href={href} className={clases({ variante, campo, ancho })}>
      {Icono ? <Icono className="h-5 w-5" aria-hidden /> : null}
      <span>{children}</span>
    </Link>
  );
}
