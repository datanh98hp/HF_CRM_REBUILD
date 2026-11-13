import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AccessScope,
  BranchStatus,
  FileScanStatus,
  PlanStatus,
  Prisma,
  TaskStatus,
  TaskVerificationStatus,
} from '../generated/prisma/client.js';
import { KpiPeriodType } from './plans.dto.js';
import { TasksService } from './tasks.service.js';

describe('TasksService', () => {
  const actor = { id: 'staff-id', type: 'STAFF' as const };
  const branchId = 'branch-id';
  const planId = 'plan-id';
  const taskId = 'task-id';
  const assignmentId = 'assignment-id';
  const secondAssigneeId = 'second-staff-id';
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
    assigneeId: null,
    dueAt: null,
    status: TaskStatus.TODO,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    metric: { unit: 'calls' },
    plan: {
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-04-01T00:00:00.000Z'),
      deletedAt: null,
    },
    results: [],
  });
  const assignment = (overrides: Record<string, unknown> = {}) => ({
    id: assignmentId,
    taskId,
    assigneeId: actor.id,
    target: new Prisma.Decimal(10),
    status: TaskStatus.TODO,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    assignee: { id: actor.id, username: 'staff', displayName: 'Staff' },
    task: {
      ...task(),
      metric: { unit: 'calls' },
    },
    results: [],
    ...overrides,
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
          createdBy: { id: actor.id, username: 'staff', displayName: 'Staff' },
        })),
        findUniqueOrThrow: jest.fn(async () => ({
          ...task(),
          metric: { id: metricId, name: 'Calls', unit: 'calls' },
          branch: { id: branchId, code: 'NORTH', name: 'North Branch' },
          createdBy: { id: actor.id, username: 'staff', displayName: 'Staff' },
          assignments: [
            assignment({
              assignee: { id: actor.id, username: 'staff', displayName: 'Staff' },
            }),
            assignment({
              id: 'second-assignment-id',
              assigneeId: secondAssigneeId,
              assignee: { id: secondAssigneeId, username: 'second', displayName: 'Second Staff' },
            }),
          ],
        })),
        update: jest.fn(async () => task()),
      },
      taskAssignment: {
        createMany: jest.fn(async () => undefined),
        update: jest.fn(async () => assignment()),
        count: jest.fn(async () => 1),
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
      taskAssignment: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => assignment()),
        findFirst: jest.fn(async () => assignment()),
      },
      taskResult: { findUnique: jest.fn(async () => null) },
      fileAsset: { findMany: jest.fn(async () => []) },
      user: {
        findFirst: jest.fn(async () => ({ id: actor.id })),
        findMany: jest.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id }))),
      },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(tx)),
    };
    access = {
      assertResourceAccess: jest.fn(async () => undefined),
      assertPermission: jest.fn(async () => undefined),
      hasResourceAccess: jest.fn(async () => true),
      hasPermission: jest.fn(async () => true),
    };
    audit = { write: jest.fn(async () => undefined) };
    service = new TasksService(prisma, access, audit);
  });

  it('creates one assignment with its own target for each eligible recipient', async () => {
    const result = await service.create(actor, planId, {
      metricId,
      branchId,
      title: ' Call customers ',
      assigneeIds: [actor.id, secondAssigneeId],
      target: 10,
    });

    expect(result).toHaveLength(2);
    expect(result.map(({ target }) => target)).toEqual([10, 10]);
    expect(result.map(({ assignee: recipient }) => recipient.id)).toEqual([actor.id, secondAssigneeId]);
    expect(tx.taskAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { taskId, assigneeId: actor.id, target: new Prisma.Decimal(10) },
        { taskId, assigneeId: secondAssigneeId, target: new Prisma.Decimal(10) },
      ],
    });
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
      assigneeIds: [actor.id],
      target: 10,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects recipients who are not active members of the selected branch', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await expect(service.create(actor, planId, {
      metricId,
      branchId,
      title: 'Call customers',
      assigneeIds: [secondAssigneeId],
      target: 10,
    })).rejects.toMatchObject({
      response: { code: 'TASK_ASSIGNEES_OUTSIDE_BRANCH' },
    });
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it('lists only each assignment visible to the requesting employee', async () => {
    const taskWithAssignments = {
      ...task(),
      metric: { id: metricId, name: 'Calls', unit: 'calls' },
      branch: { id: branchId, code: 'NORTH', name: 'North Branch' },
      createdBy: { id: actor.id, username: 'staff', displayName: 'Staff' },
      assignments: [
        assignment(),
        assignment({
          id: 'other-assignment-id',
          assigneeId: secondAssigneeId,
          assignee: { id: secondAssigneeId, username: 'other', displayName: 'Other Staff' },
        }),
      ],
    };
    prisma.task.findMany.mockResolvedValue([taskWithAssignments]);
    access.hasResourceAccess.mockImplementation(async (_id: string, _key: string, _scope: unknown, resource: any) =>
      resource.assigneeId === actor.id,
    );

    await expect(service.list(actor, planId)).resolves.toMatchObject([
      { id: assignmentId, assignee: { id: actor.id } },
    ]);
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
    prisma.taskAssignment.findUnique.mockResolvedValue(assignment({
      results: [{
        revision: 1,
        verification: { status: TaskVerificationStatus.NEEDS_INFO },
      }],
    }));

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
      data: expect.objectContaining({
        taskId,
        assignmentId,
        revision: 2,
        reportedUnit: 'calls',
      }),
    }));
    expect(tx.taskAssignment.update).toHaveBeenCalledWith({
      where: { id: assignmentId },
      data: { status: TaskStatus.IN_PROGRESS },
    });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: taskId },
      data: { status: TaskStatus.IN_PROGRESS },
    });
  });

  it('blocks duplicate submissions while a result is pending verification', async () => {
    prisma.taskAssignment.findUnique.mockResolvedValue(assignment({
      results: [{ revision: 1, verification: null }],
    }));

    await expect(service.submitResult(actor, taskId, {
      reportedValue: 4.5,
      reportedUnit: 'calls',
      narrative: 'Duplicate submission',
      occurredAt: '2026-02-01T00:00:00.000Z',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.taskResult.create).not.toHaveBeenCalled();
  });

  it('preserves verified results and accepts later corrections as a new revision', async () => {
    prisma.taskAssignment.findUnique.mockResolvedValue(assignment({
      status: TaskStatus.COMPLETED,
      results: [{
        revision: 3,
        verification: { status: TaskVerificationStatus.VERIFIED },
      }],
    }));

    await service.submitResult(actor, taskId, {
      reportedValue: 6,
      reportedUnit: 'calls',
      narrative: 'Corrected count',
      occurredAt: '2026-02-01T00:00:00.000Z',
    });

    expect(tx.taskResult.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revision: 4 }),
    }));
    expect(tx.taskAssignment.update).toHaveBeenCalledWith({
      where: { id: assignmentId },
      data: { status: TaskStatus.IN_PROGRESS },
    });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: taskId },
      data: { status: TaskStatus.IN_PROGRESS },
    });
  });

  it('requires a separate reviewer and a reason for non-verified decisions', async () => {
    const reviewResult = {
      id: resultId,
      taskId,
      assignmentId,
      submittedById: actor.id,
      assignment: {
        assigneeId: secondAssigneeId,
        results: [{ id: resultId }],
      },
      task: {
        id: taskId,
        createdById: 'creator-id',
        branchId,
        plan: { deletedAt: null },
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
    expect(tx.taskAssignment.update).toHaveBeenCalledWith({
      where: { id: assignmentId },
      data: { status: TaskStatus.IN_PROGRESS },
    });
  });

  it('completes only the verified recipient assignment while peers remain open', async () => {
    prisma.taskResult.findUnique.mockResolvedValue({
      id: resultId,
      taskId,
      assignmentId,
      submittedById: 'another-staff-id',
      assignment: {
        assigneeId: actor.id,
        results: [{ id: resultId }],
      },
      task: { id: taskId, branchId, plan: { deletedAt: null } },
      verification: null,
    });
    tx.taskAssignment.count.mockResolvedValue(1);

    await service.verifyResult(actor, resultId, {
      status: TaskVerificationStatus.VERIFIED,
    });

    expect(tx.taskAssignment.update).toHaveBeenCalledWith({
      where: { id: assignmentId },
      data: { status: TaskStatus.COMPLETED },
    });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: taskId },
      data: { status: TaskStatus.IN_PROGRESS },
    });
  });

  it('keeps the previous verified revision in KPI while a newer adjustment is pending', async () => {
    prisma.plan.findFirst.mockResolvedValue({
      ...plan(),
      metrics: [{
        id: metricId,
        name: 'Calls',
        unit: 'calls',
        target: new Prisma.Decimal(20),
      }],
    });
    prisma.taskAssignment.findMany.mockResolvedValue([
      {
        target: new Prisma.Decimal(10),
        task: { metricId },
        results: [{
          reportedValue: new Prisma.Decimal(5),
          occurredAt: new Date('2026-02-01T00:00:00.000Z'),
        }],
      },
      { target: new Prisma.Decimal(10), task: { metricId }, results: [] },
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
    expect(prisma.taskAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { task: { planId, branchId: { in: [branchId] } } },
      select: expect.objectContaining({
        results: expect.objectContaining({
          where: { verification: { is: { status: TaskVerificationStatus.VERIFIED } } },
        }),
      }),
    }));
  });

  it('filters monthly KPI by Asia/Ho_Chi_Minh occurrence-date boundaries', async () => {
    prisma.plan.findFirst.mockResolvedValue({
      ...plan(),
      metrics: [{
        id: metricId,
        name: 'Calls',
        unit: 'calls',
        target: new Prisma.Decimal(20),
      }],
    });
    prisma.taskAssignment.findMany.mockResolvedValue([
      {
        target: new Prisma.Decimal(10),
        task: { metricId },
        results: [{
          reportedValue: new Prisma.Decimal(8),
          occurredAt: new Date('2026-02-28T16:59:59.999Z'),
        }],
      },
      {
        target: new Prisma.Decimal(10),
        task: { metricId },
        results: [{
          reportedValue: new Prisma.Decimal(10),
          occurredAt: new Date('2026-02-28T17:00:00.000Z'),
        }],
      },
    ]);

    await expect(service.kpi(actor, planId, {
      periodType: KpiPeriodType.MONTH,
      date: '2026-02-18',
    })).resolves.toMatchObject([
      { metricId, verifiedTotal: 8, remaining: 12, achievementRate: 40 },
    ]);
  });

  it('limits personal KPI totals and target to the requesting employee assignments', async () => {
    access.hasPermission.mockImplementation(async (_id: string, _key: string, scope: AccessScope) =>
      scope === AccessScope.ASSIGNED,
    );
    prisma.taskAssignment.findMany.mockResolvedValue([
      {
        target: new Prisma.Decimal(10),
        task: { metricId },
        results: [{
          reportedValue: new Prisma.Decimal(3),
          occurredAt: new Date('2026-02-01T00:00:00.000Z'),
        }],
      },
    ]);

    await expect(service.kpi(actor, planId)).resolves.toMatchObject([
      {
        metricId,
        target: 10,
        verifiedTotal: 3,
        remaining: 7,
        achievementRate: 30,
      },
    ]);
    expect(prisma.taskAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        task: { planId, branchId: { in: [branchId] } },
        assigneeId: actor.id,
      },
    }));
  });

  it('does not present a partial target when a legacy personal assignment has no target', async () => {
    access.hasPermission.mockImplementation(async (_id: string, _key: string, scope: AccessScope) =>
      scope === AccessScope.ASSIGNED,
    );
    prisma.taskAssignment.findMany.mockResolvedValue([
      {
        target: new Prisma.Decimal(10),
        task: { metricId },
        results: [],
      },
      {
        target: null,
        task: { metricId },
        results: [{
          reportedValue: new Prisma.Decimal(3),
          occurredAt: new Date('2026-02-01T00:00:00.000Z'),
        }],
      },
    ]);

    await expect(service.kpi(actor, planId)).resolves.toMatchObject([
      {
        metricId,
        target: null,
        verifiedTotal: 3,
        remaining: null,
        achievementRate: null,
      },
    ]);
  });
});
