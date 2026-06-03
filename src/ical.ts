// iCal export obsazenosti — feed, na který se dají napojit externí kalendáře
// (Google Calendar, Airbnb/Booking iCal import). Read-only, chráněno tokenem
// odvozeným z identifikátoru provozovny (bez nutnosti DB sloupce).
import crypto from "crypto";
import { prisma } from "./prisma";
import { BLOCKING_STATUSES } from "./availability";
import { toDateOnly } from "./dates";

/** Stabilní token pro feed dané provozovny (odvozený, ne v DB). */
export function icalToken(identifier: string): string {
  return crypto.createHash("sha256").update(identifier + "|" + (process.env.ICAL_SECRET || "receptionai-ical-feed")).digest("hex").slice(0, 20);
}

const fmtDate = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** VCALENDAR s obsazenými termíny (volitelně jen pro daný typ pokoje). */
export async function buildExportIcs(propertyId: string, roomTypeId?: string): Promise<string> {
  const today = toDateOnly(new Date());
  const res = await prisma.reservation.findMany({
    where: { propertyId, status: { in: BLOCKING_STATUSES }, checkOutDate: { gte: today }, ...(roomTypeId ? { roomTypeId } : {}) },
    include: { roomType: true },
    orderBy: { checkInDate: "asc" },
  });
  const stamp = `${fmtDate(new Date())}T000000Z`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ReceptionAI//CS", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const r of res) {
    lines.push("BEGIN:VEVENT", `UID:${r.id}@recepceai.cz`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${fmtDate(r.checkInDate)}`, `DTEND;VALUE=DATE:${fmtDate(r.checkOutDate)}`,
      `SUMMARY:${esc("Obsazeno" + (r.roomType ? " – " + r.roomType.name : ""))}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
