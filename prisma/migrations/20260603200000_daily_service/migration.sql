-- Stav „Zkontrolovat" (ke kontrole / dennímu úklidu)
ALTER TYPE "RoomStatus" ADD VALUE IF NOT EXISTS 'to_inspect';

-- Parametr provozovny: úklid každý den
ALTER TABLE "Property" ADD COLUMN "dailyCleaning" BOOLEAN NOT NULL DEFAULT false;

-- Dedup denní automatiky na pokoji
ALTER TABLE "Room" ADD COLUMN "dailyServiceDate" DATE;
