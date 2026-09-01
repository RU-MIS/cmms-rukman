import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          DEFAULT: '#0f2c42',
          hover: '#173d59',
          active: '#1d4e70',
          border: '#1c4059',
        },
        app: {
          bg: '#eef4f8',
        },
        card: {
          DEFAULT: '#ffffff',
          border: '#dfe8ef',
        },
        brand: {
          50: '#eaf4f8',
          100: '#cfe6ee',
          200: '#a3cfdf',
          300: '#71b3cb',
          400: '#3f92ac',
          500: '#227794',
          600: '#155e79',
          700: '#124a60',
          800: '#0f2c42',
          900: '#0a1f2f',
        },
        ink: {
          DEFAULT: '#1e2b36',
          muted: '#5b7186',
          faint: '#8fa3b3',
        },
        success: { DEFAULT: '#2f9e6e', bg: '#e6f5ee' },
        warning: { DEFAULT: '#c9862f', bg: '#fbf0e0' },
        danger: { DEFAULT: '#c94f4f', bg: '#fbe9e9' },
        info: { DEFAULT: '#2f7fc9', bg: '#e7f1fb' },
      },
      borderRadius: {
        card: '10px',
        pill: '999px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 44, 66, 0.06), 0 1px 1px rgba(15, 44, 66, 0.04)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
