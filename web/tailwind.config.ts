import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f4f7fb',
          100: '#e6edf5',
          200: '#c9d8ea',
          300: '#9db8d8',
          400: '#6d93c2',
          500: '#4a75a8',
          600: '#3a5d8f',
          700: '#304b73',
          800: '#2b405f',
          900: '#0f2438',
          950: '#0a1826',
        },
      },
      fontFamily: {
        sans: ['var(--font-vazir)', 'Vazirmatn', 'Tahoma', 'sans-serif'],
      },
      boxShadow: {
        card: '0 2px 12px rgba(15, 36, 56, 0.08)',
        sticky: '0 -6px 24px rgba(15, 36, 56, 0.14)',
      },
    },
  },
  plugins: [],
};

export default config;
