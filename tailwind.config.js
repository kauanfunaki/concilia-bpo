/** @type {import('tailwindcss').Config} */
export default {
  // Tema escuro pela classe "dark" no <html>, trocada pelo botão do cabeçalho
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
