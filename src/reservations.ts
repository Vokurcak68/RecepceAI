// Hlavní operace rezervačního jádra — scopované na provozovnu, s rozlišením
// jednotky pokoj/lůžko dle typu provozovny.
import {
  Prisma, ReservationStatus, PaymentType, PaymentMethod, PaymentStatus, DocumentType, InventoryUnit, RoomStatus, ChargeCategory, GroupBilling,
} from "@prisma/client";
import { prisma } from "./prisma";
import { findFreeRoom, findFreeBed, freeUnitsForType } from "./availability";
import { getStayPrice } from "./pricing";
import { addDays, nightsBetween, toDateOnly } from "./dates";
import * as mailer from "./mailer";
import { createGuest } from "./guests";

const HOLD_MINUTES = 15;
const REGISTRATION_RETENTION_YEARS = 6;

export function generateReservationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `RC-${s}`;
}

const RES_INCLUDE = { primaryGuest: true, room: true, bed: { include: { room: true } }, roomType: true, payments: true, property: true } as const;

// ── Identifikace (scopováno na provozovnu) ───────────────────
export function findReservationByCode(propertyId: string, code: string) {
  return prisma.reservation.findFirst({
    where: { propertyId, code: code.trim().toUpperCase() },
    include: RES_INCLUDE,
  });
}

export function findReservationsByLastName(propertyId: string, lastName: string) {
  return prisma.reservation.findMany({
    where: {
      propertyId,
      primaryGuest: { lastName: { equals: lastName.trim(), mode: "insensitive" } },
      status: { in: [ReservationStatus.confirmed, ReservationStatus.pending] },
    },
    include: { primaryGuest: true, roomType: true },
    orderBy: { checkInDate: "asc" },
  });
}

// ── Walk-in ──────────────────────────────────────────────────
export type GuestInput = { firstName: string; lastName: string; email?: string; phone?: string; language?: string };
export type WalkInInput = {
  propertyId: string; roomTypeId: string; from: Date; to: Date; adults: number; children?: number; childAges?: number[]; guest: GuestInput;
};

export async function createWalkInHold(input: WalkInInput) {
  const { propertyId, roomTypeId, from, to, adults, guest } = input;
  const childAges = (input.childAges ?? []).filter((a) => Number.isFinite(a));
  const children = childAges.length || (input.children ?? 0);
  const nights = nightsBetween(from, to);
  if (nights < 1) throw new Error("Pobyt musí být alespoň jednu noc.");

  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const useBed = property.inventoryUnit === InventoryUnit.bed;

  if (await freeUnitsForType(propertyId, roomTypeId, from, to) <= 0) throw new Error("Pro zvolený termín už není volná jednotka tohoto typu.");
  const roomId = useBed ? null : await findFreeRoom(propertyId, roomTypeId, from, to);
  const bedId = useBed ? await findFreeBed(propertyId, roomTypeId, from, to) : null;
  if (useBed ? !bedId : !roomId) throw new Error("Pro zvolený termín už není volná jednotka tohoto typu.");

  const price = await getStayPrice(roomTypeId, from, to, adults, childAges);
  const guestId = await createGuest(guest); // nového hosta nepárujeme dle e-mailu (napojení na stálého klienta je manuální přes adresář)

  return prisma.reservation.create({
    data: {
      code: generateReservationCode(),
      property: { connect: { id: propertyId } },
      primaryGuest: { connect: { id: guestId } },
      roomType: { connect: { id: roomTypeId } },
      ...(roomId ? { room: { connect: { id: roomId } } } : {}),
      ...(bedId ? { bed: { connect: { id: bedId } } } : {}),
      checkInDate: toDateOnly(from), checkOutDate: toDateOnly(to), nights, adults, children, childAges,
      status: ReservationStatus.hold, source: "kiosk_walkin",
      billingCycle: price.billingCycle,
      totalAmount: price.total, cityTax: price.cityTax,
      holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
      reservationGuests: { create: { guest: { connect: { id: guestId } }, isPrimary: true } },
    },
    include: RES_INCLUDE,
  });
}

