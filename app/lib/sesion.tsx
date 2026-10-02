'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase/client';
import { exigir, limpiarError } from './errores';
import { clasificar, resumen } from './offline/cola';
import { vaciar } from './offline/db';
import { ROLES_GERENCIA, ROLES_GESTION, ROLES_VALIDAN, type Perfil, type Sector } from './types';

interface Sesion {
  perfil: Perfil | null;
  sectores: Sector[];
  // Sector en el que está parado el usuario. Lo calcula la base; acá solo se refleja para mostrarlo.
  sectorEfectivo: Sector | null;
  cargando: boolean;
  error: string | null;
  esGerencia: boolean;
  puedeValidar: boolean;
  entraAGestion: boolean;
  recargar: () => Promise<void>;
  salir: () => Promise<void>;
}

const Contexto = createContext<Sesion | null>(null);
const CACHE = 'dh1:perfil';

export function SesionProvider({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [sectores, setSectores] = useState<Sector[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    setError(null);
    try {
      const sb = supabase();
      const { data: auth, error: errorSesion } = await sb.auth.getSession();
      const uid = auth.session?.user.id;
      if (!uid) {
        // Sin señal, un ingreso vencido no se puede renovar: eso no es "sin sesión".
        // Se sigue con el último perfil conocido (abajo, en el catch) y se renueva al volver la red.
        if (errorSesion || !navigator.onLine) throw errorSesion ?? new Error('sin señal');
        setPerfil(null);
        setSectores([]);
        return;
      }
      const [p, s] = await Promise.all([
        sb.from('perfiles').select('id,email,nombre,rol,sector_id,sector_activo_id,ver_todos,activo,telefono').eq('id', uid).maybeSingle(),
        sb.from('sectores').select('id,clave,nombre,activo,orden,config').eq('activo', true).order('orden'),
      ]);
      const miPerfil = exigir(p) as Perfil | null;
      if (!miPerfil) {
        throw new Error('Tu usuario no tiene un perfil cargado en DH1. Pedile al administrador que te dé de alta.');
      }
      if (!miPerfil.activo) {
        throw new Error('Tu usuario está dado de baja. Hablá con el administrador.');
      }
      const lista = exigir(s) as Sector[];
      setPerfil(miPerfil);
      setSectores(lista);
      localStorage.setItem(CACHE, JSON.stringify({ perfil: miPerfil, sectores: lista }));
    } catch (e) {
      // Sin señal (o con el servidor sin responder): se sigue con el último perfil conocido,
      // para poder trabajar con las órdenes guardadas en el teléfono.
      const guardado = typeof localStorage !== 'undefined' ? localStorage.getItem(CACHE) : null;
      if (guardado && clasificar(e) === 'red') {
        const g = JSON.parse(guardado) as { perfil: Perfil; sectores: Sector[] };
        setPerfil(g.perfil);
        setSectores(g.sectores);
      } else {
        setError(limpiarError(e));
      }
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
    try {
      const { data } = supabase().auth.onAuthStateChange((evento) => {
        if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') void recargar();
      });
      return () => data.subscription.unsubscribe();
    } catch {
      // Supabase sin configurar: recargar() ya dejó el mensaje en "error".
    }
  }, [recargar]);

  // Al volver la señal se refresca el perfil (y con eso se renueva el ingreso si había vencido).
  useEffect(() => {
    const alVolver = () => void recargar();
    window.addEventListener('online', alVolver);
    return () => window.removeEventListener('online', alVolver);
  }, [recargar]);

  const salir = useCallback(async () => {
    // Lo que quedó sin enviar NO se borra al salir: sigue en el teléfono y se envía cuando
    // esa misma persona vuelva a ingresar. Se avisa antes.
    try {
      const uid = perfil?.id;
      const r = uid ? await resumen(uid) : null;
      if (r && r.pendientes + r.rechazadas > 0) {
        const seguir = window.confirm(
          `Tenés ${r.pendientes + r.rechazadas} cambios sin enviar en este teléfono. Si salís ahora, se envían recién cuando vuelvas a ingresar con tu usuario. ¿Salir igual?`,
        );
        if (!seguir) return;
      }
    } catch {
      // Si no se puede leer la cola, se sale igual.
    }
    // scope local: cierra la sesión de este teléfono aunque no haya señal.
    await supabase().auth.signOut({ scope: 'local' });
    localStorage.removeItem(CACHE);
    // Las órdenes guardadas son del sector de quien sale: no quedan para el próximo usuario.
    await Promise.all([vaciar('ots'), vaciar('fotos'), vaciar('borradores')]).catch(() => undefined);
    window.location.href = '/login';
  }, [perfil?.id]);

  const valor = useMemo<Sesion>(() => {
    const idEfectivo =
      perfil && (perfil.rol === 'admin' || perfil.rol === 'gerente_general')
        ? perfil.sector_activo_id ?? perfil.sector_id
        : perfil?.sector_id;
    return {
      perfil,
      sectores,
      sectorEfectivo: sectores.find((s) => s.id === idEfectivo) ?? null,
      cargando,
      error,
      esGerencia: !!perfil && ROLES_GERENCIA.includes(perfil.rol),
      puedeValidar: !!perfil && ROLES_VALIDAN.includes(perfil.rol),
      entraAGestion: !!perfil && ROLES_GESTION.includes(perfil.rol),
      recargar,
      salir,
    };
  }, [perfil, sectores, cargando, error, recargar, salir]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): Sesion {
  const s = useContext(Contexto);
  if (!s) throw new Error('useSesion se usa dentro de SesionProvider.');
  return s;
}
