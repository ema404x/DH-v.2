'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo, Casilla, Selector } from '@/components/Campos';
import { supabase } from '@/lib/supabase/client';
import { exigir, limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';

// Portal de operarios sin usuario (fase 16), del sector activo. Solo el admin.
// El "usuario del portal" es un operario que nadie usa para entrar: las acciones del portal quedan a su nombre
// (más el nombre que tipea cada operario). La clave no se puede leer: solo cambiar.

interface Config { perfil_id: string; perfil_nombre: string; activo: boolean; updated_at: string }
interface Accion { id: number; accion: string; nombre: string; ip: string; at: string; ot_id: string | null }

const ACCION: Record<string, string> = { entrar: 'Entró', iniciar: 'Inició una orden', foto: 'Subió una foto', finalizar: 'Envió una orden al jefe' };

async function cargar() {
  const sb = supabase();
  const [cfg, ops, log] = await Promise.all([
    sb.rpc('ver_portal_operarios'),
    sb.from('perfiles').select('id,nombre').eq('rol', 'operario').eq('activo', true).order('nombre'),
    sb.from('portal_acciones').select('id,accion,nombre,ip,at,ot_id').order('at', { ascending: false }).limit(15),
  ]);
  return {
    config: exigir(cfg) as Config | null,
    operarios: exigir(ops) as { id: string; nombre: string }[],
    log: (log.error ? [] : log.data) as Accion[],
  };
}

export function PortalOperarios({ sectorId }: { sectorId?: string }) {
  const datos = useCarga(cargar, [sectorId]);
  const [perfil, setPerfil] = useState('');
  const [clave, setClave] = useState('');
  const [activo, setActivo] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const c = datos.datos?.config;

  useEffect(() => {
    setPerfil(c?.perfil_id ?? '');
    setActivo(c?.activo ?? true);
    setClave('');
  }, [c?.perfil_id, c?.activo, c?.updated_at]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      exigir(await supabase().rpc('set_portal_operarios', { p_perfil: perfil, p_clave: clave.trim() || null, p_activo: activo }));
      toast.success(clave.trim() ? 'Clave del portal cambiada. Los que estaban adentro tienen que entrar de nuevo.' : 'Portal guardado.');
      await datos.recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  if (!datos.datos) return null;
  const { operarios, log } = datos.datos;

  return (
    <section className="tarjeta space-y-4">
      <div>
        <h2 className="flex items-center gap-2"><KeyRound className="h-5 w-5" aria-hidden /> Portal de operarios sin usuario</h2>
        <p className="text-sm text-suave">
          Desde el QR de un lugar, quien no tiene usuario entra con esta clave y su nombre: ve las órdenes de ese lugar, las inicia,
          sube fotos y las envía al jefe. No aprueba ni ve nada más. {c ? (c.activo ? 'Está prendido.' : 'Está apagado.') : 'Todavía no está configurado.'}
        </p>
      </div>
      <form onSubmit={guardar} className="grid gap-3 md:grid-cols-2">
        <Selector etiqueta="Usuario del portal (un operario que nadie usa para entrar)" value={perfil} onChange={(e) => setPerfil(e.target.value)} required
          opciones={{ '': 'Elegí…', ...Object.fromEntries(operarios.map((o) => [o.id, o.nombre])) }}
          ayuda="Crealo en Usuarios con rol operario, por ejemplo «Portal QR»." />
        <Campo etiqueta={c ? 'Clave nueva (vacía = no se cambia)' : 'Clave'} type="text" autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)}
          minLength={6} required={!c} ayuda="Mínimo 6 caracteres. Cambiarla saca a todos los que estaban adentro." />
        <Casilla etiqueta="Portal prendido" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        <div className="md:text-right">
          <Boton type="submit" variante="primario" icono={Save} cargando={guardando} disabled={!perfil}>Guardar</Boton>
        </div>
      </form>
      {log.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Últimos movimientos del portal</h3>
          <ul className="divide-y divide-borde text-sm">
            {log.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span><span className="font-medium">{a.nombre}</span> · {ACCION[a.accion] ?? a.accion}</span>
                <span className="text-suave">{new Date(a.at).toLocaleString('es-AR', { hour12: false })} · IP {a.ip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
