import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Sesión y redirecciones. Refresca el token en cada navegación y manda al login a quien no tiene sesión.
// Esto es comodidad de navegación, no seguridad: lo que un usuario puede ver lo decide la RLS de la base.
export async function middleware(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return respuesta;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        respuesta = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => respuesta.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const ruta = request.nextUrl.pathname;
  const enLogin = ruta === '/login';
  // La entrada y el portal del operario son cáscaras sin datos que el service worker guarda para abrir
  // sin señal. No se redirigen desde el servidor (quedaría guardado el login en su lugar): si no hay
  // sesión, ellas mismas mandan al ingreso.
  const abreSinSenal = ruta === '/' || ruta === '/mis-ots';

  if (!data.user && !enLogin && !abreSinSenal) {
    const destino = request.nextUrl.clone();
    destino.pathname = '/login';
    destino.search = '';
    // Para volver a donde iba (por ejemplo, al QR que escaneó) después de ingresar.
    const volver = ruta + request.nextUrl.search;
    if (volver !== '/') destino.searchParams.set('volver', volver);
    return NextResponse.redirect(destino);
  }
  if (data.user && enLogin) {
    const destino = request.nextUrl.clone();
    destino.pathname = '/';
    destino.search = '';
    return NextResponse.redirect(destino);
  }
  return respuesta;
}

export const config = {
  // Todo menos los archivos estáticos, el service worker y la página sin conexión.
  matcher: ['/((?!_next/static|_next/image|icons/|manifest.json|sw.js|workbox-|swe-worker-|fallback-|~offline|favicon.ico).*)'],
};
