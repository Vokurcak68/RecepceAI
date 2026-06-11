// D-ID Talks Streams — real-time „digital human" avatar (cesta C) pro kiosek.
//
// Princip: backend drží API klíč (NIKDY nejde do prohlížeče) a jen proxuje
// signaling (create / SDP / ICE / talk / close) na api.d-id.com. Vlastní
// audio+video stream už teče přímo mezi prohlížečem a D-ID přes WebRTC.
//
// Konfigurace v kořenovém .env:
//   DID_API_KEY     = <klíč z D-ID studia>   (povinné; bez něj je avatar vypnutý)
//   DID_SOURCE_URL  = veřejná URL fotky, ze které se animuje mluvící hlava
//                     (D-ID si ji stahuje z internetu — musí být veřejně dostupná).
//                     Default: fotka recepčního na admin hostu.
//   DID_API_URL     = override base URL (default https://api.d-id.com)
//
// Pozn.: klíč z D-ID bývá ve tvaru "email:apikey" → posíláme jako Basic
// (base64). Když už je to hotový base64 token (bez ':'), použijeme ho rovnou.

const API_URL = () => process.env.DID_API_URL || "https://api.d-id.com";

export const DID_SOURCE_URL = () =>
  process.env.DID_SOURCE_URL || "https://admin.recepceai.cz/reception-daniel-2.jpg";

export function isDidConfigured(): boolean {
  return !!(process.env.DID_API_KEY && process.env.DID_API_KEY.trim());
}

function authHeader(): string {
  const key = (process.env.DID_API_KEY || "").trim();
  // "email:apikey" → zakóduj do base64; jinak ber jako hotový token
  const token = key.includes(":") ? Buffer.from(key).toString("base64") : key;
  return `Basic ${token}`;
}

/** Mužský microsoft hlas (Daniel) pro jednotlivé jazyky kiosku; fallback EN. */
const VOICE: Record<string, string> = {
  cs: "cs-CZ-AntoninNeural",
  en: "en-US-GuyNeural",
  de: "de-DE-ConradNeural",
  ru: "ru-RU-DmitryNeural",
  uk: "uk-UA-OstapNeural",
  pl: "pl-PL-MarekNeural",
  sk: "sk-SK-LukasNeural",
  it: "it-IT-DiegoNeural",
  fr: "fr-FR-HenriNeural",
  es: "es-ES-AlvaroNeural",
  zh: "zh-CN-YunxiNeural",
};
export const voiceFor = (lang: string) => VOICE[lang] || VOICE.en;

// Rychlost řeči (microsoft voice_config.rate): 1 = normál, <1 pomaleji. Lze přebít přes .env.
const SPEECH_RATE = () => process.env.DID_VOICE_RATE || "0.9";

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Doplňovací otázky (Jak/Kde/Kdy/Co/Jaký…) mají v češtině KLESAVOU intonaci.
// Neural hlas je ale s „?" čte stoupavě (nepřirozeně) → nahradíme „?" tečkou,
// pak větu přečte oznamovacím (klesavým) tónem. Zjišťovací otázky (Máte…?) necháme „?".
const WH_Q = new RegExp(
  "\\b(" + [
    // cs
    "jak", "jakpak", "kde", "kdepak", "kam", "odkud", "kudy", "kdy", "dokdy", "odkdy", "kdo", "kdopak", "co", "copak", "čí", "čeho", "čemu", "čím", "čem", "kolik", "kolikátý", "proč", "nač", "jaký", "jaká", "jaké", "jací", "jakou", "jakého", "jakém", "který", "která", "které", "kterou", "kterého", "kterém",
    // en
    "how", "where", "when", "what", "who", "whom", "whose", "which", "why",
    // de
    "wie", "wo", "wann", "was", "wer", "wen", "wem", "wessen", "welche", "welcher", "welches", "welchen", "warum", "wieso", "weshalb", "wieviel",
    // pl
    "gdzie", "kiedy", "kto", "czyj", "ile", "dlaczego", "jaki", "jaka", "jakie", "który", "która", "które",
    // sk
    "ako", "kedy", "čo", "kto", "koľko", "prečo", "aký", "aká", "aké", "ktorý", "ktorá", "ktoré",
    // it
    "come", "dove", "quando", "cosa", "che", "chi", "quale", "quali", "quanto", "quanti", "perché",
    // fr
    "comment", "où", "quand", "que", "qui", "quel", "quelle", "quels", "quelles", "combien", "pourquoi",
    // es
    "cómo", "dónde", "cuándo", "qué", "quién", "cuál", "cuánto", "cuánta", "por qué",
    // uk (cyrilice)
    "як", "де", "коли", "куди", "звідки", "що", "хто", "чий", "скільки", "чому", "який", "яка", "яке",
  ].join("|") + ")\\b",
  "i",
);

