-- Typ osoby (číselník) i u běžné rezervace.
ALTER TABLE "Reservation" ADD COLUMN "personRateId" TEXT;
CREATE INDEX "Reservation_personRateId_idx" ON "Reservation"("personRateId");
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_personRateId_fkey"
  FOREIGN KEY ("personRateId") REFERENCES "PersonRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
