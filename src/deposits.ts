// Vratná kauce (jistota) — přijetí, vrácení (i částečné), zadržení. Odděleno od plateb a účtu.
import { DepositStatus, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const NOT_FOUND = () => Object.assign(new Error("not_found"), { code: "P2025" });

function fmt(d: Prisma.DepositGetPayload<object>) {
  return {
    id: d.id, amount: d.amount.toFixed(2), method: d.method, status: d.status,
    takenAt: d.takenAt, returnedAt: d.returnedAt,
    returnedAmount: d.returnedAmount != null ? d.returnedAmount.toFixed(2) : null,
    note: d.note, reservationId: d.reservationId, companyId: d.companyId,
  };
}

export type CreateDepositInput = { reservationId?: string | null; companyId?: string | null; amount: number; method?: PaymentMethod; note?: string | null };

/** Přijetí kauce. Musí být navázaná na rezervaci nebo firmu. */
export async function createDeposit(propertyId: string, input: CreateDepositInput) {
  if (!input.reservationId && !input.companyId) throw new Error("Kauce musí patřit rezervaci nebo firmě.");
  if (!(input.amount > 0)) throw new Error("Zadej částku kauce.");
  if (input.reservationId) {
    const r = await prisma.reservation.findFirst({ where: { id: input.reservationId, propertyId }, select: { id: true } });
    if (!r) throw NOT_FOUND();
  }
  if (input.companyId) {
    const c = await prisma.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
    if (!c) throw NOT_FOUND();
  }
  const created = await prisma.deposit.create({
    data: { propertyId, reservationId: input.reservationId ?? null, companyId: input.companyId ?? null, amount: input.amount, method: input.method ?? PaymentMethod.cash, note: input.note ?? null },
  });
  return fmt(created);
}

/** Vrácení kauce (celé nebo částečné — zbytek se považuje za zadržený). */
export async function returnDeposit(propertyId: string, id: string, returnedAmount?: number, note?: string) {
  const dep = await prisma.deposit.findFirst({ where: { id, propertyId } });
  if (!dep) throw NOT_FOUND();
  if (dep.status !== DepositStatus.held) throw new Error("Kauce už byla vyřízena.");
  const full = Number(dep.amount);
  const ret = returnedAmount == null ? full : Math.max(0, Math.min(returnedAmount, full));
  const updated = await prisma.deposit.update({
    where: { id },
    data: { status: ret <= 0 ? DepositStatus.forfeited : DepositStatus.returned, returnedAt: new Date(), returnedAmount: ret, note: note ?? dep.note },
  });
  return fmt(updated);
}

/** Zadržení celé kauce (propadla — např. škoda). */
export async function forfeitDeposit(propertyId: string, id: string, note?: string) {
  const dep = await prisma.deposit.findFirst({ where: { id, propertyId } });
  if (!dep) throw NOT_FOUND();
  if (dep.status !== DepositStatus.held) throw new Error("Kauce už byla vyřízena.");
  const updated = await prisma.deposit.update({
    where: { id },
    data: { status: DepositStatus.forfeited, returnedAt: new Date(), returnedAmount: 0, note: note ?? dep.note },
  });
  return fmt(updated);
}

export async function deleteDeposit(propertyId: string, id: string) {
  const dep = await prisma.deposit.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!dep) throw NOT_FOUND();
  await prisma.deposit.delete({ where: { id } });
  return { ok: true };
}

export async function listForReservation(propertyId: string, reservationId: string) {
  const items = await prisma.deposit.findMany({ where: { propertyId, reservationId }, orderBy: { takenAt: "desc" } });
  return items.map(fmt);
}

export async function listForCompany(propertyId: string, companyId: string) {
  const items = await prisma.deposit.findMany({ where: { propertyId, companyId }, orderBy: { takenAt: "desc" } });
  return items.map(fmt);
}
