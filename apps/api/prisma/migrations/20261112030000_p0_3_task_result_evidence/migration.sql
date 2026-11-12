CREATE TYPE "FileScanStatus" AS ENUM (
    'QUARANTINED',
    'AVAILABLE',
    'REJECTED',
    'DELETED'
);

CREATE TABLE "FileAsset" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'QUARANTINED',
    "scannedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FileAsset_sizeBytes_check" CHECK ("sizeBytes" BETWEEN 1 AND 10485760),
    CONSTRAINT "FileAsset_mimeType_check" CHECK ("mimeType" IN ('application/pdf', 'image/jpeg', 'image/png')),
    CONSTRAINT "FileAsset_available_requires_policy_check"
        CHECK ("scanStatus" <> 'AVAILABLE' OR ("scannedAt" IS NOT NULL AND "expiresAt" IS NOT NULL)),
    CONSTRAINT "FileAsset_deleted_state_check"
        CHECK (("scanStatus" = 'DELETED') = ("deletedAt" IS NOT NULL))
);

CREATE TABLE "TaskResultEvidence" (
    "id" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "linkedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskResultEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FileAsset_objectKey_key" ON "FileAsset"("objectKey");
CREATE INDEX "FileAsset_branchId_scanStatus_createdAt_idx"
    ON "FileAsset"("branchId", "scanStatus", "createdAt");
CREATE INDEX "FileAsset_uploadedById_createdAt_idx" ON "FileAsset"("uploadedById", "createdAt");
CREATE INDEX "FileAsset_expiresAt_legalHold_idx" ON "FileAsset"("expiresAt", "legalHold");
CREATE UNIQUE INDEX "TaskResultEvidence_resultId_fileId_key"
    ON "TaskResultEvidence"("resultId", "fileId");
CREATE INDEX "TaskResultEvidence_fileId_createdAt_idx"
    ON "TaskResultEvidence"("fileId", "createdAt");

ALTER TABLE "FileAsset"
    ADD CONSTRAINT "FileAsset_branchId_fkey"
        FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "FileAsset_uploadedById_fkey"
        FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskResultEvidence"
    ADD CONSTRAINT "TaskResultEvidence_resultId_fkey"
        FOREIGN KEY ("resultId") REFERENCES "TaskResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskResultEvidence_fileId_fkey"
        FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskResultEvidence_linkedById_fkey"
        FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
