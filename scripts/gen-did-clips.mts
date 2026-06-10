// Generátor předrenderovaných klipů pevných (statických) vět pro avatarový kiosek.
// Cesta B: jednorázově vyrobí MP4 přes D-ID /talks ze stejné fotky Daniela a uloží
// je do kiosk-avatar/public/clips/ + manifest clips.json. Za běhu kiosku se pak
// tyhle věty jen přehrávají (0 kreditů). Dynamika (AI, jména) jede živým streamem.
//
// Spuštění z kořene projektu (tsx načte .env → DID_API_KEY/DID_SOURCE_URL/DID_VOICE_RATE):
//   npx tsx scripts/gen-did-clips.mts
// Idempotentní: přeskočí věty, jejichž text se nezměnil (hash v manifestu).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
// .env se tu nenačítá automaticky (na rozdíl od služby) → načti ručně kvůli DID_API_KEY apod.
try { process.loadEnvFile(path.resolve(".env")); } catch { /* .env nemusí existovat */ }
import { makeT } from "../kiosk-avatar/src/i18n";
import { renderTalk } from "../src/did";

// Pevné věty vyslovované v kiosku (klíče t()), které NEMAJÍ proměnnou část.
const KEYS = [
  "welcome", "escalateTitle", "assistantTitle", "identifyTitle", "regTitle",
  "thanksTitle", "coFolioTitle", "coIdentifyTitle", "guestTitle", "offerTitle", "searchStayTitle",
] as const;

const LANGS = ["cs"]; // dle rozhodnutí zatím jen čeština
const CLIP_VER = "3";  // bump → nové názvy souborů (obejde cache) + vynutí přegenerování
// volitelně přegeneruj jen vybrané klíče: CLIP_ONLY="welcome,searchStayTitle"
const ONLY = (process.env.CLIP_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

const outDir = path.resolve("kiosk-avatar/public/clips");
fs.mkdirSync(outDir, { recursive: true });
const manifestPath = path.join(outDir, "clips.json");
const manifest: Record<string, { lang: string; key: string; text: string; hash: string; file: string }> =
  fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};

let made = 0, skipped = 0;
for (const lang of LANGS) {
  const t = makeT(lang as Parameters<typeof makeT>[0]);
  for (const key of KEYS) {
    if (ONLY.length && !ONLY.includes(key)) continue; // přegeneruj jen vybrané
    const text = String(t(key as never)).trim();
    if (!text) continue;
    const hash = crypto.createHash("sha1").update(`${CLIP_VER}|${lang}|${text}`).digest("hex").slice(0, 10);
    const file = `${lang}-${key}-${hash}.mp4`;
    const mkey = `${lang}:${key}`;
    const prev = manifest[mkey];
    if (prev && prev.hash === hash && fs.existsSync(path.join(outDir, prev.file))) { console.log("skip ", mkey); skipped++; continue; }
    console.log("render", mkey, "→", text);
    const url = await renderTalk(text, lang);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(path.join(outDir, file), buf);
    // starý soubor (jiný hash) ukliď
    if (prev && prev.file !== file) { try { fs.unlinkSync(path.join(outDir, prev.file)); } catch { /* ignore */ } }
    manifest[mkey] = { lang, key, text, hash, file };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log("  saved", file, buf.length, "B");
    made++;
  }
}
console.log(`HOTOVO — vyrobeno ${made}, přeskočeno ${skipped}. Manifest: ${manifestPath}`);
