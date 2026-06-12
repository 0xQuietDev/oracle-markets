import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `defineConfig` from vitest/config is a superset of vite's — the same file
// drives `vite build`, `vite dev`, and `vitest run`.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: "node", // reducer tests are pure state transitions
    include: ["src/**/*.test.ts"],
  },
});
