// Lůžková obsazenost s rotací osob (firemní ubytovny).
// Osoba (pracovník) obývá konkrétní lůžko v daném období; na lůžku se osoby střídají.
// Nezávislé na Reservation — samostatná operativa pro ubytovny (inventoryUnit = bed).
import { OccupancyStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { resolveRate } from "./personrates";

const NOT_FOUND = () => Object.assign(new Error("not_found"), { code: "P2025" });
const dateOnly = (s: string | Date) => new Date(new Date(s).toISOString().slice(0, 10));
const todayDate = () => dateOnly(new Date());

const OCC_INCLUDE = {
  occupant: { select: { id: true, firstName: true, lastName: true, phone: true } },
  company: { select: { id: true, name: true } },
  personRate: { select: { id: true, name: true } },
} as const;

const nightsBetween = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));

function fmt(o: Prisma.BedOccupancyGetPayload<{ include: typeof OCC_INCLUDE }>, energyPerNight = 0) {
  const nights = nightsBetween(o.fromDate, o.toDate);
  const ppn = Number(o.pricePerNight);
  const energyAmount = o.energyFeeExempt ? 0 : nights * energyPerNight;
  return {
    id: o.id, bedId: o.bedId, fromDate: o.fromDate, toDate: o.toDate, status: o.status, note: o.note,
    occupantId: o.occupantGuestId, occupantName: `${o.occupant.firstName} ${o.occupant.lastName}`, occupantPhone: o.occupant.phone,
    companyId: o.companyId, companyName: o.company?.name ?? null,
    personRateId: o.personRateId, personRateName: o.personRate?.name ?? null, dateOfBirth: o.dateOfBirth,
    pricePerNight: ppn.toFixed(2), nights, amount: (nights * ppn).toFixed(2), invoicedAt: o.invoicedAt,
    energyFeeExempt: o.energyFeeExempt, energyPerNight: energyPerNight.toFixed(2), energyAmount: energyAmount.toFixed(2),
    total: (nights * ppn + energyAmount).toFixed(2),
  };
}

const energyRate = async (propertyId: string) => Number((await prisma.property.findUnique({ where: { id: propertyId }, select: { energyFeePerNight: true } }))?.energyFeePerNight ?? 0);

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
  const rate = await energyRate(propertyId);
  const byBed = new Map<string, typeof occ>();
  for (const o of occ) { const a = byBed.get(o.bedId) ?? []; a.push(o); byBed.set(o.bedId, a); }
  return beds.map((b) => {
    const list = byBed.get(b.id) ?? [];
    const current = list.find((o) => o.fromDate <= today && o.toDate > today) ?? null;
    const upcoming = list.filter((o) => o.fromDate > today);
    return {
      bedId: b.id, label: b.label, roomNumber: b.room.number, floor: b.room.floor, status: b.status,
      current: current ? fmt(current, rate) : null,
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
  const rate = await energyRate(propertyId);
  return { bed, items: items.map((o) => fmt(o, rate)) };
}

export type CreateOccupancyInput = {
  bedId: string; fromDate: string; toDate: string;
  occupantGuestId?: string; firstName?: string; lastName?: string; phone?: string;
  companyId?: string | null; reservationId?: string | null; note?: string | null; pricePerNight?: number; energyFeeExempt?: boolean;
  personRateId?: string | null; dateOfBirth?: string | null;
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
  const rate = await resolveRate(propertyId, { personRateId: input.personRateId, dateOfBirth: input.dateOfBirth, pricePerNight: input.pricePerNight });
  const created = await prisma.bedOccupancy.create({
    data: { propertyId, bedId: input.bedId, occupantGuestId, companyId: input.companyId ?? null, reservationId: input.reservationId ?? null, fromDate: from, toDate: to, pricePerNight: rate.pricePerNight, personRateId: rate.personRateId, dateOfBirth: input.dateOfBirth ? dateOnly(input.dateOfBirth) : null, energyFeeExempt: input.energyFeeExempt ?? false, note: input.note ?? null },
    include: OCC_INCLUDE,
  });
  return fmt(created, await energyRate(propertyId));
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
  return fmt(updated, await energyRate(propertyId));
}

export async function updateOccupancy(propertyId: string, id: string, patch: { fromDate?: string; toDate?: string; companyId?: string | null; note?: string | null; pricePerNight?: number; energyFeeExempt?: boolean }) {
  const o = await prisma.bedOccupancy.findFirst({ where: { id, propertyId } });
  if (!o) throw NOT_FOUND();
  const from = patch.fromDate ? dateOnly(patch.fromDate) : o.fromDate;
  const to = patch.toDate ? dateOnly(patch.toDate) : o.toDate;
  if (to <= from) throw new Error("Datum do musí být po datu od.");
  if (o.status === OccupancyStatus.active && await hasOverlap(o.bedId, from, to, id)) throw new Error("Lůžko je v tomto termínu už obsazené.");
  const updated = await prisma.bedOccupancy.update({
    where: { id },
    data: { fromDate: from, toDate: to, companyId: patch.companyId === undefined ? undefined : patch.companyId, note: patch.note === undefined ? undefined : patch.note, pricePerNight: patch.pricePerNight === undefined ? undefined : patch.pricePerNight, energyFeeExempt: patch.energyFeeExempt === undefined ? undefined : patch.energyFeeExempt },
    include: OCC_INCLUDE,
  });
  return fmt(updated, await energyRate(propertyId));
}

/** Volná lůžka v jednotlivých pokojích za období — pro upozornění „nejsou volná lůžka pohromadě". */
export async function freeBedsPerRoom(propertyId: string, from: string, to: string) {
  const f = dateOnly(from), t = dateOnly(to);
  const rooms = await prisma.room.findMany({
    where: { propertyId, status: { not: "out_of_service" } },
    include: { beds: { where: { status: { not: "out_of_service" } }, select: { id: true } } },
    orderBy: [{ floor: "asc" }, { number: "asc" }],
  });
  const [occ, resv] = await Promise.all([
    prisma.bedOccupancy.findMany({ where: { propertyId, status: OccupancyStatus.active, fromDate: { lt: t }, toDate: { gt: f } }, select: { bedId: true } }),
    prisma.reservation.findMany({ where: { propertyId, bedId: { not: null }, status: { in: ["pending", "confirmed", "checked_in"] }, checkInDate: { lt: t }, checkOutDate: { gt: f } }, select: { bedId: true } }),
  ]);
  const taken = new Set<string>([...occ.map((o) => o.bedId), ...resv.map((r) => r.bedId!)]);
  return rooms
    .filter((r) => r.beds.length > 0)
    .map((r) => ({ roomId: r.id, roomNumber: r.number, floor: r.floor, totalBeds: r.beds.length, freeBeds: r.beds.filter((b) => !taken.has(b.id)).length }));
}

/** Obsazení dané firmy v provozovně — pro fakturaci (s příznakem, zda už vyfakturováno). */
export async function companyOccupanciesForProperty(propertyId: string, companyId: string) {
  const items = await prisma.bedOccupancy.findMany({
    where: { propertyId, companyId }, include: { ...OCC_INCLUDE, bed: { select: { label: true } } }, orderBy: { fromDate: "asc" },
  });
  const rate = await energyRate(propertyId);
  return items.map((o) => ({ ...fmt(o, rate), bedLabel: o.bed.label }));
}

export async function deleteOccupancy(propertyId: string, id: string) {
  const o = await prisma.bedOccupancy.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!o) throw NOT_FOUND();
  await prisma.bedOccupancy.delete({ where: { id } });
  return { ok: true };
}
