import { defineConfig } from "vite";

// Relative base: GitHub Pages serves the site under /actual-gameplay/.
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  test: { include: ["tests/**/*.test.ts"] },
});
