// Evidence vybavení (DHIM) a přesuny. Umístění kusu = (propertyId, roomId):
//   (null, null)  centrální sklad · (P, null) sklad provozovny · (P, R) pokoj.
import { Prisma, EquipmentCondition } from "@prisma/client";
import { prisma } from "./prisma";
import { toDateOnly } from "./dates";

export type Location = { propertyId: string | null; roomId: string | null };

const ITEM_INCLUDE = { property: true, room: { include: { roomType: true } }, category: true } as const;
const NOT_FOUND = () => Object.assign(new Error("not_found"), { code: "P2025" });

// ── Kategorie (číselník) ─────────────────────────────────────
export const listCategories = () => prisma.equipmentCategory.findMany({ orderBy: { name: "asc" } });
export const createCategory = (name: string) => prisma.equipmentCategory.create({ data: { name: name.trim() } });
export const deleteCategory = (id: string) => prisma.equipmentCategory.delete({ where: { id } });

// ── Kód pro čtečku ───────────────────────────────────────────
function randCode(): string {
  let s = ""; for (let i = 0; i < 6; i++) s += "0123456789"[Math.floor(Math.random() * 10)];
  return `INV-${s}`;
}
async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 12; i++) { const c = randCode(); if (!(await prisma.equipmentItem.findUnique({ where: { code: c } }))) return c; }
  return `INV-${Date.now()}`;
}

// ── Umístění ─────────────────────────────────────────────────
export async function locationLabel(loc: Location): Promise<string> {
  if (loc.roomId) {
    const room = await prisma.room.findUnique({ where: { id: loc.roomId }, include: { property: true } });
    if (room) return `${room.property.name} · pokoj ${room.number}`;
  }
  if (loc.propertyId) {
    const p = await prisma.property.findUnique({ where: { id: loc.propertyId } });
    if (p) return `${p.name} · sklad`;
  }
  return "Centrální sklad";
}

export function listEquipment(where: Prisma.EquipmentItemWhereInput) {
  return prisma.equipmentItem.findMany({ where, include: ITEM_INCLUDE, orderBy: [{ name: "asc" }] });
}

export type EquipmentInput = {
  name: string; code?: string; categoryId?: string | null; serialNumber?: string;
  condition?: EquipmentCondition; note?: string;
  acquiredAt?: Date; manufacturedAt?: Date;
  propertyId?: string | null; roomId?: string | null;
};

export async function createEquipment(data: EquipmentInput) {
  return prisma.equipmentItem.create({
    data: {
      name: data.name, code: data.code?.trim() || (await uniqueCode()), categoryId: data.categoryId ?? null,
      serialNumber: data.serialNumber, condition: data.condition ?? EquipmentCondition.ok, note: data.note,
      acquiredAt: data.acquiredAt ? toDateOnly(data.acquiredAt) : null,
      manufacturedAt: data.manufacturedAt ? toDateOnly(data.manufacturedAt) : null,
      propertyId: data.propertyId ?? null, roomId: data.roomId ?? null,
    },
    include: ITEM_INCLUDE,
  });
}

export type EquipmentPatch = {
  name?: string; code?: string; categoryId?: string | null; serialNumber?: string;
  condition?: EquipmentCondition; note?: string;
  acquiredAt?: Date | null; manufacturedAt?: Date | null; retiredAt?: Date | null; retiredReason?: string | null;
};

export function updateEquipment(id: string, data: EquipmentPatch) {
  return prisma.equipmentItem.update({
    where: { id },
    data: {
      name: data.name, code: data.code?.trim() || undefined, categoryId: data.categoryId,
      serialNumber: data.serialNumber, condition: data.condition, note: data.note,
      acquiredAt: data.acquiredAt === null ? null : data.acquiredAt ? toDateOnly(data.acquiredAt) : undefined,
      manufacturedAt: data.manufacturedAt === null ? null : data.manufacturedAt ? toDateOnly(data.manufacturedAt) : undefined,
      retiredAt: data.retiredAt === null ? null : data.retiredAt ? toDateOnly(data.retiredAt) : undefined,
      retiredReason: data.retiredReason,
    },
    include: ITEM_INCLUDE,
  });
}

