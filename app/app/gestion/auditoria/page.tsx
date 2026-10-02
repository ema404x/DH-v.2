'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, FilePlus2, FileX2, History, PenLine, ShieldCheck, Users } from 'lucide-react';
import { Boton } from '@/components/Boton';
import { Campo, Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { Indicador, Indicadores, descargarCSV } from '@/components/gestion/Piezas';
import { TABLAS_AUDITADAS, listarAuditoria, type RegistroAuditoria } from '@/lib/control';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { ROLES } from '@/lib/types';

const ACCIONES = { alta: 'Alta', cambio: 'Cambio', baja: 'Baja' };
const ICONO = { alta: FilePlus2, cambio: PenLine, baja: FileX2 };
const TONO = { alta: 'text-exito', cambio: 'text-info', baja: 'text-peligro' };
const corto = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
};
const campo = (k: string) => k.replace(/_id$/, '').replace(/_/g, ' ');

function Cambios({ r }: { r: RegistroAuditoria }) {
  const [abierto, setAbierto] = useState(false);
  if (r.accion !== 'cambio') {
    return (
      <div>
        <button type="button" className="text-sm text-primario hover:underline" onClick={() => setAbierto((a) => !a)}>{abierto ? 'Ocultar el registro' : 'Ver el registro completo'}</button>
        {abierto && <pre className="mt-2 max-h-64 overflow-auto rounded bg-elevado p-2 text-xs">{JSON.stringify(r.cambios, null, 2)}</pre>}
      </div>
    );
  }
  const filas = Object.entries(r.cambios as Record<string, { antes: unknown; despues: unknown }>);
  return (
    <ul className="space-y-1 text-sm">
      {filas.map(([k, v]) => (
        <li key={k} className="break-words"><span className="text-suave">{campo(k)}:</span> <span className="line-through opacity-70">{corto(v.antes)}</span> → <span>{corto(v.despues)}</span></li>
      ))}
    </ul>
  );
}

// Auditoría: la escriben los triggers de la base (no se carga ni se edita a mano) y la lee gerencia.
export default function Auditoria() {
  const { esGerencia } = useSesion();
  const hoy = new Date();
  const [tabla, setTabla] = useState('');
  const [accion, setAccion] = useState('');
  const [usuarioTexto, setUsuarioTexto] = useState('');
  const [usuario, setUsuario] = useState('');
  const [desde, setDesde] = useState(new Date(hoy.getTime() - 7 * 86400000).toLocaleDateString('sv-SE'));
  const [hasta, setHasta] = useState(hoy.toLocaleDateString('sv-SE'));
  const [texto, setTexto] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setUsuario(usuarioTexto), 300);
    return () => clearTimeout(t);
  }, [usuarioTexto]);

  const carga = useCarga(() => listarAuditoria({ tabla, accion, usuario, desde, hasta }), [tabla, accion, usuario, desde, hasta]);
  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (carga.datos ?? []).filter((r) => !t || (r.etiqueta ?? '').toLowerCase().includes(t) || Object.keys(r.cambios).some((k) => k.includes(t)));
  }, [carga.datos, texto]);
  const porDia = useMemo(() => {
    const m = new Map<string, RegistroAuditoria[]>();
    for (const r of lista) {
      const d = new Date(r.created_at).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
      m.set(d, [...(m.get(d) ?? []), r]);
    }
    return [...m.entries()];
  }, [lista]);

  if (!esGerencia) return <Vacio icono={ShieldCheck} titulo="Solo gerencia" texto="La auditoría la ve gerencia." />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Auditoría</h1>
        <Boton icono={Download} disabled={lista.length === 0} onClick={() => descargarCSV(`auditoria-${desde}-a-${hasta}.csv`,
          ['Fecha', 'Usuario', 'Rol', 'Sección', 'Registro', 'Acción', 'Campos cambiados', 'Detalle'],
          lista.map((r) => [new Date(r.created_at).toLocaleString('es-AR', { hourCycle: 'h23' }), r.usuario_nombre, r.usuario_rol, TABLAS_AUDITADAS[r.tabla] ?? r.tabla, r.etiqueta,
            ACCIONES[r.accion], r.accion === 'cambio' ? Object.keys(r.cambios).join('; ') : '', JSON.stringify(r.cambios)]))}>Exportar</Boton>
      </header>
      <p className="text-suave">Cada alta, cambio y baja de las secciones importantes, con quién y el antes y el después. La escribe la base y nadie la puede modificar.</p>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <Campo etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <Selector etiqueta="Sección" value={tabla} onChange={(e) => setTabla(e.target.value)} opciones={{ '': 'Todas', ...TABLAS_AUDITADAS }} />
        <Selector etiqueta="Acción" value={accion} onChange={(e) => setAccion(e.target.value)} opciones={{ '': 'Todas', ...ACCIONES }} />
        <Campo etiqueta="Usuario" type="search" value={usuarioTexto} onChange={(e) => setUsuarioTexto(e.target.value)} />
        <Campo etiqueta="Registro o campo" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>

      {carga.cargando && !carga.datos ? <Esqueleto filas={5} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} /> : (
        <>
          <Indicadores>
            <Indicador titulo="Movimientos" valor={lista.length} icono={History} nota={lista.length >= 1000 ? 'Se muestran los últimos 1000' : undefined} />
            <Indicador titulo="Altas" valor={lista.filter((r) => r.accion === 'alta').length} icono={FilePlus2} tono="exito" />
            <Indicador titulo="Bajas" valor={lista.filter((r) => r.accion === 'baja').length} icono={FileX2} tono="peligro" />
            <Indicador titulo="Usuarios" valor={new Set(lista.map((r) => r.usuario_nombre)).size} icono={Users} />
          </Indicadores>
          {lista.length === 0 ? <Vacio icono={History} titulo="Sin movimientos" texto="No hay cambios registrados con ese filtro." /> : (
            <div className="space-y-4">
              {porDia.map(([dia, regs]) => (
                <section key={dia} className="space-y-2">
                  <h2 className="first-letter:uppercase">{dia}</h2>
                  <ul className="space-y-2">
                    {regs.map((r) => {
                      const Icono = ICONO[r.accion];
                      return (
                        <li key={r.id} className="tarjeta flex gap-3">
                          <Icono className={`mt-0.5 h-5 w-5 shrink-0 ${TONO[r.accion]}`} aria-label={ACCIONES[r.accion]} />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p>
                              <span className="font-medium">{r.usuario_nombre ?? 'Sistema'}</span>
                              <span className="text-suave"> ({r.usuario_rol ? ROLES[r.usuario_rol as keyof typeof ROLES] ?? r.usuario_rol : '—'})</span>{' '}
                              {ACCIONES[r.accion].toLowerCase()} en <span className="font-medium">{TABLAS_AUDITADAS[r.tabla] ?? r.tabla}</span>: {r.etiqueta ?? '—'}
                              <span className="text-sm text-suave"> · {new Date(r.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</span>
                            </p>
                            <Cambios r={r} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
