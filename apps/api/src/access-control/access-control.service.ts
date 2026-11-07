import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessScope } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class AccessControlService {
  constructor(private readonly prisma: PrismaService) {}

  async effectivePermissions(userId: string) {
    const grants = await this.prisma.userRoleGrant.findMany({
      where: { userId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        branch: { select: { id: true, code: true, name: true } },
      },
    });

    const permissions = new Map<string, Set<AccessScope>>();
    for (const grant of grants) {
      for (const rolePermission of grant.role.permissions) {
        const scopes = permissions.get(rolePermission.permissionKey) ?? new Set<AccessScope>();
        scopes.add(rolePermission.scope);
        permissions.set(rolePermission.permissionKey, scopes);
      }
    }

    return {
      roles: grants.map((grant) => ({
        key: grant.role.key,
        name: grant.role.name,
        scope: grant.branch ? { branch: grant.branch } : { global: true },
      })),
      permissions: [...permissions.entries()]
        .map(([key, scopes]) => ({ key, scopes: [...scopes] }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    };
  }

  async hasPermission(
    userId: string,
    permissionKey: string,
    requiredScope?: AccessScope,
    targetBranchId?: string,
  ): Promise<boolean> {
    const grants = await this.prisma.userRoleGrant.findMany({
      where: { userId },
      include: { role: { include: { permissions: true } } },
    });

    for (const grant of grants) {
      for (const rolePermission of grant.role.permissions) {
        if (rolePermission.permissionKey !== permissionKey) continue;
        if (requiredScope && rolePermission.scope !== requiredScope) continue;
        if (rolePermission.scope === AccessScope.ALL) {
          if (grant.branchId === null) return true;
          continue;
        }
        if (!targetBranchId || !grant.branchId) return true;
        if (await this.isBranchInScope(targetBranchId, grant.branchId)) return true;
      }
    }
    return false;
  }

  async assertPermission(
    userId: string,
    permissionKey: string,
    scope?: AccessScope,
    targetBranchId?: string,
  ): Promise<void> {
    if (!(await this.hasPermission(userId, permissionKey, scope, targetBranchId))) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action or scope',
      });
    }
  }

  async hasDirectBranchPermission(userId: string, permissionKey: string, branchId: string): Promise<boolean> {
    const grants = await this.prisma.userRoleGrant.findMany({
      where: { userId },
      include: { role: { include: { permissions: true } } },
    });
    return grants.some((grant) => grant.role.permissions.some((permission) => {
      if (permission.permissionKey !== permissionKey) return false;
      if (permission.scope === AccessScope.ALL) return grant.branchId === null;
      return permission.scope === AccessScope.BRANCH && grant.branchId === branchId;
    }));
  }

  async assertDirectBranchPermission(userId: string, permissionKey: string, branchId: string): Promise<void> {
    if (!(await this.hasDirectBranchPermission(userId, permissionKey, branchId))) {
      throw new ForbiddenException({ code: 'DIRECT_BRANCH_PERMISSION_REQUIRED' });
    }
  }

  async isBranchManager(userId: string, branchId: string): Promise<boolean> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { managerUserId: true },
    });
    if (branch?.managerUserId !== userId) return false;
    const grant = await this.prisma.userRoleGrant.findFirst({
      where: { userId, branchId, role: { key: 'MANAGE' }, user: { status: 'ACTIVE' } },
      select: { id: true },
    });
    return Boolean(grant);
  }

  async hasManagedBranches(userId: string): Promise<boolean> {
    return (await this.prisma.branch.count({ where: { managerUserId: userId } })) > 0;
  }

  async assertBranchManagerOrGlobal(userId: string, permissionKey: string, branchId: string): Promise<void> {
    if (await this.hasPermission(userId, permissionKey, AccessScope.ALL)) return;
    if (
      await this.isBranchManager(userId, branchId) &&
      await this.hasPermission(userId, permissionKey, AccessScope.BRANCH, branchId)
    ) return;
    throw new ForbiddenException({ code: 'BRANCH_MANAGER_PERMISSION_REQUIRED' });
  }

  async canDelegate(
    actorId: string,
    permissionKey: string,
    requestedScope: AccessScope,
    branchId?: string,
  ): Promise<boolean> {
    if (await this.hasPermission(actorId, 'permissions.delegate', AccessScope.ALL)) return true;
    if (
      branchId && requestedScope !== AccessScope.ALL &&
      await this.hasPermission(actorId, 'permissions.delegate', AccessScope.BRANCH, branchId)
    ) return true;
    if (await this.hasPermission(actorId, permissionKey, AccessScope.ALL)) return true;
    return this.hasPermission(actorId, permissionKey, requestedScope, branchId);
  }

  async hasResourceAccess(
    actorId: string,
    permissionKey: string,
    scope: AccessScope | undefined,
    resource: { ownerId?: string | null; assigneeId?: string | null; branchId?: string | null },
  ): Promise<boolean> {
    const grants = await this.prisma.userRoleGrant.findMany({
      where: { userId: actorId },
      include: { role: { include: { permissions: true } } },
    });
    for (const grant of grants) {
      for (const permission of grant.role.permissions) {
        if (permission.permissionKey !== permissionKey) continue;
        if (permission.scope === AccessScope.ALL) {
          if (!grant.branchId) return true;
          continue;
        }
        const effectiveScope = scope ?? permission.scope;
        if (permission.scope !== effectiveScope) continue;
        if (effectiveScope === AccessScope.OWN && resource.ownerId !== actorId) continue;
        if (effectiveScope === AccessScope.ASSIGNED && resource.assigneeId !== actorId) continue;
        if (effectiveScope === AccessScope.BRANCH) {
          if (!grant.branchId || !resource.branchId) continue;
          if (!(await this.isBranchInScope(resource.branchId, grant.branchId))) continue;
        }
        if (grant.branchId) {
          if (!resource.branchId || !(await this.isBranchInScope(resource.branchId, grant.branchId))) continue;
        }
        return true;
      }
    }
    return false;
  }

  async assertResourceAccess(
    actorId: string,
    permissionKey: string,
    scope: AccessScope | undefined,
    resource: { ownerId?: string | null; assigneeId?: string | null; branchId?: string | null },
  ): Promise<void> {
    if (!(await this.hasResourceAccess(actorId, permissionKey, scope, resource))) {
      throw new ForbiddenException({
        code: 'RESOURCE_SCOPE_DENIED',
        message: 'Resource is outside the authenticated actor scope',
      });
    }
  }

  async isBranchInScope(targetBranchId: string, anchorBranchId: string): Promise<boolean> {
    let currentId: string | null = targetBranchId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      if (currentId === anchorBranchId) return true;
      visited.add(currentId);
      const branch: { parentId: string | null } | null = await this.prisma.branch.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });
      currentId = branch?.parentId ?? null;
    }
    return false;
  }
}
