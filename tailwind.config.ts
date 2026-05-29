import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';

export default {
  content: ['./index.html', './src/client/**/*.{vue,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          50: '#ddf1e4',
          100: '#bfe8d9',
          200: '#87d3c3',
          300: '#5abdac',
          400: '#3aa99f',
          500: '#2f968d',
          600: '#24837b',
          700: '#1c6c66',
          800: '#164f4a',
          900: '#122f2c',
          950: '#101f1d'
        }
      },
      animation: {
        float: 'float 7s ease-in-out infinite'
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' }
        }
      }
    }
  },
  plugins: [forms]
} satisfies Config;