export const deleteEquipment = (id: string) => prisma.equipmentItem.delete({ where: { id } });
export const listMoves = (id: string) => prisma.equipmentMove.findMany({ where: { itemId: id }, orderBy: { createdAt: "desc" } });

export async function moveEquipment(id: string, to: Location, note?: string) {
  const item = await prisma.equipmentItem.findUnique({ where: { id } });
  if (!item) throw NOT_FOUND();
  let target: Location = { propertyId: to.propertyId ?? null, roomId: to.roomId ?? null };
  if (target.roomId) {
    const room = await prisma.room.findUnique({ where: { id: target.roomId } });
    if (!room) throw new Error("Cílový pokoj neexistuje.");
    if (target.propertyId && room.propertyId !== target.propertyId) throw new Error("Pokoj nepatří do cílové provozovny.");
    target = { propertyId: room.propertyId, roomId: room.id };
  }
  const fromLabel = await locationLabel({ propertyId: item.propertyId, roomId: item.roomId });
  const toLabel = await locationLabel(target);
  const [updated] = await prisma.$transaction([
    prisma.equipmentItem.update({ where: { id }, data: { propertyId: target.propertyId, roomId: target.roomId }, include: ITEM_INCLUDE }),
    prisma.equipmentMove.create({ data: { itemId: id, fromLabel, toLabel, note } }),
  ]);
  return updated;
}

export async function assertInProperty(propertyId: string, id: string) {
  const it = await prisma.equipmentItem.findFirst({ where: { id, propertyId }, select: { id: true } });
  if (!it) throw NOT_FOUND();
}

// Kusy, které smí provozovna „vidět a vybrat": vlastní + centrální sklad
// (propertyId=null & roomId=null). Centrální sklad je sdílený fond pro všechny.
export const ownOrCentral = (propertyId: string): Prisma.EquipmentItemWhereInput =>
  ({ OR: [{ propertyId }, { propertyId: null, roomId: null }] });

export async function assertInPropertyOrCentral(propertyId: string, id: string) {
  const it = await prisma.equipmentItem.findFirst({ where: { id, ...ownOrCentral(propertyId) }, select: { id: true } });
  if (!it) throw NOT_FOUND();
}

// ── Dávkové založení a hromadné akce ─────────────────────────
/** Založí `quantity` shodných kusů (každý s vlastním auto-kódem). */
export async function createEquipmentBatch(data: EquipmentInput, quantity: number) {
  const n = Math.max(1, Math.min(quantity, 500));
  const out = [];
  for (let i = 0; i < n; i++) out.push(await createEquipment({ ...data, code: n > 1 ? undefined : data.code }));
  return out;
}

const scopeWhere = (ids: string[], scopePropertyId?: string, includeCentral?: boolean): Prisma.EquipmentItemWhereInput =>
  ({ id: { in: ids }, ...(scopePropertyId ? (includeCentral ? ownOrCentral(scopePropertyId) : { propertyId: scopePropertyId }) : {}) });

export async function bulkMove(ids: string[], to: Location, note: string | undefined, scopePropertyId?: string, includeCentral?: boolean) {
  const rows = await prisma.equipmentItem.findMany({ where: scopeWhere(ids, scopePropertyId, includeCentral), select: { id: true } });
  for (const r of rows) await moveEquipment(r.id, to, note);
  return { moved: rows.length };
}

export async function bulkRetire(ids: string[], reason: string, scopePropertyId?: string) {
  const { count } = await prisma.equipmentItem.updateMany({
    where: scopeWhere(ids, scopePropertyId),
    data: { condition: EquipmentCondition.retired, retiredAt: toDateOnly(new Date()), retiredReason: reason },
  });
  return { retired: count };
}

export async function bulkDelete(ids: string[], scopePropertyId?: string) {
  const { count } = await prisma.equipmentItem.deleteMany({ where: scopeWhere(ids, scopePropertyId) });
  return { deleted: count };
}
