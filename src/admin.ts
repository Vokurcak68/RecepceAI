// Admin operace majitele/správce — scopované na konkrétní provozovnu (propertyId).
import { Prisma, ReservationStatus, RoomStatus, LockType, PaymentType, PaymentMethod, PaymentStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { toDateOnly, nightsBetween, addDays } from "./dates";
import { getStayPrice } from "./pricing";
import { generateReservationCode, checkIn, checkOut, addPayment, computeFolio, addCharge, listCharges, deleteCharge } from "./reservations";
import { ChargeCategory, DocumentType } from "@prisma/client";
import * as mailer from "./mailer";

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
  const created = await prisma.reservation.create({
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
  void mailer.sendReservationCreated(created.id); // potvrzovací e-mail hostovi (best-effort)
  return created;
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

// ── Účet pokoje: připsané položky (scopováno na provozovnu) ───
export async function adminAddCharge(propertyId: string, id: string, input: { category: ChargeCategory; description?: string; quantity?: number; unitPrice: number; vatRate?: number }) {
  await assertInProperty(propertyId, id);
  return addCharge({ reservationId: id, ...input });
}
export async function adminListCharges(propertyId: string, id: string) {
  await assertInProperty(propertyId, id);
  return listCharges(id);
}
export async function adminDeleteCharge(propertyId: string, chargeId: string) {
  const c = await prisma.charge.findFirst({ where: { id: chargeId, reservation: { propertyId } }, select: { id: true } });
  if (!c) throw NOT_FOUND();
  await deleteCharge(chargeId);
  return { ok: true };
}

// ── Obsazení (kdo je v jakém pokoji + zůstatek účtu) ─────────
export async function occupancy(propertyId: string) {
  const inHouse = await prisma.reservation.findMany({
    where: { propertyId, status: ReservationStatus.checked_in },
    include: { primaryGuest: true, room: true, bed: true, roomType: true, _count: { select: { reservationGuests: true, charges: true } } },
    orderBy: { code: "asc" },
  });
  const rows = [];
  for (const r of inHouse) {
    const folio = await computeFolio(r.id);
    rows.push({
      id: r.id, code: r.code,
      unit: r.room ? `Pokoj ${r.room.number}` : r.bed ? `Lůžko ${r.bed.label}` : "—",
      roomType: r.roomType?.name ?? null,
      guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
      guests: r._count.reservationGuests || 1,
      checkInDate: r.checkInDate, checkOutDate: r.checkOutDate,
      charges: r._count.charges, balance: folio.balance.toFixed(2),
      note: r.note,
    });
  }
  return rows;
}

// ── Hosté na pokoji (spolubydlící) ───────────────────────────
export async function listReservationGuests(propertyId: string, id: string) {
  await assertInProperty(propertyId, id);
  return prisma.reservationGuest.findMany({ where: { reservationId: id }, include: { guest: true }, orderBy: { isPrimary: "desc" } });
}
type GuestInput = { firstName: string; lastName: string; email?: string; phone?: string; address?: string; documentType?: DocumentType | null; documentNumber?: string };

export async function addReservationGuest(propertyId: string, id: string, g: GuestInput) {
  await assertInProperty(propertyId, id);
  const guest = await prisma.guest.create({ data: { firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone, address: g.address, documentType: g.documentType ?? undefined, documentNumber: g.documentNumber } });
  return prisma.reservationGuest.create({ data: { reservationId: id, guestId: guest.id, isPrimary: false }, include: { guest: true } });
}
export async function updateReservationGuest(propertyId: string, rgId: string, data: Partial<GuestInput>) {
  const rg = await prisma.reservationGuest.findFirst({ where: { id: rgId, reservation: { propertyId } }, select: { guestId: true } });
  if (!rg) throw NOT_FOUND();
  await prisma.guest.update({ where: { id: rg.guestId }, data: { firstName: data.firstName, lastName: data.lastName, email: data.email, phone: data.phone, address: data.address, documentType: data.documentType ?? undefined, documentNumber: data.documentNumber } });
  return prisma.reservationGuest.findFirst({ where: { id: rgId }, include: { guest: true } });
}
export async function removeReservationGuest(propertyId: string, rgId: string) {
  const rg = await prisma.reservationGuest.findFirst({ where: { id: rgId, reservation: { propertyId } }, select: { id: true, isPrimary: true } });
  if (!rg) throw NOT_FOUND();
  if (rg.isPrimary) throw new Error("Hlavního hosta nelze odebrat.");
  await prisma.reservationGuest.delete({ where: { id: rgId } });
  return { ok: true };
}

// ── Ceník služeb (číselník) ──────────────────────────────────
export const listServiceItems = (propertyId: string) => prisma.serviceItem.findMany({ where: { propertyId }, orderBy: [{ category: "asc" }, { name: "asc" }] });
export const createServiceItem = (propertyId: string, data: { name: string; category: ChargeCategory; price: number; vatRate?: number }) =>
  prisma.serviceItem.create({ data: { propertyId, name: data.name, category: data.category, price: new Prisma.Decimal(data.price), vatRate: new Prisma.Decimal(data.vatRate ?? 21) } });
export async function updateServiceItem(propertyId: string, id: string, data: Partial<{ name: string; category: ChargeCategory; price: number; vatRate: number }>) {
  const s = await prisma.serviceItem.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!s) throw NOT_FOUND();
  return prisma.serviceItem.update({ where: { id }, data: { name: data.name, category: data.category, price: data.price != null ? new Prisma.Decimal(data.price) : undefined, vatRate: data.vatRate != null ? new Prisma.Decimal(data.vatRate) : undefined } });
}
export async function deleteServiceItem(propertyId: string, id: string) {
  await prisma.serviceItem.deleteMany({ where: { id, propertyId } });
  return { ok: true };
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

export async function updateReservationNote(propertyId: string, id: string, note: string) {
  await assertInProperty(propertyId, id);
  return prisma.reservation.update({ where: { id }, data: { note: note || null } });
}

export async function cancelReservation(propertyId: string, id: string) {
  const { count } = await prisma.reservation.updateMany({
    where: { id, propertyId }, data: { status: ReservationStatus.cancelled, holdExpiresAt: null },
  });
  if (count) void mailer.sendCancellation(id); // potvrzení storna hostovi (best-effort)
  return { ok: true };
}

// ── Úhrady a doklady o zaplacení ─────────────────────────────
/** deposit_hold je jen blokace (předautorizace), ne přijatá platba. */
const isReceived = (p: { status: PaymentStatus; type: PaymentType }) =>
  p.status === PaymentStatus.succeeded && p.type !== PaymentType.deposit_hold;

/** Seznam úhrad provozovny napříč rezervacemi (s filtrem na datum) + souhrny. */
export async function listPayments(propertyId: string, from?: Date, to?: Date) {
  const where: Prisma.PaymentWhereInput = { reservation: { propertyId } };
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: toDateOnly(addDays(to, 1)) } : {}) };
  const payments = await prisma.payment.findMany({
    where,
    include: { reservation: { select: { id: true, code: true, primaryGuest: { select: { firstName: true, lastName: true } } } } },
    orderBy: { createdAt: "desc" }, take: 1000,
  });
  let total = new Prisma.Decimal(0);
  const byMethod: Record<string, string> = {};
  for (const p of payments) {
    if (!isReceived(p)) continue;
    total = total.add(p.amount);
    const m = new Prisma.Decimal(byMethod[p.method] ?? 0).add(p.amount);
    byMethod[p.method] = m.toFixed(2);
  }
  return { payments, totals: { total: total.toFixed(2), count: payments.filter(isReceived).length, byMethod } };
}

