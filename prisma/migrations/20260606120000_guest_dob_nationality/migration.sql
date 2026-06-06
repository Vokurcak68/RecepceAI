-- Datum narození a národnost na profilu hosta (nepovinné; pro předvyplnění evidenční knihy / UBYPORT).
ALTER TABLE "Guest" ADD COLUMN "dateOfBirth" DATE;
ALTER TABLE "Guest" ADD COLUMN "nationality" TEXT;
