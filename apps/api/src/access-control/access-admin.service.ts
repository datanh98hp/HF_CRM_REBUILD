import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessScope, BranchStatus, Prisma } from '../generated/prisma/client.js';
import { ActorContext, ActorRequest } from '../common/actor-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { PasswordHasherService } from '../auth/password-hasher.service.js';
import { AccessControlService } from './access-control.service.js';
import permissionCatalog from '../../prisma/permission-catalog.json' with { type: 'json' };
import {
  CreateBranchDto,
  CreateRoleDto,
  CreateRoleGrantDto,
  CreateUserDto,
  RolePermissionDto,
  SetRolePermissionsDto,
  UpdateBranchStatusDto,
} from './access.dto.js';

function getRequestId(request?: ActorRequest): string | null {
  const value = request?.headers['x-request-id'];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

@Injectable()
export class AccessAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordHasherService,
  ) {}

  async listCatalog() {
    return this.prisma.permission.findMany({ orderBy: [{ groupKey: 'asc' }, { key: 'asc' }] });
  }

  async listRoles() {
    return this.prisma.role.findMany({
      include: { permissions: { orderBy: [{ permissionKey: 'asc' }, { scope: 'asc' }] } },
      orderBy: [{ isSystem: 'desc' }, { key: 'asc' }],
    });
  }

  async createRole(actor: ActorContext, dto: CreateRoleDto, request?: ActorRequest) {
    await this.access.assertPermission(actor.id, 'roles.manage', AccessScope.ALL);
    const permissions = this.uniquePermissionRows(dto.permissions);
    await this.assertDelegable(actor.id, permissions, undefined, true);

    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          key: dto.key,
          name: dto.name.trim(),
          description: dto.description?.trim(),
          isSystem: false,
          permissions: { create: permissions },
        },
        include: { permissions: true },
      });
      await this.audit.write(tx, {
        actor,
        action: 'access.role.created',
        targetType: 'role',
        targetId: role.id,
        afterState: { key: role.key, permissionCount: permissions.length },
        requestId: getRequestId(request),
      });
      return role;
    });
  }

  async setRolePermissions(
    actor: ActorContext,
    roleKey: string,
    dto: SetRolePermissionsDto,
    request?: ActorRequest,
  ) {
    await this.access.assertPermission(actor.id, 'roles.manage', AccessScope.ALL);
    const role = await this.prisma.role.findUnique({
      where: { key: roleKey },
      include: { permissions: true },
    });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND' });
    if (role.key === 'OPERATOR') {
      throw new ForbiddenException({ code: 'SYSTEM_OPERATOR_ROLE_PROTECTED' });
    }
    const permissions = this.uniquePermissionRows(dto.permissions);
    await this.assertDelegable(actor.id, permissions, undefined, true);

    return this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissions.length) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: role.id, ...permission })),
        });
      }
      await this.audit.write(tx, {
        actor,
        action: 'access.role.permissions_changed',
        targetType: 'role',
        targetId: role.id,
        beforeState: role.permissions.map(({ permissionKey, scope }) => ({ permissionKey, scope })),
        afterState: permissions,
        requestId: getRequestId(request),
      });
      return tx.role.findUniqueOrThrow({
        where: { id: role.id },
        include: { permissions: true },
      });
    });
  }

  async listBranches(actor: ActorContext) {
    const branchIds = await this.accessibleBranchIds(actor.id, 'branches.read');
    return this.prisma.branch.findMany({
      where: branchIds === null ? undefined : { id: { in: branchIds } },
      select: {
        id: true, code: true, name: true, parentId: true, status: true, managerUserId: true, createdAt: true,
        manager: { select: { id: true, username: true, displayName: true, status: true } },
      },
      orderBy: [{ code: 'asc' }],
    });
  }

  async assignBranchManager(actor: ActorContext, branchId: string, managerUserId: string, request?: ActorRequest) {
    await this.access.assertPermission(actor.id, 'branches.manage', AccessScope.ALL);
    const [branch, user, managerRole, adviserRole] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, parentId: true, managerUserId: true } }),
      this.prisma.user.findUnique({ where: { id: managerUserId }, select: { id: true, username: true, displayName: true, status: true, roleGrants: { select: { branchId: true, role: { select: { key: true } } } } } }),
      this.prisma.role.findUnique({ where: { key: 'MANAGE' }, select: { id: true } }),
      this.prisma.role.findUnique({ where: { key: 'ADVISING' }, select: { id: true } }),
    ]);
    if (!branch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND' });
    if (!user || user.status !== 'ACTIVE') throw new NotFoundException({ code: 'ACTIVE_MANAGER_NOT_FOUND' });
    if (!managerRole) throw new NotFoundException({ code: 'MANAGE_ROLE_NOT_FOUND' });
    if (user.roleGrants.some((grant) => grant.role.key === 'OPERATOR' || grant.role.key === 'CUSTOMER')) {
      throw new ForbiddenException({ code: 'INELIGIBLE_BRANCH_MANAGER' });
    }
    if (branch.managerUserId === managerUserId) return { branchId, manager: user };
    if (user.roleGrants.some((grant) => grant.role.key === 'ADVISING' && grant.branchId !== branchId)) {
      throw new ConflictException({ code: 'BRANCH_MANAGER_HAS_ADVISER_SCOPE' });
    }

    return this.prisma.$transaction(async (tx) => {
      if (branch.parentId) {
        await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${branch.parentId}::uuid FOR UPDATE`;
        const parent = await tx.branch.findUnique({ where: { id: branch.parentId }, select: { status: true } });
        if (!parent || parent.status !== BranchStatus.ACTIVE) {
          throw new ConflictException({ code: 'BRANCH_PARENT_INACTIVE' });
        }
      }
      await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${branchId}::uuid FOR UPDATE`;
      const current = await tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { managerUserId: true } });
      await tx.userRoleGrant.deleteMany({ where: { branchId, roleId: managerRole.id } });
      if (adviserRole) await tx.userRoleGrant.deleteMany({ where: { branchId, roleId: adviserRole.id, userId: managerUserId } });
      await tx.userRoleGrant.create({
        data: {
          userId: managerUserId,
          roleId: managerRole.id,
          branchId,
          scopeAnchor: branchId,
          createdById: actor.id,
        },
      });
      const updated = await tx.branch.update({
        where: { id: branchId },
        data: { managerUserId, status: 'ACTIVE' },
        select: { id: true, code: true, name: true, managerUserId: true },
      });
      await this.audit.write(tx, {
        actor,
        action: 'organization.branch.manager.assigned',
        targetType: 'branch',
        targetId: branchId,
        branchId,
        beforeState: { managerUserId: current.managerUserId },
          afterState: { managerUserId, status: 'ACTIVE' },
        requestId: getRequestId(request),
      });
      return { ...updated, manager: user };
    });
  }

  async updateBranchStatus(actor: ActorContext, branchId: string, dto: UpdateBranchStatusDto, request?: ActorRequest) {
    await this.assertBranchPermission(actor.id, 'branches.manage', branchId);

    return this.prisma.$transaction(async (tx) => {
      const currentBranch = await tx.branch.findUnique({ where: { id: branchId }, select: { parentId: true } });
      if (!currentBranch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND' });
      if (dto.status === BranchStatus.ACTIVE && currentBranch.parentId) {
        await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${currentBranch.parentId}::uuid FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${branchId}::uuid FOR UPDATE`;
      const branch = await tx.branch.findUnique({
        where: { id: branchId },
        include: {
          parent: { select: { status: true } },
          manager: { select: { status: true } },
        },
      });
      if (!branch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND' });
      if (branch.status === dto.status) return branch;

      if (dto.status === BranchStatus.ACTIVE) {
        if (branch.parentId && branch.parent?.status !== BranchStatus.ACTIVE) {
          throw new ConflictException({ code: 'BRANCH_PARENT_INACTIVE' });
        }
        if (!branch.managerUserId || branch.manager?.status !== 'ACTIVE') {
          throw new ConflictException({ code: 'ACTIVE_BRANCH_REQUIRES_ACTIVE_MANAGER' });
        }
      } else {
        const activeChild = await tx.branch.findFirst({
          where: { parentId: branchId, status: BranchStatus.ACTIVE },
          select: { id: true },
        });
        if (activeChild) throw new ConflictException({ code: 'BRANCH_HAS_ACTIVE_CHILDREN' });
      }

      const updated = await tx.branch.update({
        where: { id: branchId },
        data: { status: dto.status },
      });
      await this.audit.write(tx, {
        actor,
        action: 'organization.branch.status.changed',
        targetType: 'branch',
        targetId: branchId,
        branchId,
        reason: dto.reason.trim(),
        beforeState: { status: branch.status },
        afterState: { status: updated.status },
        requestId: getRequestId(request),
      });
      return updated;
    });
  }

  async createBranch(actor: ActorContext, dto: CreateBranchDto, request?: ActorRequest) {
    const parentId = dto.parentId ?? null;
    if (parentId) {
      await this.assertBranchPermission(actor.id, 'branches.manage', parentId);
    } else {
      await this.access.assertPermission(actor.id, 'branches.manage', AccessScope.ALL);
    }

    return this.prisma.$transaction(async (tx) => {
      if (parentId) {
        await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${parentId}::uuid FOR UPDATE`;
        const parent = await tx.branch.findUnique({ where: { id: parentId }, select: { status: true } });
        if (!parent || parent.status !== BranchStatus.ACTIVE) throw new NotFoundException({ code: 'BRANCH_PARENT_NOT_FOUND' });
      }
      const branch = await tx.branch.create({
        data: { code: dto.code.trim().toUpperCase(), name: dto.name.trim(), parentId, status: 'INACTIVE' },
      });
      await this.audit.write(tx, {
        actor,
        action: 'organization.branch.created',
        targetType: 'branch',
        targetId: branch.id,
        branchId: branch.id,
        afterState: { code: branch.code, name: branch.name, parentId },
        requestId: getRequestId(request),
      });
      return branch;
    });
  }

  async listUsers(actor: ActorContext) {
    let branchIds = await this.accessibleBranchIds(actor.id, 'users.read');
    if (branchIds !== null && !(await this.access.hasPermission(actor.id, 'users.read', AccessScope.ALL))) {
      const managedBranches = await this.prisma.branch.findMany({ where: { managerUserId: actor.id }, select: { id: true } });
      if (managedBranches.length) branchIds = managedBranches.map(({ id }) => id);
    }
    return this.prisma.user.findMany({
      where: branchIds === null ? undefined : { roleGrants: { some: { branchId: { in: branchIds } } } },
      select: {
        id: true,
        username: true,
        displayName: true,
        status: true,
        createdAt: true,
        roleGrants: {
          select: {
            id: true,
            role: { select: { key: true, name: true } },
            branch: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: [{ username: 'asc' }],
      take: 500,
    });
  }

  async createUser(actor: ActorContext, dto: CreateUserDto, request?: ActorRequest) {
    const branchId = dto.branchId ?? null;
    await this.assertBranchPermission(actor.id, 'users.manage', branchId);
    await this.assertBranchPermission(actor.id, 'roles.manage', branchId);
    if (dto.roleKey === 'OPERATOR') throw new ForbiddenException({ code: 'OPERATOR_ASSIGNMENT_REQUIRES_BOOTSTRAP' });
    if (dto.roleKey === 'MANAGE') throw new ForbiddenException({ code: 'MANAGE_ASSIGNMENT_REQUIRES_BRANCH_MANAGER_ENDPOINT' });
    const role = await this.prisma.role.findUnique({
      where: { key: dto.roleKey },
      include: { permissions: true },
    });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND' });
    if (role.key === 'CUSTOMER') throw new ForbiddenException({ code: 'CUSTOMER_IS_NOT_A_STAFF_ACCOUNT' });
    const managerBranches = await this.prisma.branch.findMany({ where: { managerUserId: actor.id }, select: { id: true } });
    if (managerBranches.length && !(await this.access.hasPermission(actor.id, 'users.manage', AccessScope.ALL))) {
      if (!branchId || !managerBranches.some(({ id }) => id === branchId)) throw new ForbiddenException({ code: 'BRANCH_MANAGER_WRITE_DIRECT_BRANCH_ONLY' });
      if (role.key !== 'ADVISING') throw new ForbiddenException({ code: 'BRANCH_MANAGER_CAN_ONLY_CREATE_ADVISERS' });
    } else {
      await this.assertDelegable(actor.id, role.permissions, branchId);
    }
    const passwordHash = await this.passwords.hash(dto.temporaryPassword);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: dto.username.trim().toLowerCase(),
            displayName: dto.displayName.trim(),
            passwordHash,
            mustChangePassword: true,
          },
          select: { id: true, username: true, displayName: true, status: true, createdAt: true },
        });
        const grant = await tx.userRoleGrant.create({
          data: {
            userId: user.id,
            roleId: role.id,
            branchId,
            scopeAnchor: branchId ?? 'GLOBAL',
            createdById: actor.id,
          },
        });
        await this.audit.write(tx, {
          actor,
          action: 'identity.user.created',
          targetType: 'user',
          targetId: user.id,
          branchId,
          afterState: { username: user.username, roleKey: role.key },
          requestId: getRequestId(request),
        });
        return { ...user, roleGrantId: grant.id, roleKey: role.key };
      });
    } catch (error) {
      if (this.isUniqueError(error)) throw new ConflictException({ code: 'USERNAME_ALREADY_EXISTS' });
      throw error;
    }
  }

  async createRoleGrant(actor: ActorContext, dto: CreateRoleGrantDto, request?: ActorRequest) {
    if (actor.id === dto.userId) throw new ForbiddenException({ code: 'SELF_ROLE_ASSIGNMENT_DENIED' });
    const branchId = dto.branchId ?? null;
    await this.assertBranchPermission(actor.id, 'roles.manage', branchId);
    const [target, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: dto.userId },
        include: { roleGrants: { select: { branchId: true, role: { select: { key: true } } } } },
      }),
      this.prisma.role.findUnique({
        where: { key: dto.roleKey },
        include: { permissions: true },
      }),
    ]);
    if (!target || target.status !== 'ACTIVE') throw new NotFoundException({ code: 'ACTIVE_USER_NOT_FOUND' });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND' });
    if (role.key === 'CUSTOMER') throw new ForbiddenException({ code: 'CUSTOMER_IS_NOT_A_STAFF_ACCOUNT' });
    if (role.key === 'MANAGE') throw new ForbiddenException({ code: 'MANAGE_ASSIGNMENT_REQUIRES_BRANCH_MANAGER_ENDPOINT' });
    const managerBranches = await this.prisma.branch.findMany({ where: { managerUserId: actor.id }, select: { id: true } });
    if (managerBranches.length && !(await this.access.hasPermission(actor.id, 'roles.manage', AccessScope.ALL))) {
      if (role.key !== 'ADVISING' || !branchId || !managerBranches.some(({ id }) => id === branchId)) {
        throw new ForbiddenException({ code: 'BRANCH_MANAGER_GRANT_SCOPE_RESTRICTED' });
      }
    }
    if (role.key === 'OPERATOR') throw new ForbiddenException({ code: 'OPERATOR_ASSIGNMENT_REQUIRES_BOOTSTRAP' });
    if (target.roleGrants.some((grant) => grant.role.key === 'OPERATOR')) {
      await this.assertOperator(actor.id);
    }
    await this.assertTargetScope(actor.id, target.roleGrants.map((grant) => ({
      branchId: grant.branchId,
      roleKey: grant.role.key,
    })), 'roles.manage');
    await this.assertDelegable(actor.id, role.permissions, branchId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const grant = await tx.userRoleGrant.create({
          data: {
            userId: target.id,
            roleId: role.id,
            branchId,
            scopeAnchor: branchId ?? 'GLOBAL',
            createdById: actor.id,
          },
          include: { role: { select: { key: true, name: true } }, branch: { select: { id: true, code: true, name: true } } },
        });
        await this.audit.write(tx, {
          actor,
          action: 'access.user_role.granted',
          targetType: 'user_role_grant',
          targetId: grant.id,
          branchId,
          reason: dto.reason,
          afterState: { targetUserId: target.id, roleKey: role.key, branchId },
          requestId: getRequestId(request),
        });
        return grant;
      });
    } catch (error) {
      if (this.isUniqueError(error)) throw new ConflictException({ code: 'ROLE_ALREADY_GRANTED' });
      throw error;
    }
  }

  async revokeRoleGrant(actor: ActorContext, grantId: string, reason: string, request?: ActorRequest) {
    const grant = await this.prisma.userRoleGrant.findUnique({
      where: { id: grantId },
      include: {
        role: { select: { key: true } },
        user: { select: { id: true, roleGrants: { select: { branchId: true, role: { select: { key: true } } } } } },
      },
    });
    if (!grant) throw new NotFoundException({ code: 'ROLE_GRANT_NOT_FOUND' });
    if (actor.id === grant.user.id) throw new ForbiddenException({ code: 'SELF_ROLE_REVOCATION_DENIED' });
    const hasGlobalRoleManagement = await this.access.hasPermission(
      actor.id,
      'roles.manage',
      AccessScope.ALL,
    );
    const systemAdminGrant = grant.role.key === 'MANAGE' && !hasGlobalRoleManagement
      ? await this.prisma.userRoleGrant.findFirst({
        where: {
          userId: actor.id,
          branchId: null,
          role: { key: { in: ['ADMIN', 'OPERATOR'] } },
        },
        select: { id: true },
      })
      : null;
    const canRevokeManagerRole = hasGlobalRoleManagement || Boolean(systemAdminGrant);
    if (grant.role.key === 'MANAGE' && !canRevokeManagerRole) {
      throw new ForbiddenException({ code: 'MANAGE_ROLE_REVOCATION_REQUIRES_GLOBAL_ADMIN' });
    }
    if (!canRevokeManagerRole) {
      await this.assertBranchPermission(actor.id, 'roles.manage', grant.branchId);
    }
    if (grant.role.key === 'OPERATOR') await this.assertOperator(actor.id);
    if (!canRevokeManagerRole) {
      await this.assertTargetScope(actor.id, grant.user.roleGrants.map((entry) => ({
        branchId: entry.branchId,
        roleKey: entry.role.key,
      })), 'roles.manage');
    }
    const managedBranches = await this.prisma.branch.findMany({ where: { managerUserId: actor.id }, select: { id: true } });
    if (managedBranches.length && !canRevokeManagerRole &&
      (grant.role.key !== 'ADVISING' || !grant.branchId || !managedBranches.some(({ id }) => id === grant.branchId))) {
      throw new ForbiddenException({ code: 'BRANCH_MANAGER_GRANT_SCOPE_RESTRICTED' });
    }

    await this.prisma.$transaction(async (tx) => {
      if (grant.role.key === 'MANAGE' && grant.branchId) {
        await this.unassignManagerAndDeactivateBranchTree(
          tx,
          actor,
          grant.branchId,
          grant.user.id,
          reason,
          request,
        );
      }
      await tx.userRoleGrant.delete({ where: { id: grant.id } });
      await this.audit.write(tx, {
        actor,
        action: 'access.user_role.revoked',
        targetType: 'user_role_grant',
        targetId: grant.id,
        branchId: grant.branchId,
        reason,
        beforeState: { targetUserId: grant.user.id, roleKey: grant.role.key },
        requestId: getRequestId(request),
      });
    });
    return { status: 'revoked' as const };
  }

  async setUserStatus(
    actor: ActorContext,
    userId: string,
    enabled: boolean,
    reason: string,
    request?: ActorRequest,
  ) {
    if (actor.id === userId) throw new ForbiddenException({ code: 'SELF_ACCOUNT_CHANGE_DENIED' });
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roleGrants: { select: { branchId: true, role: { select: { key: true } } } } },
    });
    if (!target) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    const managedBranches = await this.prisma.branch.findMany({ where: { managerUserId: actor.id }, select: { id: true } });
    if (managedBranches.length && !(await this.access.hasPermission(actor.id, 'users.manage', AccessScope.ALL))) {
      const canManageTarget = target.roleGrants.some((grant) => grant.role.key === 'ADVISING' && grant.branchId !== null && managedBranches.some(({ id }) => id === grant.branchId));
      if (!canManageTarget || target.roleGrants.some((grant) => grant.role.key === 'MANAGE')) throw new ForbiddenException({ code: 'BRANCH_MANAGER_USER_SCOPE_RESTRICTED' });
    }
    await this.assertTargetScope(actor.id, target.roleGrants.map((grant) => ({
      branchId: grant.branchId,
      roleKey: grant.role.key,
    })), 'users.manage');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { status: enabled ? 'ACTIVE' : 'DISABLED' },
        select: { id: true, username: true, displayName: true, status: true },
      });
      if (!enabled) {
        await tx.authSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const managedBranches = await tx.branch.findMany({
          where: { managerUserId: userId },
          orderBy: { id: 'asc' },
          select: { id: true, status: true },
        });
        for (const branch of managedBranches) {
          await this.unassignManagerAndDeactivateBranchTree(
            tx,
            actor,
            branch.id,
            userId,
            reason,
            request,
          );
        }
      }
      const targetBranchIds = [...new Set(target.roleGrants.map((grant) => grant.branchId))];
      const auditBranchIds: Array<string | null> = targetBranchIds.includes(null)
        ? [null]
        : targetBranchIds.filter((branchId): branchId is string => branchId !== null);
      if (auditBranchIds.length === 0) auditBranchIds.push(null);
      for (const branchId of auditBranchIds) {
        await this.audit.write(tx, {
          actor,
          action: enabled ? 'identity.user.enabled' : 'identity.user.disabled',
          targetType: 'user',
          targetId: userId,
          branchId,
          reason,
          beforeState: { status: target.status },
          afterState: { status: updated.status },
          requestId: getRequestId(request),
        });
      }
      return updated;
    });
  }

  async listAuditEvents(actor: ActorContext, take = 100) {
    const branchIds = await this.accessibleBranchIds(actor.id, 'audit.read');
    return this.prisma.auditEvent.findMany({
      where: branchIds === null ? undefined : { branchId: { in: branchIds } },
      select: {
        id: true,
        actorId: true,
        action: true,
        targetType: true,
        targetId: true,
        branchId: true,
        reason: true,
        beforeState: true,
        afterState: true,
        requestId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Math.trunc(take), 1), 500),
    });
  }

  private uniquePermissionRows(permissions: RolePermissionDto[]) {
    const keys = new Set<string>();
    return permissions.map(({ permissionKey, scope }) => {
      const compositeKey = `${permissionKey}:${scope}`;
      if (keys.has(compositeKey)) throw new ConflictException({ code: 'DUPLICATE_ROLE_PERMISSION' });
      keys.add(compositeKey);
      return { permissionKey, scope };
    });
  }

  private async assertDelegable(
    actorId: string,
    permissions: Array<{ permissionKey: string; scope: AccessScope }>,
    branchId?: string | null,
    allowUnboundBranchScope = false,
  ) {
    const knownPermissions = new Set(permissionCatalog.map((permission) => permission.key));
    for (const permission of permissions) {
      if (!knownPermissions.has(permission.permissionKey)) {
        throw new ConflictException({ code: 'PERMISSION_NOT_IN_CATALOG' });
      }
      if (permission.scope === AccessScope.BRANCH && !branchId && !allowUnboundBranchScope) {
        throw new ForbiddenException({ code: 'BRANCH_PERMISSION_REQUIRES_BRANCH_ASSIGNMENT' });
      }
      if (permission.scope === AccessScope.ALL && branchId) {
        throw new ForbiddenException({ code: 'GLOBAL_PERMISSION_CANNOT_BE_BRANCH_BOUND' });
      }
      if (!(await this.access.canDelegate(actorId, permission.permissionKey, permission.scope, branchId ?? undefined))) {
        throw new ForbiddenException({ code: 'PERMISSION_OUTSIDE_DELEGATION_AUTHORITY' });
      }
    }
  }

  private async unassignManagerAndDeactivateBranchTree(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    branchId: string,
    managerUserId: string,
    reason: string,
    request?: ActorRequest,
  ) {
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      select: { managerUserId: true },
    });
    if (branch?.managerUserId !== managerUserId) return;

    const descendants: string[] = [];
    let parentIds = [branchId];
    while (parentIds.length) {
      const children = await tx.branch.findMany({
        where: { parentId: { in: parentIds } },
        select: { id: true },
      });
      descendants.push(...children.map(({ id }) => id));
      parentIds = children.map(({ id }) => id);
    }

    const branchIds = [branchId, ...descendants];
    for (const id of [...branchIds].sort()) {
      await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${id}::uuid FOR UPDATE`;
    }

    for (const id of branchIds) {
      const current = await tx.branch.findUnique({
        where: { id },
        select: { managerUserId: true, status: true },
      });
      if (!current) continue;
      if (id === branchId && current.managerUserId !== managerUserId) return;
      if (id !== branchId && current.status !== BranchStatus.ACTIVE) continue;

      const previousStatus = current.status;
      const isManagerBranch = id === branchId;
      const nextStatus = previousStatus === BranchStatus.ACTIVE ? BranchStatus.INACTIVE : previousStatus;
      await tx.branch.update({
        where: { id },
        data: {
          ...(isManagerBranch ? { managerUserId: null } : {}),
          ...(nextStatus !== previousStatus ? { status: nextStatus } : {}),
        },
      });
      await this.audit.write(tx, {
        actor,
        action: isManagerBranch
          ? 'organization.branch.manager.unassigned'
          : 'organization.branch.status.changed',
        targetType: 'branch',
        targetId: id,
        branchId: id,
        reason,
        beforeState: isManagerBranch
          ? { managerUserId, status: previousStatus }
          : { status: previousStatus },
        afterState: isManagerBranch
          ? { managerUserId: null, status: nextStatus }
          : { status: nextStatus },
        requestId: getRequestId(request),
      });
    }
  }

  private async assertBranchPermission(actorId: string, permissionKey: string, branchId: string | null) {
    if (branchId) {
      const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
      if (!branch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND' });
      if (await this.access.hasPermission(actorId, permissionKey, AccessScope.ALL)) return;
      await this.access.assertPermission(actorId, permissionKey, AccessScope.BRANCH, branchId);
      return;
    }
    await this.access.assertPermission(actorId, permissionKey, AccessScope.ALL);
  }

  private async assertOperator(actorId: string) {
    const operator = await this.prisma.userRoleGrant.findFirst({
      where: { userId: actorId, role: { key: 'OPERATOR' }, branchId: null },
      select: { id: true },
    });
    if (!operator) throw new ForbiddenException({ code: 'HIGH_PRIVILEGE_TARGET_PROTECTED' });
  }

  private async assertTargetScope(
    actorId: string,
    targetGrants: Array<{ branchId: string | null; roleKey: string }>,
    permissionKey: string,
  ) {
    if (targetGrants.some((grant) => grant.roleKey === 'OPERATOR')) {
      await this.assertOperator(actorId);
    }
    if (!targetGrants.length || targetGrants.some((grant) => !grant.branchId)) {
      await this.access.assertPermission(actorId, permissionKey, AccessScope.ALL);
      return;
    }
    for (const grant of targetGrants) {
      if (grant.branchId) await this.assertBranchPermission(actorId, permissionKey, grant.branchId);
    }
  }

  private async accessibleBranchIds(actorId: string, permissionKey: string): Promise<string[] | null> {
    const grants = await this.prisma.userRoleGrant.findMany({
      where: { userId: actorId },
      include: { role: { include: { permissions: true } } },
    });
    const branchScopes: string[] = [];
    for (const grant of grants) {
      for (const permission of grant.role.permissions) {
        if (permission.permissionKey !== permissionKey) continue;
        if (permission.scope === AccessScope.ALL && grant.branchId === null) return null;
        if (permission.scope === AccessScope.BRANCH && grant.branchId) branchScopes.push(grant.branchId);
      }
    }
    if (!branchScopes.length) throw new ForbiddenException({ code: 'PERMISSION_SCOPE_UNAVAILABLE' });
    const branches = await this.prisma.branch.findMany({ select: { id: true, parentId: true } });
    const allowed = new Set(branchScopes);
    let changed = true;
    while (changed) {
      changed = false;
      for (const branch of branches) {
        if (!allowed.has(branch.id) && branch.parentId && allowed.has(branch.parentId)) {
          allowed.add(branch.id);
          changed = true;
        }
      }
    }
    return [...allowed];
  }

  private isUniqueError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
