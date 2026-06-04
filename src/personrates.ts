// Číselník typů osob s cenou za noc (děti dle věku, senior, uprchlík…). Per provozovna.
import { prisma } from "./prisma";

const NOT_FOUND = () => Object.assign(new Error("not_found"), { code: "P2025" });

export type PersonRateInput = { name: string; ageFrom?: number | null; ageTo?: number | null; pricePerNight: number; sortOrder?: number; active?: boolean };

export const listPersonRates = (propertyId: string, includeInactive = false) =>
  prisma.personRate.findMany({ where: { propertyId, ...(includeInactive ? {} : { active: true }) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });

export const createPersonRate = (propertyId: string, d: PersonRateInput) => prisma.personRate.create({ data: { propertyId, ...d } });

export async function updatePersonRate(propertyId: string, id: string, d: Partial<PersonRateInput>) {
  const r = await prisma.personRate.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!r) throw NOT_FOUND();
  return prisma.personRate.update({ where: { id }, data: d });
}

export async function deletePersonRate(propertyId: string, id: string) {
  const r = await prisma.personRate.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!r) throw NOT_FOUND();
  await prisma.personRate.delete({ where: { id } });
  return { ok: true };
}

/** Věk v celých letech k dnešnímu dni. */
export function ageFromDob(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return Math.max(0, age);
}

/** Najde nejvhodnější (nejužší) aktivní kategorii pro daný věk.
 *  boundedOnly = jen kategorie s nějakou věkovou hranicí (pro kiosek — kategorie bez věku,
 *  např. „uprchlík", vyžadují doložení a přiřazuje je recepce, ne kiosek). */
export async function rateForAge(propertyId: string, age: number, boundedOnly = false) {
  const rates = await listPersonRates(propertyId);
  const matching = rates.filter((r) =>
    (!boundedOnly || r.ageFrom != null || r.ageTo != null) &&
    (r.ageFrom == null || age >= r.ageFrom) && (r.ageTo == null || age <= r.ageTo));
  if (!matching.length) return null;
  // preferuj nejužší věkové rozpětí, pak sortOrder
  matching.sort((a, b) => ((a.ageTo ?? 200) - (a.ageFrom ?? 0)) - ((b.ageTo ?? 200) - (b.ageFrom ?? 0)) || a.sortOrder - b.sortOrder);
  return matching[0];
}

/** Z (personRateId | dateOfBirth) určí cenu/noc a kategorii. Explicitní cena má přednost. */
export async function resolveRate(propertyId: string, input: { personRateId?: string | null; dateOfBirth?: string | null; pricePerNight?: number }) {
  let personRateId = input.personRateId ?? null;
  let price = input.pricePerNight;
  if (personRateId) {
    const r = await prisma.personRate.findFirst({ where: { id: personRateId, propertyId } });
    if (!r) throw NOT_FOUND();
    if (price == null) price = Number(r.pricePerNight);
  } else if (input.dateOfBirth) {
    const r = await rateForAge(propertyId, ageFromDob(new Date(input.dateOfBirth)));
    if (r) { personRateId = r.id; if (price == null) price = Number(r.pricePerNight); }
  }
  return { personRateId, pricePerNight: price ?? 0 };
}
