// Ukládání nahraných obrázků (fotky závad z telefonu personálu). Přijímá data URL
// (base64) a ukládá na disk; servíruje se přes /uploads (resp. /api/uploads za IIS).
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic" };

/** Uloží obrázek z data URL na disk a vrátí veřejnou cestu (/api/uploads/<soubor>). */
export function saveDataUrl(dataUrl: string): string {
  const m = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) throw new Error("Neplatný obrázek.");
  const mime = m[1].toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 10 * 1024 * 1024) throw new Error("Obrázek je příliš velký (max 10 MB).");
  const ext = EXT[mime] || "bin";
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `/api/uploads/${name}`;
}
