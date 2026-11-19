CREATE TYPE "CustomerImportBatchStatus" AS ENUM (
    'QUARANTINED',
    'SCANNING',
    'QUEUED',
    'PROCESSING',
    'NEEDS_REVIEW',
    'READY_TO_CONFIRM',
    'COMMITTING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'EXPIRED'
);

CREATE TYPE "CustomerImportRowStatus" AS ENUM (
    'VALIDATING',
    'INVALID',
    'DUPLICATE_REVIEW',
    'READY',
    'IMPORTED',
    'SKIPPED_DUPLICATE'
);

CREATE TYPE "CustomerImportDuplicateDecision" AS ENUM (
    'CONFIRMED_DUPLICATE',
    'NOT_DUPLICATE'
);

CREATE TABLE "CustomerImportBatch" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "confirmedById" UUID,
    "fileAssetId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "fileSha256" CHAR(64) NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "selectedSheet" VARCHAR(160),
    "status" "CustomerImportBatchStatus" NOT NULL DEFAULT 'QUARANTINED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorCode" VARCHAR(80),
    "confirmedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "CustomerImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerImportRow" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "sheetName" VARCHAR(160) NOT NULL DEFAULT '',
    "fullName" VARCHAR(160),
    "normalizedName" VARCHAR(160),
    "phone" VARCHAR(32),
    "phoneNormalized" VARCHAR(24),
    "email" VARCHAR(254),
    "emailNormalized" VARCHAR(254),
    "dateOfBirth" DATE,
    "status" "CustomerImportRowStatus" NOT NULL DEFAULT 'VALIDATING',
    "validationErrors" JSONB NOT NULL DEFAULT '[]'::JSONB,
    "duplicateMatches" JSONB NOT NULL DEFAULT '[]'::JSONB,
    "duplicateDecision" "CustomerImportDuplicateDecision",
    "decisionReason" VARCHAR(1000),
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "customerId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "CustomerImportRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerImportBatch_fileAssetId_key" ON "CustomerImportBatch"("fileAssetId");
CREATE UNIQUE INDEX "CustomerImportBatch_createdById_idempotencyKey_key" ON "CustomerImportBatch"("createdById", "idempotencyKey");
CREATE INDEX "CustomerImportBatch_branchId_status_createdAt_idx" ON "CustomerImportBatch"("branchId", "status", "createdAt");
CREATE INDEX "CustomerImportBatch_createdById_createdAt_idx" ON "CustomerImportBatch"("createdById", "createdAt");
CREATE UNIQUE INDEX "CustomerImportRow_batchId_sheetName_rowNumber_key" ON "CustomerImportRow"("batchId", "sheetName", "rowNumber");
CREATE INDEX "CustomerImportRow_batchId_status_rowNumber_idx" ON "CustomerImportRow"("batchId", "status", "rowNumber");
CREATE INDEX "CustomerImportRow_phoneNormalized_idx" ON "CustomerImportRow"("phoneNormalized");
CREATE INDEX "CustomerImportRow_emailNormalized_idx" ON "CustomerImportRow"("emailNormalized");

ALTER TABLE "CustomerImportBatch"
    ADD CONSTRAINT "CustomerImportBatch_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerImportBatch"
    ADD CONSTRAINT "CustomerImportBatch_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerImportBatch"
    ADD CONSTRAINT "CustomerImportBatch_confirmedById_fkey"
    FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerImportBatch"
    ADD CONSTRAINT "CustomerImportBatch_fileAssetId_fkey"
    FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerImportRow"
    ADD CONSTRAINT "CustomerImportRow_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "CustomerImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerImportRow"
    ADD CONSTRAINT "CustomerImportRow_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerImportRow"
    ADD CONSTRAINT "CustomerImportRow_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("key", "groupKey", "description")
VALUES (
    'customers.import',
    'customers',
    'Import customer records in batches within granted scope | Nhập khách hàng theo lô trong phạm vi được cấp.'
)
ON CONFLICT ("key") DO UPDATE SET
    "groupKey" = EXCLUDED."groupKey",
    "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionKey", "scope")
SELECT "Role"."id", 'customers.import',
       CASE WHEN "Role"."key" = 'MANAGE' THEN 'BRANCH'::"AccessScope" ELSE 'ALL'::"AccessScope" END
FROM "Role"
WHERE "Role"."key" IN ('ADMIN', 'OPERATOR', 'MANAGE')
ON CONFLICT ("roleId", "permissionKey", "scope") DO NOTHING;
