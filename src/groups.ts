// Skupinové / vícepokojové rezervace — blok více pokojů pod jednou skupinou
// (firma, zájezd, svatba). Každý pokoj je samostatná Reservation (vlastní
// check-in/out i účet); skupina je spojuje pro společný přehled a hromadné akce.
import { ReservationStatus, ReservationSource, GroupBilling, InventoryUnit, PaymentMethod, PaymentType } from "@prisma/client";
import { prisma } from "./prisma";
import { freeUnitsForType } from "./availability";
import { getStayPrice } from "./pricing";
import { nightsBetween, toDateOnly } from "./dates";
import { createGuest } from "./guests";
import { checkIn, checkOut, computeFolio, generateReservationCode, addPayment } from "./reservations";
import * as cash from "./cashregister";
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
  organizerGuestId?: string; // existující host z adresáře → použít místo zakládání nového (bez duplicit)
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

  // 1) KONTROLA KAPACITY DOPŘEDU (per typ) — skupina se vytvoří jen jako CELEK.
  // Když není dost volných jednotek, nevytvoří se NIC a recepce dostane jasnou hlášku.
  const wantByType = new Map<string, number>();
  for (const r of rooms) wantByType.set(r.roomTypeId, (wantByType.get(r.roomTypeId) ?? 0) + 1);
  const shortages: string[] = [];
  for (const [rtId, want] of wantByType) {
    const free = await freeUnitsForType(propertyId, rtId, from, to);
    if (want > free) {
      const rt = await prisma.roomType.findUnique({ where: { id: rtId }, select: { name: true } });
      shortages.push(`${rt?.name ?? "typ"} — volných ${free}, požadováno ${want}`);
    }
  }
  if (shortages.length) {
    const unit = property.inventoryUnit === InventoryUnit.bed ? "lůžek" : "pokojů";
    throw new Error(`Pro zvolený termín není dost volných ${unit}; skupinu nelze vytvořit celou:\n• ${shortages.join("\n• ")}\nUprav počty nebo část přesuň na jiný typ.`);
  }

  // 2) Příprava hostů a cen (čtení + založení hostů) mimo transakci.
  // Hlavní osoba z adresáře → použij existujícího hosta (bez duplikátu); jinak založ z napsaných údajů.
  const existingOrganizer = input.organizerGuestId
    ? await prisma.guest.findUnique({ where: { id: input.organizerGuestId }, select: { id: true } })
    : null;
  const organizerId = existingOrganizer?.id ?? await createGuest(organizer);
  const prepared: { room: GroupRoomInput; childAges: number[]; children: number; price: Awaited<ReturnType<typeof getStayPrice>>; guestId: string }[] = [];
  for (const room of rooms) {
    const childAges = (room.childAges ?? []).filter((a) => Number.isFinite(a));
    const children = childAges.length || (room.children ?? 0);
    const price = await getStayPrice(room.roomTypeId, from, to, room.adults, childAges);
    const guestId = room.firstName && room.lastName ? await createGuest({ firstName: room.firstName, lastName: room.lastName }) : organizerId;
    prepared.push({ room, childAges, children, price, guestId });
  }

  // 3) ATOMICKÉ vytvoření skupiny + VŠECH rezervací (vše, nebo nic).
  const groupId = await prisma.$transaction(async (tx) => {
    const group = await tx.reservationGroup.create({
      data: { code: generateGroupCode(), name: input.name.trim() || "Skupina", propertyId, note: input.note?.trim() || null, organizerGuestId: organizerId, billing: input.billing ?? GroupBilling.individual },
    });
    for (const p of prepared) {
      await tx.reservation.create({
        data: {
          code: generateReservationCode(),
          property: { connect: { id: propertyId } }, group: { connect: { id: group.id } },
          primaryGuest: { connect: { id: p.guestId } }, roomType: { connect: { id: p.room.roomTypeId } },
          checkInDate: toDateOnly(from), checkOutDate: toDateOnly(to), nights, adults: p.room.adults, children: p.children, childAges: p.childAges,
          status: ReservationStatus.confirmed, source: ReservationSource.group, billingCycle: p.price.billingCycle,
          totalAmount: p.price.total, cityTax: p.price.cityTax,
          reservationGuests: { create: { guest: { connect: { id: p.guestId } }, isPrimary: true } },
        },
      });
    }
    return group.id;
  });
  void mailer.sendGroupSummary(groupId); // jeden souhrnný e-mail organizátorovi (best-effort)
  return getGroup(propertyId, groupId);
}

