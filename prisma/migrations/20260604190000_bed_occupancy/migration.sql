-- Lůžková obsazenost s rotací osob (firemní ubytovny).
CREATE TYPE "OccupancyStatus" AS ENUM ('active', 'ended');

CREATE TABLE "BedOccupancy" (
  "id"              TEXT NOT NULL,
  "propertyId"      TEXT NOT NULL,
  "bedId"           TEXT NOT NULL,
  "occupantGuestId" TEXT NOT NULL,
  "companyId"       TEXT,
  "reservationId"   TEXT,
  "fromDate"        DATE NOT NULL,
  "toDate"          DATE NOT NULL,
  "status"          "OccupancyStatus" NOT NULL DEFAULT 'active',
  "note"            TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BedOccupancy_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BedOccupancy_propertyId_status_idx" ON "BedOccupancy"("propertyId", "status");
CREATE INDEX "BedOccupancy_bedId_fromDate_toDate_idx" ON "BedOccupancy"("bedId", "fromDate", "toDate");
CREATE INDEX "BedOccupancy_companyId_idx" ON "BedOccupancy"("companyId");

ALTER TABLE "BedOccupancy" ADD CONSTRAINT "BedOccupancy_bedId_fkey"
  FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BedOccupancy" ADD CONSTRAINT "BedOccupancy_occupantGuestId_fkey"
  FOREIGN KEY ("occupantGuestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BedOccupancy" ADD CONSTRAINT "BedOccupancy_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BedOccupancy" ADD CONSTRAINT "BedOccupancy_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
