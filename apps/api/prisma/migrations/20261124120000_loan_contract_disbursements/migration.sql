CREATE TABLE "LoanContractDisbursement" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "disbursedAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedById" UUID NOT NULL,
    "idempotencyKeyHash" CHAR(64) NOT NULL,
    "requestPayloadHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanContractDisbursement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoanContractDisbursement_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "LoanContractDisbursement_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "LoanContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LoanContractDisbursement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LoanContractDisbursement_idempotencyKeyHash_key" ON "LoanContractDisbursement"("idempotencyKeyHash");
CREATE INDEX "LoanContractDisbursement_contractId_disbursedAt_idx" ON "LoanContractDisbursement"("contractId", "disbursedAt");
CREATE INDEX "LoanContractDisbursement_recordedById_createdAt_idx" ON "LoanContractDisbursement"("recordedById", "createdAt");
