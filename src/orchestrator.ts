// Orchestrátor — noční audit a ranní briefing provozovny.
//
// 1× denně (cron) projde data provozovny a sestaví přehled pro manažera:
// obsazenost, dnešní příjezdy/odjezdy, fronta úklidu, nevyrovnané účty, chybějící
// evidence hostů (ubyhost), holdy k expiraci a evidence ke skartaci.
//
// Audit je READ-ONLY (jen čte a počítá). Údržbové akce (uvolnění expirovaných holdů,
// skartace) se spouští zvlášť přes /maintenance/* — ať se nic nemaže při pouhém
// otevření briefingu. Volitelné mluvené AI shrnutí (Haiku) jen na vyžádání.
import { ReservationStatus, InventoryUnit, PaymentType } from "@prisma/client";
import { prisma } from "./prisma";
import { overlapWhere } from "./availability";
import { computeFolio } from "./reservations";
import { buildHousekeepingPlan } from "./dispatch";
import { toDateOnly, addDays } from "./dates";

type Property = Awaited<ReturnType<typeof prisma.property.findUniqueOrThrow>>;

export type OccDay = { date: string; total: number; occupied: number; free: number; pct: number };

export type NightAudit = {
  propertyId: string;
  propertyName: string;
  date: string; // YYYY-MM-DD (dnešek)
  occupancy: { today: OccDay; tomorrow: OccDay };
  arrivals: { total: number; unassigned: number };
  departures: number;
  housekeeping: { urgent: number; total: number };
  unsettled: { count: number; totalBalance: string; items: { code: string; guest: string; balance: string }[] };
  registrationMissing: { count: number; codes: string[] };
  holds: { active: number; expiring: number };
  registrationsToPurge: number;
  flags: string[]; // krátké provozní upozornění (to nejdůležitější nahoře)
};

const iso = (d: Date) => toDateOnly(d).toISOString().slice(0, 10);

/** Obsazenost na danou noc: kolik jednotek (pokoj/lůžko) je obsazeno z celkového počtu. */
async function occupancyForNight(propertyId: string, property: Property, date: Date): Promise<OccDay> {
  const from = toDateOnly(date);
  const to = addDays(from, 1);
  const useBed = property.inventoryUnit === InventoryUnit.bed;

  const total = useBed
    ? await prisma.bed.count({ where: { propertyId, status: { not: "out_of_service" } } })
    : await prisma.room.count({ where: { propertyId, status: { not: "out_of_service" } } });

  // Demand = blokující rezervace překrývající tuto noc (i nepřiřazené) = spotřebované jednotky.
  const occupied = await prisma.reservation.count({ where: { propertyId, ...overlapWhere(from, to) } });

  const free = Math.max(0, total - occupied);
  const pct = total > 0 ? Math.round((Math.min(occupied, total) / total) * 100) : 0;
  return { date: iso(date), total, occupied, free, pct };
}

