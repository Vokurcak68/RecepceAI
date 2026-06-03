// CRM hostů — párování vracejících se hostů (podle e-mailu), profil + historie
// pobytů, trvalé preference/VIP a hodnocení pobytu (NPS). Host je globální entita
// (může bydlet ve více provozovnách); přehledy se ale scopují na provozovny,
// ke kterým má uživatel přístup.
import { Prisma, ReservationStatus } from "@prisma/client";
import { prisma } from "./prisma";

export type GuestInput = { firstName: string; lastName: string; email?: string; phone?: string; language?: string };

const normalizeEmail = (e?: string | null) => (e || "").trim().toLowerCase() || null;

/** Najde existujícího hosta podle e-mailu, jinak založí nového. Vrací guestId.
 * Při shodě doplní jen chybějící kontakt/jazyk (jméno hosta nikdy nepřepisuje). */
export async function findOrCreateGuest(g: GuestInput): Promise<string> {
  const email = normalizeEmail(g.email);
  if (email) {
    const ex = await prisma.guest.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
    });
    if (ex) {
      const data: Prisma.GuestUpdateInput = {};
      if (!ex.phone && g.phone) data.phone = g.phone;
      if (!ex.language && g.language) data.language = g.language;
      if (Object.keys(data).length) await prisma.guest.update({ where: { id: ex.id }, data });
      return ex.id;
    }
  }
  const created = await prisma.guest.create({
    data: { firstName: g.firstName, lastName: g.lastName, email: g.email || null, phone: g.phone || null, language: g.language || null },
  });
  return created.id;
}

const COUNTED: ReservationStatus[] = [ReservationStatus.checked_in, ReservationStatus.checked_out];

/** Kolik předchozích (probíhajících/dokončených) pobytů má host u dané provozovny — bez aktuální rezervace. */
export function previousStaysCount(propertyId: string, primaryGuestId: string, excludeReservationId?: string) {
  return prisma.reservation.count({
    where: { propertyId, primaryGuestId, status: { in: COUNTED }, ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}) },
  });
}

// ── CRM přehledy (scopováno na přístupné provozovny) ─────────
/** Hledání hostů, kteří mají rezervaci v některé z přístupných provozoven. */
export async function searchGuests(propertyIds: string[], q: string) {
  if (!propertyIds.length) return [];
  const term = q.trim();
  const where: Prisma.ReservationWhereInput = {
    propertyId: { in: propertyIds },
    ...(term
      ? { primaryGuest: { OR: [
          { firstName: { contains: term, mode: "insensitive" } },
          { lastName: { contains: term, mode: "insensitive" } },
          { email: { contains: term, mode: "insensitive" } },
          { phone: { contains: term } },
        ] } }
      : {}),
  };
  const groups = await prisma.reservation.groupBy({
    by: ["primaryGuestId"], where, _count: { _all: true }, _max: { checkOutDate: true },
    orderBy: { _max: { checkOutDate: "desc" } }, take: 100,
  });
  const guests = await prisma.guest.findMany({ where: { id: { in: groups.map((g) => g.primaryGuestId) } } });
  const byId = new Map(guests.map((g) => [g.id, g]));
  return groups
    .map((grp) => {
      const g = byId.get(grp.primaryGuestId);
      if (!g) return null;
      return {
        id: g.id, firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone,
        vip: g.vip, preferences: g.preferences, stays: grp._count._all, lastStay: grp._max.checkOutDate,
      };
    })
    .filter(Boolean);
}

/** Profil hosta + historie pobytů (jen v přístupných provozovnách) + hodnocení. */
export async function guestProfile(guestId: string, propertyIds: string[]) {
  const guest = await prisma.guest.findUnique({ where: { id: guestId } });
  if (!guest) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const stays = await prisma.reservation.findMany({
    where: { primaryGuestId: guestId, propertyId: { in: propertyIds } },
    include: { property: { select: { name: true } }, roomType: { select: { name: true } }, review: true },
    orderBy: { checkInDate: "desc" }, take: 100,
  });
  return {
    guest: {
      id: guest.id, firstName: guest.firstName, lastName: guest.lastName, email: guest.email, phone: guest.phone,
      language: guest.language, address: guest.address, vip: guest.vip, preferences: guest.preferences,
      marketingConsent: guest.marketingConsent, createdAt: guest.createdAt,
    },
    stays: stays.map((s) => ({
      id: s.id, code: s.code, propertyName: s.property.name, roomType: s.roomType?.name ?? null,
      checkInDate: s.checkInDate, checkOutDate: s.checkOutDate, status: s.status, totalAmount: s.totalAmount,
      review: s.review ? { nps: s.review.nps, comment: s.review.comment, createdAt: s.review.createdAt } : null,
    })),
  };
}

