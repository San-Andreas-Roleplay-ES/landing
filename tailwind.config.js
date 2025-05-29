// tailwind.config.js
module.exports = {
    content: [
      "./src/**/*.{astro,html,js,ts,jsx,tsx}", // ajusta según tu estructura
    ],
    theme: {
      extend: {
        colors: {
          primary: "#fcaf17",
          secondary: "#9333EA",
          danger: "#DC2626",
          success: "#16A34A"
        },
      },
    },
    plugins: [],
  }