'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, BellOff, CheckCircle2, Info, Save, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { Chips, Indicador, Indicadores } from '@/components/gestion/Piezas';
import { TIPOS_ALERTA, guardarUmbrales, listarAlertas, marcarVista, type Alerta, type NivelAlerta, type Umbrales } from '@/lib/control';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

const NIVEL: Record<NivelAlerta, { texto: string; clase: string; icono: typeof AlertOctagon }> = {
  critica: { texto: 'Crítica', clase: 'border-peligro/50 text-peligro', icono: AlertOctagon },
  aviso: { texto: 'Aviso', clase: 'border-alerta/50 text-alerta', icono: AlertTriangle },
  info: { texto: 'Info', clase: 'border-info/50 text-info', icono: Info },
};
const ORDEN: Record<NivelAlerta, number> = { critica: 0, aviso: 1, info: 2 };

function Umbral({ onListo }: { onListo: () => void }) {
  const { sectorEfectivo, recargar } = useSesion();
  const u = ((sectorEfectivo?.config as Record<string, unknown> | undefined)?.alertas ?? {}) as Partial<Umbrales>;
  const [f, setF] = useState({
    dias_garantia: String(u.dias_garantia ?? 30), dias_pendiente: String(u.dias_pendiente ?? 7), dias_ot: String(u.dias_ot ?? 1),
    dias_mantenimiento: String(u.dias_mantenimiento ?? 0), umbral_stock_pct: String(u.umbral_stock_pct ?? 0),
  });
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value })) });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!sectorEfectivo) return;
    const valores = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Math.max(0, Math.round(Number(v) || 0))])) as unknown as Umbrales;
    setGuardando(true);
    try {
      await guardarUmbrales(sectorEfectivo.id, sectorEfectivo.config as Record<string, unknown>, valores);
      toast.success('Umbrales guardados para el sector.');
      await recargar();
      onListo();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="tarjeta space-y-4">
      <h2>Cuándo avisar (sector {sectorEfectivo?.nombre})</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <Campo etiqueta="Orden vencida desde (días)" inputMode="numeric" {...campo('dias_ot')} ayuda="Crítica a los 7 días." />
        <Campo etiqueta="Pendiente vencido desde (días)" inputMode="numeric" {...campo('dias_pendiente')} ayuda="Crítica al doble." />
        <Campo etiqueta="Garantía: avisar con (días)" inputMode="numeric" {...campo('dias_garantia')} ayuda="Crítica a 7 días." />
        <Campo etiqueta="Mantenimiento vencido desde (días)" inputMode="numeric" {...campo('dias_mantenimiento')} />
        <Campo etiqueta="Stock: margen sobre el mínimo (%)" inputMode="numeric" {...campo('umbral_stock_pct')} ayuda="0 = avisa al llegar al mínimo." />
      </div>
      <Boton type="submit" icono={Save} cargando={guardando}>Guardar umbrales</Boton>
    </form>
  );
}

// Alertas vigentes: se calculan en la base al momento. "Ya la vi" la oculta una semana para vos (vuelve si sigue).
export default function Alertas() {
  const { perfil } = useSesion();
  const carga = useCarga(listarAlertas, []);
  const [tipo, setTipo] = useState<string | null>(null);
  const [nivel, setNivel] = useState<'' | NivelAlerta>('');
  const [config, setConfig] = useState(false);
  const todas = useMemo(() => [...(carga.datos ?? [])].sort((a, b) => ORDEN[a.nivel] - ORDEN[b.nivel] || (a.fecha ?? '').localeCompare(b.fecha ?? '')), [carga.datos]);
  const lista = todas.filter((a) => (!tipo || a.tipo === tipo) && (!nivel || a.nivel === nivel));
  const tipos = [...new Set(todas.map((a) => a.tipo))];

  async function vista(a: Alerta) {
    try {
      await marcarVista(a.clave);
      carga.setDatos((carga.datos ?? []).filter((x) => x.clave !== a.clave));
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Alertas</h1>
        {perfil?.rol === 'admin' && <Boton icono={Settings} onClick={() => setConfig((c) => !c)}>{config ? 'Ocultar umbrales' : 'Umbrales'}</Boton>}
      </header>
      {config && <Umbral onListo={() => { setConfig(false); void carga.recargar(); }} />}

      <Indicadores>
        <Indicador titulo="Críticas" valor={todas.filter((a) => a.nivel === 'critica').length} icono={AlertOctagon} tono={todas.some((a) => a.nivel === 'critica') ? 'peligro' : 'neutro'} />
        <Indicador titulo="Avisos" valor={todas.filter((a) => a.nivel === 'aviso').length} icono={AlertTriangle} tono="alerta" />
        <Indicador titulo="Tipos distintos" valor={tipos.length} icono={Info} />
        <Indicador titulo="Total" valor={todas.length} icono={CheckCircle2} />
      </Indicadores>

      <div className="grid gap-3 md:grid-cols-[1fr_12rem] md:items-end">
        <Chips opciones={tipos.map((t) => ({ id: t, texto: `${TIPOS_ALERTA[t] ?? t} (${todas.filter((a) => a.tipo === t).length})` }))} valor={tipo} onCambio={setTipo} todos="Todas" />
        <Selector etiqueta="Nivel" value={nivel} onChange={(e) => setNivel(e.target.value as typeof nivel)} opciones={{ '': 'Todos', critica: 'Críticas', aviso: 'Avisos' }} />
      </div>

      {carga.cargando && !carga.datos ? <Esqueleto filas={5} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
        : lista.length === 0 ? (
          <Vacio icono={CheckCircle2} titulo={todas.length === 0 ? 'No hay alertas' : 'No hay alertas con ese filtro'}
            texto={todas.length === 0 ? 'Nada vencido, nada por vencer y el stock en orden.' : 'Probá con otro tipo o nivel.'} />
        ) : (
          <ul className="space-y-2">
            {lista.map((a) => {
              const n = NIVEL[a.nivel];
              const Icono = n.icono;
              return (
                <li key={a.clave} className={`tarjeta flex flex-wrap items-center justify-between gap-3 border-l-4 ${n.clase.split(' ')[0]}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <Icono className={`mt-0.5 h-5 w-5 shrink-0 ${n.clase.split(' ')[1]}`} aria-label={n.texto} />
                    <div className="min-w-0">
                      <Link href={a.enlace} className="font-medium text-primario hover:underline">{a.titulo}</Link>
                      <p className="text-sm text-suave">{[TIPOS_ALERTA[a.tipo], a.detalle, a.zona].filter(Boolean).join(' · ')}</p>
                    </div>
                  </div>
                  <Boton variante="fantasma" icono={BellOff} onClick={() => vista(a)}>Ya la vi</Boton>
                </li>
              );
            })}
          </ul>
        )}
    </>
  );
}
