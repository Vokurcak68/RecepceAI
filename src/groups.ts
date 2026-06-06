// Skupinové / vícepokojové rezervace — blok více pokojů pod jednou skupinou
// (firma, zájezd, svatba). Každý pokoj je samostatná Reservation (vlastní
// check-in/out i účet); skupina je spojuje pro společný přehled a hromadné akce.
import { ReservationStatus, ReservationSource, GroupBilling, InventoryUnit } from "@prisma/client";
import { prisma } from "./prisma";
import { freeUnitsForType } from "./availability";
import { getStayPrice } from "./pricing";
import { nightsBetween, toDateOnly } from "./dates";
import { createGuest } from "./guests";
import { checkIn, checkOut, computeFolio, generateReservationCode } from "./reservations";
import * as mailer from "./mailer";

function generateGroupCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `GRP-${s}`;
}

export type GroupRoomInput = { roomTypeId: string; adults: number; children?: number; childAges?: number[]; firstName?: string; lastName?: string };
export type CreateGroupInput = {
  name: string; note?: string; from: Date; to: Date;
  billing?: GroupBilling; // kolektivně / individuálně (default individual)
  organizer: { firstName: string; lastName: string; email?: string; phone?: string; language?: string };
  rooms: GroupRoomInput[];
};

/** Vytvoří skupinu a pro každý pokoj samostatnou (potvrzenou) rezervaci.
 * Bez per-pokoj e-mailů (organizátor by dostal N zpráv). */
export async function createGroup(propertyId: string, input: CreateGroupInput) {
  const { from, to, organizer } = input;
  if (!input.rooms.length) throw new Error("Přidej alespoň jeden pokoj.");
  const nights = nightsBetween(from, to);
  if (nights < 1) throw new Error("Pobyt musí být alespoň jednu noc.");
  if (!organizer.firstName || !organizer.lastName) throw new Error("Vyplň kontakt skupiny (jméno a příjmení).");

  // Lůžková provozovna: 1 lůžko = 1 rezervace. Řádek formuláře = počet lůžek daného typu →
  // rozpadne se na tolik samostatných lůžkových rezervací (adults:1), jak to dělá i průvodce.
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { inventoryUnit: true } });
  const rooms = property.inventoryUnit === InventoryUnit.bed
    ? input.rooms.flatMap((r) => {
        const beds = Math.max(1, Number(r.adults) || 1);
        return Array.from({ length: beds }, (_, i) => ({ roomTypeId: r.roomTypeId, adults: 1, children: 0, childAges: [] as number[], firstName: i === 0 ? r.firstName : undefined, lastName: i === 0 ? r.lastName : undefined }));
      })
    : input.rooms;

  const organizerId = await createGuest(organizer);
  const group = await prisma.reservationGroup.create({
    data: { code: generateGroupCode(), name: input.name.trim() || "Skupina", propertyId, note: input.note?.trim() || null, organizerGuestId: organizerId, billing: input.billing ?? GroupBilling.individual },
  });

  const created: string[] = [];
  for (const room of rooms) {
    if (await freeUnitsForType(propertyId, room.roomTypeId, from, to) <= 0) {
      // co se povedlo, necháme; ohlásíme, kde došla kapacita
      throw Object.assign(new Error(`Pro zvolený termín už není volná jednotka jednoho z typů (vytvořeno ${created.length} z ${rooms.length} pokojů).`), { partial: true, groupId: group.id });
    }
    const childAges = (room.childAges ?? []).filter((a) => Number.isFinite(a));
    const children = childAges.length || (room.children ?? 0);
    const price = await getStayPrice(room.roomTypeId, from, to, room.adults, childAges);
    const guestId = room.firstName && room.lastName
      ? await createGuest({ firstName: room.firstName, lastName: room.lastName })
      : organizerId;
    const res = await prisma.reservation.create({
      data: {
        code: generateReservationCode(),
        property: { connect: { id: propertyId } }, group: { connect: { id: group.id } },
        primaryGuest: { connect: { id: guestId } }, roomType: { connect: { id: room.roomTypeId } },
        checkInDate: toDateOnly(from), checkOutDate: toDateOnly(to), nights, adults: room.adults, children, childAges,
        status: ReservationStatus.confirmed, source: ReservationSource.group, billingCycle: price.billingCycle,
        totalAmount: price.total, cityTax: price.cityTax,
        reservationGuests: { create: { guest: { connect: { id: guestId } }, isPrimary: true } },
      },
      select: { id: true },
    });
    created.push(res.id);
  }
  void mailer.sendGroupSummary(group.id); // jeden souhrnný e-mail organizátorovi (best-effort)
  return getGroup(propertyId, group.id);
}

/** Znovu odešle souhrnný e-mail skupiny (scopováno na provozovnu). */
export async function emailGroupSummary(propertyId: string, id: string) {
  const g = await prisma.reservationGroup.findFirst({ where: { id, propertyId }, select: { id: true, organizer: { select: { email: true } } } });
  if (!g) throw Object.assign(new Error("not_found"), { code: "P2025" });
  if (!g.organizer?.email) throw new Error("Skupina nemá kontakt s e-mailem.");
  await mailer.sendGroupSummary(id);
  return { ok: true };
}

const memberInclude = { primaryGuest: true, roomType: true, room: true, bed: true } as const;

