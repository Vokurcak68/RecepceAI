// Centrální adresář firem (odběratelů) — sdílený napříč provozovnami.
// Firma drží rezervace (firemní ubytovny / služební pobyty) a je odběratelem na dokladech.
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { computeFolio } from "./reservations";

const NOT_FOUND = () => Object.assign(new Error("not_found"), { code: "P2025" });

export type CompanyInput = {
  name: string; ico?: string | null; dic?: string | null; account?: string | null;
  street?: string | null; city?: string | null; zip?: string | null; country?: string | null;
  email?: string | null; phone?: string | null; note?: string | null; active?: boolean;
};

/** Seznam firem (volitelně hledání dle názvu/IČO). */
export function listCompanies(q?: string) {
  const where: Prisma.CompanyWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { ico: { contains: q } }] }
    : {};
  return prisma.company.findMany({ where, orderBy: { name: "asc" }, take: 500 });
}

export const createCompany = (data: CompanyInput) => prisma.company.create({ data });

export async function updateCompany(id: string, data: Partial<CompanyInput>) {
  await prisma.company.findUniqueOrThrow({ where: { id } }).catch(() => { throw NOT_FOUND(); });
  return prisma.company.update({ where: { id }, data });
}

export async function deleteCompany(id: string) {
  // FK na rezervaci je ON DELETE SET NULL → rezervace zůstanou, jen se odpojí.
  await prisma.company.delete({ where: { id } }).catch(() => { throw NOT_FOUND(); });
  return { ok: true };
}

/** Detail firmy: profil + její rezervace napříč provozovnami se zůstatkem + souhrn. */
export async function getCompany(id: string) {
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) throw NOT_FOUND();
  const reservations = await prisma.reservation.findMany({
    where: { companyId: id, status: { not: "cancelled" } },
    include: { property: { select: { id: true, name: true } }, primaryGuest: { select: { firstName: true, lastName: true } } },
    orderBy: { checkInDate: "desc" }, take: 200,
  });
  let totalBalance = new Prisma.Decimal(0);
  const rows = await Promise.all(reservations.map(async (r) => {
    const f = await computeFolio(r.id);
    totalBalance = totalBalance.add(f.balance);
    return {
      id: r.id, code: r.code, propertyId: r.propertyId, propertyName: r.property.name,
      guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
      checkInDate: r.checkInDate, checkOutDate: r.checkOutDate, status: r.status,
      balance: f.balance.toFixed(2),
    };
  }));
  return { ...company, reservations: rows, totalBalance: totalBalance.toFixed(2) };
}

/** Přiřadí/odpojí firmu k rezervaci (scopováno na provozovnu). */
export async function setReservationCompany(propertyId: string, reservationId: string, companyId: string | null) {
  const r = await prisma.reservation.findFirst({ where: { id: reservationId, propertyId }, select: { id: true } });
  if (!r) throw NOT_FOUND();
  if (companyId) {
    const c = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!c) throw NOT_FOUND();
  }
  return prisma.reservation.update({ where: { id: reservationId }, data: { companyId }, select: { id: true, companyId: true } });
}

/** Nevyfakturované rezervace firmy v dané provozovně (pro souhrnnou fakturu). */
export async function companyReservationsForProperty(propertyId: string, companyId: string) {
  const reservations = await prisma.reservation.findMany({
    where: { companyId, propertyId, status: { not: "cancelled" } },
    include: { primaryGuest: { select: { firstName: true, lastName: true } } },
    orderBy: { checkInDate: "asc" }, take: 200,
  });
  return Promise.all(reservations.map(async (r) => ({
    id: r.id, code: r.code, guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
    checkInDate: r.checkInDate, checkOutDate: r.checkOutDate, status: r.status,
    balance: (await computeFolio(r.id)).balance.toFixed(2),
  })));
}
