import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AccessScope,
  BranchStatus,
  PlanApprovalDecision,
  PlanStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { PlansService } from './plans.service.js';

describe('PlansService', () => {
  const actor = { id: 'staff-id', type: 'STAFF' as const };
  const branchId = 'branch-id';
  const childBranchId = 'child-branch-id';
  const catalogId = 'catalog-id';
  const planRecord = () => ({
    id: 'plan-id',
    name: 'Quarterly outreach',
    description: null,
    createdById: actor.id,
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-04-01T00:00:00.000Z'),
    status: PlanStatus.DRAFT,
    approvalVersion: 0,
    deletedAt: null,
    branches: [{
      planId: 'plan-id',
      branchId,
      branch: { id: branchId, code: 'NORTH', name: 'North Branch' },
    }],
    metrics: [],
  });
  let prisma: any;
  let access: any;
  let audit: any;
  let tx: any;
  let service: PlansService;

  beforeEach(() => {
    tx = {
      plan: {
        findFirst: jest.fn(async () => planRecord()),
        findUniqueOrThrow: jest.fn(async () => planRecord()),
        create: jest.fn(async ({ data }: any) => ({
          id: 'plan-id',
          ...data,
          status: PlanStatus.DRAFT,
          branches: data.branches.create.map(({ branchId: id }: any) => ({
            planId: 'plan-id',
            branchId: id,
            branch: { id, code: 'NORTH', name: 'North Branch' },
          })),
          metrics: data.metrics.create.map((metric: any, index: number) => ({
            id: `metric-${index}`,
            ...metric,
            target: new Prisma.Decimal(metric.target),
          })),
        })),
        update: jest.fn(async ({ data }: any) => ({ ...planRecord(), ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      planBranch: {
        createMany: jest.fn(async () => ({ count: 1 })),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      planApproval: {
        create: jest.fn(async ({ data }: any) => ({ id: 'approval-id', ...data })),
      },
      planMetricCatalog: {
        create: jest.fn(async ({ data }: any) => ({ id: catalogId, ...data, isActive: true })),
        update: jest.fn(async ({ data }: any) => ({ id: catalogId, ...data })),
      },
    };
    prisma = {
      branch: {
        findMany: jest.fn(async ({ where, select }: any) => {
          if (select?.status) {
            return (where.id.in as string[])
              .filter((id) => [branchId, childBranchId].includes(id))
              .map((id) => ({ id, status: BranchStatus.ACTIVE }));
          }
          return [
            { id: branchId, parentId: null },
            { id: childBranchId, parentId: branchId },
            { id: 'unrelated-branch-id', parentId: null },
          ];
        }),
        findUnique: jest.fn(async () => ({ id: branchId, parentId: null })),
      },
      userRoleGrant: {
        findMany: jest.fn(async () => [{
          branchId,
          role: { permissions: [{ scope: AccessScope.BRANCH }] },
        }]),
        findFirst: jest.fn(async () => null),
      },
      taskAssignment: {
        findMany: jest.fn(async () => []),
      },
      planMetricCatalog: {
        findMany: jest.fn(async () => [{ id: catalogId, name: 'Customer calls', unit: 'calls' }]),
        findUnique: jest.fn(async () => ({
          id: catalogId,
          name: 'Customer calls',
          unit: 'calls',
          isActive: true,
        })),
      },
      plan: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => planRecord()),
      },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(tx)),
    };
    access = {
      assertResourceAccess: jest.fn(async () => undefined),
      assertPermission: jest.fn(async () => undefined),
      hasPermission: jest.fn(async () => true),
    };
    audit = { write: jest.fn(async () => undefined) };
    service = new PlansService(prisma, access, audit);
  });

  it('creates a draft plan with metric targets and audit in one transaction', async () => {
    const result = await service.create(actor, {
      name: 'Quarterly outreach',
      branchIds: [branchId],
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      metrics: [{ catalogId, target: 12.5 }],
    });

    expect(result).toMatchObject({
      id: 'plan-id',
      status: PlanStatus.DRAFT,
      metrics: [{ name: 'Customer calls', target: 12.5 }],
    });
    expect(access.assertResourceAccess).toHaveBeenCalledWith(
      actor.id,
      'plans.manage',
      undefined,
      { ownerId: actor.id, assigneeId: actor.id, branchId },
    );
    expect(tx.plan.create).toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'plan.created',
      branchId,
      afterState: expect.objectContaining({ branchIds: [branchId] }),
      targetId: 'plan-id',
    }));
  });

  it('rejects a plan whose end does not follow its start', async () => {
    await expect(service.create(actor, {
      name: 'Invalid plan',
      branchIds: [branchId],
      periodStart: '2026-04-01T00:00:00.000Z',
      periodEnd: '2026-01-01T00:00:00.000Z',
      metrics: [{ catalogId, target: 1 }],
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.branch.findMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate catalog metrics and inactive branches', async () => {
    await expect(service.create(actor, {
      name: 'Duplicate metrics',
      branchIds: [branchId],
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      metrics: [
        { catalogId, target: 1 },
        { catalogId, target: 2 },
      ],
    })).rejects.toBeInstanceOf(ConflictException);

    prisma.branch.findMany.mockResolvedValue([{ id: branchId, status: BranchStatus.INACTIVE }]);
    await expect(service.create(actor, {
      name: 'Inactive branch',
      branchIds: [branchId],
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      metrics: [{ catalogId, target: 1 }],
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('submits a draft plan into approval and records the submission version', async () => {
    tx.plan.findUniqueOrThrow.mockResolvedValue({
      ...planRecord(),
      status: PlanStatus.PENDING_APPROVAL,
      approvalVersion: 1,
    });

    await expect(service.submitForApproval(actor, 'plan-id')).resolves.toMatchObject({
      status: PlanStatus.PENDING_APPROVAL,
      approvalVersion: 1,
    });
    expect(tx.plan.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'plan-id',
        deletedAt: null,
        status: PlanStatus.DRAFT,
        approvalVersion: 0,
      },
      data: { status: PlanStatus.PENDING_APPROVAL, approvalVersion: 1 },
    });
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'plan.submitted_for_approval',
      afterState: { status: PlanStatus.PENDING_APPROVAL, approvalVersion: 1 },
    }));
  });

  it('requires an independent reviewer and reason to reject a plan', async () => {
    prisma.plan.findFirst.mockResolvedValue({
      ...planRecord(),
      createdById: 'plan-creator-id',
      status: PlanStatus.PENDING_APPROVAL,
      approvalVersion: 1,
    });
    tx.plan.findUniqueOrThrow.mockResolvedValue({
      ...planRecord(),
      createdById: 'plan-creator-id',
      status: PlanStatus.REJECTED,
      approvalVersion: 1,
    });

    await expect(service.reviewApproval(actor, 'plan-id', {
      decision: PlanApprovalDecision.REJECTED,
    })).rejects.toBeInstanceOf(BadRequestException);
    prisma.plan.findFirst.mockResolvedValueOnce({
      ...planRecord(),
      status: PlanStatus.PENDING_APPROVAL,
      approvalVersion: 1,
    });
    await expect(service.reviewApproval(actor, 'plan-id', {
      decision: PlanApprovalDecision.APPROVED,
    })).rejects.toBeInstanceOf(ForbiddenException);

    await service.reviewApproval(
      { id: 'manager-id', type: 'STAFF' },
      'plan-id',
      { decision: PlanApprovalDecision.REJECTED, reason: 'Chỉ tiêu cần điều chỉnh' },
    );
    expect(tx.planApproval.create).toHaveBeenCalledWith({
      data: {
        planId: 'plan-id',
        reviewerId: 'manager-id',
        version: 1,
        decision: PlanApprovalDecision.REJECTED,
        reason: 'Chỉ tiêu cần điều chỉnh',
      },
    });
    expect(tx.plan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: PlanStatus.PENDING_APPROVAL, approvalVersion: 1 }),
      data: { status: PlanStatus.REJECTED },
    }));
  });

  it('does not allow direct activation outside approval or catalog changes without global authority', async () => {
    await expect(service.update(actor, 'plan-id', { status: PlanStatus.ACTIVE }))
      .rejects.toBeInstanceOf(BadRequestException);

    access.assertPermission.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.createMetricCatalogItem(actor, {
      key: 'local_metric',
      name: 'Local metric',
      unit: 'count',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('shows inactive catalog entries only to globally scoped catalog managers', async () => {
    access.hasPermission.mockResolvedValue(false);

    await service.listMetricCatalog(actor);
    expect(access.hasPermission).toHaveBeenCalledWith(
      actor.id,
      'plans.catalog.manage',
      AccessScope.ALL,
    );
    expect(prisma.planMetricCatalog.findMany).toHaveBeenLastCalledWith({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    access.hasPermission.mockResolvedValue(true);
    await service.listMetricCatalog(actor);
    expect(prisma.planMetricCatalog.findMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  });

  it('limits plan lists to branches where the actor has read scope', async () => {
    access.hasPermission.mockImplementation(async (_id: string, _key: string, scope: AccessScope) =>
      scope === AccessScope.BRANCH,
    );
    prisma.plan.findMany.mockResolvedValue([planRecord()]);

    await service.list(actor, { take: 50 });

    expect(prisma.plan.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        deletedAt: null,
        OR: expect.arrayContaining([
          { branches: { some: { branchId: { in: expect.arrayContaining([branchId, childBranchId]) } } } },
        ]),
      },
    }));
    expect(prisma.plan.findMany.mock.calls[0][0].where.OR[0].branches.some.branchId.in)
      .not.toContain('unrelated-branch-id');
  });

  it('includes only plans where an assigned-scope employee has a personal task', async () => {
    access.hasPermission.mockResolvedValue(false);
    prisma.userRoleGrant.findMany.mockResolvedValue([{
      branchId,
      role: { permissions: [{ scope: AccessScope.ASSIGNED }] },
    }]);
    prisma.taskAssignment.findMany.mockResolvedValue([{
      task: { planId: 'assigned-plan-id', branchId },
    }]);
    prisma.plan.findMany.mockResolvedValue([{
      ...planRecord(),
      id: 'assigned-plan-id',
      createdById: 'another-staff-id',
    }]);

    await expect(service.list(actor, { take: 50 })).resolves.toMatchObject([
      { id: 'assigned-plan-id', branches: [{ id: branchId }] },
    ]);
    expect(prisma.taskAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assigneeId: actor.id }),
    }));
    expect(prisma.plan.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        deletedAt: null,
        OR: [{ id: { in: ['assigned-plan-id'] } }],
      },
    }));
  });

  it('does not allow customer actors to create or read staff plans', async () => {
    const customer = { id: 'customer-id', type: 'CUSTOMER' as const };
    await expect(service.list(customer, { take: 50 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create(customer, {
      name: 'Customer plan',
      branchIds: [branchId],
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      metrics: [{ catalogId, target: 1 }],
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updates dates, status and branch associations atomically with an audit event', async () => {
    prisma.plan.findFirst.mockResolvedValueOnce({
      ...planRecord(),
      status: PlanStatus.ACTIVE,
    });
    const updatedRecord = {
      ...planRecord(),
      periodStart: new Date('2026-02-01T00:00:00.000Z'),
      periodEnd: new Date('2026-05-01T00:00:00.000Z'),
      status: PlanStatus.ARCHIVED,
      branches: [
        planRecord().branches[0],
        {
          planId: 'plan-id',
          branchId: childBranchId,
          branch: { id: childBranchId, code: 'SOUTH', name: 'South Branch' },
        },
      ],
    };
    tx.plan.update.mockResolvedValue(updatedRecord);

    const result = await service.update(actor, 'plan-id', {
      periodStart: '2026-02-01T00:00:00.000Z',
      periodEnd: '2026-05-01T00:00:00.000Z',
      status: PlanStatus.ARCHIVED,
      addBranchIds: [childBranchId],
    });

    expect(result).toMatchObject({
      status: PlanStatus.ARCHIVED,
      branches: [{ id: branchId }, { id: childBranchId }],
    });
    expect(tx.planBranch.createMany).toHaveBeenCalledWith({
      data: [{ planId: 'plan-id', branchId: childBranchId }],
    });
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'plan.updated',
      beforeState: expect.objectContaining({ status: PlanStatus.ACTIVE }),
      afterState: expect.objectContaining({ status: PlanStatus.ARCHIVED }),
    }));
  });

  it('allows removing all branches and rejects adding inactive branches', async () => {
    await service.update(actor, 'plan-id', { removeBranchIds: [branchId] });
    expect(tx.planBranch.deleteMany).toHaveBeenCalledWith({
      where: { planId: 'plan-id', branchId: { in: [branchId] } },
    });

    prisma.branch.findMany.mockResolvedValue([{ id: childBranchId, status: BranchStatus.INACTIVE }]);
    await expect(service.update(actor, 'plan-id', {
      addBranchIds: [childBranchId],
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows soft deletion only for a global ADMIN or OPERATOR grant and audits the retained record', async () => {
    prisma.userRoleGrant.findFirst
      .mockResolvedValueOnce({ id: 'admin-grant' })
      .mockResolvedValueOnce({ id: 'operator-grant' })
      .mockResolvedValueOnce(null);

    await service.softDelete(actor, 'plan-id');
    await service.softDelete(actor, 'plan-id');

    expect(prisma.userRoleGrant.findFirst).toHaveBeenCalledWith({
      where: {
        userId: actor.id,
        branchId: null,
        role: { key: { in: ['ADMIN', 'OPERATOR'] } },
      },
      select: { id: true },
    });
    expect(tx.plan.updateMany).toHaveBeenCalledWith({
      where: { id: 'plan-id', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'plan.deleted',
      targetId: 'plan-id',
    }));

    await expect(service.softDelete(actor, 'plan-id')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
