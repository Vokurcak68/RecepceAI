// Hlasová laboratoř: vyrobí stejnou větu v několika variantách intonace přes D-ID
// a vygeneruje stránku /voicetest/ na poslech a výběr.
//   npx tsx scripts/gen-voice-tests.mts
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
try { process.loadEnvFile(path.resolve(".env")); } catch { /* */ }
import { renderCustom } from "../src/did";

const PHRASE = "Dobrý den, vítejte. Jak vám mohu pomoci?";
const PRE = "Dobrý den, vítejte. ";        // oznamovací část
const Q = "Jak vám mohu pomoci?";          // tázací část
const AN = "cs-CZ-AntoninNeural";          // mužský
const VL = "cs-CZ-VlastaNeural";           // ženský

// rate kolem tázací věty řešíme obalením celé promluvy <prosody rate>
const wrap = (rate: string, inner: string) => `<prosody rate="${rate}">${inner}</prosody>`;

const QD = "Jak vám mohu pomoci.";        // tázací část s TEČKOU → klesavá (oznamovací) intonace
type Variant = { id: string; label: string; input: string; ssml: boolean; voiceId?: string };
// 2. kolo: mužský Antonín s KLESAVÝM koncem (doplňovací otázka klesá) + Vlasta jako reference.
const VARIANTS: Variant[] = [
  { id: "M1", label: "M1 — Antonín, TEČKA místo otazníku (klesavě)", ssml: false, voiceId: AN, input: "Dobrý den, vítejte. Jak vám mohu pomoci." },
  { id: "M2", label: "M2 — Antonín, tečka + rychlost 0.92", ssml: true, voiceId: AN, input: wrap("0.92", `${PRE}${QD}`) },
  { id: "M3", label: "M3 — Antonín, contour klesavý jemný", ssml: true, voiceId: AN, input: wrap("0.92", `${PRE}<prosody contour="(0%,+0%) (55%,+6%) (100%,-22%)">${Q}</prosody>`) },
  { id: "M4", label: "M4 — Antonín, contour klesavý silnější", ssml: true, voiceId: AN, input: wrap("0.92", `${PRE}<prosody contour="(0%,+0%) (50%,+8%) (100%,-40%)">${Q}</prosody>`) },
  { id: "M5", label: "M5 — Antonín, pitch dolů na „pomoci“", ssml: true, voiceId: AN, input: wrap("0.92", `${PRE}Jak vám mohu <prosody pitch="-16%">pomoci?</prosody>`) },
  { id: "M6", label: "M6 — Antonín, default s otazníkem (pro srovnání)", ssml: false, voiceId: AN, input: PHRASE },
  { id: "REF", label: "REF — Vlasta (ženský, perfektní – jen reference)", ssml: false, voiceId: VL, input: PHRASE },
];

const outDir = path.resolve("kiosk-avatar/public/voicetest");
fs.rmSync(outDir, { recursive: true, force: true }); // úklid starého kola
fs.mkdirSync(outDir, { recursive: true });

const done: { id: string; label: string; file: string }[] = [];
for (const v of VARIANTS) {
  const file = `${v.id}.mp4`;
  try {
    console.log("render", v.id, v.label);
    const url = await renderCustom({ input: v.input, ssml: v.ssml, voiceId: v.voiceId });
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(path.join(outDir, file), buf);
    console.log("  saved", file, buf.length, "B");
    done.push({ id: v.id, label: v.label, file });
  } catch (e) {
    console.warn("  CHYBA", v.id, String(e));
  }
}

const cards = done.map((d) => `
  <div class="card">
    <div class="lbl">${d.label}</div>
    <video src="${d.file}?t=${Date.now()}" controls preload="metadata" width="260"></video>
  </div>`).join("");
const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hlasová laboratoř — intonace</title>
<style>
 body{font-family:Segoe UI,system-ui,sans-serif;background:#0b1020;color:#eaf0ff;margin:0;padding:24px}
 h1{font-size:22px} p{color:#93a0c4}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:18px}
 .card{background:#161d33;border:1px solid #28324f;border-radius:14px;padding:14px}
 .lbl{font-weight:600;margin-bottom:10px}
 video{border-radius:10px;background:#000;width:100%}
</style></head><body>
 <h1>🎙️ Hlasová laboratoř — výběr intonace</h1>
 <p>Věta: „${PHRASE}“ &nbsp;·&nbsp; přehraj jednotlivé varianty a napiš mi písmeno, které ti zní nejlíp (klidně i „mezi C a E“ — doladím).</p>
 <div class="grid">${cards}</div>
</body></html>`;
fs.writeFileSync(path.join(outDir, "index.html"), html);
console.log(`HOTOVO — ${done.length} variant. Stránka: ${path.join(outDir, "index.html")}`);
