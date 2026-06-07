// Obsazení lůžka osobou (rotace pracovníků) — vrstva POD rezervací lůžka (TVM Occupations).
// Rezervace drží lůžko + termín + cenu (firma plátce); pod ní se v čase střídají konkrétní osoby.
// Nepočítá se do dostupnosti (tu řeší sama rezervace) — jen eviduje kdo/kdy na lůžku bydlí.
import { OccupancyStatus, DocumentType } from "@prisma/client";
import { prisma } from "./prisma";
import { addRegistrationEntry } from "./reservations";
import { createGuest } from "./guests";

const NOT_FOUND = () => Object.assign(new Error("not_found"), { code: "P2025" });
const dateOnly = (s: string | Date) => new Date(new Date(s).toISOString().slice(0, 10));
const todayDate = () => dateOnly(new Date());
const nights = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
function ageAtDate(dob: Date, ref: Date) { let a = ref.getFullYear() - dob.getFullYear(); const m = ref.getMonth() - dob.getMonth(); if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) a--; return a; }

const OCC_INCLUDE = { occupant: { select: { id: true, firstName: true, lastName: true, phone: true } } } as const;
function fmt(o: { id: string; reservationId: string; bedId: string; occupantGuestId: string; occupant: { firstName: string; lastName: string; phone: string | null }; fromDate: Date; toDate: Date; status: OccupancyStatus; note: string | null }) {
  return { id: o.id, reservationId: o.reservationId, bedId: o.bedId, occupantId: o.occupantGuestId,
    occupantName: `${o.occupant.firstName} ${o.occupant.lastName}`, occupantPhone: o.occupant.phone,
    fromDate: o.fromDate, toDate: o.toDate, status: o.status, note: o.note, nights: nights(o.fromDate, o.toDate) };
}

/** Konflikt: jiné neukončené obsazení TÉHOŽ lůžka s překryvem [from,to). */
async function overlapOnBed(bedId: string, from: Date, to: Date, exceptId?: string) {
  return !!(await prisma.bedOccupancy.findFirst({
    where: { bedId, status: OccupancyStatus.active, ...(exceptId ? { id: { not: exceptId } } : {}), fromDate: { lt: to }, toDate: { gt: from } },
    select: { id: true },
  }));
}

/** Auto-zápis osoby do evidenční knihy rezervace pro období obsazení (reuse z dřívějšího zápisu / profilu;
 * děti do `cityTaxFreeAge` se nezapisují). */
async function autoRegisterOccupant(reservationId: string, guestId: string, from: Date, to: Date, childAge: number) {
  if (await prisma.registrationEntry.findFirst({ where: { reservationId, guestId }, select: { id: true } })) return;
  const prev = await prisma.registrationEntry.findFirst({ where: { guestId, reservationId: { not: reservationId } }, orderBy: { createdAt: "desc" } });
  if (prev) {
    if (ageAtDate(prev.dateOfBirth, from) < childAge) return;
    await addRegistrationEntry({ reservationId, guestId, fullName: prev.fullName, dateOfBirth: prev.dateOfBirth, nationality: prev.nationality, documentType: prev.documentType, documentNumber: prev.documentNumber, homeAddress: prev.homeAddress, visaNumber: prev.visaNumber ?? undefined, purposeOfStay: prev.purposeOfStay ?? undefined, stayFrom: from, stayTo: to }).catch(() => {});
    return;
  }
  const g = await prisma.guest.findUnique({ where: { id: guestId } });
  if (g?.dateOfBirth && g.nationality && g.documentNumber) {
    if (ageAtDate(g.dateOfBirth, from) < childAge) return;
    await addRegistrationEntry({ reservationId, guestId, fullName: `${g.firstName} ${g.lastName}`.trim(), dateOfBirth: g.dateOfBirth, nationality: g.nationality, documentType: g.documentType ?? DocumentType.id_card, documentNumber: g.documentNumber, homeAddress: g.address ?? "", stayFrom: from, stayTo: to }).catch(() => {});
  }
}

async function loadRes(propertyId: string, reservationId: string) {
  const res = await prisma.reservation.findFirst({ where: { id: reservationId, propertyId }, select: { id: true, bedId: true, propertyId: true, checkInDate: true, checkOutDate: true, property: { select: { cityTaxFreeAge: true } } } });
  if (!res) throw NOT_FOUND();
  return res;
}

