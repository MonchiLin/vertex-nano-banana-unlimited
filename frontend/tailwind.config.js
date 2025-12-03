/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Banana yellow accent
        banana: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FDE047', // Primary banana yellow
          500: '#EAB308',
          600: '#CA8A04',
          700: '#A16207',
          800: '#854D0E',
          900: '#713F12',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'marching-ants': 'marching-ants 0.5s linear infinite',
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        'marching-ants': {
          '0%': { 'stroke-dashoffset': '0' },
          '100%': { 'stroke-dashoffset': '10' },
        },
      },
      spacing: {
        '18': '4.5rem',
        '60': '15rem',
        '72': '18rem',
        '80': '20rem',
        '88': '22rem',
        '120': '30rem',
        '144': '36rem',
        '100': '25rem',
        '112': '28rem',
      },
    },
  },
  plugins: [],
};