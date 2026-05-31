// Dostupnost se počítá z rezervací, scopovaná na provozovnu.
// Jednotka inventáře dle typu: pokoj (hotel/penzion) nebo lůžko (ubytovna).
import { Prisma, ReservationStatus, InventoryUnit } from "@prisma/client";
import { prisma } from "./prisma";
import { getStayPrice } from "./pricing";
import { nightsBetween, toDateOnly } from "./dates";

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
  const occupied = await prisma.reservation.findMany({
    where: { propertyId, ...overlapWhere(from, to), roomId: { not: null } },
    select: { roomId: true },
  });
  const taken = new Set(occupied.map((r) => r.roomId!));

  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId, capacityAdults: { gte: guests } },
    include: { rooms: { where: { status: { not: "out_of_service" } } } },
  });

  const out: AvailableUnit[] = [];
  for (const rt of roomTypes) {
    const free = rt.rooms.filter((r) => !taken.has(r.id));
    if (!free.length) continue;
    const price = await getStayPrice(rt.id, from, to, guests);
    out.push({
      roomTypeId: rt.id, name: rt.name, description: rt.description, amenities: rt.amenities, photos: rt.photos,
      unit: InventoryUnit.room, freeUnits: free.length,
      roomTotal: price.roomTotal, cityTax: price.cityTax, total: price.total,
    });
  }
  return out;
}

async function bedAvailability(propertyId: string, from: Date, to: Date): Promise<AvailableUnit[]> {
  const occupied = await prisma.reservation.findMany({
    where: { propertyId, ...overlapWhere(from, to), bedId: { not: null } },
    select: { bedId: true },
  });
  const taken = new Set(occupied.map((r) => r.bedId!));

  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId },
    include: { rooms: { where: { status: { not: "out_of_service" } }, include: { beds: { where: { status: { not: "out_of_service" } } } } } },
  });

  const out: AvailableUnit[] = [];
  for (const rt of roomTypes) {
    const beds = rt.rooms.flatMap((r) => r.beds);
    const free = beds.filter((b) => !taken.has(b.id));
    if (!free.length) continue;
    const price = await getStayPrice(rt.id, from, to, 1); // cena za jedno lůžko
    out.push({
      roomTypeId: rt.id, name: rt.name, description: rt.description, amenities: rt.amenities, photos: rt.photos,
      unit: InventoryUnit.bed, freeUnits: free.length,
      roomTotal: price.roomTotal, cityTax: price.cityTax, total: price.total,
    });
  }
  return out;
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
