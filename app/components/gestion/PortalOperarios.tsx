'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, KeyRound, Power, RefreshCw, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Selector } from '@/components/Campos';
import { supabase } from '@/lib/supabase/client';
import { exigir, limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';

// Portal de operarios sin usuario (fase 16), del sector activo. Solo el admin.
// Pensado para hacerlo en un toque: "Generar clave" arma una clave de 8 números, la guarda y la muestra una sola vez.
// El "usuario del portal" es un operario con el que nadie entra (las acciones quedan a su nombre + el nombre tipeado).

interface Config { perfil_id: string; perfil_nombre: string; activo: boolean; updated_at: string }
interface Accion { id: number; accion: string; nombre: string; ip: string; at: string }

const ACCION: Record<string, string> = { entrar: 'Entró', iniciar: 'Inició una orden', foto: 'Subió una foto', finalizar: 'Envió una orden al jefe' };
const fecha = (f: string) => new Date(f).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

async function cargar() {
  const sb = supabase();
  const [cfg, ops, log] = await Promise.all([
    sb.rpc('ver_portal_operarios'),
    sb.from('perfiles').select('id,nombre').eq('rol', 'operario').eq('activo', true).order('nombre'),
    sb.from('portal_acciones').select('id,accion,nombre,ip,at').order('at', { ascending: false }).limit(15),
  ]);
  return {
    config: exigir(cfg) as Config | null,
    operarios: exigir(ops) as { id: string; nombre: string }[],
    log: (log.error ? [] : log.data) as Accion[],
  };
}

// 8 números al azar (con el generador seguro del navegador).
function claveNueva(): string {
  const n = new Uint32Array(8);
  crypto.getRandomValues(n);
  return Array.from(n, (x) => String(x % 10)).join('');
}

export function PortalOperarios({ sectorId }: { sectorId?: string }) {
  const datos = useCarga(cargar, [sectorId]);
  const [elegido, setElegido] = useState('');
  const [mostrar, setMostrar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (datos.error) return <section className="tarjeta text-peligro">{datos.error}</section>;
  if (!datos.datos) return <section className="tarjeta esqueleto h-40" />;
  const { config: c, operarios, log } = datos.datos;
  // El usuario del portal: el configurado, el elegido, o uno que se llame "Portal…".
  const perfil = elegido || c?.perfil_id || operarios.find((o) => /portal/i.test(o.nombre))?.id || '';

  async function guardar(clave: string | null, activo: boolean) {
    setOcupado(true);
    try {
      exigir(await supabase().rpc('set_portal_operarios', { p_perfil: perfil, p_clave: clave, p_activo: activo }));
      if (clave) setMostrar(clave);
      else toast.success(activo ? 'Portal prendido.' : 'Portal apagado. Los que estaban adentro quedaron afuera.');
      await datos.recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta space-y-4">
      <div>
        <h2 className="flex items-center gap-2"><KeyRound className="h-5 w-5" aria-hidden /> Portal de operarios sin usuario</h2>
        <p className="text-sm text-suave">
          Quien no tiene usuario escanea el QR de un lugar, toca «No tengo usuario» y entra con esta clave y su nombre: ve las órdenes de ese lugar,
          las inicia, sube fotos y las manda al jefe. No aprueba ni ve nada más.
        </p>
      </div>

      {/* Estado */}
      <div className={`flex flex-wrap items-center gap-3 rounded border px-4 py-3 ${c?.activo ? 'border-exito/40 bg-exito/10' : 'border-borde'}`}>
        {c?.activo ? <CheckCircle2 className="h-6 w-6 text-exito" aria-hidden /> : <Power className="h-6 w-6 text-suave" aria-hidden />}
        <div className="flex-1">
          <p className="font-semibold">{!c ? 'Todavía no está configurado' : c.activo ? 'Prendido' : 'Apagado'}</p>
          {c && <p className="text-sm text-suave">Usuario: {c.perfil_nombre} · clave cambiada el {fecha(c.updated_at)}</p>}
        </div>
        {c && (
          <Boton variante={c.activo ? 'secundario' : 'primario'} icono={Power} cargando={ocupado} onClick={() => guardar(null, !c.activo)}>
            {c.activo ? 'Apagar' : 'Prender'}
          </Boton>
        )}
      </div>

      {/* La clave recién generada: se muestra una sola vez */}
      {mostrar && (
        <div className="rounded border-2 border-primario/60 bg-primario/10 px-4 py-4 text-center" role="status">
          <p className="text-sm text-suave">Clave nueva del portal. Anotala o copiala: no se vuelve a mostrar.</p>
          <p className="num my-2 text-4xl font-bold tracking-[0.3em]">{mostrar}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Boton icono={Copy} onClick={() => navigator.clipboard?.writeText(mostrar).then(() => toast.success('Clave copiada.'))}>Copiar</Boton>
            <Boton variante="fantasma" onClick={() => setMostrar(null)}>Listo, ya la anoté</Boton>
          </div>
        </div>
      )}

      {/* Acción principal */}
      {operarios.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm">Primero hace falta un usuario operario para el portal (nadie entra con él). Creá uno llamado <b>Portal QR</b>.</p>
          <Link href="/gestion/usuarios" className="inline-flex min-h-control items-center gap-2 rounded bg-primario px-4 font-semibold text-white">
            <UserPlus className="h-4 w-4" aria-hidden /> Ir a Usuarios
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Selector etiqueta="Usuario del portal" value={perfil} onChange={(e) => setElegido(e.target.value)}
              opciones={{ '': 'Elegí…', ...Object.fromEntries(operarios.map((o) => [o.id, o.nombre])) }} />
          </div>
          <Boton variante="primario" icono={c ? RefreshCw : KeyRound} cargando={ocupado} disabled={!perfil} onClick={() => guardar(claveNueva(), true)}>
            {c ? 'Generar clave nueva' : 'Generar clave y prender'}
          </Boton>
        </div>
      )}
      {c && <p className="text-xs text-suave">Generar una clave nueva saca a todos los que estaban adentro: van a tener que poner la nueva.</p>}

      {log.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Últimos movimientos del portal</h3>
          <ul className="divide-y divide-borde text-sm">
            {log.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span><span className="font-medium">{a.nombre}</span> · {ACCION[a.accion] ?? a.accion}</span>
                <span className="text-suave">{fecha(a.at)} · IP {a.ip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
