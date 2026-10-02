'use client';

import { useState, type FormEvent } from 'react';
import { Layers, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Casilla } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { guardarSector, listarSectores, resumenSector, type SectorCompleto } from '@/lib/admin';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

const ETIQUETAS_RESUMEN: Record<string, string> = {
  usuarios: 'Usuarios', ubicaciones: 'Ubicaciones', activos: 'Activos', ordenes: 'Órdenes', ordenes_abiertas: 'Órdenes abiertas',
  pendientes: 'Pendientes SAP', empleados: 'Empleados', obras: 'Obras', contratos: 'Contratos', materiales: 'Materiales',
};

function Formulario({ sector, onListo }: { sector: SectorCompleto | null; onListo: (cambio: boolean) => void }) {
  const s = sector;
  const c = (s?.config ?? {}) as Record<string, unknown> & NonNullable<SectorCompleto['config']>;
  const [f, setF] = useState({
    clave: s?.clave ?? '', nombre: s?.nombre ?? '', descripcion: s?.descripcion ?? '', color: s?.color ?? '', orden: String(s?.orden ?? 0),
    zonas: (c.zonas ?? []).join(', '), singular: c.unidad?.singular ?? 'Lugar', plural: c.unidad?.plural ?? 'Lugares',
    radio: String(c.fichaje_radio_m ?? 300), sufijo: c.geocodificacion?.sufijo ?? '', viewbox: c.geocodificacion?.viewbox ?? '',
  });
  const [activo, setActivo] = useState(s?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((a) => ({ ...a, [k]: e.target.value })) });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const clave = f.clave.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '_');
    if (!clave || !f.nombre.trim()) { toast.error('El sector necesita clave y nombre.'); return; }
    setGuardando(true);
    try {
      await guardarSector(s?.id ?? null, {
        ...(s ? {} : { clave }), nombre: f.nombre.trim(), descripcion: f.descripcion.trim() || null, color: f.color.trim() || null, orden: Number(f.orden) || 0, activo,
        config: {
          ...c,
          zonas: f.zonas.split(',').map((z) => z.trim()).filter(Boolean),
          unidad: { singular: f.singular.trim() || 'Lugar', plural: f.plural.trim() || 'Lugares' },
          fichaje_radio_m: Math.max(50, Number(f.radio) || 300),
          geocodificacion: { ...(c.geocodificacion ?? {}), sufijo: f.sufijo.trim() || undefined, viewbox: f.viewbox.trim() || undefined },
        },
      });
      toast.success(s ? 'Sector guardado.' : 'Sector creado.');
      onListo(true);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>{s ? `Sector ${s.nombre}` : 'Nuevo sector'}</h1>
        <Boton variante="fantasma" onClick={() => onListo(false)}>Volver</Boton>
      </header>
      <section className="tarjeta space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Campo etiqueta="Clave" required disabled={!!s} {...campo('clave')} ayuda={s ? 'La clave no cambia (la usan la migración y las integraciones).' : 'Minúsculas, sin espacios. Ej.: hospitales'} />
          <Campo etiqueta="Nombre" required {...campo('nombre')} />
          <Campo etiqueta="Orden" inputMode="numeric" {...campo('orden')} />
          <Campo etiqueta="Color (opcional)" placeholder="#3b82f6" {...campo('color')} />
        </div>
        <Area etiqueta="Descripción" {...campo('descripcion')} />
        {s && <Casilla etiqueta="Activo (un sector inactivo no se puede elegir)" checked={activo} onChange={(e) => setActivo(e.target.checked)} />}
      </section>
      <section className="tarjeta space-y-4">
        <h2>Configuración</h2>
        <Campo etiqueta="Zonas o comunas (separadas por coma)" placeholder="8A, 8B, 10A" {...campo('zonas')} ayuda="Aparecen como pestañas en Pendientes, Obras y Reportes." />
        <div className="grid gap-4 md:grid-cols-3">
          <Campo etiqueta="Cómo se llama un lugar" placeholder="Escuela" {...campo('singular')} />
          <Campo etiqueta="En plural" placeholder="Escuelas" {...campo('plural')} />
          <Campo etiqueta="Radio del fichaje (metros)" inputMode="numeric" {...campo('radio')} ayuda="Más lejos que esto, el fichaje queda marcado." />
          <Campo etiqueta="Ubicar direcciones en (sufijo)" placeholder="Ciudad de Buenos Aires, Argentina" {...campo('sufijo')} />
          <Campo etiqueta="Área de búsqueda (viewbox, opcional)" placeholder="-58.53,-34.53,-58.33,-34.71" {...campo('viewbox')} />
        </div>
        <p className="text-sm text-suave">Los umbrales de las alertas se ajustan desde Alertas.</p>
      </section>
      <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar sector</Boton>
    </form>
  );
}

// Sectores (unidades de negocio). Solo el admin. Para ver los datos de otro sector, cambiá de sector arriba.
export default function Sectores() {
  const { perfil, sectorEfectivo, recargar } = useSesion();
  const carga = useCarga(listarSectores, []);
  const resumen = useCarga(resumenSector, [sectorEfectivo?.id]);
  const [vista, setVista] = useState<{ sector: SectorCompleto | null } | null>(null);

  if (perfil?.rol !== 'admin') return <Vacio icono={Layers} titulo="Solo el admin" texto="Los sectores los administra el admin." />;
  if (vista) return <Formulario sector={vista.sector} onListo={(cambio) => { setVista(null); if (cambio) { void carga.recargar(); void recargar(); } }} />;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Sectores</h1>
        <Boton variante="primario" icono={Plus} onClick={() => setVista({ sector: null })}>Nuevo sector</Boton>
      </header>
      {resumen.datos && (
        <section className="tarjeta space-y-2">
          <h2>En {sectorEfectivo?.nombre} (sector activo)</h2>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {Object.entries(resumen.datos).map(([k, v]) => (
              <div key={k}><dt className="text-xs text-suave">{ETIQUETAS_RESUMEN[k] ?? k}</dt><dd className="num text-left text-xl font-bold">{v}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {carga.cargando && !carga.datos ? <Esqueleto filas={3} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} /> : (
        <ul className="space-y-2">
          {(carga.datos ?? []).map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setVista({ sector: s })} className="tarjeta flex w-full flex-wrap items-center justify-between gap-3 text-left hover:border-primario/60">
                <div className="flex items-center gap-3">
                  <span className="inline-block h-4 w-4 rounded-full border" style={{ background: s.color ?? 'transparent' }} aria-hidden />
                  <div>
                    <p className="font-medium">{s.nombre}{s.id === sectorEfectivo?.id && <span className="ml-2 text-xs text-primario">(activo)</span>}</p>
                    <p className="text-sm text-suave">{[s.clave, (s.config?.zonas ?? []).length ? `zonas: ${(s.config?.zonas ?? []).join(', ')}` : null, s.config?.unidad?.plural].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
                <span className={s.activo ? 'text-exito' : 'text-suave'}>{s.activo ? 'Activo' : 'Inactivo'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
