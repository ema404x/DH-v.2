'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { calcularAnillos, hace, pesos, type DatosJefe, type Equipo, type ParaValidar, type Periodo } from '@/lib/dashboard';
import { transicionar } from '@/lib/tablero';
import { limpiarError } from '@/lib/errores';
import {
  Anillos, Avatar, BannerEmergencia, BarraAvance, Chip, Enlace, FilaAccion, FUENTE, Grilla, ICONOS, IOS, LeyendaAnillo, TituloTarjeta, degradeDe, vidrio, type Tokens,
} from './piezas';

export function VistaJefe({ k, d, equipo, periodo, onRecargar }: {
  k: Tokens; d: DatosJefe; equipo: Equipo; periodo: Periodo; onRecargar: () => void;
}) {
  const an = useMemo(() => calcularAnillos(d.ots, periodo), [d.ots, periodo]);
  const em = d.emergencias;
  const trabajando = new Map(equipo.trabajando.map((t) => [t.id, t]));
  const cuadrilla = [...d.cuadrilla].sort((a, b) => Number(trabajando.has(b.id)) - Number(trabajando.has(a.id)) || a.nombre.localeCompare(b.nombre));

  return (
    <>
      {em.length > 0 && (
        <BannerEmergencia k={k} href="/gestion/emergencias"
          titulo={em.length === 1 ? `Emergencia: ${em[0].titulo}` : `${em.length} emergencias en tus lugares`}
          detalle={`${em[0].ubicacion_nombre} · ${em[0].estado === 'en_atencion' ? 'en atención' : 'sin atender'} · ${hace(em[0].created_at)}`}
          accion="Voy" />
      )}

      <section className="grid gap-[22px] lg:grid-cols-3">
        <div style={vidrio(k)}>
          <TituloTarjeta k={k} accion={<Enlace href="/gestion/ots">Órdenes</Enlace>}>Tus órdenes</TituloTarjeta>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <Anillos k={k} valores={[
              { color: IOS.rosa, pct: an.base ? an.completadas / an.base : 0 },
              { color: IOS.verde, pct: an.aTiempoPct / 100 },
              { color: IOS.azul, pct: an.validadas48Pct / 100 },
            ]} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <LeyendaAnillo k={k} color={IOS.rosa} titulo="Cerradas" valor={String(an.completadas)} de={`/${an.base}`} />
              <LeyendaAnillo k={k} color={IOS.verde} titulo="A tiempo" valor={`${an.aTiempoPct}%`} />
              <LeyendaAnillo k={k} color={IOS.azul} titulo="Validé en 48 h" valor={`${an.validadas48Pct}%`} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <Chip k={k} valor={an.enCurso} texto="en curso" href="/gestion/ots?estado=en_progreso" />
            <Chip k={k} valor={an.aValidar} texto="a validar" color={an.aValidar ? IOS.naranja : undefined} href="/gestion/ots?estado=pendiente_validacion" />
            <Chip k={k} valor={an.vencidas} texto="vencidas" color={an.vencidas ? IOS.rojo : undefined} href="/gestion/ots" />
          </div>
        </div>

        <div className="lg:col-span-2" style={vidrio(k)}>
          <TituloTarjeta k={k} accion={d.validar.length ? <Enlace href="/gestion/ots?estado=pendiente_validacion">Ver todas</Enlace> : undefined}>
            Para validar{d.validar.length ? ` · ${d.validar.length}` : ''}
          </TituloTarjeta>
          {d.validar.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 230px), 1fr))', gap: 14 }}>
              {d.validar.slice(0, 4).map((v) => <TarjetaValidar key={v.id} k={k} v={v} onListo={onRecargar} />)}
            </div>
          ) : (
            <span style={{ fontSize: 14, color: k.muted }}>No hay órdenes esperando tu validación.</span>
          )}
        </div>
      </section>

      <Grilla>
        <Link href="/gestion/empleados" style={{ ...vidrio(k), color: k.text }}>
          <TituloTarjeta k={k}>Tu cuadrilla</TituloTarjeta>
          {cuadrilla.length ? cuadrilla.slice(0, 6).map((e) => {
            const t = trabajando.get(e.id);
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar k={k} nombre={e.nombre} tam={38} />
                <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nombre}</span>
                  <span style={{ fontSize: 13, color: k.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t ? `${t.lugar ?? 'Trabajando'} · desde ${new Date(t.desde).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}` : 'Sin fichar'}
                  </span>
                </span>
                <span aria-label={t ? 'trabajando' : 'sin fichar'} style={{ width: 10, height: 10, borderRadius: 5, background: t ? IOS.verde : k.muted, flexShrink: 0 }} />
              </div>
            );
          }) : <span style={{ fontSize: 14, color: k.muted }}>No tenés personal a cargo cargado.</span>}
          {cuadrilla.length > 6 && <span style={{ fontSize: 13, color: k.muted }}>y {cuadrilla.length - 6} más</span>}
        </Link>

        <div style={vidrio(k)}>
          <TituloTarjeta k={k} accion={<Enlace href="/gestion/obras">Ver todas</Enlace>}>Tus obras</TituloTarjeta>
          {d.obras.length ? d.obras.slice(0, 4).map((o) => (
            <BarraAvance key={o.id} k={k} titulo={o.titulo} pct={o.avance} aviso={o.alerta_plazo ? 'atrasada' : null} href="/gestion/obras" />
          )) : <span style={{ fontSize: 14, color: k.muted }}>No tenés obras en marcha.</span>}
        </div>

        <div style={vidrio(k)}>
          <TituloTarjeta k={k} accion={<Enlace href="/gestion/cobros">Cobros</Enlace>}>Plata de tus obras</TituloTarjeta>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>{pesos(d.aCobrar)}</span>
            <span style={{ fontSize: 14, color: k.muted }}>a cobrar en el ciclo</span>
          </div>
          {d.certsPorFirmar.slice(0, 3).map((c) => (
            <FilaAccion key={c.id} k={k} href="/gestion/certificacion" color={IOS.naranja} icono={ICONOS.doc}
              titulo="Falta tu firma" detalle={`Cert. N° ${c.numero ?? '—'} · ${c.obra_servicio || c.contratista}`} accion="Firmar" />
          ))}
        </div>
      </Grilla>
    </>
  );
}

