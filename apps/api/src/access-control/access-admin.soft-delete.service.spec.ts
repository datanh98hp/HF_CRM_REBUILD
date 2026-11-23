import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessScope } from '../generated/prisma/client.js';
import { AccessAdminService } from './access-admin.service.js';

describe('AccessAdminService soft delete user', () => {
  const admin = { id: 'admin-user', type: 'STAFF' as const };
  const userId = 'target-user';
  let target: any;
  let prisma: any;
  let access: any;
  let audit: any;
  let tx: any;
  let service: AccessAdminService;

  beforeEach(() => {
    target = {
      id: userId,
      username: 'staff.user',
      status: 'ACTIVE',
      deletedAt: null,
      roleGrants: [],
    };
    tx = {
      user: {
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      authSession: {
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      branch: {
        findMany: jest.fn(async () => []),
      },
    };
    prisma = {
      user: { findUnique: jest.fn(async () => target) },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(tx)),
    };
    access = { assertPermission: jest.fn(async () => undefined) };
    audit = { write: jest.fn(async () => undefined) };
    service = new AccessAdminService(prisma, access, audit, {
      hash: async () => 'encoded-password',
      verify: async () => true,
    });
  });

  it('soft-deletes the account, revokes sessions, and audits the reason', async () => {
    const result = await service.softDeleteUser(admin, userId, 'Staff account no longer needed');

    expect(result.id).toBe(userId);
    expect(result.deletedAt).toBeInstanceOf(Date);
    expect(access.assertPermission).toHaveBeenCalledWith(admin.id, 'users.manage', AccessScope.ALL);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: userId, deletedAt: null },
      data: { status: 'DISABLED', deletedAt: expect.any(Date) },
    });
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId, revokedAt: null },
      data: { revokedAt: result.deletedAt },
    });
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'identity.user.soft_deleted',
      targetType: 'user',
      targetId: userId,
      reason: 'Staff account no longer needed',
      beforeState: { status: 'ACTIVE' },
      afterState: { status: 'DISABLED', deletedAt: result.deletedAt.toISOString() },
    }));
  });

  it('requires global user-management permission before looking up the target', async () => {
    access.assertPermission.mockRejectedValue(new ForbiddenException());

    await expect(service.softDeleteUser(admin, userId, 'Staff account no longer needed'))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not allow deleting the current account', async () => {
    await expect(service.softDeleteUser({ ...admin, id: userId }, userId, 'Delete my account'))
      .rejects.toMatchObject({ response: { code: 'SELF_ACCOUNT_CHANGE_DENIED' } });

    expect(access.assertPermission).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not allow re-enabling a soft-deleted account', async () => {
    target.deletedAt = new Date();

    await expect(service.setUserStatus(admin, userId, true, 'Attempt to enable deleted account'))
      .rejects.toBeInstanceOf(NotFoundException);

    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
