import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ForbiddenException } from '@nestjs/common';
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
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (branch.id === where.id && branch.managerUserId === where.managerUserId) {
            Object.assign(branch, data);
            return { count: 1 };
          }
          return { count: 0 };
        }),
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

  it('requires an active manager and parent to activate a branch', async () => {
    branch.managerUserId = null;
    await expect(service.updateBranchStatus(actor, branchId, {
      status: BranchStatus.ACTIVE,
      reason: 'Branch is ready',
    })).rejects.toMatchObject({ response: { code: 'ACTIVE_BRANCH_REQUIRES_ACTIVE_MANAGER' } });
    expect(tx.branch.update).not.toHaveBeenCalled();

    branch.managerUserId = 'branch-manager';
    branch.status = BranchStatus.INACTIVE;
    branch.parentId = 'parent-id';
    branch.parent = { status: BranchStatus.INACTIVE };
    await expect(service.updateBranchStatus(actor, branchId, {
      status: BranchStatus.ACTIVE,
      reason: 'Branch is ready',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.branch.update).not.toHaveBeenCalled();
  });
});

describe('AccessAdminService role grant revocation', () => {
  const admin = { id: 'admin-user', type: 'STAFF' as const };
  const branchId = 'branch-id';
  let prisma: any;
  let access: any;
  let audit: any;
  let tx: any;
  let service: AccessAdminService;
  let branch: { id: string; managerUserId: string | null; status: BranchStatus };
  let descendants: Array<{ id: string; parentId: string; managerUserId: string | null; status: BranchStatus }>;
  let grant: any;

  beforeEach(() => {
    branch = { id: branchId, managerUserId: null, status: BranchStatus.INACTIVE };
    descendants = [];
    grant = {
      id: 'manager-grant',
      branchId,
      role: { key: 'MANAGE' },
      user: {
        id: 'target-user',
        roleGrants: [{ branchId, role: { key: 'MANAGE' } }],
      },
    };
    tx = {
      $queryRaw: jest.fn(async () => []),
      userRoleGrant: { delete: jest.fn(async () => undefined) },
      branch: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === branch.id ? branch : descendants.find(({ id }) => id === where.id) ?? null,
        ),
        findMany: jest.fn(async ({ where }: any) => {
          const parentIds = where.parentId?.in;
          return parentIds
            ? descendants.filter(({ parentId }) => parentIds.includes(parentId)).map(({ id }) => ({ id }))
            : [];
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const target = where.id === branch.id ? branch : descendants.find(({ id }) => id === where.id);
          if (!target) throw new Error(`Unexpected branch update: ${where.id}`);
          Object.assign(target, data);
          return target;
        }),
      },
    };
    prisma = {
      userRoleGrant: {
        findUnique: jest.fn(async () => grant),
        findFirst: jest.fn(async () => null),
      },
      branch: {
        findUnique: jest.fn(async () => branch),
        findMany: jest.fn(async () => []),
      },
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

  it('allows a global role administrator to revoke an unassigned MANAGE grant', async () => {
    await expect(service.revokeRoleGrant(admin, grant.id, 'Role no longer needed'))
      .resolves.toEqual({ status: 'revoked' });

    expect(tx.userRoleGrant.delete).toHaveBeenCalledWith({ where: { id: grant.id } });
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'access.user_role.revoked',
      reason: 'Role no longer needed',
    }));
  });

  it('clears the branch manager assignment when revoking its MANAGE grant', async () => {
    branch.managerUserId = grant.user.id;
    branch.status = BranchStatus.ACTIVE;

    await expect(service.revokeRoleGrant(admin, grant.id, 'Role no longer needed'))
      .resolves.toEqual({ status: 'revoked' });

    expect(tx.branch.update).toHaveBeenCalledWith({
      where: { id: branchId },
      data: { managerUserId: null, status: BranchStatus.INACTIVE },
    });
    expect(tx.userRoleGrant.delete).toHaveBeenCalledWith({ where: { id: grant.id } });
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'organization.branch.manager.unassigned',
      reason: 'Role no longer needed',
      beforeState: { managerUserId: grant.user.id, status: BranchStatus.ACTIVE },
      afterState: { managerUserId: null, status: BranchStatus.INACTIVE },
    }));
  });

  it('inactivates active descendants when the branch manager is removed', async () => {
    branch.managerUserId = grant.user.id;
    branch.status = BranchStatus.ACTIVE;
    descendants = [
      { id: 'child-branch', parentId: branchId, managerUserId: 'child-manager', status: BranchStatus.ACTIVE },
      { id: 'grandchild-branch', parentId: 'child-branch', managerUserId: 'grandchild-manager', status: BranchStatus.ACTIVE },
    ];

    await service.revokeRoleGrant(admin, grant.id, 'Manager removed');

    expect(branch.status).toBe(BranchStatus.INACTIVE);
    expect(descendants.map(({ status }) => status)).toEqual([
      BranchStatus.INACTIVE,
      BranchStatus.INACTIVE,
    ]);
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'organization.branch.status.changed',
      targetId: 'child-branch',
      beforeState: { status: BranchStatus.ACTIVE },
      afterState: { status: BranchStatus.INACTIVE },
    }));
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'organization.branch.status.changed',
      targetId: 'grandchild-branch',
    }));
  });

  it('allows a system ADMIN to revoke a MANAGE grant without global permission resolution', async () => {
    access.hasPermission.mockResolvedValue(false);
    prisma.userRoleGrant.findFirst.mockResolvedValue({ id: 'admin-role-grant' });

    await expect(service.revokeRoleGrant(admin, grant.id, 'Role no longer needed'))
      .resolves.toEqual({ status: 'revoked' });

    expect(access.assertPermission).not.toHaveBeenCalled();
    expect(tx.userRoleGrant.delete).toHaveBeenCalledWith({ where: { id: grant.id } });
  });

  it('does not allow a branch-scoped role manager to revoke a MANAGE grant', async () => {
    access.hasPermission.mockResolvedValue(false);

    await expect(service.revokeRoleGrant(admin, grant.id, 'Role no longer needed'))
      .rejects.toMatchObject({
        response: { code: 'MANAGE_ROLE_REVOCATION_REQUIRES_GLOBAL_ADMIN' },
      });

    expect(tx.userRoleGrant.delete).not.toHaveBeenCalled();
  });
});

