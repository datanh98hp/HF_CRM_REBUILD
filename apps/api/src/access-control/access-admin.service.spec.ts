import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { BranchStatus } from '../generated/prisma/client.js';
import { AccessAdminService } from './access-admin.service.js';

describe('AccessAdminService branch status', () => {
  const actor = { id: 'manager-user', type: 'STAFF' as const };
  const branchId = 'branch-id';
  let branch: any;
  let prisma: any;
  let access: any;
  let audit: any;
  let tx: any;
  let service: AccessAdminService;

  beforeEach(() => {
    branch = {
      id: branchId,
      code: 'BRANCH',
      name: 'Branch',
      parentId: null,
      managerUserId: 'branch-manager',
      status: BranchStatus.INACTIVE,
      parent: null,
      manager: { status: 'ACTIVE' },
    };
    tx = {
      $queryRaw: jest.fn(async () => []),
      branch: {
        findUnique: jest.fn(async () => branch),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async ({ data }: any) => ({ ...branch, ...data })),
      },
    };
    prisma = {
      branch: { findUnique: jest.fn(async () => branch) },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(tx)),
    };
    access = {
      hasPermission: jest.fn(async () => true),
      assertPermission: jest.fn(async () => undefined),
    };
    audit = { write: jest.fn(async () => undefined) };
    service = new AccessAdminService(prisma, access, audit, {
      hash: async () => 'encoded-password',
      verify: async () => true,
    });
  });

  it('activates a managed root branch and audits the change reason', async () => {
    const updated = await service.updateBranchStatus(actor, branchId, {
      status: BranchStatus.ACTIVE,
      reason: 'Branch is ready',
    });

    expect(updated.status).toBe(BranchStatus.ACTIVE);
    expect(tx.branch.update).toHaveBeenCalledWith({
      where: { id: branchId },
      data: { status: BranchStatus.ACTIVE },
    });
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'organization.branch.status.changed',
      reason: 'Branch is ready',
      beforeState: { status: BranchStatus.INACTIVE },
      afterState: { status: BranchStatus.ACTIVE },
    }));
  });

  it('does not deactivate a branch while it has active children', async () => {
    branch.status = BranchStatus.ACTIVE;
    tx.branch.findFirst.mockResolvedValue({ id: 'active-child' });

    await expect(service.updateBranchStatus(actor, branchId, {
      status: BranchStatus.INACTIVE,
      reason: 'Closing this branch',
    })).rejects.toBeInstanceOf(ConflictException);

    expect(tx.branch.update).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('requires an active manager and parent branch before activation', async () => {
    branch.manager = { status: 'DISABLED' };
    await expect(service.updateBranchStatus(actor, branchId, {
      status: BranchStatus.ACTIVE,
      reason: 'Branch is ready',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.branch.update).not.toHaveBeenCalled();

    branch.manager = { status: 'ACTIVE' };
    branch.parentId = 'parent-id';
    branch.parent = { status: BranchStatus.INACTIVE };
    await expect(service.updateBranchStatus(actor, branchId, {
      status: BranchStatus.ACTIVE,
      reason: 'Branch is ready',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.branch.update).not.toHaveBeenCalled();
  });
});
