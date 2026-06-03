// Centrální systém: správa provozoven a uživatelů (jen super_admin).
import { Prisma, PropertyType, InventoryUnit, UserRole } from "@prisma/client";
import { prisma } from "./prisma";
import { hashPassword } from "./auth";

/** Výchozí typově závislé nastavení provozovny. Lze pak per-property přepsat. */
export function typeDefaults(type: PropertyType) {
  switch (type) {
    case PropertyType.hotel:
      return { inventoryUnit: InventoryUnit.room, cityTaxEnabled: true, allowLongTerm: false, selfCheckin: false, breakfastIncluded: true };
    case PropertyType.penzion:
      return { inventoryUnit: InventoryUnit.room, cityTaxEnabled: true, allowLongTerm: false, selfCheckin: true, breakfastIncluded: true };
    case PropertyType.ubytovna:
      return { inventoryUnit: InventoryUnit.bed, cityTaxEnabled: false, allowLongTerm: true, selfCheckin: true, breakfastIncluded: false };
  }
}

// ── Provozovny ───────────────────────────────────────────────
export const listProperties = () =>
  prisma.property.findMany({ include: { _count: { select: { rooms: true, beds: true, reservations: true } } }, orderBy: { name: "asc" } });

export const getProperty = (id: string) => prisma.property.findUniqueOrThrow({ where: { id } });

export function createProperty(data: {
  identifier: string; name: string; type: PropertyType;
  street?: string; city?: string; phone?: string; email?: string;
}) {
  return prisma.property.create({ data: { ...data, ...typeDefaults(data.type) } });
}

export function updateProperty(id: string, data: Partial<{
  name: string; identifier: string; type: PropertyType; street: string; city: string; country: string; phone: string; email: string; ico: string; dic: string; iban: string; vatPayer: boolean; active: boolean; infoText: string;
  inventoryUnit: InventoryUnit; cityTaxEnabled: boolean; cityTaxPerPersonNight: number; cityTaxFreeAge: number;
  allowLongTerm: boolean; selfCheckin: boolean; breakfastIncluded: boolean; onlineCheckinHours: number; dailyCleaning: boolean;
  freeCancelDays: number; cancelFeePct: number; depositPct: number; reminderHours: number; noShowHours: number;
}>) {
  return prisma.property.update({
    where: { id },
    data: { ...data, cityTaxPerPersonNight: data.cityTaxPerPersonNight != null ? new Prisma.Decimal(data.cityTaxPerPersonNight) : undefined },
  });
}

// ── Uživatelé ────────────────────────────────────────────────
export const listUsers = () =>
  prisma.user.findMany({ include: { properties: { include: { property: true } } }, orderBy: { name: "asc" } });

export async function createUser(data: { email: string; name: string; password: string; role: UserRole; propertyIds?: string[] }) {
  return prisma.user.create({
    data: {
      email: data.email.toLowerCase().trim(), name: data.name, passwordHash: hashPassword(data.password), role: data.role,
      properties: { create: (data.propertyIds ?? []).map((propertyId) => ({ propertyId })) },
    },
    include: { properties: { include: { property: true } } },
  });
}

/** Úprava uživatele (jméno, role, případně reset hesla). */
export async function updateUser(id: string, data: { name?: string; role?: UserRole; password?: string }) {
  return prisma.user.update({
    where: { id },
    data: { name: data.name, role: data.role, passwordHash: data.password ? hashPassword(data.password) : undefined },
    include: { properties: { include: { property: true } } },
  });
}

export const deleteUser = (id: string) => prisma.user.delete({ where: { id } });

/** Nastaví uživateli sadu přiřazených provozoven (přepíše stávající). */
export async function setUserProperties(userId: string, propertyIds: string[]) {
  await prisma.userProperty.deleteMany({ where: { userId } });
  await prisma.userProperty.createMany({ data: propertyIds.map((propertyId) => ({ userId, propertyId })) });
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { properties: { include: { property: true } } } });
}

// ── Přístupová práva ─────────────────────────────────────────
export async function loadUser(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, include: { properties: true } });
}

/** Provozovny, ke kterým má uživatel přístup (super_admin = všechny). */
export async function accessibleProperties(user: { id: string; role: UserRole }) {
  if (user.role === UserRole.super_admin) return listProperties();
  return prisma.property.findMany({
    where: { users: { some: { userId: user.id } } },
    include: { _count: { select: { rooms: true, beds: true, reservations: true } } },
    orderBy: { name: "asc" },
  });
}

export function canAccessProperty(user: { role: UserRole; properties: { propertyId: string }[] }, propertyId: string) {
  return user.role === UserRole.super_admin || user.properties.some((p) => p.propertyId === propertyId);
}
