const colors = require('tailwindcss/colors');

module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx,html}'
  ],
  theme: {
    extend: {
      colors: {
        primary: '#ff7b1d',
        secondary: '#30475e',
        accent: '#f9c74f',
        muted: colors.gray,
        success: colors.emerald,
        danger: colors.red
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui']
      }
    }
  },
  plugins: [require('@tailwindcss/forms')]
};