/** Úprava CRM údajů hosta. Ověří, že host patří k některé přístupné provozovně. */
export async function updateGuestCrm(
  guestId: string, propertyIds: string[],
  data: { preferences?: string | null; vip?: boolean; email?: string | null; phone?: string | null; firstName?: string; lastName?: string },
) {
  const belongs = await prisma.reservation.findFirst({ where: { primaryGuestId: guestId, propertyId: { in: propertyIds } }, select: { id: true } });
  if (!belongs) throw Object.assign(new Error("not_found"), { code: "P2025" });
  return prisma.guest.update({
    where: { id: guestId },
    data: {
      ...(data.preferences !== undefined ? { preferences: data.preferences || null } : {}),
      ...(data.vip !== undefined ? { vip: data.vip } : {}),
      ...(data.email !== undefined ? { email: data.email || null } : {}),
      ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
      ...(data.firstName ? { firstName: data.firstName } : {}),
      ...(data.lastName ? { lastName: data.lastName } : {}),
    },
  });
}

// ── Hodnocení pobytu (NPS) ───────────────────────────────────
const RATEABLE: ReservationStatus[] = [ReservationStatus.checked_in, ReservationStatus.checked_out];

/** Kontext pro veřejnou stránku hodnocení (podle rezervačního kódu). */
export async function feedbackContext(code: string) {
  const r = await prisma.reservation.findFirst({
    where: { code: code.trim().toUpperCase() },
    include: { property: { select: { name: true } }, primaryGuest: { select: { firstName: true, language: true } }, review: true },
  });
  if (!r) return null;
  return {
    propertyName: r.property.name,
    guestName: r.primaryGuest.firstName,
    lang: r.primaryGuest.language,
    eligible: RATEABLE.includes(r.status),
    already: r.review ? { nps: r.review.nps, comment: r.review.comment } : null,
  };
}

/** Uloží (nebo přepíše) hodnocení hosta k rezervaci. */
export async function saveReview(code: string, nps: number, comment?: string) {
  const r = await prisma.reservation.findFirst({ where: { code: code.trim().toUpperCase() }, select: { id: true, propertyId: true, primaryGuestId: true, status: true } });
  if (!r) throw Object.assign(new Error("not_found"), { code: "P2025" });
  if (!RATEABLE.includes(r.status)) throw new Error("Hodnocení je možné až po pobytu.");
  const clamped = Math.max(0, Math.min(10, Math.round(nps)));
  await prisma.guestReview.upsert({
    where: { reservationId: r.id },
    create: { reservationId: r.id, propertyId: r.propertyId, guestId: r.primaryGuestId, nps: clamped, comment: comment?.trim() || null },
    update: { nps: clamped, comment: comment?.trim() || null },
  });
  return { ok: true };
}

/** Přehled hodnocení provozovny: seznam + souhrn (průměr, NPS skóre, rozložení). */
export async function listReviews(propertyId: string) {
  const reviews = await prisma.guestReview.findMany({
    where: { propertyId },
    include: { reservation: { select: { code: true, checkInDate: true, checkOutDate: true } }, guest: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" }, take: 300,
  });
  const n = reviews.length;
  let sum = 0, promoters = 0, detractors = 0, passives = 0;
  for (const r of reviews) {
    sum += r.nps;
    if (r.nps >= 9) promoters++;
    else if (r.nps <= 6) detractors++;
    else passives++;
  }
  const summary = {
    count: n,
    avg: n ? Math.round((sum / n) * 10) / 10 : null,
    nps: n ? Math.round(((promoters - detractors) / n) * 100) : null, // klasické NPS skóre (-100..100)
    promoters, passives, detractors,
  };
  return {
    summary,
    reviews: reviews.map((r) => ({
      id: r.id, nps: r.nps, comment: r.comment, createdAt: r.createdAt,
      code: r.reservation.code, checkOutDate: r.reservation.checkOutDate,
      guestName: `${r.guest.firstName} ${r.guest.lastName}`,
    })),
  };
}
