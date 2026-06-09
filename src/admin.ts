// Admin operace majitele/správce — scopované na konkrétní provozovnu (propertyId).
import { Prisma, ReservationStatus, RoomStatus, LockType, PaymentType, PaymentMethod, PaymentStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { toDateOnly, nightsBetween, addDays } from "./dates";
import { getStayPrice } from "./pricing";
import { freeUnitsForType, overlapWhere } from "./availability";
import { InventoryUnit } from "@prisma/client";
import { generateReservationCode, checkIn, checkOut, addPayment, computeFolio, addCharge, listCharges, deleteCharge, addRegistrationEntry, autoRegisterReturningGuest } from "./reservations";
import { ChargeCategory, DocumentType } from "@prisma/client";
import * as mailer from "./mailer";
import { createGuest, previousStaysCount } from "./guests";
import { currentOccupantsByBed } from "./occupancy";
import { computeCancellationFee } from "./policies";

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
    where, include: { primaryGuest: true, roomType: true, room: true, bed: true, payments: true, group: { select: { id: true, code: true, name: true } } },
    orderBy: { createdAt: "desc" }, take: 200, // nejnovější (dle vzniku) nahoře
  });
}

export async function createReservation(input: {
  propertyId: string; roomTypeId: string; from: Date; to: Date; adults: number; children?: number; childAges?: number[];
  guest: { firstName: string; lastName: string; email?: string; phone?: string; language?: string };
  billingCompany?: string; billingIco?: string; billingDic?: string; deferEmail?: boolean; bedId?: string;
  prepayDays?: number; // platba předem: úhrada nejpozději N dnů před příjezdem, jinak auto-storno
}) {
  const { propertyId, roomTypeId, from, to, adults, guest } = input;
  const childAges = (input.childAges ?? []).filter((a) => Number.isFinite(a));
  const children = childAges.length || (input.children ?? 0);
  const nights = nightsBetween(from, to);
  if (nights < 1) throw new Error("Pobyt musí být alespoň jednu noc.");
  if (await freeUnitsForType(propertyId, roomTypeId, from, to) <= 0)
    throw new Error("Pro zvolený termín už není volná jednotka tohoto typu (předešlo se přebookování).");
  // Konkrétní lůžko (nepovinné) — tvrdá kontrola, že JE volné v daném termínu (i pro dlouhodobé/sekvenční rezervace).
  if (input.bedId) {
    const bed = await prisma.bed.findFirst({ where: { id: input.bedId, room: { propertyId, roomTypeId } }, select: { id: true } });
    if (!bed) throw new Error("Neplatné lůžko pro tento typ.");
    const clash = await prisma.reservation.findFirst({ where: { bedId: input.bedId, ...overlapWhere(from, to) }, select: { id: true } });
    if (clash) throw new Error("Zvolené lůžko je v tomto termínu už obsazené.");
  }
  const price = await getStayPrice(roomTypeId, from, to, adults, childAges);
  // Platba předem: lhůta = příjezd − N dnů, nikdy do minulosti (rezervace na poslední chvíli → dnešek).
  // Firemní rezervace (faktura) se neplatí předem QR platbou → lhůtu nenastavujeme.
  const prepayDueAt = input.prepayDays && input.prepayDays > 0 && !input.billingCompany
    ? (() => { const d = addDays(toDateOnly(from), -input.prepayDays!); const today = toDateOnly(new Date()); return d < today ? today : d; })()
    : null;
  const gId = await createGuest(guest); // nového hosta nepárujeme dle e-mailu (napojení na stálého klienta je manuální přes adresář)
  const created = await prisma.reservation.create({
    data: {
      code: generateReservationCode(), property: { connect: { id: propertyId } },
      primaryGuest: { connect: { id: gId } }, roomType: { connect: { id: roomTypeId } },
      ...(input.bedId ? { bed: { connect: { id: input.bedId } } } : {}),
      checkInDate: toDateOnly(from), checkOutDate: toDateOnly(to), nights, adults, children, childAges,
      status: ReservationStatus.confirmed, source: "manual", billingCycle: price.billingCycle,
      totalAmount: price.total, cityTax: price.cityTax, prepayDueAt,
      billingCompany: input.billingCompany, billingIco: input.billingIco, billingDic: input.billingDic,
      reservationGuests: { create: { guest: { connect: { id: gId } }, isPrimary: true } },
    },
    include: { primaryGuest: true, roomType: true },
  });
  // U platby zálohou se potvrzení odloží — pošle se jeden e-mail rovnou se zálohovou fakturou (viz proforma endpoint).
  if (!input.deferEmail) void mailer.sendReservationCreated(created.id); // potvrzovací e-mail hostovi (best-effort)
  return created;
}

// ── Detail rezervace + operace (scopováno) ───────────────────
const NOT_FOUND = () => Object.assign(new Error("not_found"), { code: "P2025" });

