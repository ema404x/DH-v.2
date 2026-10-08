import { supabase } from './supabase/client';
import { exigir } from './errores';
import { listarCertificados, type CertificadoFila } from './certificados';
import { obtenerBandeja, type Bandeja } from './control';
import { obtenerKpis, type Kpis } from './gestion';
import { listarEmpleados, listarJornadas, type Empleado } from './gente';
import { listarCiclos, listarCobros, listarObras, type Obra } from './obras';
import { listarEmergencias, type Emergencia } from './operacion';
import type { OT } from './types';

// Datos del dashboard (diseño estilo Apple aprobado el 8/10/2026). Todo sale de lo que ya existe en la base;
// los cálculos (períodos, anillos) se hacen acá.

export type Periodo = 'hoy' | 'mes' | 'anio';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function rango(p: Periodo, base = new Date()): { desde: string; hasta: string; prevDesde: string; prevHasta: string; nombre: string; prevNombre: string } {
  const y = base.getFullYear(), m = base.getMonth(), d = base.getDate();
  if (p === 'hoy') {
    const ayer = new Date(y, m, d - 1);
    return { desde: iso(base), hasta: iso(base), prevDesde: iso(ayer), prevHasta: iso(ayer), nombre: 'hoy', prevNombre: 'ayer' };
  }
  if (p === 'anio') {
    return { desde: `${y}-01-01`, hasta: `${y}-12-31`, prevDesde: `${y - 1}-01-01`, prevHasta: `${y - 1}-12-31`, nombre: String(y), prevNombre: String(y - 1) };
  }
  const fin = new Date(y, m + 1, 0), ini = new Date(y, m, 1);
  const pIni = new Date(y, m - 1, 1), pFin = new Date(y, m, 0);
  return { desde: iso(ini), hasta: iso(fin), prevDesde: iso(pIni), prevHasta: iso(pFin), nombre: MESES[m], prevNombre: MESES[(m + 11) % 12] };
}

const enRango = (f: string | null | undefined, desde: string, hasta: string) => !!f && f.slice(0, 10) >= desde && f.slice(0, 10) <= hasta;
const certificado = (c: CertificadoFila) => c.estado === 'emitido' || c.estado === 'aprobado';

// ------------------------------------------------------------------ plata

export interface Plata {
  total: number;
  anterior: number;
  aprobado: number;
  porAprobar: number;
  aCobrar: number | null;
  curva: { x: number; y: number }[];
  etiquetas: string[];
  porFirmar: CertificadoFila[];
}

export function calcularPlata(certs: CertificadoFila[], p: Periodo, aCobrar: number | null): Plata {
  const r = rango(p);
  const delPeriodo = certs.filter((c) => certificado(c) && enRango(c.fecha_certificado, r.desde, r.hasta));
  const total = delPeriodo.reduce((s, c) => s + Number(c.total_neto || 0), 0);
  const anterior = certs.filter((c) => certificado(c) && enRango(c.fecha_certificado, r.prevDesde, r.prevHasta)).reduce((s, c) => s + Number(c.total_neto || 0), 0);
  const aprobado = delPeriodo.filter((c) => c.estado === 'aprobado').reduce((s, c) => s + Number(c.total_neto || 0), 0);
  const porFirmar = certs.filter((c) => c.estado === 'emitido').sort((a, b) => (a.emitido_at ?? '').localeCompare(b.emitido_at ?? ''));
  const porAprobar = porFirmar.reduce((s, c) => s + Number(c.total_neto || 0), 0);

  // Curva acumulada: por día (mes / hoy) o por mes (año).
  const puntos: number[] = [];
  const etiquetas: string[] = [];
  if (p === 'anio') {
    const y = Number(r.desde.slice(0, 4));
    let acum = 0;
    for (let m = 0; m < 12; m++) {
      const pre = `${y}-${String(m + 1).padStart(2, '0')}`;
      acum += delPeriodo.filter((c) => c.fecha_certificado.startsWith(pre)).reduce((s, c) => s + Number(c.total_neto || 0), 0);
      puntos.push(acum);
    }
    etiquetas.push('ene', 'mar', 'may', 'jul', 'sep', 'nov');
  } else {
    const ini = new Date(`${r.desde}T12:00:00`);
    const dias = p === 'hoy' ? 1 : new Date(ini.getFullYear(), ini.getMonth() + 1, 0).getDate();
    let acum = 0;
    for (let d = 1; d <= dias; d++) {
      const dia = p === 'hoy' ? r.desde : `${r.desde.slice(0, 8)}${String(d).padStart(2, '0')}`;
      acum += delPeriodo.filter((c) => c.fecha_certificado.slice(0, 10) === dia).reduce((s, c) => s + Number(c.total_neto || 0), 0);
      puntos.push(acum);
    }
    if (p === 'hoy') puntos.unshift(0);
    const mes = MESES[ini.getMonth()].slice(0, 3);
    etiquetas.push(...(p === 'hoy' ? ['0 h', '24 h'] : [`1 ${mes}`, `8 ${mes}`, `15 ${mes}`, `22 ${mes}`, `${dias} ${mes}`]));
  }
  const max = Math.max(...puntos, 1);
  const curva = puntos.map((v, i) => ({ x: (i / Math.max(puntos.length - 1, 1)) * 800, y: 150 - (v / max) * 130 }));
  return { total, anterior, aprobado, porAprobar, aCobrar, curva, etiquetas, porFirmar };
}

