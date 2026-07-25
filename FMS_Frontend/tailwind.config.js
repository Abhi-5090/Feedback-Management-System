/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brand — Torii-gate vermilion. 50/100/500/600/700 are the exact values
        // from the toriiminds.com tokens; the remaining steps are interpolated
        // on the same hue so existing utilities (brand-200/300/400/800/900)
        // keep working without drifting off-brand.
        brand: {
          50: '#fef2ed', 100: '#fde2d6', 200: '#fac9b2', 300: '#f7a684',
          400: '#f28055', 500: '#ea5829', 600: '#d1471c', 700: '#ad3816',
          800: '#8a2d13', 900: '#6f2611',
        },
        // Semantic tokens driven by CSS variables (see index.css) so light/dark
        // is a single source of truth rather than dark: variants everywhere.
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
      },
      fontSize: {
        // Display sizes for hero metrics — tight tracking at large sizes, which
        // is what stops big numbers reading as "zoomed-in body text".
        'display-sm': ['2rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        display: ['2.75rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
        'display-lg': ['3.75rem', { lineHeight: '1', letterSpacing: '-0.035em', fontWeight: '700' }],
      },
      // Torii's radius scale — slightly tighter than Tailwind's defaults, which
      // is a large part of why their cards read as considered rather than soft.
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
        '4xl': '1.75rem',
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Layered shadows: a tight contact shadow + a soft ambient one. A single
        // large blur reads as a sticker; two layers read as depth. Strengthened
        // for light mode, where the previous values were too faint to separate a
        // white card from its background at all.
        // Torii's card shadows — a tight contact layer plus a long, soft
        // ambient one with a negative spread, which is what gives their cards
        // that lifted-but-not-heavy feel.
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(0 0 0 / 0.12)',
        'card-hover': '0 2px 4px rgb(0 0 0 / 0.06), 0 18px 40px -16px rgb(0 0 0 / 0.22)',
        pop: '0 8px 30px rgb(0 0 0 / 0.16), 0 2px 6px rgb(0 0 0 / 0.07)',
        brand: '0 1px 2px rgb(234 88 41 / 0.22), 0 4px 14px rgb(234 88 41 / 0.24)',
        'brand-hover': '0 2px 6px rgb(234 88 41 / 0.26), 0 10px 24px rgb(234 88 41 / 0.32)',
        inset: 'inset 0 1px 0 rgb(255 255 255 / 0.06)',
      },
      transitionTimingFunction: {
        // Strong curves — the CSS defaults lack the punch that reads intentional.
        'out-expo': 'cubic-bezier(0.23, 1, 0.32, 1)',
        'in-out-expo': 'cubic-bezier(0.77, 0, 0.175, 1)',
        drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: {
        press: '140ms',
        pop: '200ms',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        // Never from scale(0) — nothing in the real world appears from nothing.
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(16 185 129 / 0.5)' },
          '70%': { boxShadow: '0 0 0 6px rgb(16 185 129 / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(16 185 129 / 0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 380ms cubic-bezier(0.23, 1, 0.32, 1) both',
        'fade-in': 'fade-in 260ms ease both',
        'scale-in': 'scale-in 200ms cubic-bezier(0.23, 1, 0.32, 1) both',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.23, 1, 0.32, 1) infinite',
      },
    },
  },
  plugins: [],
};
