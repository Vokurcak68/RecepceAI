import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import fs from "node:fs";
import path from "node:path";

// Kiosek běží přes HTTPS (kvůli povolení kamery/mikrofonu v zabezpečeném
// kontextu) a přes proxy volá rezervační API na 4000.
//
// HTTPS používá vlastní self-signed cert z ./certs (má SAN s localhost,
// 127.0.0.1 i LAN IP 192.168.0.54 — bez SAN prohlížeče přístup přes IP
// odmítnou). Cert se generuje openssl příkazem, viz certs/README.
const certDir = path.resolve(__dirname, "certs");
const hasRealCert = fs.existsSync(path.join(certDir, "cert.pem"));
const httpsConfig = hasRealCert
  ? { key: fs.readFileSync(path.join(certDir, "key.pem")), cert: fs.readFileSync(path.join(certDir, "cert.pem")) }
  : true; // bez reálného certu → basic-ssl plugin vygeneruje self-signed (jen pro localhost)

export default defineConfig({
  // basic-ssl si vygeneruje funkční self-signed cert, když nemáme vlastní v ./certs
  plugins: [react(), ...(hasRealCert ? [] : [basicSsl()])],
  server: {
    host: true, // naslouchá na všech rozhraních (0.0.0.0) → přístup z jiného PC v síti / přes VPN
    port: 5174, // POZOR: jiný port než původní kiosek (5173) — testovací kopie s avatarem (cesta C)
    https: httpsConfig,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
