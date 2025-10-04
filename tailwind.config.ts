import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html",
    "./admin.html",
    "./pages/**/*.{html,htm}",
    "./scripts/**/*.{js,ts}",
    "./src/**/*.{ts,tsx,js,jsx}"
  ],
  theme: {
    extend: {
      borderRadius: {
        "2xl": "1.25rem"
      }
    }
  },
  plugins: []
} satisfies Config;
