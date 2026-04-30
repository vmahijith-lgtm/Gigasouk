// tailwind.config.ts — GigaSouk Tailwind Configuration
// Brand colours are defined here once and used everywhere.
// To change the brand green: update 'brand' below. Done.
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand:   { DEFAULT: "#00E5A0", dark: "#00B87A", light: "#EEFAF5" },
        surface: { DEFAULT: "#0C1018", card: "#111826", border: "#1A2230" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
