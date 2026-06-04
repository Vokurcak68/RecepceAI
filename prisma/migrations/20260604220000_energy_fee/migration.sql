-- „Vzdušné" / energetický poplatek za lůžko/noc + osvobození per obsazení.
ALTER TABLE "Property" ADD COLUMN "energyFeePerNight" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "BedOccupancy" ADD COLUMN "energyFeeExempt" BOOLEAN NOT NULL DEFAULT false;
