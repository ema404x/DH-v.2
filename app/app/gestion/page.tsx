'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScannerModal } from '@/components/ScannerModal';
import { VistaGerencia } from '@/components/dashboard/Gerencia';
import { VistaJefe } from '@/components/dashboard/Jefe';
import { BotonPildora, Encabezado, Esqueletos, Fondo, ICONOS, IOS, Segmento, tokens, vidrio, type Tema } from '@/components/dashboard/piezas';
import { cargarEquipo, cargarGerencia, cargarJefe, fechaLarga, type Periodo } from '@/lib/dashboard';
import { listarAlertas } from '@/lib/control';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

// Tablero de inicio, estilo Apple (boceto aprobado por Emanuel el 8/10/2026).
// Gerencia ve plata, órdenes, equipo y obras de todo el sector; el jefe de sitio, lo suyo.

const CLAVE_TEMA = 'dh1-tema-dashboard';
const PERIODOS: { v: Periodo; texto: string }[] = [{ v: 'hoy', texto: 'Hoy' }, { v: 'mes', texto: 'Mes' }, { v: 'anio', texto: 'Año' }];

function saludo() {
  const h = new Date().getHours();
  return h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
}

export default function Tablero() {
  const router = useRouter();
  const { perfil, puedeValidar } = useSesion();
  const esJefe = perfil?.rol === 'jefe_sitio';
  const [tema, setTema] = useState<Tema>('oscuro');
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [escaneando, setEscaneando] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem(CLAVE_TEMA) === 'claro') setTema('claro'); } catch { /* sin almacenamiento */ }
  }, []);
  function cambiarTema() {
    const t: Tema = tema === 'oscuro' ? 'claro' : 'oscuro';
    setTema(t);
    try { localStorage.setItem(CLAVE_TEMA, t); } catch { /* sin almacenamiento */ }
  }

  const datos = useCarga(async () => {
    if (!perfil) return null;
    if (perfil.rol === 'jefe_sitio') {
      const j = await cargarJefe(perfil.id, perfil.nombre);
      return { tipo: 'jefe' as const, j, equipo: await cargarEquipo(j.cuadrilla) };
    }
    const [g, alertas] = await Promise.all([cargarGerencia(), listarAlertas().catch(() => [])]);
    return { tipo: 'gerencia' as const, g, criticas: alertas.filter((a) => a.nivel === 'critica').slice(0, 4) };
  }, [perfil?.id, perfil?.rol]);

  const k = tokens(tema);
  const nombre = perfil?.nombre.split(/\s+/)[0] ?? '';
  const d = datos.datos;

  return (
    <Fondo k={k}>
      <Encabezado k={k} sobre={fechaLarga()} titulo={esJefe ? `Tu día, ${nombre}` : `${saludo()}, ${nombre}`}>
        <Segmento k={k} etiqueta="Período" opciones={PERIODOS} valor={periodo} onCambio={setPeriodo} />
        <BotonPildora k={k} onClick={cambiarTema} etiqueta={tema === 'oscuro' ? 'Pasar a modo claro' : 'Pasar a modo oscuro'}>
          {tema === 'oscuro' ? ICONOS.sol : ICONOS.luna}
        </BotonPildora>
        {esJefe && <BotonPildora k={k} onClick={() => setEscaneando(true)}>Escanear QR</BotonPildora>}
        {puedeValidar && <BotonPildora k={k} href="/gestion/ots/nueva" primario>{ICONOS.mas} Nueva orden</BotonPildora>}
      </Encabezado>

      {datos.error ? (
        <div style={vidrio(k, { alignItems: 'flex-start' })}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>No se pudo cargar el tablero</span>
          <span style={{ fontSize: 14, color: k.muted }}>{datos.error}</span>
          <button type="button" onClick={datos.recargar}
            style={{ height: 40, padding: '0 16px', border: 0, borderRadius: 20, background: IOS.azul, color: '#FFFFFF', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            Reintentar
          </button>
        </div>
      ) : !d ? (
        <Esqueletos k={k} />
      ) : d.tipo === 'jefe' ? (
        <VistaJefe k={k} d={d.j} equipo={d.equipo} periodo={periodo} onRecargar={datos.recargar} />
      ) : (
        <VistaGerencia k={k} d={d.g} periodo={periodo} criticas={d.criticas} puedeValidar={puedeValidar} onRecargar={datos.recargar} />
      )}

      {escaneando && (
        <ScannerModal onCerrar={() => setEscaneando(false)} onToken={(t: string) => { setEscaneando(false); router.push(`/q?t=${encodeURIComponent(t)}`); }} />
      )}
    </Fondo>
  );
}
