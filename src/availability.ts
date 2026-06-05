// Dostupnost se počítá z rezervací, scopovaná na provozovnu.
// Jednotka inventáře dle typu: pokoj (hotel/penzion) nebo lůžko (ubytovna).
import { Prisma, ReservationStatus, InventoryUnit } from "@prisma/client";
import { prisma } from "./prisma";
import { getStayPrice } from "./pricing";
import { nightsBetween, toDateOnly, addDays } from "./dates";

/** Kolik jednotek daného typu je obsazeno v termínu = počet překrývajících se blokujících
 * rezervací typu (i bez přiřazeného pokoje/lůžka). Tím se brání přebookování. */
async function bookedByType(propertyId: string, from: Date, to: Date): Promise<Record<string, number>> {
  const grouped = await prisma.reservation.groupBy({
    by: ["roomTypeId"],
    where: { propertyId, ...overlapWhere(from, to) },
    _count: { _all: true },
  });
  const m: Record<string, number> = {};
  for (const g of grouped) m[g.roomTypeId] = g._count._all;
  return m;
}

/** Počet celkových jednotek (pokojů/lůžek) typu — dle režimu provozovny. */
function totalUnits(rt: { rooms: { beds: { id: string }[] }[] }, unit: InventoryUnit): number {
  return unit === InventoryUnit.bed ? rt.rooms.reduce((n, r) => n + r.beds.length, 0) : rt.rooms.length;
}

export const BLOCKING_STATUSES: ReservationStatus[] = [
  ReservationStatus.hold,
  ReservationStatus.confirmed,
  ReservationStatus.checked_in,
];

export function overlapWhere(from: Date, to: Date) {
  return {
    status: { in: BLOCKING_STATUSES },
    checkInDate: { lt: toDateOnly(to) },
    checkOutDate: { gt: toDateOnly(from) },
  };
}

export type AvailableUnit = {
  roomTypeId: string;
  name: string;
  description: string | null;
  amenities: string[];
  photos: string[];
  unit: InventoryUnit;
  freeUnits: number;
  capacityAdults: number;
  capacityChildren: number;
  maxExtraBeds: number;
  extraBedsNeeded: number;
  roomTotal: Prisma.Decimal;
  cityTax: Prisma.Decimal;
  total: Prisma.Decimal;
};

export async function getAvailability(
  propertyId: string,
  from: Date,
  to: Date,
  guests: number,
): Promise<AvailableUnit[]> {
  if (nightsBetween(from, to) < 1) throw new Error("Odjezd musí být alespoň o noc později než příjezd.");
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });

  return property.inventoryUnit === InventoryUnit.bed
    ? bedAvailability(propertyId, from, to)
    : roomAvailability(propertyId, from, to, guests);
}

async function roomAvailability(propertyId: string, from: Date, to: Date, guests: number): Promise<AvailableUnit[]> {
  const booked = await bookedByType(propertyId, from, to);
  // Bez DB filtru na kapacitu — pokoj se může vejít až s přistýlkami; filtrujeme dle efektivní kapacity (vč. maxExtraBeds).
  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId },
    include: { rooms: { where: { status: { not: "out_of_service" } }, include: { beds: true } } },
  });

  const out: AvailableUnit[] = [];
  for (const rt of roomTypes) {
    const baseCap = rt.capacityAdults + rt.capacityChildren;
    if (baseCap + rt.maxExtraBeds < guests) continue; // nevejde se ani s přistýlkami
    const free = totalUnits(rt, InventoryUnit.room) - (booked[rt.id] ?? 0);
    if (free <= 0) continue;
    const price = await getStayPrice(rt.id, from, to, guests);
    out.push({
      roomTypeId: rt.id, name: rt.name, description: rt.description, amenities: rt.amenities, photos: rt.photos,
      unit: InventoryUnit.room, freeUnits: free,
      capacityAdults: rt.capacityAdults, capacityChildren: rt.capacityChildren, maxExtraBeds: rt.maxExtraBeds,
      extraBedsNeeded: Math.max(0, guests - baseCap), // kolik přistýlek je pro tento počet osob potřeba
      roomTotal: price.roomTotal, cityTax: price.cityTax, total: price.total,
    });
  }
  return out;
}

async function bedAvailability(propertyId: string, from: Date, to: Date): Promise<AvailableUnit[]> {
  const booked = await bookedByType(propertyId, from, to);
  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId },
    include: { rooms: { where: { status: { not: "out_of_service" } }, include: { beds: { where: { status: { not: "out_of_service" } } } } } },
  });

  const out: AvailableUnit[] = [];
  for (const rt of roomTypes) {
    const free = totalUnits(rt, InventoryUnit.bed) - (booked[rt.id] ?? 0);
    if (free <= 0) continue;
    const price = await getStayPrice(rt.id, from, to, 1); // cena za jedno lůžko
    out.push({
      roomTypeId: rt.id, name: rt.name, description: rt.description, amenities: rt.amenities, photos: rt.photos,
      unit: InventoryUnit.bed, freeUnits: free,
      capacityAdults: rt.capacityAdults, capacityChildren: rt.capacityChildren, maxExtraBeds: rt.maxExtraBeds, extraBedsNeeded: 0,
      roomTotal: price.roomTotal, cityTax: price.cityTax, total: price.total,
    });
  }
  return out;
}

