/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        patrika: {
          red: '#D71920',      // Rajasthan Patrika signature red
          reddark: '#A30E13',
          gold: '#C9A227',
          golddark: '#9C7C1A',
          ink: '#1A1011'
        }
      },
      fontFamily: {
        display: ['"Roboto"', 'Georgia', 'serif'],
        sans: ['"Roboto"', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,17,17,.04), 0 8px 24px -12px rgba(16,17,17,.18)'
      }
    }
  },
  plugins: []
}
