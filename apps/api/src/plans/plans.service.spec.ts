import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AccessScope, BranchStatus, PlanStatus, Prisma } from '../generated/prisma/client.js';
import { PlansService } from './plans.service.js';

describe('PlansService', () => {
  const actor = { id: 'staff-id', type: 'STAFF' as const };
  const branchId = 'branch-id';
  const childBranchId = 'child-branch-id';
  const planRecord = () => ({
    id: 'plan-id',
    name: 'Quarterly outreach',
    description: null,
    createdById: actor.id,
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-04-01T00:00:00.000Z'),
    status: PlanStatus.DRAFT,
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
        findMany: jest.fn(async () => [{ branchId }]),
        findFirst: jest.fn(async () => null),
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
      metrics: [{ name: 'Customer calls', unit: 'calls', target: 12.5 }],
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
      { branchId },
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
      metrics: [{ name: 'Calls', unit: 'count', target: 1 }],
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.branch.findMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate metric names and inactive branches', async () => {
    await expect(service.create(actor, {
      name: 'Duplicate metrics',
      branchIds: [branchId],
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      metrics: [
        { name: 'Calls', unit: 'count', target: 1 },
        { name: ' calls ', unit: 'count', target: 2 },
      ],
    })).rejects.toBeInstanceOf(ConflictException);

    prisma.branch.findMany.mockResolvedValue([{ id: branchId, status: BranchStatus.INACTIVE }]);
    await expect(service.create(actor, {
      name: 'Inactive branch',
      branchIds: [branchId],
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      metrics: [{ name: 'Calls', unit: 'count', target: 1 }],
    })).rejects.toBeInstanceOf(ConflictException);
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
        branches: { some: { branchId: { in: expect.arrayContaining([branchId, childBranchId]) } } },
      },
    }));
    expect(prisma.plan.findMany.mock.calls[0][0].where.branches.some.branchId.in).not.toContain('unrelated-branch-id');
  });

  it('does not allow customer actors to create or read staff plans', async () => {
    const customer = { id: 'customer-id', type: 'CUSTOMER' as const };
    await expect(service.list(customer, { take: 50 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create(customer, {
      name: 'Customer plan',
      branchIds: [branchId],
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      metrics: [{ name: 'Calls', unit: 'count', target: 1 }],
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updates dates, status and branch associations atomically with an audit event', async () => {
    const updatedRecord = {
      ...planRecord(),
      periodStart: new Date('2026-02-01T00:00:00.000Z'),
      periodEnd: new Date('2026-05-01T00:00:00.000Z'),
      status: PlanStatus.ACTIVE,
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
      status: PlanStatus.ACTIVE,
      addBranchIds: [childBranchId],
    });

    expect(result).toMatchObject({
      status: PlanStatus.ACTIVE,
      branches: [{ id: branchId }, { id: childBranchId }],
    });
    expect(tx.planBranch.createMany).toHaveBeenCalledWith({
      data: [{ planId: 'plan-id', branchId: childBranchId }],
    });
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'plan.updated',
      beforeState: expect.objectContaining({ status: PlanStatus.DRAFT }),
      afterState: expect.objectContaining({ status: PlanStatus.ACTIVE }),
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
