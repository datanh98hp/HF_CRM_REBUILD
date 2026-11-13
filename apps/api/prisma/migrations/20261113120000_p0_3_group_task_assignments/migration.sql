CREATE TABLE "TaskAssignment" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "assigneeId" UUID NOT NULL,
    "target" DECIMAL(16,3),
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskAssignment_target_check" CHECK ("target" IS NULL OR "target" >= 0)
);

INSERT INTO "TaskAssignment" ("id", "taskId", "assigneeId", "target", "status", "createdAt", "updatedAt")
SELECT "id", "id", "assigneeId", NULL, "status", "createdAt", "updatedAt"
FROM "Task";

ALTER TABLE "Task" ALTER COLUMN "assigneeId" DROP NOT NULL;

ALTER TABLE "TaskResult" ADD COLUMN "assignmentId" UUID;
UPDATE "TaskResult" SET "assignmentId" = "taskId";
ALTER TABLE "TaskResult" ALTER COLUMN "assignmentId" SET NOT NULL;

DROP INDEX "TaskResult_taskId_revision_key";
CREATE UNIQUE INDEX "TaskResult_assignmentId_revision_key" ON "TaskResult"("assignmentId", "revision");
CREATE INDEX "TaskResult_taskId_idx" ON "TaskResult"("taskId");
CREATE UNIQUE INDEX "TaskAssignment_taskId_assigneeId_key" ON "TaskAssignment"("taskId", "assigneeId");
CREATE INDEX "TaskAssignment_assigneeId_status_idx" ON "TaskAssignment"("assigneeId", "status");
CREATE INDEX "TaskAssignment_taskId_status_idx" ON "TaskAssignment"("taskId", "status");

ALTER TABLE "TaskAssignment"
    ADD CONSTRAINT "TaskAssignment_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "TaskAssignment_assigneeId_fkey"
        FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskResult"
    ADD CONSTRAINT "TaskResult_assignmentId_fkey"
        FOREIGN KEY ("assignmentId") REFERENCES "TaskAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
