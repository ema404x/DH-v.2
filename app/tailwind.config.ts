import type { Config } from 'tailwindcss';

// Todos los colores salen de los tokens de app/globals.css.
// No hay colores escritos a mano en los componentes: si falta uno, se agrega el token.
const token = (nombre: string) => `hsl(var(--${nombre}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      fondo: token('fondo'),
      barra: token('barra'),
      superficie: token('superficie'),
      elevado: token('elevado'),
      borde: token('borde'),
      texto: token('texto'),
      suave: token('suave'),
      primario: token('primario'),
      'sobre-primario': token('sobre-primario'),
      exito: token('exito'),
      alerta: token('alerta'),
      peligro: token('peligro'),
      info: token('info'),
      papel: token('papel'),
      tinta: token('tinta'),
    },
    // Escala de texto: base 16 px. El tamaño más chico que existe es 14 px.
    fontSize: {
      xs: ['0.875rem', { lineHeight: '1.25rem' }],
      sm: ['0.9375rem', { lineHeight: '1.375rem' }],
      base: ['1rem', { lineHeight: '1.5rem' }],
      lg: ['1.125rem', { lineHeight: '1.625rem' }],
      xl: ['1.375rem', { lineHeight: '1.75rem' }],
      '2xl': ['1.75rem', { lineHeight: '2.125rem' }],
    },
    extend: {
      fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
      borderRadius: { DEFAULT: '0.625rem', lg: '0.875rem' },
      // Controles: 44 px como mínimo, 48 px en las pantallas de campo.
      minHeight: { control: '2.75rem', campo: '3rem' },
      minWidth: { control: '2.75rem', campo: '3rem' },
    },
  },
  plugins: [],
};

export default config;
