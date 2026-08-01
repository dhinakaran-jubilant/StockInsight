/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
      },
      colors: {
        'sidebar-dark': '#1C2434',
        'sidebar-hover': '#333A48',
        'body-gray': '#F1F5F9',
        'text-dim': '#64748B',
        'brand-blue': '#3C50E0',
        'success-green': '#10B981',
        'error-red': '#FB5454'
      }
    },
  },
  plugins: [],
}
