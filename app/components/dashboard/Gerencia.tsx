'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { calcularAnillos, calcularPlata, hace, pesos, rango, type DatosGerencia, type Periodo } from '@/lib/dashboard';
import { generarPreventivos } from '@/lib/gestion';
import type { Alerta } from '@/lib/control';
import { limpiarError } from '@/lib/errores';
import {
  Anillos, Avatar, BannerEmergencia, BarraAvance, Chip, Curva, Enlace, FilaAccion, Grilla, ICONOS, IOS, LeyendaAnillo, TituloTarjeta, vidrio, type Tokens,
} from './piezas';

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function VistaGerencia({ k, d, periodo, criticas, puedeValidar, onRecargar }: {
  k: Tokens; d: DatosGerencia; periodo: Periodo; criticas: Alerta[]; puedeValidar: boolean; onRecargar: () => void;
}) {
  const plata = useMemo(() => calcularPlata(d.certs, periodo, d.aCobrar), [d.certs, periodo, d.aCobrar]);
  const an = useMemo(() => calcularAnillos(d.ots, periodo), [d.ots, periodo]);
  const r = rango(periodo);
  const [generando, setGenerando] = useState(false);

  async function preventivos() {
    setGenerando(true);
    try {
      const n = await generarPreventivos(7);
      toast.success(n === 0 ? 'No hay preventivos nuevos para los próximos 7 días.' : n === 1 ? 'Se generó 1 orden preventiva.' : `Se generaron ${n} órdenes preventivas.`);
      onRecargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setGenerando(false);
    }
  }

  const variacion = plata.anterior > 0 ? Math.round(((plata.total - plata.anterior) / plata.anterior) * 100) : null;
  const em = d.emergencias;
  const b = d.bandeja;
  const firma = [
    ...plata.porFirmar.slice(0, 2).map((c) => ({
      key: c.id, href: '/gestion/certificacion', color: IOS.azul, icono: ICONOS.doc,
      titulo: `Certificado N° ${c.numero ?? '—'} · ${c.contratista}`, detalle: `${pesos(Number(c.total_neto))} · emitido ${hace(c.emitido_at)}`, accion: 'Firmar',
    })),
    ...(b ? ([
      ['ots_por_validar', IOS.verde, ICONOS.check, 'orden para validar', 'órdenes para validar', '/gestion/ots?estado=pendiente_validacion'],
      ['solicitudes_por_revisar', IOS.violeta, ICONOS.doc, 'solicitud de certificado', 'solicitudes de certificado', '/gestion/solicitudes'],
      ['requerimientos_por_revisar', IOS.naranja, ICONOS.carrito, 'requerimiento de compra', 'requerimientos de compra', '/gestion/requerimientos'],
      ['requerimientos_en_compra', IOS.celeste, ICONOS.bandeja, 'compra por recibir', 'compras por recibir', '/gestion/requerimientos'],
      ['informes_por_vencer', IOS.rojo, ICONOS.doc, 'informe por vencer', 'informes por vencer', '/gestion/informes'],
    ] as const).filter(([c]) => b[c] > 0).map(([c, color, icono, uno, varios, href]) => ({
      key: c, href, color, icono, titulo: plural(b[c], uno, varios), detalle: 'Esperan tu revisión', accion: 'Ver',
    })) : []),
  ];
  if (plata.porFirmar.length > 2) firma.splice(2, 0, {
    key: 'mas-certs', href: '/gestion/certificacion', color: IOS.azul, icono: ICONOS.doc,
    titulo: `${plata.porFirmar.length - 2} certificados más por aprobar`, detalle: pesos(plata.porAprobar) + ' en total', accion: 'Ver',
  });

  const obras = [...d.obras].sort((a, b2) => Number(!!b2.alerta_plazo) - Number(!!a.alerta_plazo) || b2.avance - a.avance).slice(0, 4);

  return (
    <>
      {em.length > 0 && (
        <BannerEmergencia k={k} href="/gestion/emergencias"
          titulo={em.length === 1 ? `Emergencia: ${em[0].titulo}` : `${em.length} emergencias abiertas`}
          detalle={`${em[0].ubicacion_nombre}${em[0].jefe_sitio_nombre ? ` · ${em[0].jefe_sitio_nombre}` : ''} · ${em[0].estado === 'en_atencion' ? 'en atención' : 'sin atender'} · ${hace(em[0].created_at)}`}
          accion="Ver" />
      )}

      <section className="grid gap-[22px] lg:grid-cols-3">
        <div className="lg:col-span-2" style={vidrio(k)}>
          <TituloTarjeta k={k} accion={<Enlace href="/gestion/certificacion">Certificados</Enlace>}>
            Certificado {periodo === 'hoy' ? 'hoy' : periodo === 'mes' ? `en ${r.nombre}` : `en ${r.nombre}`}
          </TituloTarjeta>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 16px' }}>
            <span style={{ fontSize: 'clamp(36px, 5vw, 52px)', fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1 }}>{pesos(plata.total)}</span>
            {variacion !== null ? (
              <span style={{ fontSize: 15, fontWeight: 700, color: variacion >= 0 ? IOS.verde : IOS.rojo }}>
                {variacion >= 0 ? '▲' : '▼'} {Math.abs(variacion)}% <span style={{ color: k.muted, fontWeight: 600 }}>vs {r.prevNombre}</span>
              </span>
            ) : (
              <span style={{ fontSize: 15, fontWeight: 600, color: k.muted }}>Sin certificados {periodo === "hoy" ? "ayer" : `en ${r.prevNombre}`}</span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Sub k={k} titulo="Aprobado" valor={pesos(plata.aprobado)} color={IOS.verde} />
            <Sub k={k} titulo={`Por aprobar (${plata.porFirmar.length})`} valor={pesos(plata.porAprobar)} color={IOS.naranja} />
            <Sub k={k} titulo="A cobrar en el ciclo" valor={plata.aCobrar === null ? 'Sin ciclo abierto' : pesos(plata.aCobrar)} color={IOS.azul} />
          </div>
          {plata.total > 0 ? <Curva k={k} puntos={plata.curva} etiquetas={plata.etiquetas} /> : (
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 18, border: "1px dashed rgba(120,120,128,0.35)", color: k.muted, fontSize: 14 }}>
              Todavía no hay certificados emitidos {periodo === 'hoy' ? 'hoy' : `en ${r.nombre}`}.
            </div>
          )}
        </div>

        <div style={vidrio(k)}>
          <TituloTarjeta k={k} accion={<Enlace href="/gestion/ots">Órdenes</Enlace>}>Órdenes de trabajo</TituloTarjeta>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <Anillos k={k} valores={[
              { color: IOS.rosa, pct: an.base ? an.completadas / an.base : 0 },
              { color: IOS.verde, pct: an.aTiempoPct / 100 },
              { color: IOS.azul, pct: an.validadas48Pct / 100 },
            ]} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <LeyendaAnillo k={k} color={IOS.rosa} titulo="Completadas" valor={String(an.completadas)} de={`/${an.base}`} />
              <LeyendaAnillo k={k} color={IOS.verde} titulo="A tiempo" valor={`${an.aTiempoPct}%`} />
              <LeyendaAnillo k={k} color={IOS.azul} titulo="Validadas en 48 h" valor={`${an.validadas48Pct}%`} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <Chip k={k} valor={an.enCurso} texto="en curso" href="/gestion/ots?estado=en_progreso" />
            <Chip k={k} valor={an.aValidar} texto="a validar" color={an.aValidar ? IOS.naranja : undefined} href="/gestion/ots?estado=pendiente_validacion" />
            <Chip k={k} valor={an.vencidas} texto="vencidas" color={an.vencidas ? IOS.rojo : undefined} href="/gestion/ots" />
          </div>
        </div>
      </section>

      <Grilla>
        <Link href="/gestion/empleados" style={{ ...vidrio(k), color: k.text }}>
          <TituloTarjeta k={k}>Equipo hoy</TituloTarjeta>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>{d.equipo.trabajando.length}</span>
            <span style={{ fontSize: 15, color: k.muted }}>trabajando de {d.equipo.activos}</span>
          </div>
          {d.equipo.trabajando.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {d.equipo.trabajando.slice(0, 6).map((p, i) => <Avatar key={p.id} k={k} nombre={p.nombre} superpuesto={i > 0} />)}
              {d.equipo.trabajando.length > 6 && <span style={{ marginLeft: 10, fontSize: 14, fontWeight: 600, color: k.muted }}>+{d.equipo.trabajando.length - 6}</span>}
            </div>
          ) : (
            <span style={{ fontSize: 14, color: k.muted }}>Nadie fichó entrada todavía.</span>
          )}
          <span style={{ fontSize: 14, color: d.equipo.sinFichar ? IOS.naranja : k.muted, fontWeight: 600 }}>
            {d.equipo.activos === 0 ? 'Sin personal cargado' : d.equipo.sinFichar ? `${plural(d.equipo.sinFichar, 'persona sin fichar', 'personas sin fichar')} hoy` : 'Todos ficharon hoy'}
          </span>
        </Link>

        <div style={vidrio(k)}>
          <TituloTarjeta k={k} accion={<Enlace href="/gestion/obras">Ver todas</Enlace>}>Obras en marcha</TituloTarjeta>
          {obras.length ? obras.map((o) => (
            <BarraAvance key={o.id} k={k} titulo={o.titulo} pct={o.avance} aviso={o.alerta_plazo ? 'atrasada' : null} href="/gestion/obras" />
          )) : <span style={{ fontSize: 14, color: k.muted }}>No hay obras en marcha.</span>}
          {d.obras.length > 4 && <span style={{ fontSize: 13, color: k.muted }}>y {d.obras.length - 4} más</span>}
        </div>

        <div style={vidrio(k)}>
          <TituloTarjeta k={k} accion={b ? <Enlace href="/gestion/alertas">{plural(b.alertas, 'alerta', 'alertas')}</Enlace> : undefined}>Requiere tu firma</TituloTarjeta>
          {firma.length ? firma.slice(0, 4).map((f) => (
            <FilaAccion key={f.key} k={k} href={f.href} color={f.color} icono={f.icono} titulo={f.titulo} detalle={f.detalle} accion={f.accion} />
          )) : <span style={{ fontSize: 14, color: k.muted }}>Nada esperando tu firma.</span>}
        </div>
      </Grilla>

      <Grilla>
        {d.kpis && (
          <div style={vidrio(k)}>
            <TituloTarjeta k={k} accion={<Enlace href="/gestion/activos">Activos</Enlace>}>Mantenimiento preventivo</TituloTarjeta>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <Chip k={k} valor={d.kpis.preventivos_por_vencer} texto="vencen en 7 días" color={d.kpis.preventivos_por_vencer ? IOS.naranja : undefined} href="/gestion/activos" />
              <Chip k={k} valor={d.kpis.fuera_de_servicio} texto="fuera de servicio" color={d.kpis.fuera_de_servicio ? IOS.rojo : undefined} href="/gestion/activos" />
              <Chip k={k} valor={d.kpis.urgentes} texto="urgentes abiertas" color={d.kpis.urgentes ? IOS.rojo : undefined} href="/gestion/ots" />
            </div>
            {puedeValidar && (
              <>
                <span style={{ fontSize: 14, color: k.muted }}>Crea una orden por cada equipo cuyo mantenimiento vence en 7 días. No duplica órdenes.</span>
                <button type="button" onClick={preventivos} disabled={generando}
                  style={{ alignSelf: 'flex-start', height: 44, padding: '0 18px', border: 0, borderRadius: 22, background: IOS.azul, color: '#FFFFFF', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: generando ? 'wait' : 'pointer', opacity: generando ? 0.6 : 1 }}>
                  {generando ? 'Generando…' : 'Generar órdenes preventivas'}
                </button>
              </>
            )}
          </div>
        )}
        {criticas.length > 0 && (
          <div style={vidrio(k)}>
            <TituloTarjeta k={k} accion={<Enlace href="/gestion/alertas">Todas</Enlace>}>Alertas críticas</TituloTarjeta>
            {criticas.map((a) => (
              <FilaAccion key={a.clave} k={k} href={a.enlace} color={IOS.rojo} icono={ICONOS.llave} titulo={a.titulo} detalle={a.detalle ?? ''} />
            ))}
          </div>
        )}
      </Grilla>
    </>
  );
}

function Sub({ k, titulo, valor, color }: { k: Tokens; titulo: string; valor: string; color: string }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 16, background: k.chip }}>
      <div style={{ fontSize: 12, fontWeight: 600, color }}>{titulo}</div>
      <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>{valor}</div>
    </div>
  );
}
