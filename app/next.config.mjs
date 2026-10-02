import withPWAInit from '@ducanh2912/next-pwa';

// PWA con Workbox: el precache lo arma el build. No hay service worker escrito a mano.
// reloadOnOnline en false: al operario nunca se le recarga la pantalla sola (podría perder un reporte a medias).
const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  reloadOnOnline: false,
  cacheOnFrontEndNav: true,
  fallbacks: { document: '/~offline' },
  workboxOptions: {
    // El portal del operario queda guardado en el teléfono apenas se instala el service worker,
    // aunque todavía no se haya visitado: es lo que permite abrir la app y trabajar sin señal.
    additionalManifestEntries: [{ url: '/mis-ots', revision: String(Date.now()) }],
    // /mis-ots?ot=… y /mis-ots?ubicacion=… son la misma página guardada.
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^ot$/, /^ubicacion$/, /^activo$/, /^nombre$/],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // La raíz del proyecto es esta carpeta (hay otros package.json al lado: pruebas/).
  outputFileTracingRoot: import.meta.dirname,
};

export default withPWA(nextConfig);
