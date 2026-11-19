DELETE FROM "CustomerImportRow"
WHERE "batchId" IN (
    SELECT "id"
    FROM "CustomerImportBatch"
    WHERE "status" = 'COMMITTING'
      AND ("tempFileKey" IS NULL OR "fileSha256" IS NULL)
);

UPDATE "CustomerImportBatch"
SET "status" = 'FAILED',
    "tempFileKey" = NULL,
    "fileSha256" = NULL,
    "totalRows" = 0,
    "validRows" = 0,
    "invalidRows" = 0,
    "skippedRows" = 0,
    "columnMapping" = '{}'::JSONB,
    "selectedSheet" = NULL,
    "errorCode" = 'IMPORT_PIPELINE_UPGRADE',
    "completedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP)
WHERE "status" = 'COMMITTING'
  AND ("tempFileKey" IS NULL OR "fileSha256" IS NULL);

ALTER TABLE "CustomerImportBatch"
    DROP CONSTRAINT IF EXISTS "CustomerImportBatch_temporary_file_lifecycle_check",
    ADD CONSTRAINT "CustomerImportBatch_temporary_file_lifecycle_check"
    CHECK (
        (
            "status" IN ('QUARANTINED', 'SCANNING', 'QUEUED', 'PROCESSING', 'COMMITTING')
            AND "tempFileKey" IS NOT NULL
            AND "fileSha256" IS NOT NULL
        )
        OR (
            "status" NOT IN ('QUARANTINED', 'SCANNING', 'QUEUED', 'PROCESSING', 'COMMITTING')
            AND "tempFileKey" IS NULL
            AND "fileSha256" IS NULL
        )
    );