/** Text → SSML: doplňovacím otázkám vnutí klesavou intonaci (přes „.") + nastaví rychlost. */
function toSsml(text: string): string {
  const parts = text.match(/[^.!?…]+[.!?…]*/g) ?? [text];
  const body = parts.map((p) => {
    let s = p.trim();
    if (!s) return "";
    if (s.endsWith("?") && WH_Q.test(s)) s = s.slice(0, -1).replace(/\s+$/, "") + ".";
    return escXml(s);
  }).join(" ");
  return `<prosody rate="${SPEECH_RATE()}">${body}</prosody>`;
}

async function didFetch(path: string, init: RequestInit): Promise<unknown> {
  const r = await fetch(API_URL() + path, {
    ...init,
    headers: { Authorization: authHeader(), "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await r.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) {
    const msg = (body && typeof body === "object" && "description" in body && (body as { description?: string }).description)
      || (typeof body === "string" ? body : `D-ID ${r.status}`);
    throw Object.assign(new Error(String(msg)), { status: r.status });
  }
  return body;
}

/** Vytvoří nový stream → vrátí {id, session_id, offer (SDP), ice_servers}.
 *  stream_warmup: D-ID pošle krátký „rozehřívací" idle, aby první vyslovená
 *  věta nebyla rozhozená (lépe sesynchronizované rty se zvukem na začátku). */
export function createStream() {
  return didFetch("/talks/streams", {
    method: "POST",
    body: JSON.stringify({ source_url: DID_SOURCE_URL(), stream_warmup: true }),
  });
}

/** Předá SDP answer z prohlížeče. */
export function sendSdp(id: string, answer: unknown, sessionId: string) {
  return didFetch(`/talks/streams/${id}/sdp`, {
    method: "POST",
    body: JSON.stringify({ answer, session_id: sessionId }),
  });
}

/** Předá ICE kandidáta z prohlížeče. */
export function sendIce(id: string, candidate: Record<string, unknown>, sessionId: string) {
  return didFetch(`/talks/streams/${id}/ice`, {
    method: "POST",
    body: JSON.stringify({ ...candidate, session_id: sessionId }),
  });
}

/** Nechá avatara vyslovit text (D-ID si sám udělá TTS daným hlasem). */
export function sendTalk(id: string, sessionId: string, text: string, lang: string) {
  return didFetch(`/talks/streams/${id}`, {
    method: "POST",
    body: JSON.stringify({
      script: { type: "text", ssml: true, provider: { type: "microsoft", voice_id: voiceFor(lang) }, input: toSsml(text.slice(0, 2000)) },
      session_id: sessionId,
      config: { stitch: true },
    }),
  });
}

/** Zavře stream (uvolní minuty). */
export function closeStream(id: string, sessionId: string) {
  return didFetch(`/talks/streams/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ session_id: sessionId }),
  });
}

async function pollTalk(id: string): Promise<string> {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const t = await didFetch(`/talks/${id}`, { method: "GET" }) as { status: string; result_url?: string };
    if (t.status === "done" && t.result_url) return t.result_url;
    if (t.status === "error" || t.status === "rejected") throw new Error("D-ID render selhal: " + JSON.stringify(t));
  }
  throw new Error("D-ID render timeout (id=" + id + ")");
}

/** Předrenderování (NE stream): vyrobí hotové MP4 z fotky + textu a vrátí dočasnou result_url.
 *  Použito generátorem klipů pevných vět (cesta B) — jednorázově, ať za běhu nestojí kredity. */
export async function renderTalk(text: string, lang: string): Promise<string> {
  const created = await didFetch("/talks", {
    method: "POST",
    body: JSON.stringify({
      source_url: DID_SOURCE_URL(),
      script: { type: "text", ssml: true, provider: { type: "microsoft", voice_id: voiceFor(lang) }, input: toSsml(text.slice(0, 2000)) },
      config: { stitch: true },
    }),
  }) as { id: string };
  return pollTalk(created.id);
}

/** Render s plně vlastním SSML/hlasem — pro testování intonace (hlasová laboratoř). */
export async function renderCustom(opts: { input: string; ssml: boolean; voiceId?: string }): Promise<string> {
  const created = await didFetch("/talks", {
    method: "POST",
    body: JSON.stringify({
      source_url: DID_SOURCE_URL(),
      script: { type: "text", ssml: opts.ssml, provider: { type: "microsoft", voice_id: opts.voiceId || voiceFor("cs") }, input: opts.input },
      config: { stitch: true },
    }),
  }) as { id: string };
  return pollTalk(created.id);
}
