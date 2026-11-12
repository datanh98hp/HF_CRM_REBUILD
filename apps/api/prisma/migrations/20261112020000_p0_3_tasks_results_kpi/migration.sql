CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "TaskVerificationStatus" AS ENUM (
    'PENDING_VERIFICATION',
    'VERIFIED',
    'NEEDS_INFO',
    'REJECTED'
);

CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "createdById" UUID NOT NULL,
    "assigneeId" UUID NOT NULL,
    "dueAt" TIMESTAMPTZ(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskResult" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "submittedById" UUID NOT NULL,
    "reportedValue" DECIMAL(16,3) NOT NULL,
    "reportedUnit" VARCHAR(40) NOT NULL,
    "narrative" VARCHAR(4000) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskResult_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskResult_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "TaskResult_value_check" CHECK ("reportedValue" >= 0)
);

CREATE TABLE "TaskVerification" (
    "id" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "verifierId" UUID NOT NULL,
    "status" "TaskVerificationStatus" NOT NULL,
    "reason" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskResult_taskId_revision_key" ON "TaskResult"("taskId", "revision");
CREATE INDEX "Task_planId_branchId_status_idx" ON "Task"("planId", "branchId", "status");
CREATE INDEX "Task_assigneeId_status_dueAt_idx" ON "Task"("assigneeId", "status", "dueAt");
CREATE UNIQUE INDEX "TaskVerification_resultId_key" ON "TaskVerification"("resultId");
CREATE INDEX "TaskVerification_createdAt_idx" ON "TaskVerification"("createdAt");

ALTER TABLE "Task"
    ADD CONSTRAINT "Task_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Task_metricId_fkey"
    FOREIGN KEY ("metricId") REFERENCES "PlanMetric"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Task_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Task_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Task_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskResult"
    ADD CONSTRAINT "TaskResult_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskResult_submittedById_fkey"
    FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskVerification"
    ADD CONSTRAINT "TaskVerification_resultId_fkey"
    FOREIGN KEY ("resultId") REFERENCES "TaskResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskVerification_verifierId_fkey"
    FOREIGN KEY ("verifierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
