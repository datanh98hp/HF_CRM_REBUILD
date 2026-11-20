ALTER TABLE "CustomerImportBatch"
ADD COLUMN "failureDetailsExpiresAt" TIMESTAMPTZ(3);

CREATE INDEX "CustomerImportBatch_failureDetailsExpiresAt_idx"
ON "CustomerImportBatch"("failureDetailsExpiresAt");

DELETE FROM "CustomerImportRow" AS row
USING "CustomerImportBatch" AS batch
WHERE row."batchId" = batch."id"
  AND batch."status" IN ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');
