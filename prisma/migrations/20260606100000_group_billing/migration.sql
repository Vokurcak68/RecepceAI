-- Platební režim skupiny: kolektivně (jeden plátce/společná faktura) nebo individuálně (každý pokoj sám).
CREATE TYPE "GroupBilling" AS ENUM ('collective', 'individual');
ALTER TABLE "ReservationGroup" ADD COLUMN "billing" "GroupBilling" NOT NULL DEFAULT 'individual';
