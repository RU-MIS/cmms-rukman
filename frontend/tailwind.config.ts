import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0E2F76',
          dark:    '#071E52',
          mid:     '#AAC0E1',
          tint:    '#D4E4F7',
          light:   '#F5FEFF',
        },
        text: {
          primary:   '#0A1F4E',
          secondary: '#3A5A8A',
          muted:     '#7A9CC0',
        },
        border: {
          DEFAULT: '#D4E4F7',
          strong:  '#AAC0E1',
        },
        success: '#16A34A',
        warning: '#D97706',
        danger:  '#DC2626',
        info:    '#0369A1',
        surface: {
          app:  '#F5FEFF',
          card: '#FFFFFF',
        },
      },
      fontFamily: {
        sans:    ['Inter', 'sans-serif'],
        display: ['Poppins', 'sans-serif'],
      },
      borderRadius: {
        sm:   '4px',
        md:   '8px',
        card: '12px',
        lg:   '16px',
        xl:   '20px',
      },
      boxShadow: {
        card:  '0 1px 3px rgba(14, 47, 118, 0.08)',
        modal: '0 8px 32px rgba(14, 47, 118, 0.15)',
      },
      animation: {
        'fade-in':  'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(10px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [],
}

export default config
