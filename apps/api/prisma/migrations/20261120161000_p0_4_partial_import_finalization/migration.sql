ALTER TABLE "CustomerImportBatch"
DROP CONSTRAINT "CustomerImportBatch_aggregate_audit_only_check";

ALTER TABLE "CustomerImportBatch"
ADD CONSTRAINT "CustomerImportBatch_aggregate_audit_only_check"
CHECK (
  "status" NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')
  OR (
    "totalRows" = 0
    AND "validRows" = 0
    AND "skippedRows" = 0
    AND "columnMapping" = '{}'::JSONB
    AND "selectedSheet" IS NULL
  )
);
