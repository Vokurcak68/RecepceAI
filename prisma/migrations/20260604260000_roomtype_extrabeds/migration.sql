-- Kolik přistýlek lze do pokoje (typu) přidat.
ALTER TABLE "RoomType" ADD COLUMN "maxExtraBeds" INTEGER NOT NULL DEFAULT 0;
