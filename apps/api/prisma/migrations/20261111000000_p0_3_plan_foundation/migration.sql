CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000),
    "branchId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Plan_period_check" CHECK ("periodStart" < "periodEnd")
);

CREATE TABLE "PlanMetric" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "unit" VARCHAR(40) NOT NULL,
    "target" DECIMAL(16,3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PlanMetric_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanMetric_target_check" CHECK ("target" >= 0)
);

CREATE UNIQUE INDEX "PlanMetric_planId_name_key" ON "PlanMetric"("planId", "name");
CREATE INDEX "Plan_branchId_periodStart_periodEnd_idx" ON "Plan"("branchId", "periodStart", "periodEnd");
CREATE INDEX "Plan_createdById_createdAt_idx" ON "Plan"("createdById", "createdAt");
CREATE INDEX "PlanMetric_planId_idx" ON "PlanMetric"("planId");

ALTER TABLE "Plan"
    ADD CONSTRAINT "Plan_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Plan"
    ADD CONSTRAINT "Plan_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanMetric"
    ADD CONSTRAINT "PlanMetric_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
