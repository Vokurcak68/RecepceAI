-- CreateEnum
CREATE TYPE "ChargeCategory" AS ENUM ('minibar', 'wellness', 'service', 'restaurant', 'parking', 'other');

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "category" "ChargeCategory" NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Charge_reservationId_idx" ON "Charge"("reservationId");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
