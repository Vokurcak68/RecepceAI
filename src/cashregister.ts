// Pokladna — pokladní směny, příjmy/výdaje hotovosti, denní uzávěrka.
// Karty/převody do šuplíku nepatří (vyúčtuje banka) — pokladna sleduje HOTOVOST.
// Hotovostní platby se do otevřené směny zapisují automaticky (recordCashPayment).
import { Prisma, CashMovementKind, PaymentMethod, PaymentStatus } from "@prisma/client";
import { prisma } from "./prisma";

const dec = (v: Prisma.Decimal | number) => new Prisma.Decimal(v);

/** Tržby kartou (a jiné bezhotovostní) za směny — nejdou do šuplíku, ale do uzávěrky patří. */
async function cardTotals(sessionIds: string[]): Promise<Map<string, string>> {
  if (!sessionIds.length) return new Map();
  const rows = await prisma.payment.groupBy({
    by: ["cashSessionId"],
    where: { cashSessionId: { in: sessionIds }, method: PaymentMethod.card_terminal, status: PaymentStatus.succeeded },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.cashSessionId as string, (r._sum.amount ?? new Prisma.Decimal(0)).toFixed(2)]));
}

/** Každá provozovna má jednu výchozí pokladnu (vytvoří se při prvním použití). */
async function getOrCreateRegister(propertyId: string) {
  const existing = await prisma.cashRegister.findFirst({ where: { propertyId }, orderBy: { createdAt: "asc" } });
  return existing ?? prisma.cashRegister.create({ data: { propertyId, name: "Hlavní pokladna" } });
}

type RawSession = Prisma.CashRegisterSessionGetPayload<{ include: { movements: true } }>;

async function withNames<T extends { openedById: string; closedById: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.flatMap((r) => [r.openedById, r.closedById]).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const map = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, openedByName: map.get(r.openedById) ?? "—", closedByName: r.closedById ? map.get(r.closedById) ?? "—" : null }));
}

function summarize(s: RawSession) {
  let income = dec(0), expense = dec(0);
  for (const m of s.movements) (m.kind === CashMovementKind.income ? (income = income.add(m.amount)) : (expense = expense.add(m.amount)));
  const expected = s.openingFloat.add(income).sub(expense);
  const counted = s.countedCash;
  return {
    ...s,
    summary: {
      openingFloat: s.openingFloat.toFixed(2),
      income: income.toFixed(2),
      expense: expense.toFixed(2),
      expected: expected.toFixed(2),
      counted: counted != null ? counted.toFixed(2) : null,
      difference: counted != null ? counted.sub(expected).toFixed(2) : null,
      card: "0.00", // tržby kartou — doplní se asynchronně (cardTotals)
    },
  };
}

/** Aktuální stav pokladny: otevřená směna (se souhrnem) nebo null. */
export async function getState(propertyId: string) {
  const register = await getOrCreateRegister(propertyId);
  const open = await prisma.cashRegisterSession.findFirst({
    where: { registerId: register.id, closedAt: null },
    include: { movements: { orderBy: { createdAt: "desc" } } },
    orderBy: { openedAt: "desc" },
  });
  if (!open) return { register: { id: register.id, name: register.name }, session: null };
  const s = summarize(open);
  s.summary.card = (await cardTotals([open.id])).get(open.id) ?? "0.00";
  const [named] = await withNames([s]);
  return { register: { id: register.id, name: register.name }, session: named };
}

export async function openSession(propertyId: string, userId: string, openingFloat: number) {
  const register = await getOrCreateRegister(propertyId);
  const open = await prisma.cashRegisterSession.findFirst({ where: { registerId: register.id, closedAt: null } });
  if (open) throw new Error("Pokladní směna už je otevřená.");
  return prisma.cashRegisterSession.create({ data: { registerId: register.id, openedById: userId, openingFloat: dec(openingFloat) } });
}

export async function addMovement(propertyId: string, input: { kind: CashMovementKind; amount: number; note?: string }) {
  const register = await getOrCreateRegister(propertyId);
  const open = await prisma.cashRegisterSession.findFirst({ where: { registerId: register.id, closedAt: null } });
  if (!open) throw new Error("Není otevřená pokladní směna.");
  if (!(input.amount > 0)) throw new Error("Částka musí být kladná.");
  return prisma.cashMovement.create({ data: { sessionId: open.id, kind: input.kind, amount: dec(input.amount), note: input.note } });
}

export async function closeSession(propertyId: string, userId: string, countedCash: number, note?: string) {
  const register = await getOrCreateRegister(propertyId);
  const open = await prisma.cashRegisterSession.findFirst({ where: { registerId: register.id, closedAt: null } });
  if (!open) throw new Error("Není otevřená pokladní směna.");
  return prisma.cashRegisterSession.update({
    where: { id: open.id },
    data: { closedAt: new Date(), closedById: userId, countedCash: dec(countedCash), note },
  });
}

/** Historie uzavřených směn (uzávěrky) se souhrny. */
export async function listSessions(propertyId: string) {
  const register = await getOrCreateRegister(propertyId);
  const sessions = await prisma.cashRegisterSession.findMany({
    where: { registerId: register.id, closedAt: { not: null } },
    include: { movements: true }, orderBy: { openedAt: "desc" }, take: 60,
  });
  const summarized = sessions.map(summarize);
  const cards = await cardTotals(summarized.map((s) => s.id));
  summarized.forEach((s) => { s.summary.card = cards.get(s.id) ?? "0.00"; });
  return withNames(summarized);
}

/**
 * Naváže platbu na otevřenou směnu. Hotovost navíc zapíše jako příjem do šuplíku
 * (CashMovement); karta/převod jdou jen do směny (tržby kartou, ne do šuplíku).
 */
export async function recordPayment(propertyId: string, input: { paymentId: string; amount: Prisma.Decimal | number; method: PaymentMethod; documentId?: string | null; note?: string | null }) {
  const register = await getOrCreateRegister(propertyId);
  const open = await prisma.cashRegisterSession.findFirst({ where: { registerId: register.id, closedAt: null } });
  if (!open) return; // bez otevřené směny do pokladny nezapisujeme
  await prisma.payment.update({ where: { id: input.paymentId }, data: { cashSessionId: open.id } });
  if (input.method === PaymentMethod.cash) {
    await prisma.cashMovement.create({
      data: { sessionId: open.id, kind: CashMovementKind.income, amount: dec(input.amount), paymentId: input.paymentId, documentId: input.documentId ?? null, note: input.note ?? "Platba v hotovosti" },
    });
  }
}