// Trazo suave (Catmull-Rom → Bézier) para la curva del widget.
export function trazoSuave(pts: { x: number; y: number }[]): string {
  if (!pts.length) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// ------------------------------------------------------------------ órdenes (anillos)

type OTMin = Pick<OT, 'id' | 'estado' | 'fecha_programada' | 'fecha_fin_real' | 'fecha_validacion' | 'created_at' | 'titulo' | 'codigo' | 'ubicacion_nombre' | 'asignado_nombre' | 'jefe_sitio_id' | 'asignado_a'>;

export interface Anillos {
  completadas: number;
  base: number;
  aTiempoPct: number;
  validadas48Pct: number;
  enCurso: number;
  aValidar: number;
  vencidas: number;
}

const AR = -3 * 3600 * 1000;
const hoyAR = () => new Date(Date.now() + AR).toISOString().slice(0, 10);

export function calcularAnillos(ots: OTMin[], p: Periodo): Anillos {
  const r = rango(p);
  const cerradas = ots.filter((o) => o.estado === 'completada' && enRango(o.fecha_validacion, r.desde, r.hasta));
  const abiertas = ots.filter((o) => !['completada', 'cancelada'].includes(o.estado));
  const aTiempo = cerradas.filter((o) => !o.fecha_programada || ((o.fecha_fin_real ?? o.fecha_validacion ?? '').slice(0, 10) <= o.fecha_programada.slice(0, 10)));
  const conFin = cerradas.filter((o) => o.fecha_fin_real && o.fecha_validacion);
  const en48 = conFin.filter((o) => new Date(o.fecha_validacion!).getTime() - new Date(o.fecha_fin_real!).getTime() <= 48 * 3600 * 1000);
  const hoy = hoyAR();
  return {
    completadas: cerradas.length,
    base: cerradas.length + abiertas.length,
    aTiempoPct: cerradas.length ? Math.round((aTiempo.length / cerradas.length) * 100) : 0,
    validadas48Pct: conFin.length ? Math.round((en48.length / conFin.length) * 100) : 0,
    enCurso: ots.filter((o) => o.estado === 'en_progreso').length,
    aValidar: ots.filter((o) => o.estado === 'pendiente_validacion').length,
    vencidas: ots.filter((o) => o.estado === 'en_progreso' && o.fecha_programada && hoy > o.fecha_programada.slice(0, 10)).length,
  };
}

async function ordenesRecientes(filtroJefe?: string): Promise<OTMin[]> {
  const desde = `${new Date().getFullYear() - 1}-01-01`;
  let q = supabase().from('v_ordenes')
    .select('id,estado,fecha_programada,fecha_fin_real,fecha_validacion,created_at,titulo,codigo,ubicacion_nombre,asignado_nombre,jefe_sitio_id,asignado_a')
    .or(`estado.not.in.(completada,cancelada),fecha_validacion.gte.${desde}`)
    .limit(10000);
  if (filtroJefe) q = q.eq('jefe_sitio_id', filtroJefe);
  return exigir(await q) as OTMin[];
}

// ------------------------------------------------------------------ equipo

export interface Equipo {
  activos: number;
  trabajando: { id: string; nombre: string; lugar: string | null; desde: string }[];
  sinFichar: number;
}

export async function cargarEquipo(empleados: Empleado[]): Promise<Equipo> {
  const hoy = iso(new Date());
  const jornadas = await listarJornadas({ desde: hoy, hasta: hoy }).catch(() => []);
  const activos = empleados.filter((e) => e.estado === 'activo');
  const ids = new Set(activos.map((e) => e.id));
  const abiertas = jornadas.filter((j) => !j.salida && ids.has(j.empleado_id));
  const vistos = new Set<string>();
  const trabajando = abiertas.filter((j) => (vistos.has(j.empleado_id) ? false : (vistos.add(j.empleado_id), true)))
    .map((j) => ({ id: j.empleado_id, nombre: j.empleado_nombre, lugar: j.ubicacion_nombre, desde: j.entrada }));
  const ficharonHoy = new Set(jornadas.map((j) => j.empleado_id));
  return { activos: activos.length, trabajando, sinFichar: activos.filter((e) => !ficharonHoy.has(e.id)).length };
}

// ------------------------------------------------------------------ todo junto

export interface DatosGerencia {
  certs: CertificadoFila[];
  aCobrar: number | null;
  ots: OTMin[];
  kpis: Kpis | null;
  bandeja: Bandeja | null;
  emergencias: Emergencia[];
  equipo: Equipo;
  obras: Obra[];
}

async function aCobrarEnCiclo(): Promise<number | null> {
  const ciclos = await listarCiclos().catch(() => []);
  const abierto = ciclos.find((c) => c.abierto);
  if (!abierto) return null;
  const cobros = await listarCobros(abierto.id).catch(() => []);
  return cobros.reduce((s, c) => s + Number(c.monto_a_cobrar || 0), 0);
}

export async function cargarGerencia(): Promise<DatosGerencia> {
  const [certs, aCobrar, ots, kpis, bandeja, em, empleados, obras] = await Promise.all([
    listarCertificados().catch(() => []),
    aCobrarEnCiclo(),
    ordenesRecientes(),
    obtenerKpis().catch(() => null),
    obtenerBandeja().catch(() => null),
    listarEmergencias().catch(() => ({ emergencias: [] as Emergencia[] })),
    listarEmpleados().catch(() => []),
    listarObras({ zona: null, estado: 'activas', q: '' }).catch(() => []),
  ]);
  return {
    certs, aCobrar, ots, kpis, bandeja,
    emergencias: em.emergencias.filter((e) => e.estado === 'activa' || e.estado === 'en_atencion'),
    equipo: await cargarEquipo(empleados),
    obras,
  };
}

export interface ParaValidar {
  id: string;
  titulo: string;
  codigo: string;
  lugar: string | null;
  quien: string | null;
  desde: string | null;
  foto: string | null;
  fotos: number;
  faltantes: number;
}

export interface DatosJefe {
  ots: OTMin[];
  validar: ParaValidar[];
  emergencias: Emergencia[];
  cuadrilla: Empleado[];
  obras: Obra[];
  certsPorFirmar: CertificadoFila[];
  aCobrar: number;
}

export async function cargarJefe(perfilId: string, nombre: string): Promise<DatosJefe> {
  const sb = supabase();
  const [ots, valid, em, empleados, obras, certs] = await Promise.all([
    ordenesRecientes(perfilId),
    sb.from('v_ordenes').select('id,titulo,codigo,ubicacion_nombre,asignado_nombre,fecha_fin_real,fotos_total,materiales_faltantes')
      .eq('jefe_sitio_id', perfilId).eq('estado', 'pendiente_validacion').order('fecha_fin_real', { ascending: true }).limit(12),
    listarEmergencias().catch(() => ({ emergencias: [] as Emergencia[] })),
    listarEmpleados().catch(() => []),
    listarObras({ zona: null, estado: 'activas', q: '' }).catch(() => []),
    listarCertificados().catch(() => []),
  ]);
  const filas = (exigir(valid) as { id: string; titulo: string; codigo: string; ubicacion_nombre: string | null; asignado_nombre: string | null; fecha_fin_real: string | null; fotos_total: number; materiales_faltantes: unknown[] | null }[]);
  const fotos = filas.length
    ? (exigir(await sb.from('ot_fotos').select('ot_id,url,created_at').in('ot_id', filas.map((f) => f.id)).order('created_at')) as { ot_id: string; url: string }[])
    : [];
  const primera = new Map<string, string>();
  for (const f of fotos) if (!primera.has(f.ot_id)) primera.set(f.ot_id, f.url);
  const mias = obras.filter((o) => o.jefe_sitio_id === perfilId);
  const ciclos = await listarCiclos().catch(() => []);
  const abierto = ciclos.find((c) => c.abierto);
  const cobros = abierto ? await listarCobros(abierto.id).catch(() => []) : [];
  const idsObras = new Set(mias.map((o) => o.id));
  return {
    ots,
    validar: filas.map((f) => ({
      id: f.id, titulo: f.titulo, codigo: f.codigo, lugar: f.ubicacion_nombre, quien: f.asignado_nombre, desde: f.fecha_fin_real,
      foto: primera.get(f.id) ?? null, fotos: f.fotos_total, faltantes: (f.materiales_faltantes ?? []).length,
    })),
    emergencias: em.emergencias.filter((e) => (e.estado === 'activa' || e.estado === 'en_atencion') && (!e.jefe_sitio_nombre || e.jefe_sitio_nombre === nombre)),
    cuadrilla: empleados.filter((e) => e.jefe_sitio_id === perfilId && e.estado === 'activo'),
    obras: mias,
    certsPorFirmar: certs.filter((c) => c.estado === 'emitido' && c.tipo === 'obra' && !c.firma_jefe_url),
    aCobrar: cobros.filter((c) => idsObras.has(c.obra_id)).reduce((s, c) => s + Number(c.monto_a_cobrar || 0), 0),
  };
}

// ------------------------------------------------------------------ formatos

export const pesos = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`;
export const pesosCorto = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `$ ${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`
    : Math.abs(n) >= 1_000 ? `$ ${(n / 1_000).toLocaleString('es-AR', { maximumFractionDigits: 0 })} mil` : pesos(n);

export function hace(f: string | null | undefined): string {
  if (!f) return '';
  const min = Math.round((Date.now() - new Date(f).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

export const iniciales = (n: string) => n.trim().split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
export const fechaLarga = (d = new Date()) => d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