export async function confirmReservation(reservationId: string) {
  const r = await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: ReservationStatus.confirmed, holdExpiresAt: null },
  });
  void mailer.sendReservationCreated(reservationId); // potvrzovací e-mail hostovi (best-effort)
  return r;
}

// ── Check-in (přiřadí pokoj nebo lůžko) ──────────────────────
export async function checkIn(reservationId: string) {
  const res = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { property: true } });
  const useBed = res.property.inventoryUnit === InventoryUnit.bed;

  let roomId = res.roomId;
  let bedId = res.bedId;
  if (useBed && !bedId) {
    bedId = await findFreeBed(res.propertyId, res.roomTypeId, res.checkInDate, res.checkOutDate);
    if (!bedId) throw new Error("Není volné lůžko k přiřazení pro check-in.");
  } else if (!useBed && !roomId) {
    roomId = await findFreeRoom(res.propertyId, res.roomTypeId, res.checkInDate, res.checkOutDate);
    if (!roomId) throw new Error("Není volný pokoj k přiřazení pro check-in.");
  }

  const updated = await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      status: ReservationStatus.checked_in, holdExpiresAt: null,
      ...(roomId ? { room: { connect: { id: roomId } } } : {}),
      ...(bedId ? { bed: { connect: { id: bedId } } } : {}),
    },
    include: RES_INCLUDE,
  });
  // Evidenční kniha: až teď (host přijel) auto-zapiš hlavního hosta, známe-li jeho údaje. Best-effort, idempotentní.
  await autoRegisterReturningGuest(reservationId, updated.primaryGuestId).catch(() => {});
  void mailer.sendCheckIn(reservationId); // uvítací e-mail (best-effort)
  return updated;
}

// ── Online check-in (portál hosta, jen self-checkin provozovny) ─
export function onlineCheckinInfo(
  res: { status: ReservationStatus; checkInDate: Date; checkOutDate: Date; onlineCheckinAt: Date | null },
  property: { selfCheckin: boolean; onlineCheckinHours: number },
) {
  const now = new Date();
  const opensAt = new Date(res.checkInDate.getTime() - property.onlineCheckinHours * 3_600_000);
  const closesAt = addDays(res.checkOutDate, 1); // do konce dne odjezdu
  const enabled = property.selfCheckin;
  const done = !!res.onlineCheckinAt;
  const available = enabled && res.status === ReservationStatus.confirmed && now >= opensAt && now < closesAt && !done;
  return { enabled, available, done, opensAt: opensAt.toISOString() };
}

export type OnlineCheckinInput = {
  fullName: string; dateOfBirth: Date; nationality: string;
  documentType?: DocumentType; documentNumber?: string; homeAddress?: string;
};

/** Online check-in pro VŠECHNY ubytované osoby. 1. osoba = primární host,
 * další se založí jako spolubydlící (ReservationGuest) + registrační záznam. */
export async function completeOnlineCheckin(reservationId: string, persons: OnlineCheckinInput[]) {
  const res = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { property: true } });
  const info = onlineCheckinInfo(res, res.property);
  if (!info.enabled) throw new Error("Online check-in není pro tuto provozovnu zapnutý.");
  if (info.done) throw new Error("Online check-in už byl dokončen.");
  if (!info.available) throw new Error("Online check-in zatím není dostupný.");
  if (!persons.length) throw new Error("Vyplňte prosím alespoň jednu osobu.");

  const reg = (guestId: string, p: OnlineCheckinInput) => addRegistrationEntry({
    reservationId, guestId, fullName: p.fullName, dateOfBirth: p.dateOfBirth, nationality: p.nationality,
    documentType: p.documentType ?? DocumentType.id_card, documentNumber: p.documentNumber ?? "", homeAddress: p.homeAddress ?? "",
    stayFrom: res.checkInDate, stayTo: res.checkOutDate,
  });

  await reg(res.primaryGuestId, persons[0]);
  for (const p of persons.slice(1)) {
    const parts = p.fullName.trim().split(/\s+/);
    const g = await prisma.guest.create({
      data: { firstName: parts[0] ?? p.fullName, lastName: parts.slice(1).join(" ") || "—", address: p.homeAddress, documentType: p.documentType ?? null, documentNumber: p.documentNumber },
    });
    await prisma.reservationGuest.upsert({
      where: { reservationId_guestId: { reservationId, guestId: g.id } },
      create: { reservationId, guestId: g.id, isPrimary: false }, update: {},
    });
    await reg(g.id, p);
  }
  return prisma.reservation.update({ where: { id: reservationId }, data: { onlineCheckinAt: new Date() } });
}

