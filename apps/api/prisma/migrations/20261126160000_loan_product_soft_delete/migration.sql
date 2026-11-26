ALTER TABLE "LoanProduct" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

CREATE INDEX "LoanProduct_deletedAt_status_name_idx"
ON "LoanProduct"("deletedAt", "status", "name");
