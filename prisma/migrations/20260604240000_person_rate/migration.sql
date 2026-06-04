-- Číselník typů osob s cenou za noc (děti dle věku, senior, uprchlík…) + napojení na obsazení lůžka.
CREATE TABLE "PersonRate" (
  "id"            TEXT NOT NULL,
  "propertyId"    TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "ageFrom"       INTEGER,
  "ageTo"         INTEGER,
  "pricePerNight" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PersonRate_propertyId_active_idx" ON "PersonRate"("propertyId", "active");

ALTER TABLE "BedOccupancy" ADD COLUMN "personRateId" TEXT;
ALTER TABLE "BedOccupancy" ADD COLUMN "dateOfBirth" DATE;
ALTER TABLE "BedOccupancy" ADD CONSTRAINT "BedOccupancy_personRateId_fkey"
  FOREIGN KEY ("personRateId") REFERENCES "PersonRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
