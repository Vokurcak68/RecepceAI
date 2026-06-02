-- AlterTable
ALTER TABLE "Property" ADD COLUMN "onlineCheckinHours" INTEGER NOT NULL DEFAULT 48;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "onlineCheckinAt" TIMESTAMP(3);
