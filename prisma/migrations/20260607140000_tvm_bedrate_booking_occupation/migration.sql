-- TVM dlouhodobé ubytování: ceník sazeb (BedRate), booking pole na rezervaci, obsazení pod rezervací.

-- Ceník sazeb za lůžko/noc (TVM PriceList)
CREATE TABLE "BedRate" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "pricePerNight" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BedRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BedRate_propertyId_active_idx" ON "BedRate"("propertyId", "active");

-- Booking pole na rezervaci
ALTER TABLE "Reservation" ADD COLUMN "bedRateId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "payUntil" DATE;
ALTER TABLE "Reservation" ADD COLUMN "paidTo" DATE;
ALTER TABLE "Reservation" ADD COLUMN "vip" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_bedRateId_fkey"
  FOREIGN KEY ("bedRateId") REFERENCES "BedRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BedOccupancy je nově vždy pod rezervací (tabulka prázdná → bezpečné)
ALTER TABLE "BedOccupancy" ALTER COLUMN "reservationId" SET NOT NULL;
ALTER TABLE "BedOccupancy" DROP CONSTRAINT IF EXISTS "BedOccupancy_reservationId_fkey";
ALTER TABLE "BedOccupancy" ADD CONSTRAINT "BedOccupancy_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