// ── Ohlašovací povinnost ─────────────────────────────────────
export type RegistrationInput = {
  reservationId: string; guestId: string; fullName: string; dateOfBirth: Date; nationality: string;
  documentType: DocumentType; documentNumber: string; homeAddress: string; visaNumber?: string;
  purposeOfStay?: string; stayFrom: Date; stayTo: Date;
};

export async function addRegistrationEntry(input: RegistrationInput) {
  const entry = await prisma.registrationEntry.create({
    data: {
      reservationId: input.reservationId, guestId: input.guestId, fullName: input.fullName,
      dateOfBirth: toDateOnly(input.dateOfBirth), nationality: input.nationality, documentType: input.documentType,
      documentNumber: input.documentNumber, homeAddress: input.homeAddress, visaNumber: input.visaNumber,
      purposeOfStay: input.purposeOfStay, stayFrom: toDateOnly(input.stayFrom), stayTo: toDateOnly(input.stayTo),
      retentionUntil: addDays(input.stayTo, 365 * REGISTRATION_RETENTION_YEARS),
    },
  });
  // Propojení knihy hostů s adresářem: doklad/adresu z evidenčního zápisu si „zapamatuje" i profil
  // hosta, aby se při příštím pobytu daly z adresáře předvyplnit (nepřepisujeme prázdnými hodnotami).
  const patch: { documentType?: DocumentType; documentNumber?: string; address?: string } = {};
  if (input.documentNumber?.trim()) { patch.documentType = input.documentType; patch.documentNumber = input.documentNumber.trim(); }
  if (input.homeAddress?.trim()) patch.address = input.homeAddress.trim();
  if (Object.keys(patch).length) await prisma.guest.update({ where: { id: input.guestId }, data: patch }).catch(() => {});
  return entry;
}

/** Věk k danému datu (z data narození). */
function ageAtDate(dob: Date, ref: Date): number {
  let a = ref.getFullYear() - dob.getFullYear();
  const m = ref.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) a--;
  return a;
}

/** Auto-zápis hosta do evidenční knihy, když ho známe z dřívějška (má dřívější zápis) nebo má vyplněný
 * profil — ať se nezadává podruhé. Volá se až při CHECK-INU (host fyzicky přijel), ne při založení
 * rezervace. Děti (do `cityTaxFreeAge` provozovny) se nezapisují. Bez data narození/národnosti/dokladu přeskočí.
 * Idempotentní: když už zápis pro tuto rezervaci+hosta existuje, nic nedělá. */
