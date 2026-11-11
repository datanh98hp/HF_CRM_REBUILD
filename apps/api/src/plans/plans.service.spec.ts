import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AccessScope, BranchStatus, PlanStatus, Prisma } from '../generated/prisma/client.js';
import { PlansService } from './plans.service.js';

describe('PlansService', () => {
  const actor = { id: 'staff-id', type: 'STAFF' as const };
  const branchId = 'branch-id';
  const childBranchId = 'child-branch-id';
  let prisma: any;
  let access: any;
  let audit: any;
  let tx: any;
  let service: PlansService;

  beforeEach(() => {
    tx = {
      plan: {
        create: jest.fn(async ({ data }: any) => ({
          id: 'plan-id',
          ...data,
          status: PlanStatus.DRAFT,
          branch: { id: branchId, code: 'NORTH', name: 'North Branch' },
          metrics: data.metrics.create.map((metric: any, index: number) => ({
            id: `metric-${index}`,
            ...metric,
            target: new Prisma.Decimal(metric.target),
          })),
        })),
      },
    };
    prisma = {
      branch: {
        findUnique: jest.fn(async () => ({ id: branchId, status: BranchStatus.ACTIVE })),
        findMany: jest.fn(async () => [
          { id: branchId, parentId: null },
          { id: childBranchId, parentId: branchId },
          { id: 'unrelated-branch-id', parentId: null },
        ]),
      },
      userRoleGrant: {
        findMany: jest.fn(async () => [{ branchId }]),
      },
      plan: {
        findMany: jest.fn(async () => []),
      },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(tx)),
    };
    access = {
      assertResourceAccess: jest.fn(async () => undefined),
      hasPermission: jest.fn(async () => true),
    };
    audit = { write: jest.fn(async () => undefined) };
    service = new PlansService(prisma, access, audit);
  });

  it('creates a draft plan with metric targets and audit in one transaction', async () => {
    const result = await service.create(actor, {
      name: 'Quarterly outreach',
      branchId,
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
      targetId: 'plan-id',
    }));
  });

  it('rejects a plan whose end does not follow its start', async () => {
    await expect(service.create(actor, {
      name: 'Invalid plan',
      branchId,
      periodStart: '2026-04-01T00:00:00.000Z',
      periodEnd: '2026-01-01T00:00:00.000Z',
      metrics: [{ name: 'Calls', unit: 'count', target: 1 }],
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.branch.findUnique).not.toHaveBeenCalled();
  });

  it('rejects duplicate metric names and inactive branches', async () => {
    await expect(service.create(actor, {
      name: 'Duplicate metrics',
      branchId,
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      metrics: [
        { name: 'Calls', unit: 'count', target: 1 },
        { name: ' calls ', unit: 'count', target: 2 },
      ],
    })).rejects.toBeInstanceOf(ConflictException);

    prisma.branch.findUnique.mockResolvedValue({ id: branchId, status: BranchStatus.INACTIVE });
    await expect(service.create(actor, {
      name: 'Inactive branch',
      branchId,
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      metrics: [{ name: 'Calls', unit: 'count', target: 1 }],
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('limits plan lists to branches where the actor has read scope', async () => {
    access.hasPermission.mockImplementation(async (_id: string, _key: string, scope: AccessScope) =>
      scope === AccessScope.BRANCH,
    );
    prisma.plan.findMany.mockResolvedValue([{ id: 'plan-id', metrics: [] }]);

    await service.list(actor, { take: 50 });

    expect(prisma.plan.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { branchId: { in: expect.arrayContaining([branchId, childBranchId]) } },
    }));
    expect(prisma.plan.findMany.mock.calls[0][0].where.branchId.in).not.toContain('unrelated-branch-id');
  });

  it('does not allow customer actors to create or read staff plans', async () => {
    const customer = { id: 'customer-id', type: 'CUSTOMER' as const };
    await expect(service.list(customer, { take: 50 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create(customer, {
      name: 'Customer plan',
      branchId,
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      metrics: [{ name: 'Calls', unit: 'count', target: 1 }],
    })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
