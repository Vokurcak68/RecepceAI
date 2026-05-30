import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Admin běží na 5174 a přes proxy volá API na 4000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