export async function autoRegisterReturningGuest(reservationId: string, guestId: string) {
  const exists = await prisma.registrationEntry.findFirst({ where: { reservationId, guestId }, select: { id: true } });
  if (exists) return;
  const res = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { checkInDate: true, checkOutDate: true, property: { select: { cityTaxFreeAge: true } } } });
  if (!res) return;
  const isChild = (dob: Date) => ageAtDate(dob, res.checkInDate) < res.property.cityTaxFreeAge;
  // 1) Máme dřívější zápis v knize → zkopíruj ho (nejúplnější zdroj).
  const prev = await prisma.registrationEntry.findFirst({ where: { guestId, reservationId: { not: reservationId } }, orderBy: { createdAt: "desc" } });
  if (prev) {
    if (isChild(prev.dateOfBirth)) return;
    await addRegistrationEntry({
      reservationId, guestId, fullName: prev.fullName, dateOfBirth: prev.dateOfBirth, nationality: prev.nationality,
      documentType: prev.documentType, documentNumber: prev.documentNumber, homeAddress: prev.homeAddress,
      visaNumber: prev.visaNumber ?? undefined, purposeOfStay: prev.purposeOfStay ?? undefined,
      stayFrom: res.checkInDate, stayTo: res.checkOutDate,
    }).catch(() => {});
    return;
  }
  // 2) Bez dřívějšího zápisu, ale klient vyplnil údaje pro evidenci v adresáři → zapiš z profilu.
  const g = await prisma.guest.findUnique({ where: { id: guestId } });
  if (g?.dateOfBirth && g.nationality && g.documentNumber) {
    if (isChild(g.dateOfBirth)) return;
    await addRegistrationEntry({
      reservationId, guestId, fullName: `${g.firstName} ${g.lastName}`.trim(), dateOfBirth: g.dateOfBirth, nationality: g.nationality,
      documentType: g.documentType ?? DocumentType.id_card, documentNumber: g.documentNumber, homeAddress: g.address ?? "",
      stayFrom: res.checkInDate, stayTo: res.checkOutDate,
    }).catch(() => {});
  }
}

// ── Platby a vyúčtování ──────────────────────────────────────
export type PaymentInput = {
  reservationId: string; type: PaymentType; amount: Prisma.Decimal | number;
  method?: PaymentMethod; status?: PaymentStatus; description?: string; invoiceNumber?: string;
};

export async function addPayment(input: PaymentInput) {
  return prisma.payment.create({
    data: {
      reservationId: input.reservationId, type: input.type, amount: new Prisma.Decimal(input.amount),
      method: input.method ?? PaymentMethod.card_terminal, status: input.status ?? PaymentStatus.succeeded,
      description: input.description, invoiceNumber: input.invoiceNumber,
    },
  });
}

export type Folio = { charges: Prisma.Decimal; paid: Prisma.Decimal; balance: Prisma.Decimal };

export async function computeFolio(reservationId: string): Promise<Folio> {
  const res = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { payments: true, charges: true, property: { select: { inventoryUnit: true, energyFeePerNight: true } } } });
  // Náklady = ubytování (totalAmount, vč. poplatku) + energie (vzdušné) + připsané položky (Charge).
  // POZN.: energie se musí počítat STEJNĚ jako řádek v dokladu (linesFromReservation, billing.ts), aby
  // „k úhradě" v rezervaci sedělo s fakturou/účtenkou (jinak balance bez energie, ale doklad s ní).
  const energyRate = Number(res.property?.energyFeePerNight ?? 0);
  const energy = (res.property?.inventoryUnit === "bed" && !res.energyFeeExempt && energyRate > 0 && res.nights > 0)
    ? new Prisma.Decimal(energyRate).mul(res.nights) : new Prisma.Decimal(0);
  let extra = new Prisma.Decimal(0);
  for (const c of res.charges) extra = extra.add(c.amount);
  // Zaplaceno = skutečné platby (záloha/doplatek/poplatek/vratka), NE položky.
  let paid = new Prisma.Decimal(0);
  for (const p of res.payments) {
    if (p.status !== PaymentStatus.succeeded) continue;
    if (p.type === PaymentType.deposit || p.type === PaymentType.balance || p.type === PaymentType.city_tax || p.type === PaymentType.refund) paid = paid.add(p.amount);
  }
  const charges = res.totalAmount.add(energy).add(extra);
  return { charges, paid, balance: charges.sub(paid) };
}

