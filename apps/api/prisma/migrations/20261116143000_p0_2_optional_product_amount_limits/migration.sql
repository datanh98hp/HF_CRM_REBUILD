ALTER TABLE "LoanProduct"
  DROP CONSTRAINT "LoanProduct_amount_range_check",
  ALTER COLUMN "minAmount" DROP NOT NULL,
  ALTER COLUMN "maxAmount" DROP NOT NULL;

ALTER TABLE "LoanProduct"
  ADD CONSTRAINT "LoanProduct_amount_range_check"
  CHECK (
    ("minAmount" IS NULL OR "minAmount" > 0)
    AND ("maxAmount" IS NULL OR "maxAmount" > 0)
    AND ("minAmount" IS NULL OR "maxAmount" IS NULL OR "maxAmount" >= "minAmount")
  );