export async function listGroups(propertyId: string) {
  const groups = await prisma.reservationGroup.findMany({
    where: { propertyId },
    include: { reservations: { select: { status: true, totalAmount: true, checkInDate: true, checkOutDate: true } } },
    orderBy: { createdAt: "desc" }, take: 200,
  });
  return groups.map((g) => {
    const active = g.reservations.filter((r) => r.status !== ReservationStatus.cancelled);
    const total = active.reduce((s, r) => s + Number(r.totalAmount), 0);
    const from = active.length ? active.reduce((m, r) => (r.checkInDate < m ? r.checkInDate : m), active[0].checkInDate) : null;
    const to = active.length ? active.reduce((m, r) => (r.checkOutDate > m ? r.checkOutDate : m), active[0].checkOutDate) : null;
    return { id: g.id, code: g.code, name: g.name, note: g.note, billing: g.billing, createdAt: g.createdAt, rooms: g.reservations.length, total, from, to };
  });
}

export async function getGroup(propertyId: string, id: string) {
  const group = await prisma.reservationGroup.findFirst({
    where: { id, propertyId },
    include: { reservations: { include: memberInclude, orderBy: { code: "asc" } } },
  });
  if (!group) throw Object.assign(new Error("not_found"), { code: "P2025" });
  let charges = 0, paid = 0;
  const members = [];
  for (const r of group.reservations) {
    const folio = await computeFolio(r.id);
    charges += Number(folio.charges); paid += Number(folio.paid);
    members.push({
      id: r.id, code: r.code, status: r.status,
      guestId: r.primaryGuestId, guestEmail: r.primaryGuest.email,
      guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
      unit: r.room ? `Pokoj ${r.room.number}` : r.bed ? `Lůžko ${r.bed.label}` : r.roomType?.name ?? "—",
      roomType: r.roomType?.name ?? null,
      checkInDate: r.checkInDate, checkOutDate: r.checkOutDate,
      totalAmount: r.totalAmount, balance: folio.balance.toFixed(2),
    });
  }
  const emails = await prisma.emailLog.findMany({ where: { groupId: id }, orderBy: { createdAt: "desc" }, take: 50 });
  return {
    id: group.id, code: group.code, name: group.name, note: group.note, billing: group.billing, createdAt: group.createdAt,
    organizer: group.organizerGuestId ? await prisma.guest.findUnique({ where: { id: group.organizerGuestId }, select: { firstName: true, lastName: true, email: true } }) : null,
    members, totals: { charges: charges.toFixed(2), paid: paid.toFixed(2), balance: (charges - paid).toFixed(2) },
    emails,
  };
}

// ── Hromadné akce nad skupinou (best-effort, výsledek per pokoj) ──
async function memberIds(propertyId: string, id: string, statuses?: ReservationStatus[]) {
  const g = await prisma.reservationGroup.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!g) throw Object.assign(new Error("not_found"), { code: "P2025" });
  return prisma.reservation.findMany({ where: { groupId: id, ...(statuses ? { status: { in: statuses } } : {}) }, select: { id: true, code: true } });
}

export async function checkInGroup(propertyId: string, id: string) {
  const rs = await memberIds(propertyId, id, [ReservationStatus.confirmed, ReservationStatus.pending]);
  const out = [];
  for (const r of rs) { try { await checkIn(r.id); out.push({ code: r.code, ok: true }); } catch (e) { out.push({ code: r.code, ok: false, error: (e as Error).message }); } }
  return out;
}

export async function checkOutGroup(propertyId: string, id: string) {
  const group = await prisma.reservationGroup.findFirst({ where: { id, propertyId }, select: { id: true, billing: true } });
  if (!group) throw Object.assign(new Error("not_found"), { code: "P2025" });
  // Kolektivní režim: platí se za celou skupinu → před hromadným odhlášením musí sedět účet CELÉ skupiny
  // (jednotlivé pokoje mají nevyrovnané vlastní účty, společná faktura připíše platbu jen na jeden z nich).
  if (group.billing === GroupBilling.collective) {
    let charges = 0, paid = 0;
    const all = await prisma.reservation.findMany({ where: { groupId: id, status: { not: ReservationStatus.cancelled } }, select: { id: true } });
    for (const r of all) { const f = await computeFolio(r.id); charges += Number(f.charges); paid += Number(f.paid); }
    const balance = charges - paid;
    if (balance > 0.005) throw new Error(`Nelze odhlásit skupinu — nevyrovnaný účet skupiny: ${balance.toFixed(2)} Kč. Vystavte a uhraďte společnou fakturu.`);
  }
  const rs = await memberIds(propertyId, id, [ReservationStatus.checked_in]);
  const out = [];
  for (const r of rs) { try { await checkOut(r.id); out.push({ code: r.code, ok: true }); } catch (e) { out.push({ code: r.code, ok: false, error: (e as Error).message }); } }
  return out;
}

/** Změna platebního režimu skupiny (kolektivně / individuálně). */
export async function setGroupBilling(propertyId: string, id: string, billing: GroupBilling) {
  const g = await prisma.reservationGroup.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!g) throw Object.assign(new Error("not_found"), { code: "P2025" });
  await prisma.reservationGroup.update({ where: { id }, data: { billing } });
  return getGroup(propertyId, id);
}

export async function cancelGroup(propertyId: string, id: string) {
  const rs = await memberIds(propertyId, id);
  await prisma.reservation.updateMany({
    where: { id: { in: rs.map((r) => r.id) }, status: { notIn: [ReservationStatus.checked_out, ReservationStatus.cancelled] } },
    data: { status: ReservationStatus.cancelled, holdExpiresAt: null },
  });
  return { ok: true, count: rs.length };
}
