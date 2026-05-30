// Admin operace majitele/správce — scopované na konkrétní provozovnu (propertyId).
import { Prisma, ReservationStatus, RoomStatus, LockType, PaymentType, PaymentMethod } from "@prisma/client";
import { prisma } from "./prisma";
import { toDateOnly, nightsBetween } from "./dates";
import { getStayPrice } from "./pricing";
import { generateReservationCode, checkIn, checkOut, addPayment, computeFolio } from "./reservations";

// ── Dashboard ────────────────────────────────────────────────
export async function dashboard(propertyId: string, date: Date) {
  const day = toDateOnly(date);
  const [arrivals, inHouse, departures, dirtyRooms, holds] = await Promise.all([
    prisma.reservation.findMany({
      where: { propertyId, checkInDate: day, status: { in: [ReservationStatus.confirmed, ReservationStatus.pending] } },
      include: { primaryGuest: true, roomType: true, room: true, bed: true }, orderBy: { code: "asc" },
    }),
    prisma.reservation.findMany({
      where: { propertyId, status: ReservationStatus.checked_in },
      include: { primaryGuest: true, roomType: true, room: true, bed: true }, orderBy: { checkOutDate: "asc" },
    }),
    prisma.reservation.findMany({
      where: { propertyId, checkOutDate: day, status: ReservationStatus.checked_in },
      include: { primaryGuest: true, room: true, bed: true }, orderBy: { code: "asc" },
    }),
    prisma.room.findMany({ where: { propertyId, status: RoomStatus.dirty }, orderBy: { number: "asc" } }),
    prisma.reservation.count({ where: { propertyId, status: ReservationStatus.hold } }),
  ]);
  return {
    date: day,
    counts: { arrivals: arrivals.length, inHouse: inHouse.length, departures: departures.length, dirtyRooms: dirtyRooms.length, activeHolds: holds },
    arrivals, inHouse, departures, dirtyRooms,
  };
}

// ── Rezervace ────────────────────────────────────────────────
export async function listReservations(propertyId: string, filter: { status?: string; q?: string } = {}) {
  const where: Prisma.ReservationWhereInput = { propertyId };
  if (filter.status) where.status = filter.status as ReservationStatus;
  if (filter.q) {
    where.OR = [
      { code: { contains: filter.q, mode: "insensitive" } },
      { primaryGuest: { lastName: { contains: filter.q, mode: "insensitive" } } },
      { primaryGuest: { firstName: { contains: filter.q, mode: "insensitive" } } },
    ];
  }
  return prisma.reservation.findMany({
    where, include: { primaryGuest: true, roomType: true, room: true, bed: true, payments: true },
    orderBy: { checkInDate: "desc" }, take: 200,
  });
}

export async function createReservation(input: {
  propertyId: string; roomTypeId: string; from: Date; to: Date; adults: number; children?: number;
  guest: { firstName: string; lastName: string; email?: string; phone?: string };
  billingCompany?: string; billingIco?: string; billingDic?: string;
}) {
  const { propertyId, roomTypeId, from, to, adults, children = 0, guest } = input;
  const nights = nightsBetween(from, to);
  if (nights < 1) throw new Error("Pobyt musí být alespoň jednu noc.");
  const price = await getStayPrice(roomTypeId, from, to, adults);
  const g = await prisma.guest.create({ data: { firstName: guest.firstName, lastName: guest.lastName, email: guest.email, phone: guest.phone } });
  return prisma.reservation.create({
    data: {
      code: generateReservationCode(), property: { connect: { id: propertyId } },
      primaryGuest: { connect: { id: g.id } }, roomType: { connect: { id: roomTypeId } },
      checkInDate: toDateOnly(from), checkOutDate: toDateOnly(to), nights, adults, children,
      status: ReservationStatus.confirmed, source: "manual", billingCycle: price.billingCycle,
      totalAmount: price.total, cityTax: price.cityTax,
      billingCompany: input.billingCompany, billingIco: input.billingIco, billingDic: input.billingDic,
      reservationGuests: { create: { guest: { connect: { id: g.id } }, isPrimary: true } },
    },
    include: { primaryGuest: true, roomType: true },
  });
}

// ── Detail rezervace + operace (scopováno) ───────────────────
const NOT_FOUND = () => Object.assign(new Error("not_found"), { code: "P2025" });

export async function getReservation(propertyId: string, id: string) {
  const r = await prisma.reservation.findFirst({
    where: { id, propertyId },
    include: {
      primaryGuest: true, roomType: true, room: true, bed: { include: { room: true } }, property: true,
      payments: { orderBy: { createdAt: "asc" } }, registrationEntries: true,
    },
  });
  if (!r) throw NOT_FOUND();
  return r;
}

async function assertInProperty(propertyId: string, id: string) {
  const r = await prisma.reservation.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!r) throw NOT_FOUND();
}

export async function adminCheckIn(propertyId: string, id: string) { await assertInProperty(propertyId, id); return checkIn(id); }
export async function adminCheckOut(propertyId: string, id: string) { await assertInProperty(propertyId, id); return checkOut(id); }
export async function adminFolio(propertyId: string, id: string) { await assertInProperty(propertyId, id); return computeFolio(id); }
export async function adminAddPayment(propertyId: string, id: string, input: { type: PaymentType; amount: number; method?: PaymentMethod; description?: string; invoiceNumber?: string }) {
  await assertInProperty(propertyId, id);
  return addPayment({ reservationId: id, ...input });
}

