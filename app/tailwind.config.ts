import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Aspecto de la v1 (DH1 en Base44): paleta completa de Tailwind + los colores de shadcn
// (background, card, primary…) definidos en app/globals.css, igual que su tailwind.config.js.
// Los tokens propios de la v2 (fondo, superficie, primario…) siguen existiendo y apuntan a la misma paleta.
const token = (nombre: string) => `hsl(var(--${nombre}) / <alpha-value>)`;

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx,js,jsx}', './components/**/*.{ts,tsx,js,jsx}', './lib/**/*.{ts,tsx}', './hooks/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        inter: ['var(--font-inter)'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        // shadcn (v1)
        background: token('background'),
        foreground: token('foreground'),
        card: { DEFAULT: token('card'), foreground: token('card-foreground') },
        popover: { DEFAULT: token('popover'), foreground: token('popover-foreground') },
        primary: { DEFAULT: token('primary'), foreground: token('primary-foreground') },
        secondary: { DEFAULT: token('secondary'), foreground: token('secondary-foreground') },
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        destructive: { DEFAULT: token('destructive'), foreground: token('destructive-foreground') },
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        chart: { 1: token('chart-1'), 2: token('chart-2'), 3: token('chart-3'), 4: token('chart-4'), 5: token('chart-5') },
        sidebar: {
          DEFAULT: token('sidebar-background'),
          foreground: token('sidebar-foreground'),
          primary: token('sidebar-primary'),
          'primary-foreground': token('sidebar-primary-foreground'),
          accent: token('sidebar-accent'),
          'accent-foreground': token('sidebar-accent-foreground'),
          border: token('sidebar-border'),
          ring: token('sidebar-ring'),
        },
        // tokens de la v2
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
      // Controles: 44 px como mínimo, 48 px en las pantallas de campo.
      minHeight: { control: '2.75rem', campo: '3rem' },
      minWidth: { control: '2.75rem', campo: '3rem' },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        blink: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        aceroRise: { from: { opacity: '0', transform: 'translateY(13px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        aceroDrift: { '0%, 100%': { transform: 'translate3d(0, 0, 0)' }, '50%': { transform: 'translate3d(0, -5px, 0)' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        blink: 'blink 0.8s ease-in-out infinite',
        'acero-rise': 'aceroRise 0.55s cubic-bezier(0.2, 0.75, 0.25, 1) both',
        'acero-drift': 'aceroDrift 7s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
  safelist: [
    'tabular-nums',
    'border-l-slate-400', 'border-l-amber-400', 'border-l-blue-500', 'border-l-emerald-500', 'border-l-red-500',
  ],
};

export default config;