export async function getReservation(propertyId: string, id: string) {
  const r = await prisma.reservation.findFirst({
    where: { id, propertyId },
    include: {
      primaryGuest: true, roomType: true, room: true, bed: { include: { room: true } }, property: true,
      payments: { orderBy: { createdAt: "asc" } }, registrationEntries: true, review: true,
      group: { select: { id: true, code: true, name: true } },
      company: { select: { id: true, name: true } },
      personRate: { select: { id: true, name: true, pricePerNight: true } },
      bedRate: { select: { id: true, name: true, pricePerNight: true } },
    },
  });
  if (!r) throw NOT_FOUND();
  const previousStays = await previousStaysCount(propertyId, r.primaryGuestId, r.id); // pro odznak „vrací se"
  // Propojení s knihou hostů: poslední evidenční zápis tohoto hosta (z jakéhokoli pobytu) — pro
  // předvyplnění evidenční knihy (doklad, datum narození, národnost, adresa) u vracejícího se hosta.
  const lastReg = await prisma.registrationEntry.findFirst({
    where: { guestId: r.primaryGuestId },
    orderBy: { createdAt: "desc" },
    select: { fullName: true, dateOfBirth: true, nationality: true, documentType: true, documentNumber: true, homeAddress: true },
  });
  return { ...r, previousStays, primaryGuestLastReg: lastReg };
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
/** Naúčtuje položku z ceníku (ServiceItem) na účet aktuálního hosta pokoje daného
 * servisního požadavku (praní/žehlení/minibar od personálu). */
export async function chargeFromRequest(propertyId: string, requestId: string, serviceItemId: string, quantity: number) {
  const req = await prisma.serviceRequest.findFirst({ where: { id: requestId, propertyId }, select: { roomId: true } });
  if (!req) throw NOT_FOUND();
  if (!req.roomId) throw new Error("Požadavek není u konkrétního pokoje — nelze naúčtovat.");
  const tomorrow = addDays(toDateOnly(new Date()), 1);
  const occ = await prisma.reservation.findFirst({ where: { propertyId, roomId: req.roomId, status: ReservationStatus.checked_in, checkInDate: { lt: tomorrow } }, orderBy: { checkInDate: "desc" }, select: { id: true } });
  if (!occ) throw new Error("Pokoj není obsazen — službu nelze naúčtovat.");
  const item = await prisma.serviceItem.findFirst({ where: { id: serviceItemId, propertyId } });
  if (!item) throw new Error("Neplatná položka ceníku.");
  return addCharge({ reservationId: occ.id, category: item.category, description: item.name, quantity, unitPrice: Number(item.price), vatRate: Number(item.vatRate) });
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

// ── UBYPORT: hlášení ubytovaných cizinců (podklad pro Policii ČR) ─
const isForeign = (nat: string) => { const n = (nat || "").toLowerCase().trim(); return !(n === "cz" || n.includes("česk") || n.includes("cesk") || n.includes("czech")); };

export async function ubyportData(propertyId: string, from: Date, to: Date, all: boolean) {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const rows = await prisma.registrationEntry.findMany({
    where: { reservation: { propertyId }, stayFrom: { lte: toDateOnly(to) }, stayTo: { gte: toDateOnly(from) } },
    orderBy: [{ stayFrom: "asc" }, { fullName: "asc" }],
  });
  const filtered = all ? rows : rows.filter((r) => isForeign(r.nationality));
  return {
    ubytovatel: { nazev: p.name, ulice: p.street ?? "", mesto: p.city ?? "", ico: p.ico ?? "", dic: p.dic ?? "" },
    pocet: filtered.length,
    entries: filtered.map((r) => ({
      jmeno: r.fullName, datumNarozeni: r.dateOfBirth, narodnost: r.nationality,
      druhDokladu: r.documentType, cisloDokladu: r.documentNumber, vizum: r.visaNumber ?? "",
      adresa: r.homeAddress, ucelPobytu: r.purposeOfStay ?? "", pobytOd: r.stayFrom, pobytDo: r.stayTo,
    })),
  };
}

// ── Přiřazení / změna pokoje-lůžka rezervaci (tape chart + detail) ───
// `reprice` (jen u pokoje s jiným typem): "recompute" = cena dle nového pokoje;
// "keep" = host platí původní cenu (rozdíl se připíše jako Sleva/Příplatek na účet).
export async function assignUnit(propertyId: string, id: string, unitId: string, reprice?: "recompute" | "keep") {
  await assertInProperty(propertyId, id);
  const res = await prisma.reservation.findFirst({ where: { id, propertyId }, include: { property: true } });
  if (!res) throw NOT_FOUND();
  const useBed = res.property.inventoryUnit === InventoryUnit.bed;
  if (useBed) {
    const bed = await prisma.bed.findFirst({ where: { id: unitId, room: { propertyId, roomTypeId: res.roomTypeId } }, select: { id: true } });
    if (!bed) throw new Error("Neplatné lůžko pro tento typ.");
    const clash = await prisma.reservation.findFirst({ where: { id: { not: id }, bedId: unitId, ...overlapWhere(res.checkInDate, res.checkOutDate) }, select: { id: true } });
    if (clash) throw new Error("Lůžko je v tomto termínu obsazené.");
    return prisma.reservation.update({ where: { id }, data: { bedId: unitId } });
  }
  // Pokoj — povolíme i JINÝ typ, pokud kapacitně stačí počtu osob.
  const room = await prisma.room.findFirst({ where: { id: unitId, propertyId }, select: { id: true, roomTypeId: true, roomType: { select: { capacityAdults: true, maxExtraBeds: true } } } });
  if (!room) throw new Error("Neplatný pokoj.");
  const people = res.adults + (res.children ?? 0);
  if (room.roomType.capacityAdults + room.roomType.maxExtraBeds < people) throw new Error("Pokoj nemá dostatečnou kapacitu pro počet osob.");
  const clash = await prisma.reservation.findFirst({ where: { id: { not: id }, roomId: unitId, ...overlapWhere(res.checkInDate, res.checkOutDate) }, select: { id: true } });
  if (clash) throw new Error("Pokoj je v tomto termínu obsazený.");
  const typeChanged = room.roomTypeId !== res.roomTypeId;
  const oldNet = Number(res.totalAmount) - Number(res.cityTax); // původní cena ubytování (bez pobyt. poplatku)
  await prisma.reservation.update({ where: { id }, data: { roomId: unitId, ...(typeChanged ? { roomTypeId: room.roomTypeId } : {}) } });
  if (typeChanged && reprice) {
    await recalcRoomAccommodation(id); // cena dle nového pokoje (+ přistýlky)
    if (reprice === "keep") {
      const after = await prisma.reservation.findUniqueOrThrow({ where: { id }, select: { totalAmount: true, cityTax: true } });
      const newNet = Number(after.totalAmount) - Number(after.cityTax);
      const adj = Math.round((oldNet - newNet) * 100) / 100; // <0 = sleva (dražší pokoj), >0 = příplatek
      if (Math.abs(adj) >= 0.01) {
        await addCharge({ reservationId: id, category: ChargeCategory.discount, unitPrice: adj,
          description: adj < 0 ? "Sleva — přesun do dražšího pokoje (ponechána původní cena)" : "Příplatek — přesun do levnějšího pokoje (ponechána původní cena)" });
      }
    }
  }
  return prisma.reservation.findUnique({ where: { id } });
}

// ── E-maily hostovi: přehled + znovuodeslání (scopováno) ─────
export async function adminListEmails(propertyId: string, id: string) {
  await assertInProperty(propertyId, id);
  return mailer.listEmails(id);
}
export async function adminResendEmail(propertyId: string, id: string, type: string) {
  await assertInProperty(propertyId, id);
  const r = await prisma.reservation.findUnique({ where: { id }, include: { primaryGuest: true } });
  if (!r?.primaryGuest?.email) throw new Error("Host nemá vyplněný e-mail — nelze odeslat.");
  await mailer.resend(id, type);
  return mailer.listEmails(id);
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

// ── Přehled pokojů („room rack") — vše o pokoji na jednom místě ──
export async function roomBoard(propertyId: string) {
  const today = toDateOnly(new Date());
  const tomorrow = addDays(today, 1);
  const [rooms, inHouse, arrivals, reqGroups] = await Promise.all([
    prisma.room.findMany({ where: { propertyId }, include: { roomType: { select: { name: true } } }, orderBy: [{ floor: "asc" }, { number: "asc" }] }),
    prisma.reservation.findMany({ where: { propertyId, status: ReservationStatus.checked_in, roomId: { not: null }, checkInDate: { lt: tomorrow } }, select: { id: true, roomId: true, checkInDate: true, checkOutDate: true, doNotDisturb: true, primaryGuest: { select: { firstName: true, lastName: true } } }, orderBy: { checkInDate: "asc" } }),
    prisma.reservation.findMany({ where: { propertyId, status: ReservationStatus.confirmed, roomId: { not: null }, checkInDate: { gte: today, lt: tomorrow } }, select: { id: true, roomId: true, primaryGuest: { select: { firstName: true, lastName: true } } } }),
    prisma.serviceRequest.groupBy({ by: ["roomId", "domain"], where: { propertyId, roomId: { not: null }, status: { in: ["open", "in_progress"] } }, _count: { _all: true } }),
  ]);
  const occ = new Map(inHouse.map((r) => [r.roomId!, r]));
  const arr = new Map(arrivals.map((r) => [r.roomId!, r]));
  const balances = new Map<string, string>();
  await Promise.all(inHouse.map(async (r) => { balances.set(r.roomId!, (await computeFolio(r.id)).balance.toFixed(2)); }));
  const reqs = new Map<string, { housekeeping: number; maintenance: number }>();
  for (const g of reqGroups) {
    const m = reqs.get(g.roomId!) ?? { housekeeping: 0, maintenance: 0 };
    if (g.domain === "maintenance") m.maintenance += g._count._all; else m.housekeeping += g._count._all;
    reqs.set(g.roomId!, m);
  }
  const todayMs = today.getTime();
  return rooms.map((r) => {
    const o = occ.get(r.id); const a = arr.get(r.id); const rq = reqs.get(r.id) ?? { housekeeping: 0, maintenance: 0 };
    return {
      id: r.id, number: r.number, floor: r.floor, roomType: r.roomType?.name ?? null, status: r.status,
      posX: r.posX, posY: r.posY, w: r.w, h: r.h,
      occupant: o ? { reservationId: o.id, name: `${o.primaryGuest.firstName} ${o.primaryGuest.lastName}`, checkInDate: o.checkInDate, checkOutDate: o.checkOutDate, departsToday: o.checkOutDate.getTime() === todayMs, balance: balances.get(r.id) ?? "0", dnd: o.doNotDisturb } : null,
      arrival: a ? { reservationId: a.id, name: `${a.primaryGuest.firstName} ${a.primaryGuest.lastName}` } : null,
      openHousekeeping: rq.housekeeping, openMaintenance: rq.maintenance,
    };
  });
}

/** Uloží rozložení pokojů na grafickém půdorysu (souřadnice/velikost). Scopováno na provozovnu. */
export async function setRoomLayout(propertyId: string, rooms: { id: string; posX: number; posY: number; w: number; h: number }[]) {
  const owned = new Set((await prisma.room.findMany({ where: { id: { in: rooms.map((r) => r.id) }, propertyId }, select: { id: true } })).map((r) => r.id));
  const ops = rooms.filter((r) => owned.has(r.id)).map((r) =>
    prisma.room.update({ where: { id: r.id }, data: { posX: Math.round(r.posX), posY: Math.round(r.posY), w: Math.round(r.w), h: Math.round(r.h) } }));
  await prisma.$transaction(ops);
  return { saved: ops.length };
}

/** Detail pokoje — vše pro centrální ovládání: rezervace na pokoji, aktuální host
 * (+ zůstatek), otevřené požadavky. */
export async function roomDetail(propertyId: string, roomId: string) {
  const room = await prisma.room.findFirst({ where: { id: roomId, propertyId }, include: { roomType: { select: { id: true, name: true } } } });
  if (!room) throw NOT_FOUND();
  const today = toDateOnly(new Date());
  const tomorrow = addDays(today, 1);
  const since = addDays(today, -60);
  const reservations = await prisma.reservation.findMany({
    where: { propertyId, roomId, status: { not: ReservationStatus.cancelled }, checkOutDate: { gte: since } },
    include: { primaryGuest: { select: { firstName: true, lastName: true } } },
    orderBy: { checkInDate: "asc" }, take: 50,
  });
  // Otevřené požadavky + nedávno dokončené (3 dny) s poznámkou/fotkou — ať recepce vidí, co úklid/údržba našli (a může naúčtovat).
  const since3 = addDays(today, -3);
  const requests = await prisma.serviceRequest.findMany({
    where: {
      propertyId, roomId,
      OR: [
        { status: { in: ["open", "in_progress"] } },
        { status: "done", resolvedAt: { gte: since3 }, OR: [{ note: { not: null } }, { imageUrls: { isEmpty: false } }] },
      ],
    },
    include: { resolvedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" }, take: 30,
  });
  // Aktuální host = ubytovaný, který už přijel; při více se vezme nejpozdější příjezd.
  const occ = reservations.filter((r) => r.status === ReservationStatus.checked_in && r.checkInDate < tomorrow).sort((a, b) => (a.checkInDate < b.checkInDate ? 1 : -1))[0] ?? null;
  const balances = new Map<string, string>();
  await Promise.all(reservations.map(async (r) => { balances.set(r.id, (await computeFolio(r.id)).balance.toFixed(2)); }));
  return {
    room: { id: room.id, number: room.number, floor: room.floor, status: room.status, lockType: room.lockType, notes: room.notes ?? "", roomType: { id: room.roomType.id, name: room.roomType.name } },
    occupantId: occ?.id ?? null, occupantBalance: occ ? (balances.get(occ.id) ?? null) : null, occupantDnd: occ?.doNotDisturb ?? false,
    reservations: reservations.map((r) => ({ id: r.id, code: r.code, guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`, status: r.status, checkInDate: r.checkInDate, checkOutDate: r.checkOutDate, balance: balances.get(r.id) ?? "0" })),
    requests: requests.map((q) => ({ id: q.id, type: q.type, domain: q.domain, status: q.status, description: q.description, note: q.note, imageUrls: q.imageUrls, resolvedAt: q.resolvedAt, resolvedByName: q.resolvedBy?.name ?? null, createdAt: q.createdAt })),
  };
}

/** Přehled lůžek z REZERVACÍ (sjednoceno — dlouhodobé i krátkodobé jsou rezervace na lůžko).
 * Pro každé lůžko: aktuální obyvatel (rezervace kryjící dnešek) + počet nadcházejících rezervací. */
export async function bedReservationBoard(propertyId: string) {
  const today = toDateOnly(new Date());
  const beds = await prisma.bed.findMany({
    where: { propertyId },
    include: { room: { select: { id: true, number: true, floor: true, roomTypeId: true, posX: true, posY: true, w: true, h: true } } },
    orderBy: [{ room: { floor: "asc" } }, { label: "asc" }],
  });
  const resv = await prisma.reservation.findMany({
    where: { propertyId, bedId: { not: null }, status: { in: [ReservationStatus.confirmed, ReservationStatus.checked_in] }, checkOutDate: { gt: today } },
    include: { primaryGuest: { select: { firstName: true, lastName: true } }, company: { select: { name: true } } },
    orderBy: { checkInDate: "asc" },
  });
  const byBed = new Map<string, typeof resv>();
  for (const r of resv) { const a = byBed.get(r.bedId!) ?? []; a.push(r); byBed.set(r.bedId!, a); }
  const occByBed = await currentOccupantsByBed(propertyId); // konkrétní osoba na lůžku dnes (rotace)
  return beds.map((b) => {
    const list = byBed.get(b.id) ?? [];
    const cur = list.find((r) => r.checkInDate <= today && r.checkOutDate > today) ?? null;
    const upcoming = list.filter((r) => r.checkInDate > today);
    return {
      bedId: b.id, label: b.label, roomId: b.room.id, roomNumber: b.room.number, floor: b.room.floor, roomTypeId: b.room.roomTypeId, status: b.status,
      roomPosX: b.room.posX, roomPosY: b.room.posY, roomW: b.room.w, roomH: b.room.h,
      current: cur ? { reservationId: cur.id, code: cur.code, guestName: occByBed.get(b.id) ?? `${cur.primaryGuest.firstName} ${cur.primaryGuest.lastName}`, companyName: cur.company?.name ?? null, fromDate: cur.checkInDate, toDate: cur.checkOutDate, status: cur.status } : null,
      upcoming: upcoming.length, nextFrom: upcoming[0]?.checkInDate ?? null,
    };
  });
}

/** Volná lůžka daného typu pro termín — pro nepovinný výběr konkrétního lůžka v průvodci. */
export async function freeBedsForType(propertyId: string, roomTypeId: string, fromStr: string, toStr: string) {
  const from = toDateOnly(new Date(fromStr)), to = toDateOnly(new Date(toStr));
  const beds = await prisma.bed.findMany({ where: { room: { propertyId, roomTypeId }, status: { not: RoomStatus.out_of_service } }, orderBy: { label: "asc" }, select: { id: true, label: true, room: { select: { number: true } } } });
  if (!beds.length) return [];
  const clashes = await prisma.reservation.findMany({ where: { propertyId, bedId: { in: beds.map((b) => b.id) }, ...overlapWhere(from, to) }, select: { bedId: true } });
  const taken = new Set(clashes.map((c) => c.bedId));
  return beds.map((b) => ({ id: b.id, label: `Lůžko ${b.label} · pok. ${b.room.number}`, free: !taken.has(b.id) }));
}

/** Rezervace na konkrétním lůžku (časová osa) — pro správu lůžka. */
export async function listBedReservations(propertyId: string, bedId: string) {
  const bed = await prisma.bed.findFirst({ where: { id: bedId, propertyId }, select: { id: true, label: true, room: { select: { number: true, roomTypeId: true } } } });
  if (!bed) throw NOT_FOUND();
  const items = await prisma.reservation.findMany({
    where: { propertyId, bedId, status: { not: ReservationStatus.cancelled } },
    include: { primaryGuest: { select: { firstName: true, lastName: true } }, company: { select: { name: true } } },
    orderBy: { checkInDate: "desc" }, take: 100,
  });
  return {
    bed: { id: bed.id, label: bed.label, roomNumber: bed.room.number, roomTypeId: bed.room.roomTypeId },
    items: items.map((r) => ({ id: r.id, code: r.code, guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`, companyName: r.company?.name ?? null, fromDate: r.checkInDate, toDate: r.checkOutDate, status: r.status, totalAmount: r.totalAmount })),
  };
}

/** Nastaví cenu ubytování rezervace (totalAmount = ubytování + pobyt. poplatek) — pro per-person ceník (součet sazeb osob). */
export async function setReservationAccommodation(propertyId: string, id: string, accommodation: number) {
  const r = await prisma.reservation.findFirst({ where: { id, propertyId }, select: { id: true, cityTax: true } });
  if (!r) throw NOT_FOUND();
  return prisma.reservation.update({ where: { id }, data: { totalAmount: new Prisma.Decimal(accommodation).add(r.cityTax) }, select: { id: true, totalAmount: true } });
}

/** Energetický poplatek („vzdušné") osvobození na rezervaci (lůžkové/firemní pobyty). */
export async function setReservationEnergyExempt(propertyId: string, id: string, exempt: boolean) {
  await assertInProperty(propertyId, id);
  return prisma.reservation.update({ where: { id }, data: { energyFeeExempt: exempt }, select: { id: true, energyFeeExempt: true } });
}

/** Sjednaná sazba za lůžko/noc (ceník) na rezervaci → přepočítá cenu ubytování = sazba × nocí (+ pobyt. poplatek).
 * Výslednou částku lze pak ručně přepsat přes setReservationAccommodation. */
export async function setReservationBedRate(propertyId: string, id: string, bedRateId: string | null) {
  const r = await prisma.reservation.findFirst({ where: { id, propertyId }, select: { id: true, nights: true, cityTax: true } });
  if (!r) throw NOT_FOUND();
  let totalAmount: Prisma.Decimal | undefined;
  if (bedRateId) {
    const rate = await prisma.bedRate.findFirst({ where: { id: bedRateId, propertyId }, select: { pricePerNight: true } });
    if (!rate) throw NOT_FOUND();
    totalAmount = rate.pricePerNight.mul(r.nights).add(r.cityTax);
  }
  return prisma.reservation.update({ where: { id }, data: { bedRateId, ...(totalAmount !== undefined ? { totalAmount } : {}) }, select: { id: true, bedRateId: true, totalAmount: true } });
}

/** Booking pole dlouhodobé/firemní rezervace: splatnost, zaplaceno do, VIP. */
export async function setReservationBooking(propertyId: string, id: string, patch: { payUntil?: string | null; paidTo?: string | null; vip?: boolean }) {
  await assertInProperty(propertyId, id);
  return prisma.reservation.update({
    where: { id },
    data: {
      ...(patch.payUntil !== undefined ? { payUntil: patch.payUntil ? new Date(patch.payUntil) : null } : {}),
      ...(patch.paidTo !== undefined ? { paidTo: patch.paidTo ? new Date(patch.paidTo) : null } : {}),
      ...(patch.vip !== undefined ? { vip: patch.vip } : {}),
    },
    select: { id: true, payUntil: true, paidTo: true, vip: true },
  });
}

/** Přiřadí typ osoby (číselník) k rezervaci; volitelně přepočítá cenu ubytování = sazba × nocí (+ pobyt. poplatek). */
export async function setReservationPersonRate(propertyId: string, id: string, personRateId: string | null, applyPrice = true) {
  const r = await prisma.reservation.findFirst({ where: { id, propertyId }, select: { id: true, nights: true, cityTax: true } });
  if (!r) throw NOT_FOUND();
  let totalAmount: Prisma.Decimal | undefined;
  if (personRateId && applyPrice) {
    const rate = await prisma.personRate.findFirst({ where: { id: personRateId, propertyId }, select: { pricePerNight: true } });
    if (!rate) throw NOT_FOUND();
    totalAmount = rate.pricePerNight.mul(r.nights).add(r.cityTax);
  }
  return prisma.reservation.update({ where: { id }, data: { personRateId, ...(totalAmount !== undefined ? { totalAmount } : {}) }, select: { id: true, personRateId: true, totalAmount: true } });
}

/** Domovská obrazovka recepce: dnešní příjezdy/odjezdy (se zůstatkem), ubytovaní, volno, nezaplacené, k úklidu. */
export async function receptionToday(propertyId: string) {
  const day = toDateOnly(new Date());
  const prop = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { inventoryUnit: true } });
  const gName = (r: { primaryGuest: { firstName: string; lastName: string } }) => `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`;
  const whereOf = (r: { room: { number: string } | null; bed: { label: string } | null; roomType?: { name: string } | null }) =>
    r.room ? `Pokoj ${r.room.number}` : r.bed ? `Lůžko ${r.bed.label}` : `${r.roomType?.name ?? "—"} (nepřiřazeno)`;

  const [arr, inHouse, dep, dirtyRooms] = await Promise.all([
    prisma.reservation.findMany({ where: { propertyId, checkInDate: day, status: { in: [ReservationStatus.confirmed, ReservationStatus.pending] } }, include: { primaryGuest: { select: { firstName: true, lastName: true } }, roomType: { select: { name: true } }, room: { select: { number: true } }, bed: { select: { label: true } } }, orderBy: { code: "asc" } }),
    prisma.reservation.findMany({ where: { propertyId, status: ReservationStatus.checked_in }, include: { primaryGuest: { select: { firstName: true, lastName: true } }, room: { select: { number: true } }, bed: { select: { label: true } } }, orderBy: { checkOutDate: "asc" } }),
    prisma.reservation.findMany({ where: { propertyId, checkOutDate: day, status: ReservationStatus.checked_in }, include: { primaryGuest: { select: { firstName: true, lastName: true } }, room: { select: { number: true } }, bed: { select: { label: true } } }, orderBy: { code: "asc" } }),
    prisma.room.count({ where: { propertyId, status: RoomStatus.dirty } }),
  ]);

  // zůstatky ubytovaných (pro odjezdy i nezaplacené)
  const bal = new Map<string, string>();
  await Promise.all(inHouse.map(async (r) => bal.set(r.id, (await computeFolio(r.id)).balance.toFixed(2))));
  const depIds = new Set(dep.map((d) => d.id));
  for (const d of dep) if (!bal.has(d.id)) bal.set(d.id, (await computeFolio(d.id)).balance.toFixed(2));

  // volné jednotky
  let freeUnits: number; let unitLabel: string;
  if (prop.inventoryUnit === InventoryUnit.bed) {
    const [beds, occRes, occBed] = await Promise.all([
      prisma.bed.count({ where: { propertyId, status: { not: RoomStatus.out_of_service } } }),
      prisma.reservation.count({ where: { propertyId, bedId: { not: null }, status: ReservationStatus.checked_in } }),
      prisma.bedOccupancy.count({ where: { propertyId, status: "active", fromDate: { lte: day }, toDate: { gt: day } } }),
    ]);
    freeUnits = Math.max(0, beds - occRes - occBed); unitLabel = "lůžek";
  } else {
    const rooms = await prisma.room.count({ where: { propertyId, status: { not: RoomStatus.out_of_service } } });
    freeUnits = Math.max(0, rooms - new Set(inHouse.map((r) => r.roomId).filter(Boolean)).size); unitLabel = "pokojů";
  }

  return {
    date: day, freeUnits, unitLabel, dirtyRooms, inHouseCount: inHouse.length,
    arrivals: arr.map((r) => ({ id: r.id, code: r.code, guestName: gName(r), where: whereOf(r), assigned: !!(r.roomId || r.bedId) })),
    departures: dep.map((r) => ({ id: r.id, code: r.code, guestName: gName(r), where: whereOf(r), balance: bal.get(r.id) ?? "0" })),
    unpaid: inHouse.filter((r) => Number(bal.get(r.id) ?? "0") > 0 && !depIds.has(r.id)).map((r) => ({ id: r.id, code: r.code, guestName: gName(r), where: whereOf(r), balance: bal.get(r.id)! })),
  };
}

/** Report příchodů/odchodů za období — rezervace (hotel) i lůžková obsazenost (ubytovna). */
export async function movementsReport(propertyId: string, from: Date, to: Date) {
  const between = { gte: from, lte: to };
  const [resArr, resDep, occArr, occDep] = await Promise.all([
    prisma.reservation.findMany({ where: { propertyId, status: { not: ReservationStatus.cancelled }, checkInDate: between }, include: { primaryGuest: { select: { firstName: true, lastName: true } }, room: { select: { number: true } }, bed: { select: { label: true } }, roomType: { select: { name: true } }, company: { select: { name: true } } } }),
    prisma.reservation.findMany({ where: { propertyId, status: { not: ReservationStatus.cancelled }, checkOutDate: between }, include: { primaryGuest: { select: { firstName: true, lastName: true } }, room: { select: { number: true } }, bed: { select: { label: true } }, roomType: { select: { name: true } }, company: { select: { name: true } } } }),
    prisma.bedOccupancy.findMany({ where: { propertyId, fromDate: between }, include: { occupant: { select: { firstName: true, lastName: true } }, bed: { select: { label: true } }, company: { select: { name: true } } } }),
    prisma.bedOccupancy.findMany({ where: { propertyId, toDate: between }, include: { occupant: { select: { firstName: true, lastName: true } }, bed: { select: { label: true } }, company: { select: { name: true } } } }),
  ]);
  const resWhere = (r: { room: { number: string } | null; bed: { label: string } | null; roomType: { name: string } | null }) => r.room ? `Pokoj ${r.room.number}` : r.bed ? `Lůžko ${r.bed.label}` : (r.roomType?.name ?? "—") + " (nepřiřazeno)";
  const mapRes = (list: typeof resArr, dateOf: (r: typeof resArr[number]) => Date) => list.map((r) => ({ date: dateOf(r), kind: "reservation" as const, name: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`, where: resWhere(r), code: r.code, companyName: r.company?.name ?? null }));
  const mapOcc = (list: typeof occArr, dateOf: (o: typeof occArr[number]) => Date) => list.map((o) => ({ date: dateOf(o), kind: "occupancy" as const, name: `${o.occupant.firstName} ${o.occupant.lastName}`, where: `Lůžko ${o.bed.label}`, code: null as string | null, companyName: o.company?.name ?? null }));
  const byDate = <T extends { date: Date; name: string }>(a: T, b: T) => a.date.getTime() - b.date.getTime() || a.name.localeCompare(b.name);
  const arrivals = [...mapRes(resArr, (r) => r.checkInDate), ...mapOcc(occArr, (o) => o.fromDate)].sort(byDate);
  const departures = [...mapRes(resDep, (r) => r.checkOutDate), ...mapOcc(occDep, (o) => o.toDate)].sort(byDate);
  return { from, to, arrivals, departures };
}

/** Nastaví „Nerušit" na rezervaci (host si nepřeje úklid). Scopováno na provozovnu. */
export async function setDoNotDisturb(propertyId: string, reservationId: string, on: boolean) {
  const res = await prisma.reservation.findFirst({ where: { id: reservationId, propertyId }, select: { id: true } });
  if (!res) throw NOT_FOUND();
  return prisma.reservation.update({
    where: { id: reservationId },
    data: { doNotDisturb: on, dndSince: on ? new Date() : null },
    select: { id: true, doNotDisturb: true, dndSince: true },
  });
}

/** Pokoje téhož typu vhodné pro přesun rezervace (volné = bez kolize v termínu). */
export async function roomMoveCandidates(propertyId: string, reservationId: string) {
  const res = await prisma.reservation.findFirst({ where: { id: reservationId, propertyId }, select: { roomTypeId: true, checkInDate: true, checkOutDate: true, roomId: true } });
  if (!res) throw NOT_FOUND();
  const rooms = await prisma.room.findMany({ where: { propertyId, roomTypeId: res.roomTypeId, status: { not: "out_of_service" } }, orderBy: [{ floor: "asc" }, { number: "asc" }], select: { id: true, number: true, floor: true } });
  const clashes = await prisma.reservation.findMany({ where: { id: { not: reservationId }, roomId: { not: null }, roomTypeId: res.roomTypeId, ...overlapWhere(res.checkInDate, res.checkOutDate) }, select: { roomId: true } });
  const taken = new Set(clashes.map((c) => c.roomId));
  return rooms.map((r) => ({ id: r.id, number: r.number, floor: r.floor, free: !taken.has(r.id), current: r.id === res.roomId }));
}

/** Kandidáti pro změnu jednotky rezervace — pokoje (pokojová provozovna) NEBO lůžka (ubytovna),
 * téhož typu, s příznakem volno/aktuální. Pro tlačítko „Změnit pokoj/lůžko" v detailu rezervace. */
export async function unitMoveCandidates(propertyId: string, reservationId: string) {
  const res = await prisma.reservation.findFirst({ where: { id: reservationId, propertyId }, select: { roomTypeId: true, checkInDate: true, checkOutDate: true, roomId: true, bedId: true, adults: true, children: true, property: { select: { inventoryUnit: true } } } });
  if (!res) throw NOT_FOUND();
  if (res.property.inventoryUnit === InventoryUnit.bed) {
    const beds = await prisma.bed.findMany({ where: { room: { propertyId, roomTypeId: res.roomTypeId }, status: { not: RoomStatus.out_of_service } }, orderBy: { label: "asc" }, select: { id: true, label: true, room: { select: { number: true } } } });
    const clashes = await prisma.reservation.findMany({ where: { id: { not: reservationId }, bedId: { not: null }, ...overlapWhere(res.checkInDate, res.checkOutDate) }, select: { bedId: true } });
    const taken = new Set(clashes.map((c) => c.bedId));
    return { unit: "bed" as const, candidates: beds.map((b) => ({ id: b.id, label: `Lůžko ${b.label} · pok. ${b.room.number}`, free: !taken.has(b.id), current: b.id === res.bedId })) };
  }
  // Pokoje VŠECH typů, které kapacitně stačí počtu osob (přesun i do jiného typu, je-li volný).
  const people = res.adults + (res.children ?? 0);
  const rooms = await prisma.room.findMany({ where: { propertyId, status: { not: RoomStatus.out_of_service } }, orderBy: [{ floor: "asc" }, { number: "asc" }], select: { id: true, number: true, floor: true, roomTypeId: true, roomType: { select: { name: true, basePrice: true, capacityAdults: true, maxExtraBeds: true } } } });
  const fitting = rooms.filter((r) => r.roomType.capacityAdults + r.roomType.maxExtraBeds >= people);
  const clashes = await prisma.reservation.findMany({ where: { id: { not: reservationId }, roomId: { not: null }, ...overlapWhere(res.checkInDate, res.checkOutDate) }, select: { roomId: true } });
  const taken = new Set(clashes.map((c) => c.roomId));
  return {
    unit: "room" as const,
    candidates: fitting.map((r) => ({
      id: r.id, typeName: r.roomType.name, pricePerNight: Number(r.roomType.basePrice),
      label: `Pokoj ${r.number} · ${r.roomType.name} · ${Number(r.roomType.basePrice).toLocaleString("cs-CZ")} Kč/noc · ${r.floor}. p`,
      free: !taken.has(r.id), current: r.id === res.roomId,
    })),
  };
}

/** Nepřiřazené (confirmed bez pokoje) rezervace téhož typu — k umístění na tento pokoj. */
export async function unassignedForRoom(propertyId: string, roomId: string) {
  const room = await prisma.room.findFirst({ where: { id: roomId, propertyId }, select: { roomTypeId: true } });
  if (!room) throw NOT_FOUND();
  const today = toDateOnly(new Date());
  const list = await prisma.reservation.findMany({
    where: { propertyId, roomId: null, roomTypeId: room.roomTypeId, status: ReservationStatus.confirmed, checkOutDate: { gte: today } },
    include: { primaryGuest: { select: { firstName: true, lastName: true } } }, orderBy: { checkInDate: "asc" }, take: 30,
  });
  return list.map((r) => ({ id: r.id, code: r.code, guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`, checkInDate: r.checkInDate, checkOutDate: r.checkOutDate }));
}

// ── Hosté na pokoji (spolubydlící) ───────────────────────────
export async function listReservationGuests(propertyId: string, id: string) {
  await assertInProperty(propertyId, id);
  return prisma.reservationGuest.findMany({ where: { reservationId: id }, include: { guest: true, personRate: { select: { id: true, name: true, pricePerNight: true } } }, orderBy: { isPrimary: "desc" } });
}

/** Přepočítá cenu ubytování pokojové rezervace: základ pokoje + přistýlky oceněné dle typu osoby na nich.
 * Osoby do `capacityAdults` kryje cena pokoje; přebývající spí na přistýlkách — na přistýlky jdou
 * NEJLEVNĚJŠÍ sazby (typ osoby `pricePerNight`, bez typu `extraBedPrice`). Lůžkové provozovny přeskočí. */
async function recalcRoomAccommodation(reservationId: string) {
  const res = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      roomTypeId: true, checkInDate: true, checkOutDate: true, nights: true, adults: true, childAges: true, cityTax: true,
      property: { select: { inventoryUnit: true } },
      roomType: { select: { capacityAdults: true, maxExtraBeds: true, extraBedPrice: true } },
      reservationGuests: { select: { personRate: { select: { pricePerNight: true } } } },
    },
  });
  if (!res || !res.roomTypeId || !res.roomType || res.property.inventoryUnit === InventoryUnit.bed) return; // jen pokojové
  const price = await getStayPrice(res.roomTypeId, res.checkInDate, res.checkOutDate, res.adults, res.childAges);
  const people = res.reservationGuests.length;
  const extraCount = Math.min(res.roomType.maxExtraBeds, Math.max(0, people - res.roomType.capacityAdults));
  const extraBed = Number(res.roomType.extraBedPrice);
  const costs = res.reservationGuests.map((g) => (g.personRate ? Number(g.personRate.pricePerNight) : extraBed)).sort((a, b) => a - b);
  let perNight = 0;
  for (let i = 0; i < extraCount; i++) perNight += costs[i] ?? extraBed;
  const accommodation = Number(price.roomTotal) + perNight * res.nights;
  await prisma.reservation.update({ where: { id: reservationId }, data: { totalAmount: new Prisma.Decimal(accommodation).add(res.cityTax) } });
}