export async function runNightAudit(propertyId: string): Promise<NightAudit> {
  const now = new Date();
  const today = toDateOnly(now);
  const tomorrow = addDays(today, 1);

  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const useBed = property.inventoryUnit === InventoryUnit.bed;

  const [occToday, occTomorrow, todaysArrivals, departures, plan, inHouse, holdsActive, holdsExpiring, toPurge] = await Promise.all([
    occupancyForNight(propertyId, property, today),
    occupancyForNight(propertyId, property, tomorrow),
    prisma.reservation.findMany({
      where: { propertyId, checkInDate: today, status: { in: [ReservationStatus.confirmed, ReservationStatus.pending] } },
      select: { id: true, roomId: true, bedId: true },
    }),
    prisma.reservation.count({ where: { propertyId, checkOutDate: today, status: ReservationStatus.checked_in } }),
    buildHousekeepingPlan(propertyId),
    prisma.reservation.findMany({
      where: { propertyId, status: ReservationStatus.checked_in },
      select: { id: true, code: true, primaryGuest: { select: { firstName: true, lastName: true } }, _count: { select: { registrationEntries: true } } },
    }),
    prisma.reservation.count({ where: { propertyId, status: ReservationStatus.hold } }),
    prisma.reservation.count({ where: { propertyId, status: ReservationStatus.hold, holdExpiresAt: { lt: now } } }),
    prisma.registrationEntry.count({ where: { reservation: { propertyId }, retentionUntil: { lt: today } } }),
  ]);

  const unassigned = todaysArrivals.filter((r) => (useBed ? !r.bedId : !r.roomId)).length;

  // Nevyrovnané účty u ubytovaných (vč. dnešních odjezdů — ti jsou také checked_in).
  const unsettledItems: { code: string; guest: string; balance: string }[] = [];
  let totalBalance = 0;
  for (const r of inHouse) {
    const folio = await computeFolio(r.id);
    const bal = Number(folio.balance);
    if (bal > 0.005) {
      unsettledItems.push({ code: r.code, guest: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`, balance: folio.balance.toFixed(2) });
      totalBalance += bal;
    }
  }

  const missing = inHouse.filter((r) => r._count.registrationEntries === 0);

  const flags: string[] = [];
  if (plan.counts.urgent > 0) flags.push(`${plan.counts.urgent} pokojů je nutné uklidit před dnešním příjezdem.`);
  if (unassigned > 0) flags.push(`${unassigned} dnešních příjezdů zatím nemá přiřazenou jednotku.`);
  if (unsettledItems.length > 0) flags.push(`${unsettledItems.length} nevyrovnaných účtů, celkem ${totalBalance.toFixed(0)} Kč.`);
  if (missing.length > 0) flags.push(`${missing.length} ubytovaných hostů bez evidence (ohlašovací povinnost).`);
  if (holdsExpiring > 0) flags.push(`${holdsExpiring} rezervací v předběžné držbě po expiraci — uvolnit.`);
  if (toPurge > 0) flags.push(`${toPurge} evidenčních záznamů je po lhůtě uchování — ke skartaci.`);
  if (occTomorrow.pct >= 90) flags.push(`Zítra je obsazenost ${occTomorrow.pct} % — málo volných jednotek.`);
  if (flags.length === 0) flags.push("Vše v pořádku, žádné akce nečekají.");

  return {
    propertyId,
    propertyName: property.name,
    date: iso(today),
    occupancy: { today: occToday, tomorrow: occTomorrow },
    arrivals: { total: todaysArrivals.length, unassigned },
    departures,
    housekeeping: { urgent: plan.counts.urgent, total: plan.counts.total },
    unsettled: { count: unsettledItems.length, totalBalance: totalBalance.toFixed(2), items: unsettledItems },
    registrationMissing: { count: missing.length, codes: missing.map((r) => r.code) },
    holds: { active: holdsActive, expiring: holdsExpiring },
    registrationsToPurge: toPurge,
    flags,
  };
}

// ── Volitelné: mluvené AI shrnutí auditu (Claude/Haiku) ───────
// Jen na vyžádání (manažer klikne). Krátký text, bez markdownu — lze i předčíst.
let _client: import("@anthropic-ai/sdk").default | null = null;
async function anthropic() {
  if (!_client) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    _client = new Anthropic(); // čte ANTHROPIC_API_KEY z env
  }
  return _client;
}

export async function briefManager(audit: NightAudit, lang = "cs"): Promise<string> {
  const model = process.env.AI_MODEL || "claude-haiku-4-5";
  const data = [
    `Provozovna: ${audit.propertyName}, datum ${audit.date}.`,
    `Obsazenost dnes ${audit.occupancy.today.pct} % (${audit.occupancy.today.occupied}/${audit.occupancy.today.total}), zítra ${audit.occupancy.tomorrow.pct} %.`,
    `Dnešní příjezdy: ${audit.arrivals.total} (z toho ${audit.arrivals.unassigned} bez jednotky). Odjezdy: ${audit.departures}.`,
    `Úklid: ${audit.housekeeping.urgent} urgentních z ${audit.housekeeping.total}.`,
    `Nevyrovnané účty: ${audit.unsettled.count} (${audit.unsettled.totalBalance} Kč).`,
    `Bez evidence (ubyhost): ${audit.registrationMissing.count}.`,
    `Holdy po expiraci: ${audit.holds.expiring}. Ke skartaci: ${audit.registrationsToPurge}.`,
  ].join("\n");

  const client = await anthropic();
  const msg = await client.messages.create({
    model,
    max_tokens: 400,
    system: [{
      type: "text",
      text:
        "Jsi provozní ředitel hotelu. Z denního auditu napiš manažerovi KRÁTKÝ ranní " +
        "briefing (4–6 vět) jako mluvenou řeč: nejdřív stav (obsazenost, příjezdy/odjezdy), " +
        "pak konkrétní úkoly seřazené podle naléhavosti a na závěr jednou větou priorita dne. " +
        "ŽÁDNÝ markdown, žádné odrážky, žádné emoji, čísla a data přirozeně slovy. " +
        "Odpovídej v jazyce dle pokynu.",
      cache_control: { type: "ephemeral" },
    }],
    messages: [{ role: "user", content: `Jazyk odpovědi: ${lang}.\nDenní audit:\n${data}` }],
  });
  return msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
}
