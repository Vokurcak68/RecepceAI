-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('cleaning', 'maintenance', 'laundry', 'ironing', 'minibar', 'other');

-- CreateEnum
CREATE TYPE "ServiceDomain" AS ENUM ('housekeeping', 'maintenance');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('open', 'in_progress', 'done', 'cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'housekeeping';
ALTER TYPE "UserRole" ADD VALUE 'maintenance';

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT,
    "roomId" TEXT,
    "bedId" TEXT,
    "type" "ServiceType" NOT NULL,
    "domain" "ServiceDomain" NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'open',
    "description" TEXT,
    "fromGuest" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceRequest_propertyId_domain_status_idx" ON "ServiceRequest"("propertyId", "domain", "status");

-- CreateIndex
CREATE INDEX "ServiceRequest_reservationId_idx" ON "ServiceRequest"("reservationId");

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
