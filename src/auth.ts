// Autentizace: hashování hesla (scrypt) + HMAC-podepsaný token s userId.
// Bez externí závislosti (node:crypto).
import crypto from "node:crypto";

const SECRET = process.env.ADMIN_SECRET || "dev-secret-zmen-me-v-env";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 h

// ── Hashování hesla ──────────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const a = Buffer.from(hashHex, "hex");
  return a.length === hash.length && crypto.timingSafeEqual(a, hash);
}

// ── Token ────────────────────────────────────────────────────
export function createToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + TTL_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Vrátí userId z platného tokenu, jinak null. */
export function readToken(token: string): string | null {
  const [payload, sig] = (token || "").split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { userId, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" && exp > Date.now() && typeof userId === "string" ? userId : null;
  } catch {
    return null;
  }
}
