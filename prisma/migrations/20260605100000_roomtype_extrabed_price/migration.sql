-- Cena za přistýlku/noc na typu pokoje (přesun z číselníku osob).
ALTER TABLE "RoomType" ADD COLUMN "extraBedPrice" DECIMAL(10,2) NOT NULL DEFAULT 0;
