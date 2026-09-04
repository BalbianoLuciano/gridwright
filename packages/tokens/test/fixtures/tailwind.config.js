import typography from '@tailwindcss/typography'
import plugin from 'tailwindcss/plugin.js'

const withOpacity = (name, fallback) => `rgb(var(--sf-${name}, ${fallback}) / <alpha-value>)`

export default {
  content: ['./**/*.html'],
  theme: {
    extend: {
      colors: {
        primary: {
          500: '#008599',
          900: '#003841',
        },
        neutral: {
          50: '#f8f7f7',
          900: '#1a1a1a',
        },
        // Computed: exists, but cannot be compared by ΔE.
        accent: withOpacity('accent', '255 90 60'),
      },
      spacing: {
        4: '16px',
        8: '32px',
        14: '56px',
      },
      borderRadius: {
        card: '16px',
      },
      fontSize: {
        display: ['48px', { lineHeight: '56px' }],
      },
    },
  },
  plugins: [typography, plugin(() => {})],
}