/** Znovu odešle souhrnný e-mail skupiny (scopováno na provozovnu). */
export async function emailGroupSummary(propertyId: string, id: string) {
  const g = await prisma.reservationGroup.findFirst({ where: { id, propertyId }, select: { id: true, organizer: { select: { email: true } } } });
  if (!g) throw Object.assign(new Error("not_found"), { code: "P2025" });
  if (!g.organizer?.email) throw new Error("Skupina nemá kontakt s e-mailem.");
  await mailer.sendGroupSummary(id);
  return { ok: true };
}

const memberInclude = { primaryGuest: true, roomType: true, room: true, bed: true, charges: true } as const;

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
  // Rozpad částky za celou skupinu (ubytování / pobytový poplatek / energie / položky) — pro Vyúčtování.
  const propE = await prisma.property.findUnique({ where: { id: propertyId }, select: { inventoryUnit: true, energyFeePerNight: true } });
  let acc = 0, ctax = 0, energy = 0, items = 0;
  const members = [];
  for (const r of group.reservations) {
    const folio = await computeFolio(r.id);
    charges += Number(folio.charges); paid += Number(folio.paid);
    acc += Number(r.totalAmount) - Number(r.cityTax);
    ctax += Number(r.cityTax);
    if (propE?.inventoryUnit === "bed" && !r.energyFeeExempt && Number(propE.energyFeePerNight) > 0) energy += Number(propE.energyFeePerNight) * r.nights;
    items += (r.charges ?? []).reduce((s, c) => s + Number(c.amount), 0);
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
  // Aktivní (nestornovaná) hromadná faktura skupiny — jednoznačně přes groupId.
  const invoice = await prisma.document.findFirst({ where: { propertyId, type: "invoice", status: { not: "cancelled" }, groupId: id }, select: { id: true, number: true, status: true } });
  return {
    id: group.id, code: group.code, name: group.name, note: group.note, billing: group.billing, createdAt: group.createdAt,
    organizer: group.organizerGuestId ? await prisma.guest.findUnique({ where: { id: group.organizerGuestId }, select: { firstName: true, lastName: true, email: true } }) : null,
    members, totals: { charges: charges.toFixed(2), paid: paid.toFixed(2), balance: (charges - paid).toFixed(2), accommodation: acc.toFixed(2), cityTax: ctax.toFixed(2), energy: energy.toFixed(2), items: items.toFixed(2) },
    emails, invoice,
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

/** Hromadná úhrada celé skupiny jednou akcí — vyrovná zůstatek každého člena
 * zvolenou metodou (hotově/kartou). Jedno kliknutí na recepci = celá skupina zaplacena. */
export async function payGroup(propertyId: string, id: string, method: PaymentMethod) {
  const g = await prisma.reservationGroup.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!g) throw Object.assign(new Error("not_found"), { code: "P2025" });
  const members = await prisma.reservation.findMany({ where: { groupId: id, status: { not: ReservationStatus.cancelled } }, select: { id: true } });
  let paid = 0, count = 0;
  for (const m of members) {
    const bal = Number((await computeFolio(m.id)).balance);
    if (bal > 0.005) {
      const payment = await addPayment({ reservationId: m.id, type: PaymentType.balance, amount: bal, method, description: "Hromadná úhrada skupiny" });
      await cash.recordPayment(propertyId, { paymentId: payment.id, amount: payment.amount, method, note: "Hromadná úhrada skupiny" }); // pokladní doklad (hotovost) / navázání na směnu
      paid += bal; count++;
    }
  }
  return { paid: paid.toFixed(2), count };
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
