-- Typ osoby (ceník) per ubytovaný host na pokoji — určuje cenu přistýlky, na které osoba spí.
ALTER TABLE "ReservationGuest" ADD COLUMN "personRateId" TEXT;
ALTER TABLE "ReservationGuest" ADD CONSTRAINT "ReservationGuest_personRateId_fkey"
  FOREIGN KEY ("personRateId") REFERENCES "PersonRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
