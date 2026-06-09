// Servisní požadavky (tikety) — od hostů i personálu.
import { Prisma, ServiceType, ServiceDomain, ServiceStatus, ReservationStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { saveDataUrl } from "./uploads";

/** Typ požadavku → fronta personálu. */
export const DOMAIN_FOR_TYPE: Record<ServiceType, ServiceDomain> = {
  cleaning: ServiceDomain.housekeeping,
  laundry: ServiceDomain.housekeeping,
  ironing: ServiceDomain.housekeeping,
  minibar: ServiceDomain.housekeeping,
  other: ServiceDomain.housekeeping,
  maintenance: ServiceDomain.maintenance,
};

const REQ_INCLUDE = {
  reservation: { include: { primaryGuest: true } },
  room: true,
  resolvedBy: { select: { id: true, name: true } },
} as const;

export function listRequests(where: Prisma.ServiceRequestWhereInput) {
  return prisma.serviceRequest.findMany({ where, include: REQ_INCLUDE, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300 });
}

export function createRequest(input: {
  propertyId: string; reservationId?: string | null; roomId?: string | null; bedId?: string | null;
  type: ServiceType; description?: string; fromGuest?: boolean;
}) {
  return prisma.serviceRequest.create({
    data: {
      propertyId: input.propertyId, reservationId: input.reservationId ?? null, roomId: input.roomId ?? null, bedId: input.bedId ?? null,
      type: input.type, domain: DOMAIN_FOR_TYPE[input.type], description: input.description, fromGuest: input.fromGuest ?? false,
    },
    include: REQ_INCLUDE,
  });
}

export async function updateStatus(id: string, status: ServiceStatus, note: string | undefined, userId: string | undefined) {
  const data: Prisma.ServiceRequestUpdateInput = { status, note };
  if (status === ServiceStatus.done || status === ServiceStatus.cancelled) {
    data.resolvedAt = new Date();
    if (userId) data.resolvedBy = { connect: { id: userId } };
  }
  const req = await prisma.serviceRequest.update({ where: { id }, data, include: REQ_INCLUDE });
  // Dokončený úklid → jednotka uklizená (pokoj u hotelu, lůžko u ubytovny).
  if (status === ServiceStatus.done && req.type === ServiceType.cleaning) {
    if (req.roomId) await prisma.room.update({ where: { id: req.roomId }, data: { status: "clean" } });
    if (req.bedId) await prisma.bed.update({ where: { id: req.bedId }, data: { status: "clean" } });
  }
  return req;
}

// ── Host (přístup přes rezervační kód) ───────────────────────
export function loadReservationByCode(code: string) {
  return prisma.reservation.findFirst({
    where: { code: code.trim().toUpperCase(), status: { in: [ReservationStatus.confirmed, ReservationStatus.checked_in] } },
    include: { property: true, room: true, bed: true, primaryGuest: true },
  });
}

export const listRequestsForReservation = (reservationId: string) =>
  prisma.serviceRequest.findMany({ where: { reservationId }, orderBy: { createdAt: "desc" } });

/** Přidá fotky (data URL) k servisnímu požadavku. */
export async function addRequestImages(id: string, dataUrls: string[]) {
  const urls = dataUrls.map(saveDataUrl);
  return prisma.serviceRequest.update({ where: { id }, data: { imageUrls: { push: urls } }, include: REQ_INCLUDE });
}
