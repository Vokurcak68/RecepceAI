import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Portál hosta na 5175, proxy na API 4000.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175, proxy: { "/api": { target: "http://localhost:4000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } } },
});
