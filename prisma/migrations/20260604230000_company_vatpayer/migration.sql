-- Plátce DPH na firmě (z VIES / dle DIČ).
ALTER TABLE "Company" ADD COLUMN "vatPayer" BOOLEAN NOT NULL DEFAULT false;
