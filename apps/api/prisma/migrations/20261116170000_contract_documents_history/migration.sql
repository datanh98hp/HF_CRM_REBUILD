CREATE TABLE "LoanContractDocument" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "storageKey" VARCHAR(80) NOT NULL,
    "mimeType" VARCHAR(127) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" UUID,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "LoanContractDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoanContractChangeHistory" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "changedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanContractChangeHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoanContractDocument_storageKey_key" ON "LoanContractDocument"("storageKey");
CREATE INDEX "LoanContractDocument_contractId_deletedAt_createdAt_idx" ON "LoanContractDocument"("contractId", "deletedAt", "createdAt");
CREATE INDEX "LoanContractChangeHistory_contractId_createdAt_idx" ON "LoanContractChangeHistory"("contractId", "createdAt");

ALTER TABLE "LoanContractDocument"
    ADD CONSTRAINT "LoanContractDocument_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "LoanContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoanContractDocument"
    ADD CONSTRAINT "LoanContractDocument_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LoanContractChangeHistory"
    ADD CONSTRAINT "LoanContractChangeHistory_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "LoanContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoanContractChangeHistory"
    ADD CONSTRAINT "LoanContractChangeHistory_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
