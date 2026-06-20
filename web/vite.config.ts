import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// `defineConfig` from vitest/config is a superset of vite's — the same file
// drives `vite build`, `vite dev`, and `vitest run`. Tailwind v4 + HeroUI v3.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Proxy REST + artifacts to the server so the UI can call /v1/control etc.
  // same-origin in dev.
  server: { port: 5173, proxy: { "/v1": "http://localhost:8402", "/artifacts": "http://localhost:8402" } },
  test: {
    environment: "node", // reducer tests are pure state transitions
    include: ["src/**/*.test.ts"],
  },
});
