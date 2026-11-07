import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AccessScope } from '../generated/prisma/client.js';
import { AccessControlService } from './access-control.service.js';

describe('AccessControlService resource scopes', () => {
  const userId = 'actor';
  const branchId = 'branch-parent';
  const childId = 'branch-child';
  let grants: any[];
  let prisma: any;
  let service: AccessControlService;

  beforeEach(() => {
    grants = [];
    prisma = {
      userRoleGrant: { findMany: jest.fn(async () => grants) },
      branch: { findUnique: jest.fn(async ({ where }: any) => where.id === childId ? { parentId: branchId } : null) },
    };
    service = new AccessControlService(prisma);
  });

  const grant = (scope: AccessScope, grantBranchId: string | null = null) => [{
    branchId: grantBranchId,
    role: { permissions: [{ permissionKey: 'customers.read', scope }] },
  }];

  it('applies OWN and ASSIGNED to the corresponding identity field', async () => {
    grants = grant(AccessScope.OWN);
    await expect(service.hasResourceAccess(userId, 'customers.read', undefined, { ownerId: userId })).resolves.toBe(true);
    await expect(service.hasResourceAccess(userId, 'customers.read', undefined, { ownerId: 'other' })).resolves.toBe(false);
    grants = grant(AccessScope.ASSIGNED);
    await expect(service.hasResourceAccess(userId, 'customers.read', undefined, { assigneeId: userId })).resolves.toBe(true);
    await expect(service.hasResourceAccess(userId, 'customers.read', undefined, { assigneeId: 'other' })).resolves.toBe(false);
  });

  it('restricts branch grants to the branch and its descendants', async () => {
    grants = grant(AccessScope.BRANCH, branchId);
    await expect(service.hasResourceAccess(userId, 'customers.read', undefined, { branchId: childId })).resolves.toBe(true);
    await expect(service.hasResourceAccess(userId, 'customers.read', undefined, { branchId: 'outside' })).resolves.toBe(false);
    await expect(service.hasResourceAccess(userId, 'customers.read', undefined, {})).resolves.toBe(false);
  });

  it('does not let a branch-bound ALL grant become global', async () => {
    grants = grant(AccessScope.ALL, branchId);
    await expect(service.hasResourceAccess(userId, 'customers.read', undefined, { branchId: childId })).resolves.toBe(false);
    grants = grant(AccessScope.ALL);
    await expect(service.hasResourceAccess(userId, 'customers.read', undefined, { branchId: 'outside' })).resolves.toBe(true);
  });
});
