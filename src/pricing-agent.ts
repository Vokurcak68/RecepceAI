// Revenue / pricing agent — návrh dynamických cen do RatePlan.
//
// Rule-based (bez LLM): pro každý den horizontu spočítá obsazenost daného typu
// jednotky a navrhne cenu odvozenou z basePrice. Vyšší poptávka → příplatek,
// nízká obsazenost na blízký termín → doprodej, víkend → příplatek.
//
// Agent VŽDY jen NAVRHUJE. Zápis do RatePlan je samostatná, explicitní akce
// manažera (applyRates) — ceny se nikdy nepřepisují automaticky.
import { Prisma, InventoryUnit } from "@prisma/client";
import { prisma } from "./prisma";
import { overlapWhere } from "./availability";
import { upsertRatePlan } from "./admin";
import { toDateOnly, addDays } from "./dates";

const WEEKDAY_CS = ["ne", "po", "út", "st", "čt", "pá", "so"];
const round10 = (n: number) => Math.round(n / 10) * 10;
const iso = (d: Date) => toDateOnly(d).toISOString().slice(0, 10);

export type DaySuggestion = {
  date: string;
  weekday: string;
  weekend: boolean;
  leadDays: number;
  totalUnits: number;
  bookedUnits: number;
  freeUnits: number;
  occupancyPct: number;
  basePrice: string;
  currentPrice: string;   // RatePlan na den, jinak basePrice
  suggestedPrice: string;
  factor: number;
  reason: string;
  changed: boolean;       // navržená cena ≠ současná
  direction: "up" | "down" | "same";
};

export type PricingSuggestion = {
  roomTypeId: string;
  roomTypeName: string;
  unit: "room" | "bed";
  basePrice: string;
  horizonDays: number;
  days: DaySuggestion[];
  counts: { changed: number; up: number; down: number };
};

/** Faktor ceny + slovní důvod z obsazenosti, lead-time a víkendu. */
function priceRule(occPct: number, leadDays: number, weekend: boolean): { factor: number; reason: string } {
  let factor = 1.0;
  const reasons: string[] = [];
  if (occPct >= 80) { factor += 0.20; reasons.push("vysoká obsazenost"); }
  else if (occPct >= 60) { factor += 0.10; reasons.push("zvýšená poptávka"); }
  else if (occPct <= 15) { factor -= 0.10; reasons.push("nízká obsazenost"); }
  if (occPct <= 30 && leadDays <= 7) { factor -= 0.15; reasons.push("last-minute doprodej"); }
  if (weekend) { factor += 0.10; reasons.push("víkend"); }
  factor = Math.max(0.7, Math.min(1.6, factor));
  return { factor, reason: reasons.length ? reasons.join(", ") : "beze změny" };
}

/**
 * Navrhne ceny na N dní dopředu pro jeden typ jednotky.
 * Obsazenost = blokující rezervace daného typu překrývající noc / celkový počet jednotek typu.
 */
export async function suggestRates(propertyId: string, roomTypeId: string, horizonDays = 14): Promise<PricingSuggestion> {
  const horizon = Math.max(1, Math.min(60, horizonDays));
  const today = toDateOnly(new Date());
  const end = addDays(today, horizon);

  const roomType = await prisma.roomType.findFirstOrThrow({ where: { id: roomTypeId, propertyId }, include: { property: true } });
  const useBed = roomType.property.inventoryUnit === InventoryUnit.bed;
  const basePrice = roomType.basePrice;

  // Celkový počet jednotek daného typu (mimo provozu se nepočítá).
  const totalUnits = useBed
    ? await prisma.bed.count({ where: { propertyId, status: { not: "out_of_service" }, room: { roomTypeId } } })
    : await prisma.room.count({ where: { propertyId, roomTypeId, status: { not: "out_of_service" } } });

  // Blokující rezervace typu v celém okně (jednou) → překryvy počítáme v paměti.
  const reservations = await prisma.reservation.findMany({
    where: { propertyId, roomTypeId, ...overlapWhere(today, end) },
    select: { checkInDate: true, checkOutDate: true },
  });

  // Existující RatePlany v okně.
  const ratePlans = await prisma.ratePlan.findMany({ where: { roomTypeId, date: { gte: today, lte: end } } });
  const rateByDay = new Map(ratePlans.map((r) => [toDateOnly(r.date).getTime(), r.price]));

  const days: DaySuggestion[] = [];
  for (let i = 0; i < horizon; i++) {
    const night = addDays(today, i);
    const nightEnd = addDays(night, 1);
    const booked = reservations.filter((r) => toDateOnly(r.checkInDate) < nightEnd && toDateOnly(r.checkOutDate) > night).length;
    const occPct = totalUnits > 0 ? Math.round((Math.min(booked, totalUnits) / totalUnits) * 100) : 0;
    const dow = night.getUTCDay();
    const weekend = dow === 5 || dow === 6; // noc z pátku/soboty
    const { factor, reason } = priceRule(occPct, i, weekend);

    const current = rateByDay.get(night.getTime()) ?? basePrice;
    const suggested = new Prisma.Decimal(round10(Number(basePrice) * factor));
    const changed = !suggested.equals(current);
    const direction = suggested.greaterThan(current) ? "up" : suggested.lessThan(current) ? "down" : "same";

    days.push({
      date: iso(night), weekday: WEEKDAY_CS[dow], weekend, leadDays: i,
      totalUnits, bookedUnits: booked, freeUnits: Math.max(0, totalUnits - booked), occupancyPct: occPct,
      basePrice: basePrice.toFixed(2), currentPrice: current.toFixed(2), suggestedPrice: suggested.toFixed(2),
      factor: Math.round(factor * 100) / 100, reason, changed, direction,
    });
  }

  const counts = {
    changed: days.filter((d) => d.changed).length,
    up: days.filter((d) => d.direction === "up" && d.changed).length,
    down: days.filter((d) => d.direction === "down" && d.changed).length,
  };

  return {
    roomTypeId, roomTypeName: roomType.name, unit: useBed ? "bed" : "room",
    basePrice: basePrice.toFixed(2), horizonDays: horizon, days, counts,
  };
}

/** Zapíše schválené ceny do RatePlan (explicitní akce manažera). */
export async function applyRates(propertyId: string, roomTypeId: string, items: { date: string; price: number }[]) {
  const roomType = await prisma.roomType.findFirstOrThrow({ where: { id: roomTypeId, propertyId }, select: { id: true } });
  let applied = 0;
  for (const it of items) {
    if (!Number.isFinite(it.price) || it.price < 0) continue;
    await upsertRatePlan(roomType.id, new Date(it.date), it.price);
    applied++;
  }
  return { applied };
}
