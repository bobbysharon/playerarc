/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /* Surfaces — near-black base with slate panels above it */
        canvas: '#0D0D14',        // the page itself
        surface: {
          DEFAULT: '#0F172A',     // cards and panels
          raised: '#16203A',      // hover / nested panels
          sunken: '#0A0F1C',      // table headers, wells
        },
        line: {
          DEFAULT: '#1E293B',     // borders
          bright: '#2A3A52',      // hover borders
        },

        /* Text — a light scale, so text-ink reads as the primary colour */
        ink: {
          DEFAULT: '#F8FAFC',
          700: '#E2E8F0',
          600: '#CBD5E1',
          400: '#94A3B8',
          200: '#7A8AA0',
        },

        /* Signature amber to orange. Everything primary uses this gradient. */
        gold: {
          DEFAULT: '#F59E0B',
          dark: '#EA580C',
          soft: '#3A2A10',        // tinted panel behind gold text
          glow: '#FBBF24',
        },

        /* Accents. Each sport also carries its own colour from the database. */
        pitch: '#10B981',         // success, positive movement
        alert: '#F43F5E',         // errors, cards, losses
        sky: '#38BDF8',           // links, information
        violet: '#A78BFA',
        fuchsia: '#D946EF',
        cyan: '#06B6D4',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'Oswald', 'Impact', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      backgroundImage: {
        'gold-grad': 'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)',
        'gold-grad-soft': 'linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(234,88,12,0.18) 100%)',
        'surface-grad': 'linear-gradient(160deg, #16203A 0%, #0F172A 60%)',
        aurora: 'radial-gradient(60% 50% at 15% 0%, rgba(245,158,11,0.16) 0%, transparent 70%), radial-gradient(50% 45% at 90% 5%, rgba(167,139,250,0.13) 0%, transparent 70%)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.28)',
        lift: '0 12px 36px rgba(0,0,0,0.5)',
        glow: '0 0 0 1px rgba(245,158,11,0.35), 0 8px 28px rgba(245,158,11,0.22)',
        'glow-sm': '0 0 18px rgba(245,158,11,0.28)',
      },
      borderRadius: { xl: '0.85rem' },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: { 'fade-up': 'fade-up 0.28s ease-out both' },
    },
  },
  plugins: [],
};
