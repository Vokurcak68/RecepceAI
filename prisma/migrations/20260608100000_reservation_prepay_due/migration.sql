-- Platba předem: lhůta úhrady (příjezd − N dnů). Po uplynutí auto-storno neuhrazené nefiremní rezervace.
ALTER TABLE "Reservation" ADD COLUMN "prepayDueAt" DATE;
