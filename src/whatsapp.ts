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
  const ts = () => new Date().toISOString();
  client.on("qr", (q) => { lastQr = q; state = "qr"; console.log(`📱 [wa ${ts()}] QR — naskenuj v adminu (Centrála → WhatsApp).`); });
  client.on("loading_screen", (percent, message) => console.log(`⏳ [wa ${ts()}] loading ${percent}% ${message ?? ""}`));
  client.on("authenticated", () => {
    state = "authenticated"; console.log(`🔐 [wa ${ts()}] authenticated`);
    // Pojistka: po OBNOVĚ session whatsapp-web.js občas nevystřelí 'ready' (čerstvý QR
    // ho vystřelí, restore ne). Ověřujeme proto reálný stav spojení — jakmile je
    // CONNECTED, považujeme klienta za použitelný i bez 'ready' eventu.
    let tries = 0;
    const iv = setInterval(async () => {
      tries++;
      if (state === "ready" || !client || tries > 10) { clearInterval(iv); return; }
      try {
        const ws = await client.getState();
        console.log(`🩺 [wa ${ts()}] check#${tries} getState=${ws}`);
        if (ws === "CONNECTED") { state = "ready"; lastQr = null; clearInterval(iv); console.log(`✅ [wa ${ts()}] ready (dle getState, obejití restore-stallu)`); }
      } catch (e) { console.log(`🩺 [wa ${ts()}] check#${tries} getState err: ${(e as Error)?.message}`); }
    }, 10000);
  });
  client.on("change_state", (s) => console.log(`🔄 [wa ${ts()}] change_state=${s}`));
  client.on("auth_failure", (m) => { state = "error"; lastError = String(m); console.log(`❌ [wa ${ts()}] auth_failure: ${m}`); });
  client.on("ready", () => { state = "ready"; lastQr = null; console.log(`✅ [wa ${ts()}] ready — WhatsApp připojen.`); });
  client.on("disconnected", (r) => { state = "disconnected"; lastQr = null; console.log(`🔌 [wa ${ts()}] disconnected: ${r}`); });
  console.log(`🚀 [wa ${ts()}] initialize()…`);
  client.initialize().catch((e) => { state = "error"; lastError = String((e as Error)?.message || e); console.error(`WhatsApp init error [${ts()}]:`, lastError); });
}

export function whatsappStatus() {
  return { state, qr: lastQr, error: lastError || undefined };
}

/** Čisté ukončení — zavře headless Chrome, aby se profil v .wwebjs_auth uložil
 * a neuzamkl. NUTNÉ volat při zastavení služby, jinak se session po restartu
 * neobnoví (vyžadovala by nové naskenování QR / odebrání zařízení). */
export async function destroyWhatsApp() {
  if (!client) return;
  try { await client.destroy(); } catch (e) { console.error("WhatsApp destroy error:", (e as Error)?.message); }
  client = null;
  state = "off";
}

/** Pošle WhatsApp zprávu na číslo (mezinárodní formát, jen číslice, např. 420724239572). */
export async function sendWhatsApp(number: string, text: string) {
  if (!client || state !== "ready") throw new Error(`WhatsApp není připojen (stav: ${state}).`);
  const id = number.replace(/[^0-9]/g, "") + "@c.us";
  return client.sendMessage(id, text);
}
