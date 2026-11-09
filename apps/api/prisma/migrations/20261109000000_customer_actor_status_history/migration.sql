ALTER TABLE "CustomerStatusHistory" ADD COLUMN "changedByCustomerId" UUID;
ALTER TABLE "CustomerStatusHistory" ADD CONSTRAINT "CustomerStatusHistory_changedByCustomerId_fkey"
  FOREIGN KEY ("changedByCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "CustomerStatusHistory_changedByCustomerId_createdAt_idx"
  ON "CustomerStatusHistory"("changedByCustomerId", "createdAt");

ALTER TABLE "LoanContractStatusHistory" ADD COLUMN "changedByCustomerId" UUID;
ALTER TABLE "LoanContractStatusHistory" ADD CONSTRAINT "LoanContractStatusHistory_changedByCustomerId_fkey"
  FOREIGN KEY ("changedByCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "LoanContractStatusHistory_changedByCustomerId_createdAt_idx"
  ON "LoanContractStatusHistory"("changedByCustomerId", "createdAt");
