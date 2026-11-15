CREATE TYPE "LoanProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

ALTER TABLE "LoanRequest"
  ADD COLUMN "productId" UUID,
  ADD COLUMN "requestedAmount" DECIMAL(18, 2),
  ADD COLUMN "requestedTermMonths" INTEGER;

CREATE TABLE "LoanProduct" (
  "id" UUID NOT NULL,
  "branchId" UUID,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "loanType" VARCHAR(120) NOT NULL,
  "source" VARCHAR(200) NOT NULL,
  "description" VARCHAR(4000),
  "sourceUrl" VARCHAR(2048),
  "thumbnailUrl" VARCHAR(2048),
  "minTermMonths" INTEGER NOT NULL,
  "maxTermMonths" INTEGER NOT NULL,
  "minAmount" DECIMAL(18, 2) NOT NULL,
  "maxAmount" DECIMAL(18, 2) NOT NULL,
  "annualInterestRate" DECIMAL(9, 4) NOT NULL DEFAULT 0,
  "status" "LoanProductStatus" NOT NULL DEFAULT 'DRAFT',
  "currentFormulaVersion" INTEGER NOT NULL DEFAULT 0,
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "LoanProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoanProduct_term_range_check" CHECK ("minTermMonths" >= 1 AND "maxTermMonths" >= "minTermMonths"),
  CONSTRAINT "LoanProduct_amount_range_check" CHECK ("minAmount" > 0 AND "maxAmount" >= "minAmount"),
  CONSTRAINT "LoanProduct_rate_nonnegative_check" CHECK ("annualInterestRate" >= 0),
  CONSTRAINT "LoanProduct_formula_version_nonnegative_check" CHECK ("currentFormulaVersion" >= 0)
);

CREATE TABLE "LoanProductFormulaVersion" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "interestFormula" VARCHAR(512) NOT NULL,
  "monthlyPaymentFormula" VARCHAR(512) NOT NULL,
  "variables" JSONB NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoanProductFormulaVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoanProductFormulaVersion_version_check" CHECK ("version" >= 1)
);

ALTER TABLE "LoanContract"
  ADD COLUMN "productId" UUID,
  ADD COLUMN "loanRequestId" UUID,
  ADD COLUMN "formulaVersionId" UUID,
  ADD COLUMN "loanAmount" DECIMAL(18, 2),
  ADD COLUMN "annualInterestRate" DECIMAL(9, 4),
  ADD COLUMN "interestAmount" DECIMAL(18, 2),
  ADD COLUMN "monthlyPayment" DECIMAL(18, 2),
  ADD COLUMN "formulaSnapshot" JSONB,
  ADD COLUMN "formulaInputs" JSONB,
  ADD COLUMN "formulaOutputs" JSONB;

CREATE UNIQUE INDEX "LoanProduct_code_key" ON "LoanProduct"("code");
CREATE INDEX "LoanProduct_branchId_status_name_idx" ON "LoanProduct"("branchId", "status", "name");
CREATE UNIQUE INDEX "LoanProductFormulaVersion_productId_version_key" ON "LoanProductFormulaVersion"("productId", "version");
CREATE INDEX "LoanProductFormulaVersion_productId_createdAt_idx" ON "LoanProductFormulaVersion"("productId", "createdAt");

ALTER TABLE "LoanProduct"
  ADD CONSTRAINT "LoanProduct_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LoanProduct_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LoanProductFormulaVersion"
  ADD CONSTRAINT "LoanProductFormulaVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "LoanProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LoanProductFormulaVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoanRequest"
  ADD CONSTRAINT "LoanRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "LoanProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LoanRequest_requestedAmount_check" CHECK ("requestedAmount" IS NULL OR "requestedAmount" > 0),
  ADD CONSTRAINT "LoanRequest_requestedTermMonths_check" CHECK ("requestedTermMonths" IS NULL OR "requestedTermMonths" >= 1);

ALTER TABLE "LoanContract"
  ADD CONSTRAINT "LoanContract_productId_fkey" FOREIGN KEY ("productId") REFERENCES "LoanProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LoanContract_loanRequestId_fkey" FOREIGN KEY ("loanRequestId") REFERENCES "LoanRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LoanContract_formulaVersionId_fkey" FOREIGN KEY ("formulaVersionId") REFERENCES "LoanProductFormulaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LoanContract_loanAmount_check" CHECK ("loanAmount" IS NULL OR "loanAmount" > 0),
  ADD CONSTRAINT "LoanContract_annualInterestRate_check" CHECK ("annualInterestRate" IS NULL OR "annualInterestRate" >= 0),
  ADD CONSTRAINT "LoanContract_interestAmount_check" CHECK ("interestAmount" IS NULL OR "interestAmount" >= 0),
  ADD CONSTRAINT "LoanContract_monthlyPayment_check" CHECK ("monthlyPayment" IS NULL OR "monthlyPayment" >= 0);
