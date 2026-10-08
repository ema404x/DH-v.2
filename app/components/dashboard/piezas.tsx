'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { iniciales, trazoSuave } from '@/lib/dashboard';

// Dashboard estilo Apple (boceto aprobado el 8/10/2026): tarjetas de vidrio sobre fondo con luces,
// anillos tipo "Actividad", colores de sistema de iOS. Claro y oscuro.

export type Tema = 'claro' | 'oscuro';

export const IOS = { azul: '#0A84FF', verde: '#30D158', naranja: '#FF9F0A', rojo: '#FF453A', rosa: '#FF375F', violeta: '#BF5AF2', celeste: '#64D2FF', amarillo: '#FFD60A' };

export function tokens(t: Tema) {
  return t === 'oscuro' ? {
    bg: '#000000', text: '#F5F5F7', muted: '#98989F',
    card: 'rgba(28,28,30,0.62)', border: 'rgba(255,255,255,0.08)', shadow: '0 20px 60px rgba(0,0,0,0.55)',
    chip: 'rgba(255,255,255,0.07)', ring: '#1C1C1E', segment: 'rgba(118,118,128,0.24)', segmentOn: 'rgba(99,99,102,0.9)',
    alertBg: 'rgba(58,18,20,0.62)', alertBorder: 'rgba(255,69,58,0.35)',
    blob1: 'rgba(10,132,255,0.38)', blob2: 'rgba(191,90,242,0.30)', blob3: 'rgba(48,209,88,0.22)',
    track: (c: string) => `${c}38`,
  } : {
    bg: '#F2F2F7', text: '#1C1C1E', muted: '#6E6E73',
    card: 'rgba(255,255,255,0.68)', border: 'rgba(255,255,255,0.9)', shadow: '0 20px 50px rgba(30,40,80,0.10)',
    chip: 'rgba(120,120,128,0.10)', ring: '#FFFFFF', segment: 'rgba(118,118,128,0.14)', segmentOn: '#FFFFFF',
    alertBg: 'rgba(255,240,240,0.82)', alertBorder: 'rgba(255,69,58,0.25)',
    blob1: 'rgba(100,210,255,0.55)', blob2: 'rgba(191,90,242,0.30)', blob3: 'rgba(255,214,10,0.35)',
    track: (c: string) => `${c}29`,
  };
}
export type Tokens = ReturnType<typeof tokens>;

export const FUENTE = "var(--font-figtree), -apple-system, 'Segoe UI', sans-serif";

export function Fondo({ k, children }: { k: Tokens; children: ReactNode }) {
  return (
    <div className="-m-4 sm:-m-5 lg:-m-6" style={{ position: 'relative', minHeight: 'calc(100vh - 3.5rem)', overflow: 'hidden', background: k.bg, color: k.text, fontFamily: FUENTE }}>
      <div aria-hidden style={{ position: 'absolute', width: 620, height: 620, left: -160, top: -200, borderRadius: '50%', background: k.blob1, filter: 'blur(110px)' }} />
      <div aria-hidden style={{ position: 'absolute', width: 560, height: 560, right: -140, top: 120, borderRadius: '50%', background: k.blob2, filter: 'blur(120px)' }} />
      <div aria-hidden style={{ position: 'absolute', width: 520, height: 520, left: '35%', bottom: -240, borderRadius: '50%', background: k.blob3, filter: 'blur(120px)' }} />
      <div style={{ position: 'relative', maxWidth: 1320, margin: '0 auto', padding: 'clamp(20px, 4vw, 44px) clamp(14px, 3vw, 36px) 72px', display: 'flex', flexDirection: 'column', gap: 26 }}>
        {children}
      </div>
    </div>
  );
}

export const vidrio = (k: Tokens, extra: CSSProperties = {}): CSSProperties => ({
  padding: 26, borderRadius: 30, background: k.card, border: `1px solid ${k.border}`, boxShadow: k.shadow,
  backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, ...extra,
});

export function Grilla({ children, min = 300 }: { children: ReactNode; min?: number }) {
  return <section style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 22 }}>{children}</section>;
}

export function TituloTarjeta({ k, children, accion }: { k: Tokens; children: ReactNode; accion?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: k.muted }}>{children}</span>
      {accion}
    </div>
  );
}

export function Enlace({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} style={{ fontSize: 14, fontWeight: 600, color: IOS.azul }}>{children}</Link>;
}

