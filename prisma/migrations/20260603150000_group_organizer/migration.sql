-- AlterTable: kontakt/organizátor skupiny (pro souhrnný e-mail)
ALTER TABLE "ReservationGroup" ADD COLUMN "organizerGuestId" TEXT;

-- AddForeignKey
ALTER TABLE "ReservationGroup" ADD CONSTRAINT "ReservationGroup_organizerGuestId_fkey" FOREIGN KEY ("organizerGuestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
