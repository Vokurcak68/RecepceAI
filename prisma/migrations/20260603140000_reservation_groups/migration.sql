-- AlterEnum
ALTER TYPE "ReservationSource" ADD VALUE IF NOT EXISTS 'group';

-- CreateTable
CREATE TABLE "ReservationGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReservationGroup_code_key" ON "ReservationGroup"("code");
CREATE INDEX "ReservationGroup_propertyId_idx" ON "ReservationGroup"("propertyId");

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "groupId" TEXT;
CREATE INDEX "Reservation_groupId_idx" ON "Reservation"("groupId");

-- AddForeignKey
ALTER TABLE "ReservationGroup" ADD CONSTRAINT "ReservationGroup_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ReservationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
