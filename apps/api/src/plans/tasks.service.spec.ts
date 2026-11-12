import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  BranchStatus,
  FileScanStatus,
  PlanStatus,
  Prisma,
  TaskStatus,
  TaskVerificationStatus,
} from '../generated/prisma/client.js';
import { TasksService } from './tasks.service.js';

describe('TasksService', () => {
  const actor = { id: 'staff-id', type: 'STAFF' as const };
  const branchId = 'branch-id';
  const planId = 'plan-id';
  const taskId = 'task-id';
  const resultId = 'result-id';
  const metricId = 'metric-id';
  const plan = () => ({
    id: planId,
    status: PlanStatus.ACTIVE,
    deletedAt: null,
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-04-01T00:00:00.000Z'),
    branches: [{ branchId, branch: { status: BranchStatus.ACTIVE } }],
    metrics: [{ id: metricId, name: 'Calls', unit: 'calls', target: new Prisma.Decimal(20) }],
  });
  const task = () => ({
    id: taskId,
    planId,
    metricId,
    branchId,
    title: 'Call customers',
    description: null,
    createdById: actor.id,
    assigneeId: actor.id,
    dueAt: null,
    status: TaskStatus.TODO,
    metric: { unit: 'calls' },
    plan: {
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
    },
    results: [],
  });
  let prisma: any;
  let access: any;
  let audit: any;
  let tx: any;
  let service: TasksService;

  beforeEach(() => {
    tx = {
      task: {
        create: jest.fn(async ({ data }: any) => ({
          ...task(),
          ...data,
          metric: { id: metricId, name: 'Calls', unit: 'calls' },
          branch: { id: branchId, code: 'NORTH', name: 'North Branch' },
          assignee: { id: actor.id, username: 'staff', displayName: 'Staff' },
          createdBy: { id: actor.id, username: 'staff', displayName: 'Staff' },
          results: [],
        })),
        update: jest.fn(async () => task()),
      },
      taskResult: {
        create: jest.fn(async ({ data }: any) => ({
          id: resultId,
          ...data,
          reportedValue: new Prisma.Decimal(data.reportedValue),
        })),
      },
      taskVerification: {
        create: jest.fn(async ({ data }: any) => ({
          id: 'verification-id',
          ...data,
          verifier: { id: actor.id, username: 'reviewer', displayName: 'Reviewer' },
        })),
      },
    };
    prisma = {
      plan: { findFirst: jest.fn(async () => plan()) },
      task: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => task()),
      },
      taskResult: { findUnique: jest.fn(async () => null) },
      fileAsset: { findMany: jest.fn(async () => []) },
      user: { findFirst: jest.fn(async () => ({ id: actor.id })) },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(tx)),
    };
    access = {
      assertResourceAccess: jest.fn(async () => undefined),
      assertPermission: jest.fn(async () => undefined),
      hasResourceAccess: jest.fn(async () => true),
    };
    audit = { write: jest.fn(async () => undefined) };
    service = new TasksService(prisma, access, audit);
  });

  it('creates a task only for a metric and branch in an active plan', async () => {
    const result = await service.create(actor, planId, {
      metricId,
      branchId,
      title: ' Call customers ',
    });

    expect(result).toMatchObject({ title: 'Call customers', status: TaskStatus.TODO });
    expect(access.assertResourceAccess).toHaveBeenCalledWith(
      actor.id,
      'tasks.manage',
      undefined,
      { branchId },
    );
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'task.created',
      targetId: taskId,
    }));

    await expect(service.create(actor, planId, {
      metricId: 'other-metric',
      branchId,
      title: 'Invalid metric',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects mismatched result units and dates outside the plan period', async () => {
    await expect(service.submitResult(actor, taskId, {
      reportedValue: 3,
      reportedUnit: 'customers',
      narrative: 'Completed calls',
      occurredAt: '2026-02-01T00:00:00.000Z',
    })).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.submitResult(actor, taskId, {
      reportedValue: 3,
      reportedUnit: 'calls',
      narrative: 'Completed calls',
      occurredAt: '2026-04-01T00:00:00.000Z',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.taskResult.create).not.toHaveBeenCalled();
  });

  it('links only available, unexpired evidence files from the task branch', async () => {
    prisma.fileAsset.findMany.mockResolvedValue([{ id: 'evidence-file-id' }]);

    await service.submitResult(actor, taskId, {
      reportedValue: 3,
      reportedUnit: 'calls',
      narrative: 'Completed calls',
      occurredAt: '2026-02-01T00:00:00.000Z',
      evidenceFileIds: ['evidence-file-id'],
    });

    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ['evidence-file-id'] },
        branchId,
        scanStatus: FileScanStatus.AVAILABLE,
        deletedAt: null,
        expiresAt: { gt: expect.any(Date) },
      }),
    }));
    expect(tx.taskResult.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        evidenceFiles: {
          create: [{
            file: { connect: { id: 'evidence-file-id' } },
            linkedBy: { connect: { id: actor.id } },
          }],
        },
      }),
    }));
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'task.result.submitted',
      afterState: expect.objectContaining({ evidenceFileIds: ['evidence-file-id'] }),
    }));
  });

  it('rejects evidence files outside scope or not available before creating a result', async () => {
    await expect(service.submitResult(actor, taskId, {
      reportedValue: 3,
      reportedUnit: 'calls',
      narrative: 'Completed calls',
      occurredAt: '2026-02-01T00:00:00.000Z',
      evidenceFileIds: ['unavailable-file-id'],
    })).rejects.toMatchObject({
      response: { code: 'TASK_EVIDENCE_FILE_UNAVAILABLE' },
    });

    expect(tx.taskResult.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('submits a result as a new immutable revision and marks it pending review', async () => {
    prisma.task.findUnique.mockResolvedValue({
      ...task(),
      results: [{
        revision: 1,
        verification: { status: TaskVerificationStatus.NEEDS_INFO },
      }],
    });

    const result = await service.submitResult(actor, taskId, {
      reportedValue: 4.5,
      reportedUnit: 'calls',
      narrative: 'Completed calls',
      occurredAt: '2026-02-01T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      revision: 2,
      reportedValue: 4.5,
      verificationStatus: TaskVerificationStatus.PENDING_VERIFICATION,
    });
    expect(tx.taskResult.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revision: 2, reportedUnit: 'calls' }),
    }));
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: taskId },
      data: { status: TaskStatus.IN_PROGRESS },
    });
  });

  it('blocks duplicate submissions while a result is pending verification', async () => {
    prisma.task.findUnique.mockResolvedValue({
      ...task(),
      results: [{ revision: 1, verification: null }],
    });

    await expect(service.submitResult(actor, taskId, {
      reportedValue: 4.5,
      reportedUnit: 'calls',
      narrative: 'Duplicate submission',
      occurredAt: '2026-02-01T00:00:00.000Z',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.taskResult.create).not.toHaveBeenCalled();
  });

  it('preserves verified results and accepts later corrections as a new revision', async () => {
    prisma.task.findUnique.mockResolvedValue({
      ...task(),
      status: TaskStatus.COMPLETED,
      results: [{
        revision: 3,
        verification: { status: TaskVerificationStatus.VERIFIED },
      }],
    });

    await service.submitResult(actor, taskId, {
      reportedValue: 6,
      reportedUnit: 'calls',
      narrative: 'Corrected count',
      occurredAt: '2026-02-01T00:00:00.000Z',
    });

    expect(tx.taskResult.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revision: 4 }),
    }));
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: taskId },
      data: { status: TaskStatus.IN_PROGRESS },
    });
  });

  it('requires a separate reviewer and a reason for non-verified decisions', async () => {
    const reviewResult = {
      id: resultId,
      taskId,
      submittedById: actor.id,
      task: {
        id: taskId,
        createdById: 'creator-id',
        assigneeId: 'assignee-id',
        branchId,
        plan: { deletedAt: null },
        results: [{ id: resultId }],
      },
      verification: null,
    };
    prisma.taskResult.findUnique.mockResolvedValue(reviewResult);

    await expect(service.verifyResult(actor, resultId, {
      status: TaskVerificationStatus.VERIFIED,
    })).rejects.toBeInstanceOf(ForbiddenException);

    prisma.taskResult.findUnique.mockResolvedValue({
      ...reviewResult,
      submittedById: 'another-staff',
    });
    await expect(service.verifyResult(actor, resultId, {
      status: TaskVerificationStatus.NEEDS_INFO,
    })).rejects.toBeInstanceOf(BadRequestException);

    await service.verifyResult(actor, resultId, {
      status: TaskVerificationStatus.NEEDS_INFO,
      reason: 'Please attach supporting details',
    });
    expect(tx.taskVerification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: TaskVerificationStatus.NEEDS_INFO }),
    }));
  });

  it('counts only the latest verified result for scoped KPI totals', async () => {
    prisma.plan.findFirst.mockResolvedValue({
      ...plan(),
      metrics: [{
        id: metricId,
        name: 'Calls',
        unit: 'calls',
        target: new Prisma.Decimal(20),
      }],
    });
    prisma.task.findMany.mockResolvedValue([
      {
        metricId,
        results: [{
          reportedValue: new Prisma.Decimal(5),
          verification: { status: TaskVerificationStatus.VERIFIED },
        }],
      },
      {
        metricId,
        results: [{
          reportedValue: new Prisma.Decimal(7),
          verification: { status: TaskVerificationStatus.PENDING_VERIFICATION },
        }],
      },
      { metricId, results: [] },
    ]);

    await expect(service.kpi(actor, planId)).resolves.toEqual([{
      metricId,
      name: 'Calls',
      unit: 'calls',
      target: 20,
      verifiedTotal: 5,
      remaining: 15,
      achievementRate: 25,
    }]);
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { planId, branchId: { in: [branchId] } },
    }));
  });
});
