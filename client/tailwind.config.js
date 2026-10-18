/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#14243A',
        teal: { DEFAULT: '#0D9488', dark: '#0B7A70' },
        canvas: '#F5F7FA',
        ink: '#334155',
        muted: '#64748B',
        line: '#E2E8F0',
        success: '#15803D',
        info: '#2563EB',
        warn: '#B45309',
        danger: '#B91C1C',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
