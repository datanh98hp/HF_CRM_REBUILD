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
    scope: AccessScope,
    resource: { ownerId?: string | null; assigneeId?: string | null; branchId?: string | null },
  ): Promise<boolean> {
    const grants = await this.prisma.userRoleGrant.findMany({
      where: { userId: actorId },
      include: { role: { include: { permissions: true } } },
    });
    for (const grant of grants) {
      for (const permission of grant.role.permissions) {
        if (permission.permissionKey !== permissionKey) continue;
        if (permission.scope === AccessScope.ALL && !grant.branchId) return true;
        if (permission.scope !== scope) continue;
        if (permission.scope === AccessScope.OWN && resource.ownerId !== actorId) continue;
        if (permission.scope === AccessScope.ASSIGNED && resource.assigneeId !== actorId) continue;
        if (permission.scope === AccessScope.BRANCH) {
          if (!grant.branchId || !resource.branchId) continue;
          if (!(await this.isBranchInScope(resource.branchId, grant.branchId))) continue;
        }
        if (grant.branchId && resource.branchId && !(await this.isBranchInScope(resource.branchId, grant.branchId))) continue;
        if (grant.branchId && !resource.branchId) continue;
        return true;
      }
    }
    return false;
  }

  async assertResourceAccess(
    actorId: string,
    permissionKey: string,
    scope: AccessScope,
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