export async function listOccupations(propertyId: string, reservationId: string) {
  await loadRes(propertyId, reservationId);
  const items = await prisma.bedOccupancy.findMany({ where: { reservationId }, include: OCC_INCLUDE, orderBy: { fromDate: "desc" } });
  return items.map(fmt);
}

export type CreateOccupationInput = { occupantGuestId?: string; firstName?: string; lastName?: string; phone?: string; fromDate: string; toDate: string; note?: string | null };

export async function createOccupation(propertyId: string, reservationId: string, input: CreateOccupationInput) {
  const res = await loadRes(propertyId, reservationId);
  if (!res.bedId) throw new Error("Rezervace nemá přiřazené lůžko — nejdřív přiřaď konkrétní lůžko (Změnit lůžko).");
  const from = dateOnly(input.fromDate), to = dateOnly(input.toDate);
  if (to <= from) throw new Error("Datum do musí být po datu od.");
  if (await overlapOnBed(res.bedId, from, to)) throw new Error("Lůžko je v tomto termínu už obsazené jinou osobou.");
  let guestId = input.occupantGuestId;
  if (!guestId) {
    if (!input.firstName?.trim() || !input.lastName?.trim()) throw new Error("Vyplň jméno a příjmení osoby.");
    guestId = await createGuest({ firstName: input.firstName, lastName: input.lastName, phone: input.phone });
  }
  const occ = await prisma.bedOccupancy.create({
    data: { propertyId: res.propertyId, reservationId, bedId: res.bedId, occupantGuestId: guestId, fromDate: from, toDate: to, note: input.note ?? null, status: OccupancyStatus.active },
    include: OCC_INCLUDE,
  });
  await autoRegisterOccupant(reservationId, guestId, from, to, res.property.cityTaxFreeAge);
  return fmt(occ);
}

export async function updateOccupation(propertyId: string, id: string, patch: { fromDate?: string; toDate?: string; note?: string | null }) {
  const o = await prisma.bedOccupancy.findFirst({ where: { id, propertyId } });
  if (!o) throw NOT_FOUND();
  const from = patch.fromDate ? dateOnly(patch.fromDate) : o.fromDate;
  const to = patch.toDate ? dateOnly(patch.toDate) : o.toDate;
  if (to <= from) throw new Error("Datum do musí být po datu od.");
  if (o.status === OccupancyStatus.active && await overlapOnBed(o.bedId, from, to, id)) throw new Error("Lůžko je v tomto termínu už obsazené jinou osobou.");
  const updated = await prisma.bedOccupancy.update({ where: { id }, data: { fromDate: from, toDate: to, note: patch.note === undefined ? undefined : patch.note }, include: OCC_INCLUDE });
  return fmt(updated);
}

export async function endOccupation(propertyId: string, id: string, toDate?: string) {
  const o = await prisma.bedOccupancy.findFirst({ where: { id, propertyId }, select: { id: true, fromDate: true } });
  if (!o) throw NOT_FOUND();
  const end = toDate ? dateOnly(toDate) : todayDate();
  const updated = await prisma.bedOccupancy.update({ where: { id }, data: { status: OccupancyStatus.ended, toDate: end < o.fromDate ? o.fromDate : end }, include: OCC_INCLUDE });
  return fmt(updated);
}

export async function deleteOccupation(propertyId: string, id: string) {
  const o = await prisma.bedOccupancy.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!o) throw NOT_FOUND();
  await prisma.bedOccupancy.delete({ where: { id } });
  return { ok: true };
}

/** Aktuální (dnešní) obyvatelé lůžek z obsazení — mapa bedId → jméno. Pro lůžkovou nástěnku. */
export async function currentOccupantsByBed(propertyId: string) {
  const today = todayDate();
  const occ = await prisma.bedOccupancy.findMany({
    where: { propertyId, status: OccupancyStatus.active, fromDate: { lte: today }, toDate: { gt: today } },
    include: OCC_INCLUDE,
  });
  const map = new Map<string, string>();
  for (const o of occ) map.set(o.bedId, `${o.occupant.firstName} ${o.occupant.lastName}`);
  return map;
}
