// CRM hostů — profil + historie pobytů, trvalé preference/VIP a hodnocení pobytu
// (NPS). Host je globální entita (může bydlet ve více provozovnách); přehledy se
// ale scopují na provozovny, ke kterým má uživatel přístup.
// POZN.: automatické párování vracejícího se hosta podle e-mailu bylo ZRUŠENO
// (záměrně — dělalo víc škody než užitku). Napojení na existujícího hosta je teď
// výhradně manuální přes adresář (📇 → setPrimaryGuest).
import { ReservationStatus, DocumentType } from "@prisma/client";
import { prisma } from "./prisma";

export type GuestInput = { firstName: string; lastName: string; email?: string; phone?: string; language?: string };

/** Založí nového hosta a vrátí jeho id. (Nepáruje podle e-mailu — viz pozn. výše.) */
export async function createGuest(g: GuestInput): Promise<string> {
  const created = await prisma.guest.create({
    data: { firstName: g.firstName, lastName: g.lastName, email: g.email || null, phone: g.phone || null, language: g.language || null },
  });
  return created.id;
}

/** Ruční založení hosta do adresáře (z výběru hosta — když klient ještě není v seznamu). Vrací nový záznam.
 * Údaje pro evidenci/UBYPORT (narození/národnost/doklad/adresa) jsou nepovinné — když je klient dá hned,
 * předvyplní se z nich evidenční kniha. */
export async function createGuestProfile(g: GuestInput & { address?: string; documentType?: string; documentNumber?: string; dateOfBirth?: string; nationality?: string }) {
  if (!g.firstName?.trim() || !g.lastName?.trim()) throw new Error("Vyplň jméno a příjmení.");
  return prisma.guest.create({
    data: {
      firstName: g.firstName.trim(), lastName: g.lastName.trim(), email: g.email?.trim() || null, phone: g.phone?.trim() || null, language: g.language || null,
      address: g.address?.trim() || null, documentType: g.documentType ? (g.documentType as DocumentType) : null, documentNumber: g.documentNumber?.trim() || null,
      dateOfBirth: g.dateOfBirth ? new Date(g.dateOfBirth) : null, nationality: g.nationality?.trim() || null,
    },
  });
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
  // Normalizace bez diakritiky + case (zadám „tomas" → najde „Tomáš"). Tokenové (každé slovo musí sednout).
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const tokens = norm(q.trim()).split(/\s+/).filter(Boolean);
  // Bez name-filtru v DB (diakritiku Postgres contains neumí) — vezmeme hosty provozovny a filtrujeme v aplikaci.
  const groups = await prisma.reservation.groupBy({
    by: ["primaryGuestId"], where: { propertyId: { in: propertyIds } }, _count: { _all: true }, _max: { checkOutDate: true },
    orderBy: { _max: { checkOutDate: "desc" } }, take: tokens.length ? 3000 : 100,
  });
  const guests = await prisma.guest.findMany({ where: { id: { in: groups.map((g) => g.primaryGuestId) } } });
  const byId = new Map(guests.map((g) => [g.id, g]));
  const rows = groups
    .map((grp) => {
      const g = byId.get(grp.primaryGuestId);
      if (!g) return null;
      return {
        id: g.id, firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone,
        vip: g.vip, preferences: g.preferences, stays: grp._count._all, lastStay: grp._max.checkOutDate,
        // Propojení s knihou hostů: máme uložený doklad → při výběru z adresáře se předvyplní evidence.
        hasDocument: !!g.documentNumber, documentType: g.documentType,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const filtered = tokens.length
    ? rows.filter((r) => { const hay = norm(`${r.firstName} ${r.lastName} ${r.email ?? ""} ${r.phone ?? ""}`); return tokens.every((t) => hay.includes(t)); })
    : rows;
  return filtered.slice(0, 100);
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
      language: guest.language, address: guest.address, documentType: guest.documentType, documentNumber: guest.documentNumber,
      dateOfBirth: guest.dateOfBirth, nationality: guest.nationality,
      vip: guest.vip, preferences: guest.preferences, marketingConsent: guest.marketingConsent, createdAt: guest.createdAt,
    },
    stays: stays.map((s) => ({
      id: s.id, code: s.code, propertyName: s.property.name, roomType: s.roomType?.name ?? null,
      checkInDate: s.checkInDate, checkOutDate: s.checkOutDate, status: s.status, totalAmount: s.totalAmount,
      review: s.review ? { nps: s.review.nps, comment: s.review.comment, createdAt: s.review.createdAt } : null,
    })),
  };
}

/** Úprava údajů hosta (plný adresář). Ověří, že host patří k některé přístupné provozovně. */
export async function updateGuestCrm(
  guestId: string, propertyIds: string[],
  data: {
    firstName?: string; lastName?: string; email?: string | null; phone?: string | null;
    language?: string | null; address?: string | null; documentType?: string | null; documentNumber?: string | null;
    dateOfBirth?: string | null; nationality?: string | null;
    vip?: boolean; preferences?: string | null; marketingConsent?: boolean;
  },
) {
  const belongs = await prisma.reservation.findFirst({ where: { primaryGuestId: guestId, propertyId: { in: propertyIds } }, select: { id: true } });
  if (!belongs) throw Object.assign(new Error("not_found"), { code: "P2025" });
  return prisma.guest.update({
    where: { id: guestId },
    data: {
      ...(data.firstName ? { firstName: data.firstName } : {}),
      ...(data.lastName ? { lastName: data.lastName } : {}),
      ...(data.email !== undefined ? { email: data.email || null } : {}),
      ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
      ...(data.language !== undefined ? { language: data.language || null } : {}),
      ...(data.address !== undefined ? { address: data.address || null } : {}),
      ...(data.documentType !== undefined ? { documentType: data.documentType ? (data.documentType as DocumentType) : null } : {}),
      ...(data.documentNumber !== undefined ? { documentNumber: data.documentNumber || null } : {}),
      ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null } : {}),
      ...(data.nationality !== undefined ? { nationality: data.nationality || null } : {}),
      ...(data.vip !== undefined ? { vip: data.vip } : {}),
      ...(data.preferences !== undefined ? { preferences: data.preferences || null } : {}),
      ...(data.marketingConsent !== undefined ? { marketingConsent: data.marketingConsent } : {}),
    },
  });
}

