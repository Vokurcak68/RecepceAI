-- Storno / zálohové politiky + automatika na provozovně (0 = vypnuto)
ALTER TABLE "Property" ADD COLUMN "freeCancelDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Property" ADD COLUMN "cancelFeePct" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Property" ADD COLUMN "depositPct" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Property" ADD COLUMN "reminderHours" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Property" ADD COLUMN "noShowHours" INTEGER NOT NULL DEFAULT 0;
