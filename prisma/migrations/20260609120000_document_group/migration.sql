-- Jednoznačná vazba dokladu (hromadné faktury) na skupinu.
ALTER TABLE "Document" ADD COLUMN "groupId" TEXT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ReservationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Document_groupId_idx" ON "Document"("groupId");
