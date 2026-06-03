-- AlterEnum
ALTER TYPE "ReservationSource" ADD VALUE IF NOT EXISTS 'ical';

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "externalRef" TEXT;
CREATE INDEX "Reservation_externalRef_idx" ON "Reservation"("externalRef");

-- CreateTable
CREATE TABLE "IcalFeed" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "blockGuestId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IcalFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IcalFeed_propertyId_idx" ON "IcalFeed"("propertyId");

-- AddForeignKey
ALTER TABLE "IcalFeed" ADD CONSTRAINT "IcalFeed_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IcalFeed" ADD CONSTRAINT "IcalFeed_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
