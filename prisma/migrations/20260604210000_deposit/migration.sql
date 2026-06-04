-- Vratná kauce (jistota) — lifecycle přijata / vrácena / zadržena.
CREATE TYPE "DepositStatus" AS ENUM ('held', 'returned', 'forfeited');

CREATE TABLE "Deposit" (
  "id"             TEXT NOT NULL,
  "propertyId"     TEXT NOT NULL,
  "reservationId"  TEXT,
  "companyId"      TEXT,
  "amount"         DECIMAL(10,2) NOT NULL,
  "method"         "PaymentMethod" NOT NULL DEFAULT 'cash',
  "status"         "DepositStatus" NOT NULL DEFAULT 'held',
  "takenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "returnedAt"     TIMESTAMP(3),
  "returnedAmount" DECIMAL(10,2),
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Deposit_propertyId_status_idx" ON "Deposit"("propertyId", "status");
CREATE INDEX "Deposit_reservationId_idx" ON "Deposit"("reservationId");
CREATE INDEX "Deposit_companyId_idx" ON "Deposit"("companyId");

ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
