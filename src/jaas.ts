// JaaS (Jitsi as a Service od 8x8) — podpis krátkodobého JWT pro videohovor.
//
// JaaS vyžaduje, aby se účastník připojil s tokenem podepsaným tvým privátním
// klíčem (RS256). Tím zmizí 5min limit i hláška veřejného meet.jit.si. Token
// podepisujeme tady na backendu (privátní klíč NIKDY nejde do prohlížeče).
//
// Konfigurace v .env:
//   JAAS_APP_ID       = vpaas-magic-cookie-xxxxxxxx   (App ID z JaaS konzole)
//   JAAS_KID          = vpaas-magic-cookie-xxxx/abc12 (API Key / „kid" z konzole)
//   JAAS_KEY_FILE     = ./jaas-key.pem                (stažený privátní klíč), NEBO
//   JAAS_PRIVATE_KEY  = "-----BEGIN PRIVATE KEY-----\n…"  (inline, \n jako escape)
import crypto from "crypto";
import fs from "fs";

function privateKey(): string | null {
  const inline = process.env.JAAS_PRIVATE_KEY;
  if (inline && inline.trim()) return inline.replace(/\\n/g, "\n");
  const file = process.env.JAAS_KEY_FILE;
  if (file && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  return null;
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function isJaasConfigured(): boolean {
  return !!(process.env.JAAS_APP_ID && process.env.JAAS_KID && privateKey());
}

/** Podepíše JaaS JWT (moderátor, platnost 2 h). room "*" = platí pro libovolnou místnost. */
export function mintJaasToken(name = "Recepce"): string {
  const appId = process.env.JAAS_APP_ID;
  const kid = process.env.JAAS_KID;
  const key = privateKey();
  if (!appId || !kid || !key) throw new Error("JaaS není nakonfigurováno (JAAS_APP_ID / JAAS_KID / JAAS_KEY_FILE).");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid, typ: "JWT" };
  const payload = {
    aud: "jitsi",
    iss: "chat",
    sub: appId,
    room: "*",
    iat: now,
    nbf: now - 10,
    exp: now + 2 * 60 * 60,
    context: {
      user: { id: "kiosk", name, email: "", avatar: "", moderator: "true" },
      features: { livestreaming: "false", recording: "false", transcription: "false", "outbound-call": "false" },
    },
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(key);
  return `${signingInput}.${b64url(signature)}`;
}
