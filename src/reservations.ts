// Hlavní operace rezervačního jádra — scopované na provozovnu, s rozlišením
// jednotky pokoj/lůžko dle typu provozovny.
import {
  Prisma, ReservationStatus, PaymentType, PaymentMethod, PaymentStatus, DocumentType, InventoryUnit, RoomStatus,
} from "@prisma/client";
import { prisma } from "./prisma";
import { findFreeRoom, findFreeBed } from "./availability";
import { getStayPrice } from "./pricing";
import { addDays, nightsBetween, toDateOnly } from "./dates";

const HOLD_MINUTES = 15;
const REGISTRATION_RETENTION_YEARS = 6;

export function generateReservationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `RC-${s}`;
}

const RES_INCLUDE = { primaryGuest: true, room: true, bed: true, roomType: true, payments: true, property: true } as const;

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
  propertyId: string; roomTypeId: string; from: Date; to: Date; adults: number; children?: number; guest: GuestInput;
};

export async function createWalkInHold(input: WalkInInput) {
  const { propertyId, roomTypeId, from, to, adults, children = 0, guest } = input;
  const nights = nightsBetween(from, to);
  if (nights < 1) throw new Error("Pobyt musí být alespoň jednu noc.");

  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const useBed = property.inventoryUnit === InventoryUnit.bed;

  const roomId = useBed ? null : await findFreeRoom(propertyId, roomTypeId, from, to);
  const bedId = useBed ? await findFreeBed(propertyId, roomTypeId, from, to) : null;
  if (useBed ? !bedId : !roomId) throw new Error("Pro zvolený termín už není volná jednotka tohoto typu.");

  const price = await getStayPrice(roomTypeId, from, to, adults);
  const newGuest = await prisma.guest.create({
    data: { firstName: guest.firstName, lastName: guest.lastName, email: guest.email, phone: guest.phone, language: guest.language },
  });

  return prisma.reservation.create({
    data: {
      code: generateReservationCode(),
      property: { connect: { id: propertyId } },
      primaryGuest: { connect: { id: newGuest.id } },
      roomType: { connect: { id: roomTypeId } },
      ...(roomId ? { room: { connect: { id: roomId } } } : {}),
      ...(bedId ? { bed: { connect: { id: bedId } } } : {}),
      checkInDate: toDateOnly(from), checkOutDate: toDateOnly(to), nights, adults, children,
      status: ReservationStatus.hold, source: "kiosk_walkin",
      billingCycle: price.billingCycle,
      totalAmount: price.total, cityTax: price.cityTax,
      holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
      reservationGuests: { create: { guest: { connect: { id: newGuest.id } }, isPrimary: true } },
    },
    include: RES_INCLUDE,
  });
}

export async function confirmReservation(reservationId: string) {
  return prisma.reservation.update({
    where: { id: reservationId },
    data: { status: ReservationStatus.confirmed, holdExpiresAt: null },
  });
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

  return prisma.reservation.update({
    where: { id: reservationId },
    data: {
      status: ReservationStatus.checked_in, holdExpiresAt: null,
      ...(roomId ? { room: { connect: { id: roomId } } } : {}),
      ...(bedId ? { bed: { connect: { id: bedId } } } : {}),
    },
    include: RES_INCLUDE,
  });
}

// ── Ohlašovací povinnost ─────────────────────────────────────
export type RegistrationInput = {
  reservationId: string; guestId: string; fullName: string; dateOfBirth: Date; nationality: string;
  documentType: DocumentType; documentNumber: string; homeAddress: string; visaNumber?: string;
  purposeOfStay?: string; stayFrom: Date; stayTo: Date;
};

export async function addRegistrationEntry(input: RegistrationInput) {
  return prisma.registrationEntry.create({
    data: {
      reservationId: input.reservationId, guestId: input.guestId, fullName: input.fullName,
      dateOfBirth: toDateOnly(input.dateOfBirth), nationality: input.nationality, documentType: input.documentType,
      documentNumber: input.documentNumber, homeAddress: input.homeAddress, visaNumber: input.visaNumber,
      purposeOfStay: input.purposeOfStay, stayFrom: toDateOnly(input.stayFrom), stayTo: toDateOnly(input.stayTo),
      retentionUntil: addDays(input.stayTo, 365 * REGISTRATION_RETENTION_YEARS),
    },
  });
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
  const res = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { payments: true } });
  let extraCharges = new Prisma.Decimal(0);
  let paid = new Prisma.Decimal(0);
  for (const p of res.payments) {
    if (p.status !== PaymentStatus.succeeded) continue;
    if (p.type === PaymentType.extra) { extraCharges = extraCharges.add(p.amount); paid = paid.add(p.amount); }
    else if (p.type === PaymentType.deposit || p.type === PaymentType.balance || p.type === PaymentType.city_tax) paid = paid.add(p.amount);
    else if (p.type === PaymentType.refund) paid = paid.add(p.amount);
  }
  const charges = res.totalAmount.add(extraCharges);
  return { charges, paid, balance: charges.sub(paid) };
}

// ── Check-out ────────────────────────────────────────────────
export async function checkOut(reservationId: string) {
  const folio = await computeFolio(reservationId);
  if (!folio.balance.isZero()) throw new Error(`Nelze odhlásit — nevyrovnaný účet: ${folio.balance.toFixed(2)} Kč.`);

  const res = await prisma.reservation.update({
    where: { id: reservationId },
    data: { status: ReservationStatus.checked_out },
    include: { room: true, bed: true },
  });
  if (res.roomId) await prisma.room.update({ where: { id: res.roomId }, data: { status: RoomStatus.dirty } });
  if (res.bedId) await prisma.bed.update({ where: { id: res.bedId }, data: { status: RoomStatus.dirty } });
  // Automatický požadavek na úklid po odhlášení (fronta uklízeček).
  await prisma.serviceRequest.create({
    data: { propertyId: res.propertyId, reservationId: res.id, roomId: res.roomId, bedId: res.bedId, type: "cleaning", domain: "housekeeping", description: "Úklid po odhlášení", fromGuest: false },
  });
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
