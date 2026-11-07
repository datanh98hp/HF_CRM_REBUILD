ALTER TABLE "Branch" ADD COLUMN "managerUserId" UUID;
ALTER TABLE "Branch" ALTER COLUMN "status" SET DEFAULT 'INACTIVE';
UPDATE "Branch" SET "status" = 'INACTIVE';
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_managerUserId_fkey"
  FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Branch_managerUserId_idx" ON "Branch"("managerUserId");

CREATE TYPE "LoanContractStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'AWAITING_CUSTOMER_CONFIRMATION', 'COMPLETED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ContractOtpChallengeStatus" AS ENUM ('PENDING', 'VERIFIED', 'INVALIDATED', 'LOCKED');

ALTER TABLE "LoanContract"
  ADD COLUMN "packageCode" VARCHAR(80),
  ADD COLUMN "packageVersion" VARCHAR(40),
  ADD COLUMN "sourceSystem" VARCHAR(80),
  ADD COLUMN "externalContractId" VARCHAR(160),
  ADD COLUMN "sourceUpdatedAt" TIMESTAMPTZ(3),
  ADD COLUMN "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "importBatchId" VARCHAR(120),
  ADD COLUMN "sourcePayloadHash" CHAR(64),
  ADD COLUMN "idempotencyKeyHash" CHAR(64),
  ADD COLUMN "status" "LoanContractStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "approvedById" UUID,
  ADD COLUMN "approvedAt" TIMESTAMPTZ(3),
  ADD COLUMN "completedAt" TIMESTAMPTZ(3);

-- Existing contracts predate this approval workflow and retain their prior usable state.
UPDATE "LoanContract" SET "status" = 'COMPLETED', "completedAt" = "createdAt";

CREATE UNIQUE INDEX "LoanContract_sourceSystem_externalContractId_key" ON "LoanContract"("sourceSystem", "externalContractId");
CREATE UNIQUE INDEX "LoanContract_idempotencyKeyHash_key" ON "LoanContract"("idempotencyKeyHash");
CREATE INDEX "LoanContract_branchId_status_createdAt_idx" ON "LoanContract"("branchId", "status", "createdAt");
CREATE INDEX "LoanContract_sourceSystem_receivedAt_idx" ON "LoanContract"("sourceSystem", "receivedAt");
ALTER TABLE "LoanContract" ADD CONSTRAINT "LoanContract_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LoanContractStatusHistory" (
  "id" UUID NOT NULL,
  "contractId" UUID NOT NULL,
  "fromStatus" "LoanContractStatus",
  "toStatus" "LoanContractStatus" NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "changedById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoanContractStatusHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoanContractStatusHistory_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "LoanContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LoanContractStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "LoanContractStatusHistory_contractId_createdAt_idx" ON "LoanContractStatusHistory"("contractId", "createdAt");
INSERT INTO "LoanContractStatusHistory" ("id", "contractId", "toStatus", "reason", "createdAt")
SELECT gen_random_uuid(), "id", 'COMPLETED', 'Existing contract migrated as completed before OTP workflow', "createdAt" FROM "LoanContract";

CREATE TABLE "ContractOtpChallenge" (
  "id" UUID NOT NULL,
  "contractId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "contractVersion" INTEGER NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "status" "ContractOtpChallengeStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractOtpChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractOtpChallenge_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "LoanContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContractOtpChallenge_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ContractOtpChallenge_contractId_status_createdAt_idx" ON "ContractOtpChallenge"("contractId", "status", "createdAt");
CREATE INDEX "ContractOtpChallenge_customerId_createdAt_idx" ON "ContractOtpChallenge"("customerId", "createdAt");
