-- Fakturace lůžkové obsazenosti firmě: cena za lůžko/noc + příznak vyfakturováno.
ALTER TABLE "BedOccupancy"
  ADD COLUMN "pricePerNight" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "invoicedAt" TIMESTAMP(3);
