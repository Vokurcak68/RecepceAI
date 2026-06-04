-- Centrální adresář firem (odběratelů) + volitelná vazba rezervace na firmu.
CREATE TABLE "Company" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "ico"       TEXT,
  "dic"       TEXT,
  "account"   TEXT,
  "street"    TEXT,
  "city"      TEXT,
  "zip"       TEXT,
  "country"   TEXT DEFAULT 'CZ',
  "email"     TEXT,
  "phone"     TEXT,
  "note"      TEXT,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Company_name_idx" ON "Company"("name");

ALTER TABLE "Reservation" ADD COLUMN "companyId" TEXT;
CREATE INDEX "Reservation_companyId_idx" ON "Reservation"("companyId");
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
