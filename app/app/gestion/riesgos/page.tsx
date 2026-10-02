'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Download, Plus, Save, ShieldAlert, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Casilla, Selector, oNull } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Chips, descargarCSV } from '@/components/gestion/Piezas';
import {
  CLASES, CONSECUENCIAS, ESTADOS_RIESGO, PROBABILIDADES, borrarRiesgo, clase, guardarRiesgo, listarRiesgos, type ClaseRiesgo, type Riesgo,
} from '@/lib/admin';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

const COLOR: Record<ClaseRiesgo, string> = {
  aceptable: 'bg-exito/25 text-exito border-exito/50', tolerable: 'bg-alerta/20 text-alerta border-alerta/50',
  alto: 'bg-[hsl(30_90%_55%/0.25)] text-[hsl(30_90%_60%)] border-[hsl(30_90%_55%/0.5)]', extremo: 'bg-peligro/25 text-peligro border-peligro/50',
};
const PROB = [5, 4, 3, 2, 1];
const CONS = [1, 2, 4, 8, 16];

// Las 5 reglas de oro de seguridad eléctrica (la v1 las mostraba en esta pantalla).
const REGLAS = [
  ['Corte visible o efectivo', 'Aislá la instalación desconectando todas las fuentes. El corte tiene que ser físico y visible.'],
  ['Bloqueo y etiquetado', 'Bloqueá los dispositivos de corte (candado) y etiquetalos para que nadie reconecte mientras trabajás.'],
  ['Verificación de ausencia de tensión', 'No confíes en que la llave está abierta: medí con instrumental que no haya tensión.'],
  ['Puesta a tierra y en cortocircuito', 'Conectá a tierra todos los conductores activos para evitar diferencias de potencial.'],
  ['Señalización de la zona', 'Delimitá y señalizá la zona para que nadie ajeno entre ni energice por accidente.'],
];

