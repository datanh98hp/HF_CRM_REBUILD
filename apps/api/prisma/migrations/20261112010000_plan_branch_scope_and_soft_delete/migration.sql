CREATE TABLE IF NOT EXISTS "PlanBranch" (
    "planId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanBranch_pkey" PRIMARY KEY ("planId", "branchId")
);

INSERT INTO "PlanBranch" ("planId", "branchId")
SELECT "id", "branchId" FROM "Plan"
ON CONFLICT ("planId", "branchId") DO NOTHING;

ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "PlanBranch_branchId_planId_idx" ON "PlanBranch"("branchId", "planId");
CREATE INDEX IF NOT EXISTS "Plan_periodStart_periodEnd_deletedAt_idx" ON "Plan"("periodStart", "periodEnd", "deletedAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlanBranch_planId_fkey') THEN
        ALTER TABLE "PlanBranch"
            ADD CONSTRAINT "PlanBranch_planId_fkey"
            FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlanBranch_branchId_fkey') THEN
        ALTER TABLE "PlanBranch"
            ADD CONSTRAINT "PlanBranch_branchId_fkey"
            FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DROP INDEX IF EXISTS "Plan_branchId_periodStart_periodEnd_idx";
ALTER TABLE "Plan" DROP CONSTRAINT IF EXISTS "Plan_branchId_fkey";
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "branchId";
