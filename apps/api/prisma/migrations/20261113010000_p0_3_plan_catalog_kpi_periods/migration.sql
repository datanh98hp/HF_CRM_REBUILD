CREATE TABLE "PlanMetricCatalog" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "unit" VARCHAR(40) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PlanMetricCatalog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanApproval" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "decision" "PlanApprovalDecision" NOT NULL,
    "reason" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanApproval_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanApproval_version_check" CHECK ("version" > 0),
    CONSTRAINT "PlanApproval_rejection_reason_check" CHECK ("decision" <> 'REJECTED' OR coalesce(length(trim("reason")), 0) > 0)
);

ALTER TABLE "Plan" ADD COLUMN "approvalVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlanMetric" ADD COLUMN "catalogId" UUID;

CREATE UNIQUE INDEX "PlanMetricCatalog_key_key" ON "PlanMetricCatalog"("key");
CREATE INDEX "PlanMetricCatalog_isActive_name_idx" ON "PlanMetricCatalog"("isActive", "name");
CREATE UNIQUE INDEX "PlanApproval_planId_version_key" ON "PlanApproval"("planId", "version");
CREATE INDEX "PlanApproval_reviewerId_createdAt_idx" ON "PlanApproval"("reviewerId", "createdAt");
CREATE INDEX "PlanMetric_catalogId_idx" ON "PlanMetric"("catalogId");

ALTER TABLE "PlanMetric"
    ADD CONSTRAINT "PlanMetric_catalogId_fkey"
    FOREIGN KEY ("catalogId") REFERENCES "PlanMetricCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanApproval"
    ADD CONSTRAINT "PlanApproval_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "PlanApproval_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "PlanMetricCatalog" ("id", "key", "name", "unit", "updatedAt") VALUES
    ('8a5b2c10-1d67-4f91-a007-000000000101', 'new_customers', 'Khách hàng mới', 'khách hàng', CURRENT_TIMESTAMP),
    ('8a5b2c10-1d67-4f91-a007-000000000102', 'outreach_attempts', 'Lượt tiếp cận', 'lượt', CURRENT_TIMESTAMP),
    ('8a5b2c10-1d67-4f91-a007-000000000103', 'consultations', 'Lượt tư vấn', 'lượt', CURRENT_TIMESTAMP),
    ('8a5b2c10-1d67-4f91-a007-000000000104', 'loan_applications_received', 'Hồ sơ tiếp nhận', 'hồ sơ', CURRENT_TIMESTAMP),
    ('8a5b2c10-1d67-4f91-a007-000000000105', 'loan_applications_completed', 'Hồ sơ hoàn thiện', 'hồ sơ', CURRENT_TIMESTAMP),
    ('8a5b2c10-1d67-4f91-a007-000000000106', 'loan_applications_approved', 'Hồ sơ được duyệt', 'hồ sơ', CURRENT_TIMESTAMP),
    ('8a5b2c10-1d67-4f91-a007-000000000107', 'loans_disbursed', 'Khoản giải ngân', 'khoản', CURRENT_TIMESTAMP),
    ('8a5b2c10-1d67-4f91-a007-000000000108', 'disbursement_amount', 'Giá trị giải ngân', 'VND', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
