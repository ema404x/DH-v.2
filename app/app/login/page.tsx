'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { Boton } from '@/components/Boton';
import { Campo } from '@/components/Campos';
import { supabase } from '@/lib/supabase/client';
import { limpiarError } from '@/lib/errores';

function Formulario() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setEntrando(true);
    setError(null);
    try {
      const { error: fallo } = await supabase().auth.signInWithPassword({ email: email.trim(), password: clave });
      if (fallo) throw fallo;
      // Solo se vuelve a rutas propias de la app.
      const volver = params.get('volver');
      window.location.href = volver && volver.startsWith('/') && !volver.startsWith('//') ? volver : '/';
    } catch (err) {
      setError(limpiarError(err));
      setEntrando(false);
    }
  }

  return (
    <form onSubmit={entrar} className="tarjeta space-y-4">
      <Campo etiqueta="Correo" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-campo" />
      <Campo etiqueta="Contraseña" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} className="min-h-campo" />
      {error && (
        <p className="rounded border border-peligro/40 bg-peligro/10 px-3 py-2 text-peligro" role="alert">
          {error}
        </p>
      )}
      <Boton type="submit" variante="primario" icono={LogIn} campo ancho cargando={entrando}>
        Ingresar
      </Boton>
    </form>
  );
}

export default function Login() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <p className="text-2xl font-bold text-primario">DH1</p>
        <p className="text-suave">Mantenimiento · Mejores Hospitales</p>
      </div>
      <Suspense fallback={<div className="esqueleto h-64" />}>
        <Formulario />
      </Suspense>
      <p className="text-center text-sm text-suave">Si no tenés usuario o no recordás la contraseña, pedísela al administrador.</p>
    </main>
  );
}
