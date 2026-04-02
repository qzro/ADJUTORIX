/** @type {import("tailwindcss").Config} */
module.exports = {
  content: [
    "./src/renderer/**/*.{ts,tsx,js,jsx,html}",
    "./src/preload/**/*.{ts,tsx,js,jsx}",
    "./src/shared/**/*.{ts,tsx,js,jsx}",
    "./src/types/**/*.{ts,tsx,js,jsx}",
    "./scripts/**/*.{js,mjs,cjs,ts}",
    "./.adjutorix.renderer.entry.html"
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
