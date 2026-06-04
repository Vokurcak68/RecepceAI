-- „Nerušit" (Do Not Disturb) na rezervaci — nastavují host/recepce/úklid, plán úklidu ho odráží.
ALTER TABLE "Reservation"
  ADD COLUMN "doNotDisturb" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dndSince" TIMESTAMP(3);
