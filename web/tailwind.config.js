/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0E2233',   // deep navy — rails, headers, the club's colour
          700: '#183449',
          600: '#26485F',
          400: '#5A7080',
          200: '#9DAEBB',
        },
        canvas: '#F4F6F8',
        line: '#DFE5EA',
        gold: {
          DEFAULT: '#C8952F',   // medal gold — awards, ratings, the accent
          soft: '#F5E9D0',
          dark: '#9A700F',
        },
        pitch: '#0F766E',       // data teal
        alert: '#C4453B',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'Oswald', 'Impact', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(14,34,51,0.06), 0 4px 12px rgba(14,34,51,0.04)',
        lift: '0 8px 28px rgba(14,34,51,0.12)',
      },
      borderRadius: { xl: '0.75rem' },
    },
  },
  plugins: [],
};