function TarjetaValidar({ k, v, onListo }: { k: Tokens; v: ParaValidar; onListo: () => void }) {
  const [devolviendo, setDevolviendo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function hacer(accion: 'aprobar' | 'rechazar') {
    setOcupado(true);
    try {
      toast.success(await transicionar({ id: v.id, estado: 'pendiente_validacion', asignado_a: null }, accion, accion === 'rechazar' ? { rechazo_comentario: motivo } : {}));
      onListo();
    } catch (e) {
      toast.error(limpiarError(e));
      setOcupado(false);
    }
  }

  const boton = (fondo: string, color: string) => ({
    flex: 1, height: 40, border: 0, borderRadius: 12, background: fondo, color, fontFamily: FUENTE, fontSize: 14, fontWeight: 700,
    cursor: ocupado ? 'wait' : 'pointer', opacity: ocupado ? 0.6 : 1,
  });

  return (
    <div style={{ borderRadius: 22, overflow: 'hidden', background: k.chip, display: 'flex', flexDirection: 'column' }}>
      <Link href={`/gestion/ots?ot=${v.id}`} style={{ position: 'relative', height: 130, display: 'block', background: v.foto ? `center / cover no-repeat url("${v.foto}")` : degradeDe(v.titulo) }}>
        <span style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', gap: 6 }}>
          <Etiqueta>{v.fotos === 1 ? '1 foto' : `${v.fotos} fotos`}</Etiqueta>
          {v.faltantes > 0 && <Etiqueta fondo="rgba(255,159,10,0.92)">{v.faltantes === 1 ? '1 faltante' : `${v.faltantes} faltantes`}</Etiqueta>}
        </span>
      </Link>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.titulo}</span>
          <span style={{ fontSize: 13, color: k.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[v.codigo, v.lugar, v.quien, hace(v.desde)].filter(Boolean).join(' · ')}
          </span>
        </span>
        {devolviendo ? (
          <>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Motivo de la devolución" aria-label="Motivo de la devolución" autoFocus
              style={{ width: '100%', borderRadius: 12, border: 0, padding: 10, fontFamily: FUENTE, fontSize: 14, background: k.card, color: k.text, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={ocupado} onClick={() => setDevolviendo(false)} style={boton(k.chip, k.text)}>Cancelar</button>
              <button type="button" disabled={ocupado || !motivo.trim()} onClick={() => hacer('rechazar')} style={{ ...boton(IOS.rojo, '#FFFFFF'), opacity: ocupado || !motivo.trim() ? 0.5 : 1 }}>Devolver</button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={ocupado} onClick={() => hacer('aprobar')} style={boton(IOS.verde, '#FFFFFF')}>Aprobar</button>
            <button type="button" disabled={ocupado} onClick={() => setDevolviendo(true)} style={boton(k.card, k.text)}>Devolver</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Etiqueta({ children, fondo = 'rgba(0,0,0,0.55)' }: { children: React.ReactNode; fondo?: string }) {
  return <span style={{ padding: '4px 9px', borderRadius: 10, background: fondo, color: '#FFFFFF', fontSize: 12, fontWeight: 700, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>{children}</span>;
}