/** Sestaví podklad faktury (zejm. firmě u ubytoven). Číslo z kódu rezervace. */
export async function buildInvoice(propertyId: string, id: string) {
  const r = await getReservation(propertyId, id);
  const folio = await computeFolio(id);
  const lines: { label: string; amount: Prisma.Decimal }[] = [
    { label: `Ubytování — ${r.roomType?.name} (${r.nights} ${r.nights === 1 ? "noc" : "nocí"})`, amount: r.totalAmount.sub(r.cityTax) },
  ];
  if (!r.cityTax.isZero()) lines.push({ label: "Pobytový poplatek", amount: r.cityTax });
  for (const p of r.payments) if (p.type === PaymentType.extra) lines.push({ label: p.description ?? "Položka", amount: p.amount });
  return {
    number: `FA-${r.code.replace("RC-", "")}`,
    property: r.property,
    reservation: { code: r.code, checkInDate: r.checkInDate, checkOutDate: r.checkOutDate, nights: r.nights },
    guest: r.primaryGuest,
    billing: { company: r.billingCompany, ico: r.billingIco, dic: r.billingDic },
    lines, total: folio.charges, paid: folio.paid, balance: folio.balance,
  };
}

export async function cancelReservation(propertyId: string, id: string) {
  await prisma.reservation.updateMany({
    where: { id, propertyId }, data: { status: ReservationStatus.cancelled, holdExpiresAt: null },
  });
  return { ok: true };
}

// ── Pokoje ───────────────────────────────────────────────────
export const listRooms = (propertyId: string) =>
  prisma.room.findMany({ where: { propertyId }, include: { roomType: true, beds: true }, orderBy: { number: "asc" } });

export const createRoom = (propertyId: string, data: { roomTypeId: string; number: string; floor: number; lockType?: LockType }) =>
  prisma.room.create({ data: { ...data, propertyId } });

export const updateRoom = (propertyId: string, id: string, data: Partial<{ number: string; floor: number; status: RoomStatus; lockType: LockType; notes: string }>) =>
  prisma.room.update({ where: { id }, data }); // id je globálně unikátní; property se ověřuje v routě

export const deleteRoom = (id: string) => prisma.room.delete({ where: { id } });
export const markRoomClean = (id: string) => prisma.room.update({ where: { id }, data: { status: RoomStatus.clean } });

// ── Lůžka (ubytovna) ─────────────────────────────────────────
export const listBeds = (propertyId: string) =>
  prisma.bed.findMany({ where: { propertyId }, include: { room: { include: { roomType: true } } }, orderBy: { label: "asc" } });

export const createBed = (propertyId: string, data: { roomId: string; label: string }) =>
  prisma.bed.create({ data: { ...data, propertyId } });

export const deleteBed = (id: string) => prisma.bed.delete({ where: { id } });

// ── Typy pokojů ──────────────────────────────────────────────
export const listRoomTypes = (propertyId: string) =>
  prisma.roomType.findMany({ where: { propertyId }, include: { _count: { select: { rooms: true } } }, orderBy: { name: "asc" } });

export const createRoomType = (propertyId: string, data: {
  name: string; description?: string; capacityAdults: number; capacityChildren?: number;
  basePrice: number; weeklyPrice?: number; monthlyPrice?: number; amenities?: string[];
}) =>
  prisma.roomType.create({
    data: {
      propertyId, name: data.name, description: data.description, capacityAdults: data.capacityAdults,
      capacityChildren: data.capacityChildren ?? 0, basePrice: new Prisma.Decimal(data.basePrice),
      weeklyPrice: data.weeklyPrice != null ? new Prisma.Decimal(data.weeklyPrice) : null,
      monthlyPrice: data.monthlyPrice != null ? new Prisma.Decimal(data.monthlyPrice) : null,
      amenities: data.amenities ?? [],
    },
  });

export const updateRoomType = (id: string, data: Partial<{
  name: string; description: string; capacityAdults: number; capacityChildren: number;
  basePrice: number; weeklyPrice: number; monthlyPrice: number; amenities: string[];
}>) =>
  prisma.roomType.update({
    where: { id },
    data: {
      ...data,
      basePrice: data.basePrice != null ? new Prisma.Decimal(data.basePrice) : undefined,
      weeklyPrice: data.weeklyPrice != null ? new Prisma.Decimal(data.weeklyPrice) : undefined,
      monthlyPrice: data.monthlyPrice != null ? new Prisma.Decimal(data.monthlyPrice) : undefined,
    },
  });

// ── Ceny ─────────────────────────────────────────────────────
export const listRatePlans = (roomTypeId: string, from: Date, to: Date) =>
  prisma.ratePlan.findMany({ where: { roomTypeId, date: { gte: toDateOnly(from), lte: toDateOnly(to) } }, orderBy: { date: "asc" } });

export const upsertRatePlan = (roomTypeId: string, date: Date, price: number) =>
  prisma.ratePlan.upsert({
    where: { roomTypeId_date: { roomTypeId, date: toDateOnly(date) } },
    update: { price: new Prisma.Decimal(price) }, create: { roomTypeId, date: toDateOnly(date), price: new Prisma.Decimal(price) },
  });

// ── Evidenční kniha (scopováno přes rezervaci) ───────────────
export const listRegistrations = (propertyId: string, from: Date, to: Date) =>
  prisma.registrationEntry.findMany({
    where: { reservation: { propertyId }, stayFrom: { gte: toDateOnly(from) }, stayTo: { lte: toDateOnly(to) } },
    orderBy: { stayFrom: "desc" }, take: 500,
  });
