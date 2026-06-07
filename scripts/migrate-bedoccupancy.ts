// Jednorázová migrace: převede staré BedOccupancy na Reservation (sjednocení dlouhodobého
// ubytování s rezervacemi). Po převodu obsazenost SMAŽE → idempotentní (opětovné spuštění nic nedělá).
// Spustit JEDNOU na serveru:  npx tsx scripts/migrate-bedoccupancy.ts
import { PrismaClient, ReservationStatus, ReservationSource } from "@prisma/client";
import { generateReservationCode } from "../src/reservations";

const prisma = new PrismaClient();
const dateOnly = (d: Date) => new Date(d.toISOString().slice(0, 10));
const nights = (a: Date, b: Date) => Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));

async function main() {
  const occs = await prisma.bedOccupancy.findMany({ include: { bed: { select: { room: { select: { roomTypeId: true } } } } } });
  if (!occs.length) { console.log("Žádné BedOccupancy k migraci."); return; }
  const today = dateOnly(new Date());
  let done = 0;
  for (const o of occs) {
    const roomTypeId = o.bed.room.roomTypeId;
    const n = nights(o.fromDate, o.toDate);
    const status = o.status === "ended" || o.toDate <= today ? ReservationStatus.checked_out
      : o.fromDate <= today ? ReservationStatus.checked_in : ReservationStatus.confirmed;
    await prisma.$transaction(async (tx) => {
      const res = await tx.reservation.create({
        data: {
          code: generateReservationCode(),
          propertyId: o.propertyId, primaryGuestId: o.occupantGuestId, roomTypeId, bedId: o.bedId,
          checkInDate: o.fromDate, checkOutDate: o.toDate, nights: n, adults: 1,
          status, source: ReservationSource.manual,
          totalAmount: Number(o.pricePerNight) * n, energyFeeExempt: o.energyFeeExempt,
          companyId: o.companyId, personRateId: o.personRateId,
          note: o.note ? `[převod z obsazenosti] ${o.note}` : "[převod z obsazenosti]",
          reservationGuests: { create: { guestId: o.occupantGuestId, isPrimary: true } },
        },
      });
      await tx.bedOccupancy.delete({ where: { id: o.id } });
      console.log(`  ${o.id} → ${res.code} (lůžko, ${n} nocí, ${status})`);
    });
    done++;
  }
  console.log(`Hotovo: převedeno ${done} obsazení na rezervace.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
