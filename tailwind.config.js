import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    resolve(__dirname, './index.html'),
    resolve(__dirname, './src/**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: 'rgb(var(--color-bg-900) / <alpha-value>)',
          800: 'rgb(var(--color-bg-800) / <alpha-value>)',
          700: 'rgb(var(--color-bg-700) / <alpha-value>)',
          600: 'rgb(var(--color-bg-600) / <alpha-value>)',
          500: 'rgb(var(--color-bg-500) / <alpha-value>)',
          400: 'rgb(var(--color-bg-400) / <alpha-value>)',
        },
        accent: {
          DEFAULT: '#2962ff',
          hover: '#1e53e4',
          light: '#5c8aff',
          glow: 'rgba(41, 98, 255, 0.15)',
        },
        success: '#26a69a',
        danger: '#ef5350',
        warning: '#ff9800',
        txt: {
          primary: 'rgb(var(--color-txt-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-txt-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-txt-muted) / <alpha-value>)',
        },
        border: 'rgb(var(--color-border) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        'glow-sm': '0 0 10px -3px rgba(41, 98, 255, 0.3)',
        'glow': '0 0 20px -5px rgba(41, 98, 255, 0.4)',
        'glow-lg': '0 0 30px -5px rgba(41, 98, 255, 0.5)',
        'glow-success': '0 0 20px -5px rgba(38, 166, 154, 0.4)',
        'glow-danger': '0 0 20px -5px rgba(239, 83, 80, 0.4)',
        'depth': '0 4px 16px -4px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.03) inset',
        'depth-lg': '0 8px 32px -8px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
        'inner-glow': '0 0 0 1px rgba(255, 255, 255, 0.05) inset, 0 1px 0 0 rgba(255, 255, 255, 0.03) inset',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-accent': 'linear-gradient(135deg, #2962ff 0%, #1e88e5 50%, #2979ff 100%)',
        'gradient-accent-purple': 'linear-gradient(135deg, #2962ff 0%, #7c4dff 100%)',
        'gradient-dark': 'linear-gradient(180deg, rgb(var(--color-bg-800)) 0%, rgb(var(--color-bg-900)) 100%)',
      },
    },
  },
  plugins: [],
};