function Matriz({ riesgos, sel, onSel }: { riesgos: Riesgo[]; sel: { p: number; c: number } | null; onSel: (s: { p: number; c: number } | null) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr><th /><th colSpan={5} className="pb-1 text-center text-xs uppercase tracking-wide text-suave">Consecuencia</th></tr>
          <tr>
            <th className="pr-2 text-left text-xs uppercase tracking-wide text-suave">Probabilidad</th>
            {CONS.map((c) => <th key={c} className="w-20 px-1 pb-1 text-center text-xs font-medium text-suave">{CONSECUENCIAS[c]}</th>)}
          </tr>
        </thead>
        <tbody>
          {PROB.map((p) => (
            <tr key={p}>
              <th className="pr-2 text-left text-xs font-medium text-suave">{PROBABILIDADES[p]}</th>
              {CONS.map((c) => {
                const n = riesgos.filter((r) => r.probabilidad === p && r.consecuencia === c).length;
                const activa = sel?.p === p && sel?.c === c;
                return (
                  <td key={c} className="p-0.5">
                    <button type="button" onClick={() => onSel(activa ? null : { p, c })} aria-pressed={activa}
                      aria-label={`${PROBABILIDADES[p]} × ${CONSECUENCIAS[c]}: nivel ${p * c}, ${n} riesgos`}
                      className={`flex h-14 w-20 flex-col items-center justify-center rounded border ${COLOR[clase(p * c)]} ${activa ? 'ring-2 ring-primario' : ''}`}>
                      <span className="text-xs opacity-80">{p * c}</span>
                      <span className="text-lg font-bold">{n || ''}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap gap-3 text-xs text-suave">
        {(Object.keys(CLASES) as ClaseRiesgo[]).map((k) => <span key={k} className={`rounded border px-2 ${COLOR[k]}`}>{CLASES[k]}</span>)}
        <span>Aceptable menos de 4 · tolerable 4 a 15 · alto 16 a 31 · extremo 32 o más</span>
      </p>
    </div>
  );
}

function Formulario({ riesgo, onListo }: { riesgo: Riesgo | null; onListo: (cambio: boolean) => void }) {
  const { esGerencia } = useSesion();
  const r = riesgo;
  const [f, setF] = useState({
    numero: r?.numero ? String(r.numero) : '', evento: r?.evento ?? '', probabilidad: String(r?.probabilidad ?? 3), consecuencia: String(r?.consecuencia ?? 4),
    metodo_control: r?.metodo_control ?? 'MP', frecuencia: r?.frecuencia ?? '', estado: r?.estado ?? 'activo', comentarios: r?.comentarios ?? '',
  });
  const [alcance, setAlcance] = useState(r?.en_alcance ?? true);
  const [resp, setResp] = useState<ResultadoBusqueda | null>(r?.responsable_id ? { id: r.responsable_id, etiqueta: r.responsable_nombre ?? '', detalle: null } : null);
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value })) });
  const nivel = Number(f.probabilidad) * Number(f.consecuencia);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await guardarRiesgo(r?.id ?? null, {
        numero: f.numero ? Number(f.numero) : null, evento: f.evento.trim(), probabilidad: Number(f.probabilidad), consecuencia: Number(f.consecuencia),
        metodo_control: oNull(f.metodo_control), frecuencia: oNull(f.frecuencia), en_alcance: alcance, estado: f.estado, responsable_id: resp?.id ?? null, comentarios: oNull(f.comentarios),
      });
      toast.success(r ? 'Riesgo guardado.' : 'Riesgo cargado.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>{r ? 'Editar riesgo' : 'Nuevo riesgo'}</h1>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Volver</Boton>
      </header>
      <section className="tarjeta space-y-4">
        <div className="grid gap-4 md:grid-cols-[6rem_1fr]">
          <Campo etiqueta="N°" inputMode="numeric" {...campo('numero')} />
          <Campo etiqueta="Evento o riesgo" required {...campo('evento')} />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Selector etiqueta="Probabilidad" opciones={Object.fromEntries(PROB.map((p) => [p, PROBABILIDADES[p]]))} {...campo('probabilidad')} />
          <Selector etiqueta="Consecuencia" opciones={Object.fromEntries(CONS.map((c) => [c, CONSECUENCIAS[c]]))} {...campo('consecuencia')} />
          <div>
            <p className="etiqueta">Nivel</p>
            <p className={`flex min-h-control items-center justify-center rounded border font-bold ${COLOR[clase(nivel)]}`}>{nivel} · {CLASES[clase(nivel)]}</p>
          </div>
          <Selector etiqueta="Método de control" opciones={{ MP: 'MP · Mantenimiento preventivo', MC: 'MC · Mantenimiento correctivo', MT: 'MT · Técnico o legal', '': 'Sin definir' }} {...campo('metodo_control')} />
          <Campo etiqueta="Frecuencia de control" placeholder="Ej.: Mensual" {...campo('frecuencia')} />
          <Selector etiqueta="Estado" opciones={ESTADOS_RIESGO} {...campo('estado')} />
        </div>
        <BuscadorRemoto etiqueta="Responsable" tabla="perfiles" valor={resp} onCambio={setResp} />
        <Casilla etiqueta="Dentro del alcance del contrato" checked={alcance} onChange={(e) => setAlcance(e.target.checked)} />
        <Area etiqueta="Comentarios" {...campo('comentarios')} />
      </section>
      <div className="flex flex-wrap justify-between gap-3">
        <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar</Boton>
        {r && esGerencia && (
          <Boton variante="peligro" icono={Trash2} onClick={async () => {
            if (!window.confirm('¿Borrar este riesgo?')) return;
            try { await borrarRiesgo(r.id); toast.success('Riesgo borrado.'); onListo(true); } catch (err) { toast.error(limpiarError(err)); }
          }}>Borrar</Boton>
        )}
      </div>
    </form>
  );
}

// Control de riesgos: la matriz probabilidad × consecuencia del sector y su planilla.
export default function Riesgos() {
  const { puedeValidar } = useSesion();
  const carga = useCarga(listarRiesgos, []);
  const [vista, setVista] = useState<{ riesgo: Riesgo | null } | null>(null);
  const [claseSel, setClaseSel] = useState<ClaseRiesgo | null>(null);
  const [celda, setCelda] = useState<{ p: number; c: number } | null>(null);
  const [estado, setEstado] = useState('');
  const [texto, setTexto] = useState('');
  const [reglas, setReglas] = useState(false);
  const todos = useMemo(() => carga.datos ?? [], [carga.datos]);
  const lista = todos.filter((r) => (!claseSel || r.clase === claseSel) && (!celda || (r.probabilidad === celda.p && r.consecuencia === celda.c))
    && (!estado || r.estado === estado) && (!texto.trim() || r.evento.toLowerCase().includes(texto.trim().toLowerCase())));

  if (vista) return <Formulario riesgo={vista.riesgo} onListo={(cambio) => { setVista(null); if (cambio) void carga.recargar(); }} />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Control de riesgos</h1>
        <div className="flex flex-wrap gap-2">
          <Boton icono={Zap} onClick={() => setReglas((r) => !r)}>5 reglas de oro</Boton>
          <Boton icono={Download} disabled={lista.length === 0} onClick={() => descargarCSV('riesgos.csv',
            ['N°', 'Evento', 'Probabilidad', 'Consecuencia', 'Nivel', 'Clase', 'Método', 'Frecuencia', 'En alcance', 'Estado', 'Responsable', 'Comentarios'],
            lista.map((r) => [r.numero, r.evento, PROBABILIDADES[r.probabilidad], CONSECUENCIAS[r.consecuencia], r.nivel, CLASES[r.clase], r.metodo_control, r.frecuencia,
              r.en_alcance ? 'Sí' : 'No', ESTADOS_RIESGO[r.estado], r.responsable_nombre, r.comentarios]))}>Exportar</Boton>
          {puedeValidar && <Boton variante="primario" icono={Plus} onClick={() => setVista({ riesgo: null })}>Nuevo riesgo</Boton>}
        </div>
      </header>

      {reglas && (
        <section className="tarjeta space-y-2 border-alerta/50">
          <h2 className="flex items-center gap-2 text-alerta"><Zap className="h-5 w-5" aria-hidden />5 reglas de oro · seguridad eléctrica</h2>
          <ol className="space-y-2">
            {REGLAS.map(([t, d], i) => <li key={t}><strong>{i + 1}. {t}.</strong> <span className="text-suave">{d}</span></li>)}
          </ol>
        </section>
      )}

      {carga.cargando && !carga.datos ? <Esqueleto filas={5} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} /> : (
        <>
          <section className="tarjeta space-y-3">
            <h2>Matriz</h2>
            <p className="text-sm text-suave">Tocá una celda para ver sus riesgos.</p>
            <Matriz riesgos={todos.filter((r) => r.estado !== 'resuelto')} sel={celda} onSel={setCelda} />
          </section>

          <div className="grid gap-3 md:grid-cols-[1fr_12rem_1fr] md:items-end">
            <Chips opciones={(Object.keys(CLASES) as ClaseRiesgo[]).map((k) => ({ id: k, texto: `${CLASES[k]} (${todos.filter((r) => r.clase === k).length})` }))} valor={claseSel} onCambio={setClaseSel} />
            <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} opciones={{ '': 'Todos', ...ESTADOS_RIESGO }} />
            <Campo etiqueta="Buscar" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>

          {lista.length === 0 ? (
            <Vacio icono={ShieldAlert} titulo={todos.length === 0 ? 'Todavía no hay riesgos cargados' : 'No hay riesgos con ese filtro'}
              texto={todos.length === 0 ? 'Cargá la planilla de riesgos del contrato: probabilidad, consecuencia, método y frecuencia de control.' : 'Probá con otra clase, otro estado u otra celda.'} />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-superficie">
              <table className="w-full border-collapse text-sm">
                <thead><tr className="border-b text-left text-suave">
                  <th className="px-3 py-3 font-medium">Riesgo</th><th className="px-3 py-3 font-medium">Nivel</th>
                  <th className="hidden px-3 py-3 font-medium md:table-cell">Control</th><th className="hidden px-3 py-3 font-medium md:table-cell">Estado</th>
                </tr></thead>
                <tbody>
                  {lista.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0 hover:bg-elevado/60">
                      <td className="px-3 py-3">
                        <button type="button" className="block min-h-control text-left font-medium text-primario hover:underline disabled:text-texto disabled:no-underline"
                          disabled={!puedeValidar} onClick={() => setVista({ riesgo: r })}>
                          {r.numero ? `${r.numero}. ` : ''}{r.evento}
                          <span className="block text-xs font-normal text-suave">{PROBABILIDADES[r.probabilidad]} × {CONSECUENCIAS[r.consecuencia]}{r.en_alcance ? '' : ' · fuera de alcance'}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3"><span className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${COLOR[r.clase]}`}>{r.nivel} · {CLASES[r.clase]}</span></td>
                      <td className="hidden px-3 py-3 md:table-cell">{[r.metodo_control, r.frecuencia].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="hidden px-3 py-3 md:table-cell">{ESTADOS_RIESGO[r.estado]}{r.responsable_nombre && <span className="block text-xs text-suave">{r.responsable_nombre}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
