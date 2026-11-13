import { defineConfig } from "vite";

// Relative base: GitHub Pages serves the site under /actual-gameplay/.
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  // Physics tests play whole levels. Twenty seconds leaves room on a slow or busy machine.
  test: { include: ["tests/**/*.test.ts"], testTimeout: 20_000 },
});
