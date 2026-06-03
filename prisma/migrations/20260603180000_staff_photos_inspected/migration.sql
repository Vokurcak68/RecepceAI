-- Stav pokoje „zkontrolováno"
ALTER TYPE "RoomStatus" ADD VALUE IF NOT EXISTS 'inspected';

-- Fotky závady u servisního požadavku
ALTER TABLE "ServiceRequest" ADD COLUMN "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