/** Doklad o zaplacení za JEDNU úhradu. Číslo: DOK-<kód>-<pořadí platby>. */
export async function buildPaymentReceipt(propertyId: string, paymentId: string) {
  const p = await prisma.payment.findFirst({
    where: { id: paymentId, reservation: { propertyId } },
    include: { reservation: { include: { primaryGuest: true, property: true, roomType: true } } },
  });
  if (!p) throw NOT_FOUND();
  const r = p.reservation;
  const seq = await prisma.payment.count({ where: { reservationId: r.id, createdAt: { lte: p.createdAt } } });
  return {
    kind: "payment" as const,
    number: p.invoiceNumber || `DOK-${r.code.replace("RC-", "")}-${seq}`,
    issuedAt: p.createdAt,
    property: r.property,
    guest: r.primaryGuest,
    reservation: { code: r.code, checkInDate: r.checkInDate, checkOutDate: r.checkOutDate, roomType: r.roomType?.name ?? null, nights: r.nights },
    billing: { company: r.billingCompany, ico: r.billingIco, dic: r.billingDic },
    lines: [{ date: p.createdAt, type: p.type, method: p.method, description: p.description, amount: p.amount }],
    totalPaid: p.amount,
  };
}

/** Souhrnný doklad o zaplacení za celý pobyt (všechny přijaté platby). */
export async function buildStayReceipt(propertyId: string, reservationId: string) {
  const r = await getReservation(propertyId, reservationId);
  const folio = await computeFolio(reservationId);
  const lines = r.payments.filter(isReceived).map((p) => ({ date: p.createdAt, type: p.type, method: p.method, description: p.description, amount: p.amount }));
  const totalPaid = lines.reduce((s, l) => s.add(l.amount), new Prisma.Decimal(0));
  return {
    kind: "stay" as const,
    number: `DOK-${r.code.replace("RC-", "")}`,
    issuedAt: new Date(),
    property: r.property,
    guest: r.primaryGuest,
    reservation: { code: r.code, checkInDate: r.checkInDate, checkOutDate: r.checkOutDate, roomType: r.roomType?.name ?? null, nights: r.nights },
    billing: { company: r.billingCompany, ico: r.billingIco, dic: r.billingDic },
    lines, totalPaid, charges: folio.charges, balance: folio.balance,
  };
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
