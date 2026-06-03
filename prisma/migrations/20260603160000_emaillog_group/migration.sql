-- EmailLog může patřit skupině (souhrnný e-mail), proto reservationId volitelné + groupId.
ALTER TABLE "EmailLog" ALTER COLUMN "reservationId" DROP NOT NULL;
ALTER TABLE "EmailLog" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE INDEX "EmailLog_groupId_createdAt_idx" ON "EmailLog"("groupId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ReservationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