/** Volných jednotek daného typu pro termín (pojistka při zakládání rezervace). */
export async function freeUnitsForType(propertyId: string, roomTypeId: string, from: Date, to: Date): Promise<number> {
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { inventoryUnit: true } });
  const rt = await prisma.roomType.findUniqueOrThrow({
    where: { id: roomTypeId },
    include: { rooms: { where: { status: { not: "out_of_service" } }, include: { beds: { where: { status: { not: "out_of_service" } } } } } },
  });
  const booked = await prisma.reservation.count({ where: { propertyId, roomTypeId, ...overlapWhere(from, to) } });
  return totalUnits(rt, property.inventoryUnit) - booked;
}

/** Kalendář obsazenosti: pro každý typ pokoje/lůžka počet obsazeno/volno po dnech. */
export async function occupancyCalendar(propertyId: string, from: Date, days: number) {
  const start = toDateOnly(from);
  const end = addDays(start, days);
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { inventoryUnit: true } });
  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId },
    include: { rooms: { where: { status: { not: "out_of_service" } }, include: { beds: { where: { status: { not: "out_of_service" } } } } } },
    orderBy: { name: "asc" },
  });
  const reservations = await prisma.reservation.findMany({
    where: { propertyId, status: { in: BLOCKING_STATUSES }, checkInDate: { lt: end }, checkOutDate: { gt: start } },
    select: { roomTypeId: true, checkInDate: true, checkOutDate: true },
  });
  const dates: string[] = [];
  for (let i = 0; i < days; i++) dates.push(toDateOnly(addDays(start, i)).toISOString());

  const types = roomTypes.map((rt) => {
    const total = totalUnits(rt, property.inventoryUnit);
    const cells = [];
    for (let i = 0; i < days; i++) {
      const day = toDateOnly(addDays(start, i)).getTime();
      const bookedCount = reservations.filter((r) => r.roomTypeId === rt.id && r.checkInDate.getTime() <= day && r.checkOutDate.getTime() > day).length;
      cells.push({ booked: bookedCount, free: total - bookedCount });
    }
    return { roomTypeId: rt.id, name: rt.name, total, cells };
  });
  return { from: start.toISOString(), days, unit: property.inventoryUnit, dates, types };
}

/** Tape chart: jednotlivé pokoje/lůžka (řádky) + rezervace v okně (pruhy). */
export async function tapeChart(propertyId: string, from: Date, days: number) {
  const start = toDateOnly(from);
  const end = addDays(start, days);
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { inventoryUnit: true } });
  const useBed = property.inventoryUnit === InventoryUnit.bed;
  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId },
    include: { rooms: { where: { status: { not: "out_of_service" } }, include: { beds: { where: { status: { not: "out_of_service" } } } }, orderBy: { number: "asc" } } },
    orderBy: { name: "asc" },
  });
  const units: { id: string; label: string; roomTypeId: string }[] = [];
  for (const rt of roomTypes) {
    if (useBed) for (const r of rt.rooms) for (const b of r.beds) units.push({ id: b.id, label: `Lůžko ${b.label}`, roomTypeId: rt.id });
    else for (const r of rt.rooms) units.push({ id: r.id, label: `Pokoj ${r.number}`, roomTypeId: rt.id });
  }
  const reservations = await prisma.reservation.findMany({
    where: { propertyId, status: { in: BLOCKING_STATUSES }, checkInDate: { lt: end }, checkOutDate: { gt: start } },
    include: { primaryGuest: true },
  });
  const dates: string[] = [];
  for (let i = 0; i < days; i++) dates.push(toDateOnly(addDays(start, i)).toISOString());
  return {
    from: start.toISOString(), days, unit: property.inventoryUnit, dates,
    types: roomTypes.map((rt) => ({ roomTypeId: rt.id, name: rt.name })),
    units,
    reservations: reservations.map((r) => ({
      id: r.id, code: r.code, guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`, status: r.status,
      roomTypeId: r.roomTypeId, unitId: useBed ? r.bedId : r.roomId,
      checkInDate: r.checkInDate.toISOString(), checkOutDate: r.checkOutDate.toISOString(),
    })),
  };
}

/** Najde volný pokoj daného typu pro termín (hotel/penzion). */
export async function findFreeRoom(propertyId: string, roomTypeId: string, from: Date, to: Date): Promise<string | null> {
  const occupied = await prisma.reservation.findMany({
    where: { propertyId, ...overlapWhere(from, to), roomId: { not: null }, roomTypeId },
    select: { roomId: true },
  });
  const taken = new Set(occupied.map((r) => r.roomId!));
  const room = await prisma.room.findFirst({
    where: { propertyId, roomTypeId, status: { not: "out_of_service" }, id: { notIn: [...taken] } },
    orderBy: { number: "asc" },
  });
  return room?.id ?? null;
}

/** Najde volné lůžko daného typu pro termín (ubytovna). */
export async function findFreeBed(propertyId: string, roomTypeId: string, from: Date, to: Date): Promise<string | null> {
  const occupied = await prisma.reservation.findMany({
    where: { propertyId, ...overlapWhere(from, to), bedId: { not: null } },
    select: { bedId: true },
  });
  const taken = new Set(occupied.map((r) => r.bedId!));
  const bed = await prisma.bed.findFirst({
    where: { propertyId, status: { not: "out_of_service" }, room: { roomTypeId }, id: { notIn: [...taken] } },
    orderBy: { label: "asc" },
  });
  return bed?.id ?? null;
}
