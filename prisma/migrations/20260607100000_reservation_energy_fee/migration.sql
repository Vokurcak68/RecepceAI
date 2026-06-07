-- Energetický poplatek („vzdušné") na rezervaci — pro lůžkové/firemní pobyty (sjednocení s BedOccupancy).
ALTER TABLE "Reservation" ADD COLUMN "energyFeeExempt" BOOLEAN NOT NULL DEFAULT false;
