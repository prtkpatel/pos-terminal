/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#10b981", // Emerald 500
        slate: {
          950: "#020617",
          900: "#0f172a",
          800: "#1e293b",
        }
      },
    },
  },
  plugins: [],
}