/** Sloučí duplicitní záznam: pobyty/registrace/hodnocení zdroje se přesunou do
 * cílového hosta, prázdná pole cíle se doplní ze zdroje, zdroj se smaže. */
export async function mergeGuests(targetId: string, sourceId: string, propertyIds: string[]) {
  if (targetId === sourceId) throw new Error("Nelze sloučit záznam sám se sebou.");
  const [target, source] = await Promise.all([
    prisma.guest.findUnique({ where: { id: targetId } }),
    prisma.guest.findUnique({ where: { id: sourceId } }),
  ]);
  if (!target || !source) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const belongs = await prisma.reservation.findFirst({ where: { primaryGuestId: targetId, propertyId: { in: propertyIds } }, select: { id: true } });
  if (!belongs) throw Object.assign(new Error("not_found"), { code: "P2025" });

  await prisma.$transaction(async (tx) => {
    // doplň prázdná pole cíle ze zdroje (cíl má přednost)
    await tx.guest.update({ where: { id: targetId }, data: {
      email: target.email ?? source.email, phone: target.phone ?? source.phone,
      language: target.language ?? source.language, address: target.address ?? source.address,
      documentType: target.documentType ?? source.documentType, documentNumber: target.documentNumber ?? source.documentNumber,
      preferences: target.preferences || source.preferences || null,
      vip: target.vip || source.vip, marketingConsent: target.marketingConsent || source.marketingConsent,
    } });
    // primární rezervace
    await tx.reservation.updateMany({ where: { primaryGuestId: sourceId }, data: { primaryGuestId: targetId } });
    // spolubydlící — ošetři unikát [reservationId, guestId]
    const srcRGs = await tx.reservationGuest.findMany({ where: { guestId: sourceId } });
    for (const rg of srcRGs) {
      const dup = await tx.reservationGuest.findUnique({ where: { reservationId_guestId: { reservationId: rg.reservationId, guestId: targetId } } });
      if (dup) {
        if (rg.isPrimary && !dup.isPrimary) await tx.reservationGuest.update({ where: { id: dup.id }, data: { isPrimary: true } });
        await tx.reservationGuest.delete({ where: { id: rg.id } });
      } else {
        await tx.reservationGuest.update({ where: { id: rg.id }, data: { guestId: targetId } });
      }
    }
    await tx.registrationEntry.updateMany({ where: { guestId: sourceId }, data: { guestId: targetId } });
    await tx.guestReview.updateMany({ where: { guestId: sourceId }, data: { guestId: targetId } });
    await tx.guest.delete({ where: { id: sourceId } });
  });
  return { ok: true, targetId };
}

/** Smaže hosta z adresáře — jen pokud nemá žádné navázané pobyty. */
export async function deleteGuest(guestId: string) {
  const guest = await prisma.guest.findUnique({ where: { id: guestId }, select: { id: true } });
  if (!guest) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const [asPrimary, asGuest] = await Promise.all([
    prisma.reservation.count({ where: { primaryGuestId: guestId } }),
    prisma.reservationGuest.count({ where: { guestId } }),
  ]);
  if (asPrimary > 0 || asGuest > 0) throw new Error("Hosta nelze smazat — má navázané pobyty. Použij sloučení do jiného záznamu.");
  await prisma.guest.delete({ where: { id: guestId } });
  return { ok: true };
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