// ── Účet pokoje: připsané položky (konzumace/služby) ─────────
/** Výchozí sazba DPH dle kategorie (restaurace/strava 12 %, ostatní služby 21 %). */
const CHARGE_VAT: Record<ChargeCategory, number> = { minibar: 21, laundry: 21, ironing: 21, restaurant: 12, wellness: 21, service: 21, parking: 21, discount: 12, other: 21 };
export const CHARGE_LABEL: Record<ChargeCategory, string> = { minibar: "Minibar", laundry: "Praní", ironing: "Žehlení", wellness: "Wellness", service: "Služba", restaurant: "Restaurace", parking: "Parkování", discount: "Sleva", other: "Ostatní" };

export async function addCharge(input: { reservationId: string; category: ChargeCategory; description?: string; quantity?: number; unitPrice: number; vatRate?: number }) {
  const qty = new Prisma.Decimal(input.quantity ?? 1);
  const unit = new Prisma.Decimal(input.unitPrice);
  const amount = new Prisma.Decimal(qty.mul(unit).toFixed(2));
  return prisma.charge.create({
    data: { reservationId: input.reservationId, category: input.category, description: input.description, quantity: qty, unitPrice: unit, amount, vatRate: new Prisma.Decimal(input.vatRate ?? CHARGE_VAT[input.category]) },
  });
}
export const listCharges = (reservationId: string) => prisma.charge.findMany({ where: { reservationId }, orderBy: { createdAt: "desc" } });
export const deleteCharge = (id: string) => prisma.charge.delete({ where: { id } });

// ── Check-out ────────────────────────────────────────────────
export async function checkOut(reservationId: string) {
  const folio = await computeFolio(reservationId);
  // Kolektivní skupina se platí hromadně → jednotlivý pokoj jde odhlásit i s nevyrovnaným vlastním
  // účtem (zůstatek celé skupiny hlídá checkOutGroup). Individuální skupina i sólo rezervace: účet musí sedět.
  const grp = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { group: { select: { billing: true } } } });
  const collective = grp?.group?.billing === GroupBilling.collective;
  if (!collective && !folio.balance.isZero()) throw new Error(`Nelze odhlásit — nevyrovnaný účet: ${folio.balance.toFixed(2)} Kč.`);

  const res = await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: ReservationStatus.checked_out },
    include: { room: true, bed: true },
  });
  // Úklid se vede po POKOJÍCH (uklízečka i Recepce pracují s room.status). U lůžkové rezervace
  // proto označíme „k úklidu" POKOJ daného lůžka (ne lůžko) — ať to sedí napříč celou aplikací.
  if (res.roomId) await prisma.room.update({ where: { id: res.roomId }, data: { status: RoomStatus.dirty } });
  else if (res.bedId) { const bed = await prisma.bed.findUnique({ where: { id: res.bedId }, select: { roomId: true } }); if (bed) await prisma.room.update({ where: { id: bed.roomId }, data: { status: RoomStatus.dirty } }); }
  // Automatický požadavek na úklid po odhlášení (fronta uklízeček).
  await prisma.serviceRequest.create({
    data: { propertyId: res.propertyId, reservationId: res.id, roomId: res.roomId, bedId: res.bedId, type: "cleaning", domain: "housekeeping", description: "Úklid po odhlášení", fromGuest: false },
  });
  void mailer.sendCheckOut(reservationId); // poděkování + souhrn (best-effort)
  return { reservation: res, folio };
}

// ── Údržba ───────────────────────────────────────────────────
export async function releaseExpiredHolds(): Promise<number> {
  const { count } = await prisma.reservation.updateMany({
    where: { status: ReservationStatus.hold, holdExpiresAt: { lt: new Date() } },
    data: { status: ReservationStatus.cancelled },
  });
  return count;
}

export async function purgeExpiredRegistrations(): Promise<number> {
  const { count } = await prisma.registrationEntry.deleteMany({ where: { retentionUntil: { lt: new Date() } } });
  return count;
}
