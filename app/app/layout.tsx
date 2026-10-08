import type { Metadata, Viewport } from 'next';
import { Figtree, Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { Proveedores } from './proveedores';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Tipografía del dashboard (estilo Apple).
const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', display: 'swap' });

export const metadata: Metadata = {
  title: 'DH1 — Mantenimiento',
  description: 'Órdenes de trabajo, activos y certificación de mantenimiento.',
  manifest: '/manifest.json',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, title: 'DH1', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Se puede hacer zoom: hay operarios que lo necesitan para leer.
  themeColor: '#121922',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR" className={`${inter.variable} ${figtree.variable}`}>
      <body>
        <Proveedores>{children}</Proveedores>
      </body>
    </html>
  );
}
