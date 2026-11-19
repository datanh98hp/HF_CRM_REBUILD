ALTER TABLE "CustomerImportBatch"
    DROP CONSTRAINT IF EXISTS "CustomerImportBatch_fileAssetId_fkey";

DROP INDEX IF EXISTS "CustomerImportBatch_fileAssetId_key";

ALTER TABLE "CustomerImportBatch"
    DROP COLUMN IF EXISTS "fileAssetId",
    ADD COLUMN "tempFileKey" VARCHAR(64),
    ALTER COLUMN "fileSha256" DROP NOT NULL,
    ADD COLUMN "failedInsertRows" INTEGER NOT NULL DEFAULT 0;

UPDATE "CustomerImportBatch"
SET "status" = 'FAILED',
    "errorCode" = 'LOCAL_TEMP_STORAGE_MIGRATION'
WHERE "status" IN ('QUARANTINED', 'SCANNING', 'QUEUED', 'PROCESSING');

UPDATE "CustomerImportBatch"
SET "fileSha256" = NULL
WHERE "status" NOT IN ('QUARANTINED', 'SCANNING', 'QUEUED', 'PROCESSING');

DELETE FROM "CustomerImportRow"
WHERE "batchId" IN (
    SELECT "id"
    FROM "CustomerImportBatch"
    WHERE "status" IN ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')
);

UPDATE "CustomerImportBatch"
SET "totalRows" = 0,
    "validRows" = 0,
    "invalidRows" = 0,
    "skippedRows" = 0,
    "columnMapping" = '{}'::JSONB,
    "selectedSheet" = NULL
WHERE "status" IN ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

ALTER TABLE "CustomerImportBatch"
    ADD CONSTRAINT "CustomerImportBatch_temporary_file_lifecycle_check"
    CHECK (
        (
            "status" IN ('QUARANTINED', 'SCANNING', 'QUEUED', 'PROCESSING')
            AND "tempFileKey" IS NOT NULL
            AND "fileSha256" IS NOT NULL
        )
        OR (
            "status" NOT IN ('QUARANTINED', 'SCANNING', 'QUEUED', 'PROCESSING')
            AND "tempFileKey" IS NULL
            AND "fileSha256" IS NULL
        )
    ),
    ADD CONSTRAINT "CustomerImportBatch_aggregate_audit_only_check"
    CHECK (
        "status" NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')
        OR (
            "totalRows" = 0
            AND "validRows" = 0
            AND "invalidRows" = 0
            AND "skippedRows" = 0
            AND "columnMapping" = '{}'::JSONB
            AND "selectedSheet" IS NULL
        )
    );
