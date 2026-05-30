// Připojení k WhatsAppu jako propojené zařízení (whatsapp-web.js).
// Session se ukládá do .wwebjs_auth → po restartu se znovu přihlásí sám.
// Pozn.: neoficiální (automatizuje WhatsApp Web přes headless Chrome).
import { Client, LocalAuth } from "whatsapp-web.js";
import path from "node:path";

export type WaState = "off" | "loading" | "qr" | "authenticated" | "ready" | "disconnected" | "error";

let client: Client | null = null;
let state: WaState = "off";
let lastQr: string | null = null;
let lastError = "";

const CHROME = process.env.CHROME_PATH || "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

export function initWhatsApp() {
  if (client || process.env.WHATSAPP_ENABLED === "false") return;
  state = "loading";
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(process.cwd(), ".wwebjs_auth") }),
    puppeteer: { headless: true, executablePath: CHROME, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
  });
  client.on("qr", (q) => { lastQr = q; state = "qr"; console.log("📱 WhatsApp: naskenuj QR v adminu (Centrála → WhatsApp) pro propojení."); });
  client.on("authenticated", () => { state = "authenticated"; });
  client.on("ready", () => { state = "ready"; lastQr = null; console.log("✅ WhatsApp připojen."); });
  client.on("disconnected", () => { state = "disconnected"; lastQr = null; });
  client.initialize().catch((e) => { state = "error"; lastError = String((e as Error)?.message || e); console.error("WhatsApp init error:", lastError); });
}

export function whatsappStatus() {
  return { state, qr: lastQr, error: lastError || undefined };
}

/** Pošle WhatsApp zprávu na číslo (mezinárodní formát, jen číslice, např. 420724239572). */
export async function sendWhatsApp(number: string, text: string) {
  if (!client || state !== "ready") throw new Error(`WhatsApp není připojen (stav: ${state}).`);
  const id = number.replace(/[^0-9]/g, "") + "@c.us";
  return client.sendMessage(id, text);
}