/** Nastaví typ osoby (ceník) konkrétnímu ubytovanému na pokoji a přepočítá cenu přistýlek. */
export async function setReservationGuestRate(propertyId: string, rgId: string, personRateId: string | null) {
  const rg = await prisma.reservationGuest.findFirst({ where: { id: rgId, reservation: { propertyId } }, select: { reservationId: true } });
  if (!rg) throw NOT_FOUND();
  if (personRateId) { const pr = await prisma.personRate.findFirst({ where: { id: personRateId, propertyId }, select: { id: true } }); if (!pr) throw NOT_FOUND(); }
  await prisma.reservationGuest.update({ where: { id: rgId }, data: { personRateId } });
  await recalcRoomAccommodation(rg.reservationId);
  return prisma.reservationGuest.findFirst({ where: { id: rgId }, include: { guest: true, personRate: { select: { id: true, name: true, pricePerNight: true } } } });
}
type GuestInput = { firstName: string; lastName: string; email?: string; phone?: string; address?: string; documentType?: DocumentType | null; documentNumber?: string; dateOfBirth?: string; nationality?: string };

export async function addReservationGuest(propertyId: string, id: string, g: GuestInput) {
  await assertInProperty(propertyId, id);
  const guest = await prisma.guest.create({ data: { firstName: g.firstName, lastName: g.lastName, email: g.email || null, phone: g.phone || null, address: g.address || null, documentType: g.documentType ?? undefined, documentNumber: g.documentNumber || null, dateOfBirth: g.dateOfBirth ? new Date(g.dateOfBirth) : null, nationality: g.nationality || null } });
  const rg = await prisma.reservationGuest.create({ data: { reservationId: id, guestId: guest.id, isPrimary: false }, include: { guest: true } });
  await autoRegisterReturningGuest(id, guest.id); // spolubydlící (dospělý) → rovnou do evidenční knihy
  await recalcRoomAccommodation(id); // o osobu navíc → případná přistýlka do ceny
  return rg;
}
/** Napojí na pokoj existujícího hosta z adresáře (spolubydlící) — sjednoceno s výběrem hlavní osoby. */
export async function addExistingReservationGuest(propertyId: string, id: string, guestId: string) {
  await assertInProperty(propertyId, id);
  const guest = await prisma.guest.findUnique({ where: { id: guestId }, select: { id: true } });
  if (!guest) throw new Error("Klient nenalezen v adresáři.");
  const rg = await prisma.reservationGuest.upsert({
    where: { reservationId_guestId: { reservationId: id, guestId } },
    create: { reservationId: id, guestId, isPrimary: false }, update: {},
    include: { guest: true },
  });
  await autoRegisterReturningGuest(id, guestId); // spolubydlící (dospělý) → rovnou do evidenční knihy
  await recalcRoomAccommodation(id);
  return rg;
}
export async function updateReservationGuest(propertyId: string, rgId: string, data: Partial<GuestInput>) {
  const rg = await prisma.reservationGuest.findFirst({ where: { id: rgId, reservation: { propertyId } }, select: { guestId: true, reservationId: true } });
  if (!rg) throw NOT_FOUND();
  await prisma.guest.update({ where: { id: rg.guestId }, data: { firstName: data.firstName, lastName: data.lastName, email: data.email, phone: data.phone, address: data.address, documentType: data.documentType ?? undefined, documentNumber: data.documentNumber, ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null } : {}), ...(data.nationality !== undefined ? { nationality: data.nationality || null } : {}) } });
  await autoRegisterReturningGuest(rg.reservationId, rg.guestId); // doplnil-li se kompletní doklad → rovnou do evidenční knihy (dospělí, ne děti)
  return prisma.reservationGuest.findFirst({ where: { id: rgId }, include: { guest: true } });
}
export async function removeReservationGuest(propertyId: string, rgId: string) {
  const rg = await prisma.reservationGuest.findFirst({ where: { id: rgId, reservation: { propertyId } }, select: { id: true, isPrimary: true, reservationId: true } });
  if (!rg) throw NOT_FOUND();
  if (rg.isPrimary) throw new Error("Hlavního hosta nelze odebrat.");
  await prisma.reservationGuest.delete({ where: { id: rgId } });
  await recalcRoomAccommodation(rg.reservationId); // o osobu míň → přepočet přistýlek
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

// ── Evidenční kniha (zápis na recepci) ───────────────────────
export async function addRegistration(propertyId: string, id: string, input: { primary?: boolean; fullName: string; dateOfBirth: Date; nationality: string; documentType?: DocumentType; documentNumber?: string; homeAddress?: string }) {
  const res = await prisma.reservation.findFirst({ where: { id, propertyId }, select: { id: true, primaryGuestId: true, checkInDate: true, checkOutDate: true } });
  if (!res) throw NOT_FOUND();
  let guestId = res.primaryGuestId;
  if (!input.primary) {
    const parts = input.fullName.trim().split(/\s+/);
    const g = await prisma.guest.create({ data: { firstName: parts[0] ?? input.fullName, lastName: parts.slice(1).join(" ") || "—", address: input.homeAddress, documentType: input.documentType ?? null, documentNumber: input.documentNumber } });
    guestId = g.id;
    await prisma.reservationGuest.upsert({ where: { reservationId_guestId: { reservationId: id, guestId } }, create: { reservationId: id, guestId, isPrimary: false }, update: {} });
  }
  return addRegistrationEntry({
    reservationId: id, guestId, fullName: input.fullName, dateOfBirth: input.dateOfBirth, nationality: input.nationality,
    documentType: input.documentType ?? DocumentType.id_card, documentNumber: input.documentNumber ?? "", homeAddress: input.homeAddress ?? "",
    stayFrom: res.checkInDate, stayTo: res.checkOutDate,
  });
}

export async function deleteRegistration(propertyId: string, id: string) {
  const e = await prisma.registrationEntry.findFirst({ where: { id, reservation: { propertyId } }, select: { id: true } });
  if (!e) throw NOT_FOUND();
  await prisma.registrationEntry.delete({ where: { id } });
  return { ok: true };
}

export async function updateReservationNote(propertyId: string, id: string, note: string) {
  await assertInProperty(propertyId, id);
  return prisma.reservation.update({ where: { id }, data: { note: note || null } });
}

/** Přepojí rezervaci na existujícího hosta z adresáře (primární host). */
export async function setPrimaryGuest(propertyId: string, id: string, guestId: string) {
  await assertInProperty(propertyId, id);
  const guest = await prisma.guest.findUnique({ where: { id: guestId }, select: { id: true } });
  if (!guest) throw new Error("Klient nenalezen v adresáři.");
  const oldPrimary = await prisma.reservationGuest.findFirst({ where: { reservationId: id, isPrimary: true } });
  if (oldPrimary?.guestId !== guestId) {
    await prisma.$transaction(async (tx) => {
      await tx.reservation.update({ where: { id }, data: { primaryGuestId: guestId } });
      if (oldPrimary) await tx.reservationGuest.delete({ where: { id: oldPrimary.id } });
      await tx.reservationGuest.upsert({
        where: { reservationId_guestId: { reservationId: id, guestId } },
        create: { reservationId: id, guestId, isPrimary: true },
        update: { isPrimary: true },
      });
    });
    // Evidenční kniha se plní až při check-inu — když měníme hlavní osobu u UŽ ubytované rezervace, doplň i zápis.
    const r = await prisma.reservation.findUnique({ where: { id }, select: { status: true } });
    if (r?.status === ReservationStatus.checked_in) await autoRegisterReturningGuest(id, guestId);
  }
  return getReservation(propertyId, id);
}

export async function cancelReservation(propertyId: string, id: string) {
  const r = await prisma.reservation.findFirst({ where: { id, propertyId }, include: { property: true } });
  if (!r) throw NOT_FOUND();
  if (r.status === ReservationStatus.cancelled) return { ok: true, fee: 0 };
  const { fee } = computeCancellationFee(r.property, r); // storno poplatek dle politiky provozovny
  if (fee > 0) await addCharge({ reservationId: id, category: ChargeCategory.other, description: `Storno poplatek (${r.property.cancelFeePct} %)`, unitPrice: fee });
  await prisma.reservation.update({ where: { id }, data: { status: ReservationStatus.cancelled, holdExpiresAt: null } });
  void mailer.sendCancellation(id, fee > 0 ? fee : undefined); // potvrzení storna hostovi (best-effort)
  return { ok: true, fee };
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
  name: string; description?: string; capacityAdults: number; capacityChildren?: number; maxExtraBeds?: number; extraBedPrice?: number;
  basePrice: number; weeklyPrice?: number; monthlyPrice?: number; amenities?: string[];
}) =>
  prisma.roomType.create({
    data: {
      propertyId, name: data.name, description: data.description, capacityAdults: data.capacityAdults,
      capacityChildren: data.capacityChildren ?? 0, maxExtraBeds: data.maxExtraBeds ?? 0, extraBedPrice: new Prisma.Decimal(data.extraBedPrice ?? 0), basePrice: new Prisma.Decimal(data.basePrice),
      weeklyPrice: data.weeklyPrice != null ? new Prisma.Decimal(data.weeklyPrice) : null,
      monthlyPrice: data.monthlyPrice != null ? new Prisma.Decimal(data.monthlyPrice) : null,
      amenities: data.amenities ?? [],
    },
  });

export const updateRoomType = (id: string, data: Partial<{
  name: string; description: string; capacityAdults: number; capacityChildren: number; maxExtraBeds: number; extraBedPrice: number;
  basePrice: number; weeklyPrice: number; monthlyPrice: number; amenities: string[];
}>) =>
  prisma.roomType.update({
    where: { id },
    data: {
      ...data,
      basePrice: data.basePrice != null ? new Prisma.Decimal(data.basePrice) : undefined,
      weeklyPrice: data.weeklyPrice != null ? new Prisma.Decimal(data.weeklyPrice) : undefined,
      monthlyPrice: data.monthlyPrice != null ? new Prisma.Decimal(data.monthlyPrice) : undefined,
      extraBedPrice: data.extraBedPrice != null ? new Prisma.Decimal(data.extraBedPrice) : undefined,
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