describe('AccessAdminService manager account disabling', () => {
  const admin = { id: 'admin-user', type: 'STAFF' as const };
  const userId = 'manager-user';
  const branch: { id: string; managerUserId: string | null; status: BranchStatus } = {
    id: 'branch-id',
    managerUserId: userId,
    status: BranchStatus.ACTIVE,
  };
  let prisma: any;
  let access: any;
  let audit: any;
  let tx: any;
  let service: AccessAdminService;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(async () => []),
      user: {
        update: jest.fn(async () => ({
          id: userId,
          username: 'manager',
          displayName: 'Branch Manager',
          status: 'DISABLED',
        })),
      },
      authSession: { updateMany: jest.fn(async () => ({ count: 1 })) },
      branch: {
        findMany: jest.fn(async ({ where }: any) => where.managerUserId === userId ? [branch] : []),
        findUnique: jest.fn(async () => branch),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(branch, data);
          return branch;
        }),
      },
    };
    prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: userId,
          status: 'ACTIVE',
          roleGrants: [{ branchId: branch.id, role: { key: 'MANAGE' } }],
        })),
      },
      branch: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => branch),
      },
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

  it('unassigns the manager and inactivates an active branch when disabling the account', async () => {
    await expect(service.setUserStatus(admin, userId, false, 'Account disabled'))
      .resolves.toMatchObject({ status: 'DISABLED' });

    expect(tx.branch.update).toHaveBeenCalledWith({
      where: { id: branch.id },
      data: { managerUserId: null, status: BranchStatus.INACTIVE },
    });
    expect(branch.managerUserId).toBeNull();
    expect(branch.status).toBe(BranchStatus.INACTIVE);
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'organization.branch.manager.unassigned',
      targetId: branch.id,
      reason: 'Account disabled',
      beforeState: { managerUserId: userId, status: BranchStatus.ACTIVE },
      afterState: { managerUserId: null, status: BranchStatus.INACTIVE },
    }));
  });
});
