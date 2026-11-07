-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'IN_PROGRESS', 'CONVERTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CustomerVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "DuplicateReviewStatus" AS ENUM ('OPEN', 'CONFIRMED_DUPLICATE', 'NOT_DUPLICATE');

-- CreateEnum
CREATE TYPE "LoanRequestSource" AS ENUM ('CUSTOMER', 'ADVISING');

-- CreateEnum
CREATE TYPE "LoanRequestStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "normalizedName" VARCHAR(160) NOT NULL,
    "dateOfBirth" DATE,
    "phone" VARCHAR(32) NOT NULL,
    "phoneNormalized" VARCHAR(24) NOT NULL,
    "email" VARCHAR(254),
    "emailNormalized" VARCHAR(254),
    "provenance" VARCHAR(120) NOT NULL,
    "verificationStatus" "CustomerVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "status" "CustomerStatus" NOT NULL DEFAULT 'NEW',
    "branchId" UUID NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAssignment" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "adviserId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "assignedById" UUID,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    CONSTRAINT "CustomerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerStatusHistory" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "fromStatus" "CustomerStatus" NOT NULL,
    "toStatus" "CustomerStatus" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "changedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateCandidate" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "candidateCustomerId" UUID NOT NULL,
    "matchReasons" JSONB NOT NULL,
    "status" "DuplicateReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "resolutionReason" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "DuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanRequest" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "source" "LoanRequestSource" NOT NULL,
    "topic" VARCHAR(200) NOT NULL,
    "notes" VARCHAR(4000),
    "status" "LoanRequestStatus" NOT NULL DEFAULT 'OPEN',
    "recordedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "LoanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanContract" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "contractNumber" VARCHAR(120) NOT NULL,
    "packageName" VARCHAR(200) NOT NULL,
    "loanType" VARCHAR(120),
    "termMonths" INTEGER,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "LoanContract_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Customer_branchId_status_createdAt_idx" ON "Customer"("branchId", "status", "createdAt");
CREATE INDEX "Customer_phoneNormalized_idx" ON "Customer"("phoneNormalized");
CREATE INDEX "Customer_emailNormalized_idx" ON "Customer"("emailNormalized");
CREATE INDEX "Customer_normalizedName_dateOfBirth_idx" ON "Customer"("normalizedName", "dateOfBirth");
CREATE INDEX "CustomerAssignment_customerId_endedAt_idx" ON "CustomerAssignment"("customerId", "endedAt");
CREATE INDEX "CustomerAssignment_adviserId_endedAt_idx" ON "CustomerAssignment"("adviserId", "endedAt");
CREATE INDEX "CustomerAssignment_branchId_endedAt_idx" ON "CustomerAssignment"("branchId", "endedAt");
CREATE UNIQUE INDEX "CustomerAssignment_one_active_primary_per_customer_key" ON "CustomerAssignment"("customerId") WHERE "endedAt" IS NULL AND "isPrimary" = true;
CREATE INDEX "CustomerStatusHistory_customerId_createdAt_idx" ON "CustomerStatusHistory"("customerId", "createdAt");
CREATE UNIQUE INDEX "DuplicateCandidate_customerId_candidateCustomerId_key" ON "DuplicateCandidate"("customerId", "candidateCustomerId");
CREATE INDEX "DuplicateCandidate_customerId_status_idx" ON "DuplicateCandidate"("customerId", "status");
CREATE INDEX "DuplicateCandidate_candidateCustomerId_status_idx" ON "DuplicateCandidate"("candidateCustomerId", "status");
CREATE INDEX "LoanRequest_customerId_createdAt_idx" ON "LoanRequest"("customerId", "createdAt");
CREATE INDEX "LoanRequest_branchId_status_createdAt_idx" ON "LoanRequest"("branchId", "status", "createdAt");
CREATE UNIQUE INDEX "LoanContract_contractNumber_key" ON "LoanContract"("contractNumber");
CREATE INDEX "LoanContract_customerId_createdAt_idx" ON "LoanContract"("customerId", "createdAt");
CREATE INDEX "LoanContract_branchId_createdAt_idx" ON "LoanContract"("branchId", "createdAt");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerAssignment" ADD CONSTRAINT "CustomerAssignment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAssignment" ADD CONSTRAINT "CustomerAssignment_adviserId_fkey" FOREIGN KEY ("adviserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAssignment" ADD CONSTRAINT "CustomerAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAssignment" ADD CONSTRAINT "CustomerAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerStatusHistory" ADD CONSTRAINT "CustomerStatusHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerStatusHistory" ADD CONSTRAINT "CustomerStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_candidateCustomerId_fkey" FOREIGN KEY ("candidateCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoanContract" ADD CONSTRAINT "LoanContract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanContract" ADD CONSTRAINT "LoanContract_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanContract" ADD CONSTRAINT "LoanContract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
