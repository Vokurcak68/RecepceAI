import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Admin běží na 5174 a přes proxy volá API na 4000.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // poslouchej na všech rozhraních → dostupné i přes http://192.168.0.54:5174
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