export function Encabezado({ k, sobre, titulo, children }: { k: Tokens; sobre: string; titulo: string; children?: ReactNode }) {
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.02em', color: k.muted }}>{sobre}</span>
        <h1 style={{ margin: 0, fontSize: 'clamp(32px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.1 }}>{titulo}</h1>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>{children}</div>
    </header>
  );
}

export function Segmento<T extends string>({ k, opciones, valor, onCambio, etiqueta }: {
  k: Tokens; opciones: { v: T; texto: string }[]; valor: T; onCambio: (v: T) => void; etiqueta: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: k.segment, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
      {opciones.map((o) => (
        <button key={o.v} type="button" aria-pressed={o.v === valor} onClick={() => onCambio(o.v)}
          style={{ height: 36, padding: '0 16px', border: 0, borderRadius: 10, cursor: 'pointer', fontFamily: FUENTE, fontSize: 14, fontWeight: 600,
            background: o.v === valor ? k.segmentOn : 'transparent', color: o.v === valor ? k.text : k.muted, boxShadow: o.v === valor ? '0 2px 8px rgba(0,0,0,0.12)' : 'none' }}>
          {o.texto}
        </button>
      ))}
    </div>
  );
}

const ICONO_ALERTA = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l9.5 16.5h-19z" /><path d="M12 10v4M12 17.5v.5" /></svg>;

export function BannerEmergencia({ k, href, titulo, detalle, accion }: { k: Tokens; href: string; titulo: string; detalle: string; accion: string }) {
  return (
    <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderRadius: 22, background: k.alertBg, border: `1px solid ${k.alertBorder}`, color: k.text,
      backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', boxShadow: k.shadow }}>
      <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 13, background: IOS.rojo, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 16px rgba(255,69,58,0.4)' }}>{ICONO_ALERTA}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{titulo}</span>
        <span style={{ fontSize: 14, color: k.muted }}>{detalle}</span>
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: IOS.rojo }}>{accion}</span>
    </Link>
  );
}

// Anillos tipo "Actividad": cada uno con su porcentaje (0–1).
export function Anillos({ k, valores, tam = 150 }: { k: Tokens; valores: { color: string; pct: number }[]; tam?: number }) {
  const radios = [64, 46, 28];
  return (
    <svg width={tam} height={tam} viewBox="0 0 150 150" style={{ flexShrink: 0, transform: 'rotate(-90deg)' }} aria-hidden>
      {valores.slice(0, 3).map((v, i) => {
        const r = radios[i], c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, v.pct));
        return (
          <g key={i}>
            <circle cx="75" cy="75" r={r} fill="none" stroke={k.track(v.color)} strokeWidth="15" />
            {p > 0 && <circle cx="75" cy="75" r={r} fill="none" stroke={v.color} strokeWidth="15" strokeLinecap="round" strokeDasharray={`${(c * p).toFixed(1)} ${c.toFixed(1)}`} />}
          </g>
        );
      })}
    </svg>
  );
}

export function LeyendaAnillo({ k, color, titulo, valor, de }: { k: Tokens; color: string; titulo: string; valor: string; de?: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{valor}{de && <span style={{ fontSize: 15, fontWeight: 600, color: k.muted }}>{de}</span>}</div>
    </div>
  );
}

export function Chip({ k, valor, texto, color, href }: { k: Tokens; valor: number | string; texto: string; color?: string; href: string }) {
  return (
    <Link href={href} style={{ padding: 12, borderRadius: 16, background: k.chip, display: 'flex', flexDirection: 'column', color: k.text }}>
      <span style={{ fontSize: 22, fontWeight: 800, color: color ?? k.text }}>{valor}</span>
      <span style={{ fontSize: 12, color: k.muted }}>{texto}</span>
    </Link>
  );
}

const DEGRADES = ['linear-gradient(135deg,#64D2FF,#0A84FF)', 'linear-gradient(135deg,#FFD60A,#FF9F0A)', 'linear-gradient(135deg,#30D158,#0BA360)', 'linear-gradient(135deg,#BF5AF2,#7D3CF0)', 'linear-gradient(135deg,#FF6482,#FF375F)'];
export const degradeDe = (s: string) => DEGRADES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % DEGRADES.length];

