ALTER TABLE "User"
ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
