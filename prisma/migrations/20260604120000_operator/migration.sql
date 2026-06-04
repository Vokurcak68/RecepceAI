-- Provozovatel (fakturující firma) na provozovně + rozšířený snímek dodavatele na dokladu.
ALTER TABLE "Property"
  ADD COLUMN "operatorName" TEXT,
  ADD COLUMN "operatorAddress" TEXT,
  ADD COLUMN "operatorRegistration" TEXT,
  ADD COLUMN "operatorAccount" TEXT,
  ADD COLUMN "operatorIco" TEXT,
  ADD COLUMN "operatorDic" TEXT;

ALTER TABLE "Document"
  ADD COLUMN "supplierRegistration" TEXT,
  ADD COLUMN "supplierAccount" TEXT;
