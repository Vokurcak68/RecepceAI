-- AlterTable: CRM pole hosta
ALTER TABLE "Guest" ADD COLUMN "preferences" TEXT;
ALTER TABLE "Guest" ADD COLUMN "vip" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: rychlé párování vracejících se hostů podle e-mailu
CREATE INDEX "Guest_email_idx" ON "Guest"("email");

-- CreateTable: hodnocení pobytu (NPS)
CREATE TABLE "GuestReview" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "nps" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestReview_reservationId_key" ON "GuestReview"("reservationId");
CREATE INDEX "GuestReview_propertyId_createdAt_idx" ON "GuestReview"("propertyId", "createdAt");

-- AddForeignKey
ALTER TABLE "GuestReview" ADD CONSTRAINT "GuestReview_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuestReview" ADD CONSTRAINT "GuestReview_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuestReview" ADD CONSTRAINT "GuestReview_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
