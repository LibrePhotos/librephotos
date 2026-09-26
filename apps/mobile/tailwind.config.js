/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // LibrePhotos-ish accent; tweak alongside src/theme.
        brand: {
          DEFAULT: "#208AEF",
          dark: "#1769c4",
        },
      },
    },
  },
  plugins: [],
};
