// iCal export obsazenosti — feed, na který se dají napojit externí kalendáře
// (Google Calendar, Airbnb/Booking iCal import). Read-only, chráněno tokenem
// odvozeným z identifikátoru provozovny (bez nutnosti DB sloupce).
import crypto from "crypto";
import { ReservationStatus, ReservationSource } from "@prisma/client";
import { prisma } from "./prisma";
import { BLOCKING_STATUSES } from "./availability";
import { toDateOnly, addDays } from "./dates";
import { generateReservationCode } from "./reservations";

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

// ── Import: parsování externího iCal + synchronizace do blokací ──
export function parseIcs(text: string): { uid: string; start: Date; end: Date }[] {
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, ""); // rozbal složené řádky
  const events: { uid: string; start: Date; end: Date }[] = [];
  const dt = (v: string): Date | null => { const m = v.match(/(\d{4})(\d{2})(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  let cur: { uid?: string; start?: Date | null; end?: Date | null } | null = null;
  for (const ln of unfolded.split(/\r?\n/)) {
    if (ln.startsWith("BEGIN:VEVENT")) cur = {};
    else if (ln.startsWith("END:VEVENT")) {
      if (cur?.start && cur.end) events.push({ uid: cur.uid || String(cur.start.getTime()), start: cur.start, end: cur.end });
      cur = null;
    } else if (cur) {
      const i = ln.indexOf(":"); if (i < 0) continue;
      const key = ln.slice(0, i).toUpperCase(), val = ln.slice(i + 1).trim();
      if (key.startsWith("UID")) cur.uid = val;
      else if (key.startsWith("DTSTART")) cur.start = dt(val);
      else if (key.startsWith("DTEND")) cur.end = dt(val);
    }
  }
  return events;
}

/** Stáhne jeden feed a promítne ho do blokujících rezervací (upsert + úklid). */
export async function syncFeed(feedId: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const feed = await prisma.icalFeed.findUnique({ where: { id: feedId } });
  if (!feed) return { ok: false, error: "feed nenalezen" };
  try {
    const resp = await fetch(feed.url, { redirect: "follow" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const events = parseIcs(await resp.text());

    let guestId = feed.blockGuestId;
    if (!guestId) {
      const g = await prisma.guest.create({ data: { firstName: "Blokace", lastName: feed.label || "iCal" } });
      guestId = g.id;
      await prisma.icalFeed.update({ where: { id: feed.id }, data: { blockGuestId: guestId } });
    }

    const seen = new Set<string>();
    for (const ev of events) {
      const ci = toDateOnly(ev.start);
      let co = toDateOnly(ev.end);
      if (co <= ci) co = addDays(ci, 1);
      const nights = Math.max(1, Math.round((co.getTime() - ci.getTime()) / 86_400_000));
      const ref = `${feed.id}:${ev.uid}`;
      seen.add(ref);
      const ex = await prisma.reservation.findFirst({ where: { externalRef: ref }, select: { id: true } });
      if (ex) {
        await prisma.reservation.update({ where: { id: ex.id }, data: { checkInDate: ci, checkOutDate: co, nights, roomTypeId: feed.roomTypeId } });
      } else {
        await prisma.reservation.create({
          data: {
            code: generateReservationCode(), property: { connect: { id: feed.propertyId } },
            primaryGuest: { connect: { id: guestId } }, roomType: { connect: { id: feed.roomTypeId } },
            checkInDate: ci, checkOutDate: co, nights, adults: 1,
            status: ReservationStatus.confirmed, source: ReservationSource.ical, totalAmount: 0, cityTax: 0, externalRef: ref,
          },
        });
      }
    }
    // úklid: blokace tohoto feedu, které už ve feedu nejsou
    const stale = await prisma.reservation.findMany({ where: { source: ReservationSource.ical, externalRef: { startsWith: `${feed.id}:` } }, select: { id: true, externalRef: true } });
    const del = stale.filter((s) => s.externalRef && !seen.has(s.externalRef)).map((s) => s.id);
    if (del.length) await prisma.reservation.deleteMany({ where: { id: { in: del } } });

    await prisma.icalFeed.update({ where: { id: feed.id }, data: { lastSyncedAt: new Date(), lastError: null } });
    return { ok: true, count: events.length };
  } catch (e) {
    const msg = (e as Error).message;
    await prisma.icalFeed.update({ where: { id: feed.id }, data: { lastSyncedAt: new Date(), lastError: msg } }).catch(() => {});
    return { ok: false, error: msg };
  }
}

export async function syncProperty(propertyId: string) {
  const feeds = await prisma.icalFeed.findMany({ where: { propertyId } });
  const out = [];
  for (const f of feeds) out.push({ id: f.id, ...(await syncFeed(f.id)) });
  return out;
}

export const listIcalFeeds = (propertyId: string) =>
  prisma.icalFeed.findMany({ where: { propertyId }, include: { roomType: { select: { name: true } } }, orderBy: { createdAt: "asc" } });

export async function addIcalFeed(propertyId: string, roomTypeId: string, url: string, label?: string) {
  const rt = await prisma.roomType.findFirst({ where: { id: roomTypeId, propertyId }, select: { id: true } });
  if (!rt) throw new Error("Neplatný typ pokoje.");
  const feed = await prisma.icalFeed.create({ data: { propertyId, roomTypeId, url, label } });
  await syncFeed(feed.id); // hned první synchronizace
  return feed;
}

export async function deleteIcalFeed(propertyId: string, id: string) {
  const f = await prisma.icalFeed.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!f) throw new Error("Feed nenalezen.");
  await prisma.reservation.deleteMany({ where: { source: ReservationSource.ical, externalRef: { startsWith: `${id}:` } } });
  await prisma.icalFeed.delete({ where: { id } });
  return { ok: true };
}
