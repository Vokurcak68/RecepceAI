-- Texty na výsledkové obrazovce kiosku (klíč, Wi-Fi) — per provozovna.
ALTER TABLE "Property"
  ADD COLUMN "kioskKeyInfo" TEXT,
  ADD COLUMN "kioskWifi" TEXT;
