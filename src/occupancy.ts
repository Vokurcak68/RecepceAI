// Lůžková obsazenost s rotací osob (firemní ubytovny).
// Osoba (pracovník) obývá konkrétní lůžko v daném období; na lůžku se osoby střídají.
// Nezávislé na Reservation — samostatná operativa pro ubytovny (inventoryUnit = bed).
import { OccupancyStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const NOT_FOUND = () => Object.assign(new Error("not_found"), { code: "P2025" });
const dateOnly = (s: string | Date) => new Date(new Date(s).toISOString().slice(0, 10));
const todayDate = () => dateOnly(new Date());

const OCC_INCLUDE = {
  occupant: { select: { id: true, firstName: true, lastName: true, phone: true } },
  company: { select: { id: true, name: true } },
} as const;

function fmt(o: Prisma.BedOccupancyGetPayload<{ include: typeof OCC_INCLUDE }>) {
  return {
    id: o.id, bedId: o.bedId, fromDate: o.fromDate, toDate: o.toDate, status: o.status, note: o.note,
    occupantId: o.occupantGuestId, occupantName: `${o.occupant.firstName} ${o.occupant.lastName}`, occupantPhone: o.occupant.phone,
    companyId: o.companyId, companyName: o.company?.name ?? null,
  };
}

/** Konflikt: jiná NEUKONČENÁ obsazenost téhož lůžka, jejíž interval se překrývá s [from, to). */
async function hasOverlap(bedId: string, from: Date, to: Date, exceptId?: string) {
  const clash = await prisma.bedOccupancy.findFirst({
    where: {
      bedId, status: OccupancyStatus.active, ...(exceptId ? { id: { not: exceptId } } : {}),
      fromDate: { lt: to }, toDate: { gt: from },
    },
    select: { id: true },
  });
  return !!clash;
}

/** Přehled lůžek provozovny: aktuální obyvatel (kryje dnešek) + počet nadcházejících obsazení. */
export async function bedBoard(propertyId: string) {
  const today = todayDate();
  const beds = await prisma.bed.findMany({
    where: { propertyId },
    include: { room: { select: { number: true, floor: true } } },
    orderBy: [{ room: { floor: "asc" } }, { label: "asc" }],
  });
  const occ = await prisma.bedOccupancy.findMany({
    where: { propertyId, status: OccupancyStatus.active, toDate: { gt: today } },
    include: OCC_INCLUDE, orderBy: { fromDate: "asc" },
  });
  const byBed = new Map<string, typeof occ>();
  for (const o of occ) { const a = byBed.get(o.bedId) ?? []; a.push(o); byBed.set(o.bedId, a); }
  return beds.map((b) => {
    const list = byBed.get(b.id) ?? [];
    const current = list.find((o) => o.fromDate <= today && o.toDate > today) ?? null;
    const upcoming = list.filter((o) => o.fromDate > today);
    return {
      bedId: b.id, label: b.label, roomNumber: b.room.number, floor: b.room.floor, status: b.status,
      current: current ? fmt(current) : null,
      upcoming: upcoming.length,
      nextFrom: upcoming[0]?.fromDate ?? null,
    };
  });
}

/** Časová osa obsazení jednoho lůžka (historie + budoucnost). */
export async function listBedOccupancies(propertyId: string, bedId: string) {
  const bed = await prisma.bed.findFirst({ where: { id: bedId, propertyId }, select: { id: true, label: true } });
  if (!bed) throw NOT_FOUND();
  const items = await prisma.bedOccupancy.findMany({ where: { propertyId, bedId }, include: OCC_INCLUDE, orderBy: { fromDate: "desc" } });
  return { bed, items: items.map(fmt) };
}

export type CreateOccupancyInput = {
  bedId: string; fromDate: string; toDate: string;
  occupantGuestId?: string; firstName?: string; lastName?: string; phone?: string;
  companyId?: string | null; reservationId?: string | null; note?: string | null;
};

/** Umístí osobu na lůžko (check-in pracovníka). Buď existující host, nebo se založí nový jen se jménem. */
export async function createOccupancy(propertyId: string, input: CreateOccupancyInput) {
  const bed = await prisma.bed.findFirst({ where: { id: input.bedId, propertyId }, select: { id: true } });
  if (!bed) throw NOT_FOUND();
  const from = dateOnly(input.fromDate), to = dateOnly(input.toDate);
  if (to <= from) throw new Error("Datum do musí být po datu od.");
  if (await hasOverlap(input.bedId, from, to)) throw new Error("Lůžko je v tomto termínu už obsazené.");

  let occupantGuestId = input.occupantGuestId;
  if (!occupantGuestId) {
    if (!input.firstName?.trim() || !input.lastName?.trim()) throw new Error("Vyplň jméno a příjmení osoby.");
    const g = await prisma.guest.create({ data: { firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone: input.phone || null } });
    occupantGuestId = g.id;
  }
  if (input.companyId) {
    const c = await prisma.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
    if (!c) throw NOT_FOUND();
  }
  const created = await prisma.bedOccupancy.create({
    data: { propertyId, bedId: input.bedId, occupantGuestId, companyId: input.companyId ?? null, reservationId: input.reservationId ?? null, fromDate: from, toDate: to, note: input.note ?? null },
    include: OCC_INCLUDE,
  });
  return fmt(created);
}

/** Ukončí obsazenost (pracovník odešel / vystřídán). toDate volitelně zkrátí na skutečný odchod. */
export async function endOccupancy(propertyId: string, id: string, toDate?: string) {
  const o = await prisma.bedOccupancy.findFirst({ where: { id, propertyId }, select: { id: true, fromDate: true } });
  if (!o) throw NOT_FOUND();
  const end = toDate ? dateOnly(toDate) : todayDate();
  const updated = await prisma.bedOccupancy.update({
    where: { id },
    data: { status: OccupancyStatus.ended, toDate: end < o.fromDate ? o.fromDate : end },
    include: OCC_INCLUDE,
  });
  return fmt(updated);
}

export async function updateOccupancy(propertyId: string, id: string, patch: { fromDate?: string; toDate?: string; companyId?: string | null; note?: string | null }) {
  const o = await prisma.bedOccupancy.findFirst({ where: { id, propertyId } });
  if (!o) throw NOT_FOUND();
  const from = patch.fromDate ? dateOnly(patch.fromDate) : o.fromDate;
  const to = patch.toDate ? dateOnly(patch.toDate) : o.toDate;
  if (to <= from) throw new Error("Datum do musí být po datu od.");
  if (o.status === OccupancyStatus.active && await hasOverlap(o.bedId, from, to, id)) throw new Error("Lůžko je v tomto termínu už obsazené.");
  const updated = await prisma.bedOccupancy.update({
    where: { id },
    data: { fromDate: from, toDate: to, companyId: patch.companyId === undefined ? undefined : patch.companyId, note: patch.note === undefined ? undefined : patch.note },
    include: OCC_INCLUDE,
  });
  return fmt(updated);
}

export async function deleteOccupancy(propertyId: string, id: string) {
  const o = await prisma.bedOccupancy.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!o) throw NOT_FOUND();
  await prisma.bedOccupancy.delete({ where: { id } });
  return { ok: true };
}