export function Avatar({ k, nombre, tam = 42, superpuesto }: { k: Tokens; nombre: string; tam?: number; superpuesto?: boolean }) {
  return (
    <span title={nombre} style={{ width: tam, height: tam, marginLeft: superpuesto ? -10 : 0, borderRadius: tam / 2, background: degradeDe(nombre), border: `3px solid ${k.ring}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: tam * 0.33, fontWeight: 700, flexShrink: 0 }}>
      {iniciales(nombre)}
    </span>
  );
}

export function BarraAvance({ k, titulo, pct, aviso, href }: { k: Tokens; titulo: string; pct: number; aviso?: string | null; href: string }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <Link href={href} style={{ display: 'flex', flexDirection: 'column', gap: 6, color: k.text }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 15, fontWeight: 600 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titulo}</span>
        <span style={{ flexShrink: 0, color: aviso ? IOS.naranja : k.text }}>{p}%{aviso ? ` · ${aviso}` : ''}</span>
      </span>
      <span style={{ height: 8, borderRadius: 4, background: k.chip }}>
        <span style={{ display: 'block', width: `${p}%`, height: '100%', borderRadius: 4, background: aviso ? 'linear-gradient(90deg,#FFD60A,#FF9F0A)' : 'linear-gradient(90deg,#64D2FF,#0A84FF)' }} />
      </span>
    </Link>
  );
}

export function FilaAccion({ k, href, color, icono, titulo, detalle, accion }: { k: Tokens; href: string; color: string; icono: ReactNode; titulo: string; detalle: string; accion?: string }) {
  return (
    <Link href={href} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 14, borderRadius: 20, background: k.chip, color: k.text }}>
      <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 11, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icono}</span>
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titulo}</span>
        <span style={{ fontSize: 13, color: k.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detalle}</span>
      </span>
      {accion && <span style={{ fontSize: 14, fontWeight: 700, color: IOS.azul, flexShrink: 0 }}>{accion}</span>}
    </Link>
  );
}

export const ICONOS = {
  doc: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4M9 13h6M9 17h4" /></svg>,
  check: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l4 4L19 6" /></svg>,
  carrito: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18l-2 12H5z" /><path d="M9 10v4M15 10v4" /></svg>,
  bandeja: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5" /></svg>,
  llave: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14.7 6.3a4 4 0 0 0 5 5L12 19l-3 1 1-3z" /></svg>,
  mas: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>,
  sol: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  luna: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" /></svg>,
};

export function BotonPildora({ k, href, onClick, primario, children, etiqueta }: { k: Tokens; href?: string; onClick?: () => void; primario?: boolean; children: ReactNode; etiqueta?: string }) {
  const st: CSSProperties = {
    height: 46, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 20px', borderRadius: 23, fontFamily: FUENTE, fontSize: 15, cursor: 'pointer',
    ...(primario
      ? { background: IOS.azul, color: '#FFFFFF', fontWeight: 700, border: 0, boxShadow: '0 10px 24px rgba(10,132,255,0.35)' }
      : { background: k.card, border: `1px solid ${k.border}`, color: k.text, fontWeight: 600, boxShadow: k.shadow, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }),
  };
  if (href) return <Link href={href} style={st} aria-label={etiqueta}>{children}</Link>;
  return <button type="button" onClick={onClick} style={st} aria-label={etiqueta}>{children}</button>;
}

export function Curva({ puntos, etiquetas, k }: { puntos: { x: number; y: number }[]; etiquetas: string[]; k: Tokens }) {
  const d = trazoSuave(puntos);
  const ult = puntos[puntos.length - 1];
  return (
    <>
      {/* El SVG se estira a lo ancho: el punto final va como HTML encima para que no se deforme. */}
      <div style={{ position: 'relative', height: 160 }}>
        <svg viewBox="0 0 800 160" preserveAspectRatio="none" style={{ width: '100%', height: 160, display: 'block' }} aria-hidden>
          <defs><linearGradient id="dhArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={IOS.azul} stopOpacity="0.38" /><stop offset="1" stopColor={IOS.azul} stopOpacity="0" /></linearGradient></defs>
          {d && <path d={`${d} L800,160 L0,160 Z`} fill="url(#dhArea)" />}
          {d && <path d={d} fill="none" stroke={IOS.azul} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        </svg>
        {ult && <span style={{ position: 'absolute', left: `${(ult.x / 800) * 100}%`, top: ult.y, width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: 7, background: IOS.azul, border: '3px solid #FFFFFF' }} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: k.muted }}>{etiquetas.map((e) => <span key={e}>{e}</span>)}</div>
    </>
  );
}

export function Esqueletos({ k }: { k: Tokens }) {
  return (
    <Grilla>
      {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={{ ...vidrio(k), height: 220, opacity: 0.6 }} />)}
    </Grilla>
  );
}
