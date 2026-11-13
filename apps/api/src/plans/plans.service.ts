import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessScope,
  BranchStatus,
  PlanApprovalDecision,
  PlanStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { AccessControlService } from '../access-control/access-control.service.js';
import { ActorContext, ActorRequest } from '../common/actor-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  CreatePlanDto,
  CreatePlanMetricCatalogDto,
  PlanListQueryDto,
  ReviewPlanDto,
  UpdatePlanDto,
  UpdatePlanMetricCatalogDto,
} from './plans.dto.js';

function requestId(request?: ActorRequest): string | null {
  const value = request?.headers['x-request-id'];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const planInclude = {
  branches: { include: { branch: { select: { id: true, code: true, name: true } } } },
  metrics: { orderBy: { name: 'asc' as const } },
  approvals: {
    orderBy: { version: 'asc' as const },
    include: { reviewer: { select: { id: true, username: true, displayName: true } } },
  },
};

function serializePlan<
  T extends {
    branches: Array<{ branch: { id: string; code: string; name: string } }>;
    metrics: Array<{ target: Prisma.Decimal }>;
  },
>(plan: T, visibleBranchIds?: Set<string>) {
  const { branches, ...serialized } = plan;
  return {
    ...serialized,
    branches: branches
      .map(({ branch }) => branch)
      .filter((branch) => !visibleBranchIds || visibleBranchIds.has(branch.id))
      .sort((left, right) => left.name.localeCompare(right.name, 'vi')),
    metrics: serialized.metrics.map((metric) => ({ ...metric, target: metric.target.toNumber() })),
  };
}

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: ActorContext, query: PlanListQueryDto) {
    this.assertStaff(actor);
    const globallyAllowed = await this.access.hasPermission(actor.id, 'plans.read', AccessScope.ALL);
    const where: Prisma.PlanWhereInput = { deletedAt: null };
    let branchScopeIds = new Set<string>();
    let ownerScopeBranchIds = new Set<string>();
    let ownerScopeGrantCount = 0;
    let hasUnanchoredOwnerScope = false;
    let assignedBranchesByPlan = new Map<string, Set<string>>();
    let assignedPlanIds = new Set<string>();
    if (globallyAllowed) {
      if (query.branchId) where.branches = { some: { branchId: query.branchId } };
    } else {
      const readGrants = await this.prisma.userRoleGrant.findMany({
        where: {
          userId: actor.id,
          role: {
            permissions: {
              some: { permissionKey: 'plans.read' },
            },
          },
        },
        select: {
          branchId: true,
          role: {
            select: {
              permissions: {
                where: { permissionKey: 'plans.read' },
                select: { scope: true },
              },
            },
          },
        },
      });
      const branches = await this.prisma.branch.findMany({
        select: { id: true, parentId: true },
      });
      branchScopeIds = new Set(
        readGrants.flatMap(({ branchId, role }) =>
          branchId && role.permissions.some(({ scope }) => scope === AccessScope.BRANCH)
            ? [branchId]
            : [],
        ),
      );
      const ownerScopeGrants = readGrants.filter(({ role }) =>
        role.permissions.some(({ scope }) => scope === AccessScope.OWN),
      );
      ownerScopeGrantCount = ownerScopeGrants.length;
      const assignedScopeGrants = readGrants.filter(({ role }) =>
        role.permissions.some(({ scope }) => scope === AccessScope.ASSIGNED),
      );
      ownerScopeBranchIds = new Set(
        readGrants.flatMap(({ branchId, role }) =>
          branchId && role.permissions.some(({ scope }) => scope === AccessScope.OWN)
            ? [branchId]
            : [],
        ),
      );
      const assignedScopeBranchIds = new Set(
        readGrants.flatMap(({ branchId, role }) =>
          branchId && role.permissions.some(({ scope }) => scope === AccessScope.ASSIGNED)
            ? [branchId]
            : [],
        ),
      );
      hasUnanchoredOwnerScope = ownerScopeGrants.some(({ branchId }) => branchId === null);
      const hasUnanchoredAssignedScope = assignedScopeGrants.some(({ branchId }) => branchId === null);
      const childrenByParent = new Map<string, string[]>();
      for (const branch of branches) {
        if (!branch.parentId) continue;
        const children = childrenByParent.get(branch.parentId) ?? [];
        children.push(branch.id);
        childrenByParent.set(branch.parentId, children);
      }
      const expandBranchScope = (scopeIds: Set<string>) => {
        const pendingBranches = [...scopeIds];
        for (let index = 0; index < pendingBranches.length; index += 1) {
          for (const childId of childrenByParent.get(pendingBranches[index]) ?? []) {
            if (scopeIds.has(childId)) continue;
            scopeIds.add(childId);
            pendingBranches.push(childId);
          }
        }
      };
      expandBranchScope(branchScopeIds);
      expandBranchScope(ownerScopeBranchIds);
      expandBranchScope(assignedScopeBranchIds);
      const assignedTaskRows = assignedScopeGrants.length
        ? await this.prisma.taskAssignment.findMany({
            where: {
              assigneeId: actor.id,
              task: {
                plan: { deletedAt: null },
                ...(hasUnanchoredAssignedScope
                  ? {}
                  : { branchId: { in: [...assignedScopeBranchIds] } }),
              },
            },
            select: { task: { select: { planId: true, branchId: true } } },
          })
        : [];
      assignedBranchesByPlan = new Map<string, Set<string>>();
      for (const { task } of assignedTaskRows) {
        const assignedBranches = assignedBranchesByPlan.get(task.planId) ?? new Set<string>();
        assignedBranches.add(task.branchId);
        assignedBranchesByPlan.set(task.planId, assignedBranches);
      }
      assignedPlanIds = new Set(assignedBranchesByPlan.keys());
      if (query.branchId) {
        const selectedBranchId = query.branchId;
        if (branchScopeIds.has(query.branchId)) {
          where.branches = { some: { branchId: query.branchId } };
        } else if ([...assignedBranchesByPlan.values()].some((ids) => ids.has(selectedBranchId))) {
          where.id = { in: [...assignedPlanIds] };
          where.branches = { some: { branchId: query.branchId } };
        } else if (ownerScopeGrants.length &&
          (hasUnanchoredOwnerScope || ownerScopeBranchIds.has(query.branchId))) {
          where.createdById = actor.id;
          where.branches = { some: { branchId: query.branchId } };
        } else {
          where.id = { in: [] };
        }
      } else {
        const scopeFilters: Prisma.PlanWhereInput[] = [];
        if (branchScopeIds.size) {
          scopeFilters.push({ branches: { some: { branchId: { in: [...branchScopeIds] } } } });
        }
        if (ownerScopeGrants.length) {
          scopeFilters.push({
            createdById: actor.id,
            ...(hasUnanchoredOwnerScope
              ? {}
              : { branches: { some: { branchId: { in: [...ownerScopeBranchIds] } } } }),
          });
        }
        if (assignedPlanIds.size) {
          scopeFilters.push({ id: { in: [...assignedPlanIds] } });
        }
        if (scopeFilters.length) where.OR = scopeFilters;
        else where.id = { in: [] };
      }
    }

    const plans = await this.prisma.plan.findMany({
      where,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.take,
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      include: planInclude,
    });
    return plans.map((plan) => {
      if (globallyAllowed) return serializePlan(plan);
      const visibleBranchIds = new Set(branchScopeIds);
      const canReadOwnedPlan = ownerScopeGrantCount > 0
        && plan.createdById === actor.id
        && (hasUnanchoredOwnerScope
          || plan.branches.some(({ branchId }) => ownerScopeBranchIds.has(branchId)));
      const assignedBranches = assignedBranchesByPlan.get(plan.id);
      if (canReadOwnedPlan && hasUnanchoredOwnerScope) return serializePlan(plan);
      if (canReadOwnedPlan) {
        for (const { branchId } of plan.branches) {
          if (ownerScopeBranchIds.has(branchId)) visibleBranchIds.add(branchId);
        }
      }
      for (const branchId of assignedBranches ?? []) visibleBranchIds.add(branchId);
      return serializePlan(plan, visibleBranchIds);
    });
  }

  async create(actor: ActorContext, dto: CreatePlanDto, request?: ActorRequest) {
    this.assertStaff(actor);
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodStart.getTime() >= periodEnd.getTime()) {
      throw new BadRequestException({ code: 'INVALID_PLAN_PERIOD' });
    }
    const catalogIds = dto.metrics.map(({ catalogId }) => catalogId);
    if (new Set(catalogIds).size !== catalogIds.length) {
      throw new ConflictException({ code: 'DUPLICATE_PLAN_METRIC' });
    }
    const catalogItems = await this.prisma.planMetricCatalog.findMany({
      where: { id: { in: catalogIds }, isActive: true },
      select: { id: true, name: true, unit: true },
    });
    if (catalogItems.length !== catalogIds.length) {
      throw new BadRequestException({ code: 'PLAN_METRIC_CATALOG_ITEM_UNAVAILABLE' });
    }
    const catalogById = new Map(catalogItems.map((item) => [item.id, item]));

    const uniqueBranchIds = [...new Set(dto.branchIds)];
    for (const branchId of uniqueBranchIds) {
      await this.access.assertResourceAccess(
        actor.id,
        'plans.manage',
        undefined,
        { ownerId: actor.id, assigneeId: actor.id, branchId },
      );
    }
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: uniqueBranchIds } },
      select: { id: true, status: true },
    });
    if (branches.length !== uniqueBranchIds.length) {
      throw new NotFoundException({ code: 'BRANCH_NOT_FOUND' });
    }
    if (branches.some((branch) => branch.status !== BranchStatus.ACTIVE)) {
      throw new ConflictException({ code: 'PLAN_BRANCH_INACTIVE' });
    }

    try {
      const plan = await this.prisma.$transaction(async (tx) => {
        const created = await tx.plan.create({
          data: {
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            createdById: actor.id,
            periodStart,
            periodEnd,
            branches: {
              create: uniqueBranchIds.map((branchId) => ({ branchId })),
            },
            metrics: {
              create: dto.metrics.map((metric) => {
                const catalogItem = catalogById.get(metric.catalogId);
                if (!catalogItem) throw new BadRequestException({ code: 'PLAN_METRIC_CATALOG_ITEM_UNAVAILABLE' });
                return {
                  catalogId: catalogItem.id,
                  name: catalogItem.name,
                  unit: catalogItem.unit,
                  target: new Prisma.Decimal(metric.target),
                };
              }),
            },
          },
          include: planInclude,
        });
        await this.audit.write(tx, {
          actor,
          action: 'plan.created',
          targetType: 'plan',
          targetId: created.id,
          branchId: uniqueBranchIds[0] ?? null,
          afterState: {
            name: created.name,
            branchIds: uniqueBranchIds,
            periodStart: created.periodStart.toISOString(),
            periodEnd: created.periodEnd.toISOString(),
            metricCount: created.metrics.length,
          },
          requestId: requestId(request),
        });
        return created;
      });
      return serializePlan(plan);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundException({ code: 'PLAN_REFERENCE_NOT_FOUND' });
      }
      throw error;
    }
  }

  async update(actor: ActorContext, planId: string, dto: UpdatePlanDto, request?: ActorRequest) {
    this.assertStaff(actor);
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException({ code: 'PLAN_UPDATE_EMPTY' });
    }
    if ((dto.periodStart === undefined) !== (dto.periodEnd === undefined)) {
      throw new BadRequestException({ code: 'PLAN_PERIOD_REQUIRES_BOTH_DATES' });
    }

    const current = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null },
      include: planInclude,
    });
    if (!current) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });
    if (current.status === PlanStatus.PENDING_APPROVAL) {
      throw new ConflictException({ code: 'PLAN_PENDING_APPROVAL_CANNOT_BE_EDITED' });
    }
    if (dto.status && dto.status !== PlanStatus.ARCHIVED) {
      throw new BadRequestException({ code: 'PLAN_STATUS_REQUIRES_APPROVAL_FLOW' });
    }
    if (dto.status === PlanStatus.ARCHIVED && current.status !== PlanStatus.ACTIVE) {
      throw new ConflictException({ code: 'ONLY_ACTIVE_PLANS_CAN_BE_ARCHIVED' });
    }

    const currentBranchIds = current.branches.map(({ branch }) => branch.id);
    const addBranchIds = [...new Set(dto.addBranchIds ?? [])];
    const removeBranchIds = [...new Set(dto.removeBranchIds ?? [])];
    if (addBranchIds.some((branchId) => removeBranchIds.includes(branchId))) {
      throw new BadRequestException({ code: 'PLAN_BRANCH_CANNOT_BE_ADDED_AND_REMOVED' });
    }
    if (removeBranchIds.some((branchId) => !currentBranchIds.includes(branchId))) {
      throw new BadRequestException({ code: 'PLAN_BRANCH_NOT_ASSIGNED' });
    }
    const nextBranchIds = [
      ...currentBranchIds.filter((branchId) => !removeBranchIds.includes(branchId)),
      ...addBranchIds.filter((branchId) => !currentBranchIds.includes(branchId)),
    ];
    const accessBranchIds = [...new Set([...currentBranchIds, ...nextBranchIds])];
    if (accessBranchIds.length === 0) {
      await this.access.assertPermission(actor.id, 'plans.manage', AccessScope.ALL);
    } else {
      for (const branchId of accessBranchIds) {
          await this.access.assertResourceAccess(
            actor.id,
            'plans.manage',
            undefined,
            { ownerId: current.createdById, assigneeId: current.createdById, branchId },
          );
      }
    }

    const periodStart = dto.periodStart ? new Date(dto.periodStart) : current.periodStart;
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : current.periodEnd;
    if (periodStart.getTime() >= periodEnd.getTime()) {
      throw new BadRequestException({ code: 'INVALID_PLAN_PERIOD' });
    }

    const addedBranchIds = addBranchIds.filter((branchId) => !currentBranchIds.includes(branchId));
    if (addedBranchIds.length) {
      const addedBranches = await this.prisma.branch.findMany({
        where: { id: { in: addedBranchIds } },
        select: { id: true, status: true },
      });
      if (addedBranches.length !== addedBranchIds.length) {
        throw new NotFoundException({ code: 'BRANCH_NOT_FOUND' });
      }
      if (addedBranches.some((branch) => branch.status !== BranchStatus.ACTIVE)) {
        throw new ConflictException({ code: 'PLAN_BRANCH_INACTIVE' });
      }
    }

    const nextStatus = dto.status ?? current.status;
    const removedBranchIds = removeBranchIds;
    const plan = await this.prisma.$transaction(async (tx) => {
      if (removedBranchIds.length) {
        await tx.planBranch.deleteMany({
          where: { planId, branchId: { in: removedBranchIds } },
        });
      }
      if (addedBranchIds.length) {
        await tx.planBranch.createMany({
          data: addedBranchIds.map((branchId) => ({ planId, branchId })),
        });
      }

      const updated = await tx.plan.update({
        where: { id: planId },
        data: {
          ...(dto.periodStart ? { periodStart } : {}),
          ...(dto.periodEnd ? { periodEnd } : {}),
          ...(dto.status ? { status: dto.status } : {}),
        },
        include: planInclude,
      });
      await this.audit.write(tx, {
        actor,
        action: 'plan.updated',
        targetType: 'plan',
        targetId: planId,
        branchId: nextBranchIds[0] ?? currentBranchIds[0] ?? null,
        beforeState: {
          branchIds: currentBranchIds,
          periodStart: current.periodStart.toISOString(),
          periodEnd: current.periodEnd.toISOString(),
          status: current.status,
        },
        afterState: {
          branchIds: nextBranchIds,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          status: nextStatus,
        },
        requestId: requestId(request),
      });
      return updated;
    });
    return serializePlan(plan);
  }

  async listMetricCatalog(actor: ActorContext) {
    this.assertStaff(actor);
    await this.access.assertPermission(actor.id, 'plans.read');
    const canManageCatalog = await this.access.hasPermission(
      actor.id,
      'plans.catalog.manage',
      AccessScope.ALL,
    );
    return this.prisma.planMetricCatalog.findMany({
      where: canManageCatalog ? {} : { isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async createMetricCatalogItem(
    actor: ActorContext,
    dto: CreatePlanMetricCatalogDto,
    request?: ActorRequest,
  ) {
    this.assertStaff(actor);
    await this.access.assertPermission(actor.id, 'plans.catalog.manage', AccessScope.ALL);
    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const created = await tx.planMetricCatalog.create({
          data: { key: dto.key.trim(), name: dto.name.trim(), unit: dto.unit.trim() },
        });
        await this.audit.write(tx, {
          actor,
          action: 'plan.metric_catalog.created',
          targetType: 'plan-metric-catalog',
          targetId: created.id,
          afterState: { key: created.key, name: created.name, unit: created.unit },
          requestId: requestId(request),
        });
        return created;
      });
      return item;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'PLAN_METRIC_CATALOG_KEY_EXISTS' });
      }
      throw error;
    }
  }

  async updateMetricCatalogItem(
    actor: ActorContext,
    catalogId: string,
    dto: UpdatePlanMetricCatalogDto,
    request?: ActorRequest,
  ) {
    this.assertStaff(actor);
    await this.access.assertPermission(actor.id, 'plans.catalog.manage', AccessScope.ALL);
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException({ code: 'PLAN_METRIC_CATALOG_UPDATE_EMPTY' });
    }
    const current = await this.prisma.planMetricCatalog.findUnique({ where: { id: catalogId } });
    if (!current) throw new NotFoundException({ code: 'PLAN_METRIC_CATALOG_ITEM_NOT_FOUND' });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.planMetricCatalog.update({
        where: { id: catalogId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.unit !== undefined ? { unit: dto.unit.trim() } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.write(tx, {
        actor,
        action: 'plan.metric_catalog.updated',
        targetType: 'plan-metric-catalog',
        targetId: catalogId,
        beforeState: { name: current.name, unit: current.unit, isActive: current.isActive },
        afterState: { name: updated.name, unit: updated.unit, isActive: updated.isActive },
        requestId: requestId(request),
      });
      return updated;
    });
  }

  async submitForApproval(actor: ActorContext, planId: string, request?: ActorRequest) {
    this.assertStaff(actor);
    const current = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null },
      include: { branches: { select: { branchId: true } } },
    });
    if (!current) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });
    if (current.status !== PlanStatus.DRAFT && current.status !== PlanStatus.REJECTED) {
      throw new ConflictException({ code: 'PLAN_CANNOT_BE_SUBMITTED' });
    }
    await this.assertPlanBranchAccess(
      actor.id,
      'plans.manage',
      current.branches.map(({ branchId }) => branchId),
      current.createdById,
    );
    const version = current.approvalVersion + 1;

    const result = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.plan.updateMany({
        where: {
          id: planId,
          deletedAt: null,
          status: current.status,
          approvalVersion: current.approvalVersion,
        },
        data: { status: PlanStatus.PENDING_APPROVAL, approvalVersion: version },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'PLAN_STATE_CHANGED' });
      const updated = await tx.plan.findUniqueOrThrow({
        where: { id: planId },
        include: planInclude,
      });
      await this.audit.write(tx, {
        actor,
        action: 'plan.submitted_for_approval',
        targetType: 'plan',
        targetId: planId,
        branchId: current.branches[0]?.branchId ?? null,
        beforeState: { status: current.status, approvalVersion: current.approvalVersion },
        afterState: { status: PlanStatus.PENDING_APPROVAL, approvalVersion: version },
        requestId: requestId(request),
      });
      return updated;
    });
    return serializePlan(result);
  }

  async reviewApproval(
    actor: ActorContext,
    planId: string,
    dto: ReviewPlanDto,
    request?: ActorRequest,
  ) {
    this.assertStaff(actor);
    const reason = dto.reason?.trim() || null;
    if (dto.decision === PlanApprovalDecision.REJECTED && !reason) {
      throw new BadRequestException({ code: 'PLAN_REJECTION_REASON_REQUIRED' });
    }
    const current = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null },
      include: { branches: { select: { branchId: true } } },
    });
    if (!current) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });
    if (current.status !== PlanStatus.PENDING_APPROVAL) {
      throw new ConflictException({ code: 'PLAN_NOT_PENDING_APPROVAL' });
    }
    if (current.createdById === actor.id) {
      throw new ForbiddenException({ code: 'PLAN_CREATOR_CANNOT_APPROVE' });
    }
    await this.assertPlanBranchAccess(
      actor.id,
      'plans.approve',
      current.branches.map(({ branchId }) => branchId),
    );

    try {
      const approved = dto.decision === PlanApprovalDecision.APPROVED;
      const result = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.plan.updateMany({
          where: {
            id: planId,
            deletedAt: null,
            status: PlanStatus.PENDING_APPROVAL,
            approvalVersion: current.approvalVersion,
          },
          data: { status: approved ? PlanStatus.ACTIVE : PlanStatus.REJECTED },
        });
        if (changed.count !== 1) throw new ConflictException({ code: 'PLAN_STATE_CHANGED' });
        await tx.planApproval.create({
          data: {
            planId,
            reviewerId: actor.id,
            version: current.approvalVersion,
            decision: dto.decision,
            reason,
          },
        });
        const updated = await tx.plan.findUniqueOrThrow({
          where: { id: planId },
          include: planInclude,
        });
        await this.audit.write(tx, {
          actor,
          action: approved ? 'plan.approved' : 'plan.rejected',
          targetType: 'plan',
          targetId: planId,
          branchId: current.branches[0]?.branchId ?? null,
          reason,
          beforeState: { status: current.status, approvalVersion: current.approvalVersion },
          afterState: { status: updated.status, decision: dto.decision },
          requestId: requestId(request),
        });
        return updated;
      });
      return serializePlan(result);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'PLAN_ALREADY_REVIEWED' });
      }
      throw error;
    }
  }

  private async assertPlanBranchAccess(
    actorId: string,
    permission: string,
    branchIds: string[],
    ownerId?: string,
  ) {
    if (branchIds.length === 0) {
      await this.access.assertPermission(actorId, permission, AccessScope.ALL);
      return;
    }
    for (const branchId of branchIds) {
      await this.access.assertResourceAccess(actorId, permission, undefined, {
        ownerId,
        assigneeId: ownerId,
        branchId,
      });
    }
  }

  async softDelete(actor: ActorContext, planId: string, request?: ActorRequest) {
    this.assertStaff(actor);
    const deleteGrant = await this.prisma.userRoleGrant.findFirst({
      where: {
        userId: actor.id,
        branchId: null,
        role: { key: { in: ['ADMIN', 'OPERATOR'] } },
      },
      select: { id: true },
    });
    if (!deleteGrant) throw new ForbiddenException({ code: 'PLAN_DELETE_REQUIRES_ADMIN_OR_OPERATOR' });

    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findFirst({
        where: { id: planId, deletedAt: null },
        include: planInclude,
      });
      if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });
      const deletedAt = new Date();
      const result = await tx.plan.updateMany({
        where: { id: planId, deletedAt: null },
        data: { deletedAt },
      });
      if (result.count !== 1) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });
      await this.audit.write(tx, {
        actor,
        action: 'plan.deleted',
        targetType: 'plan',
        targetId: planId,
        branchId: plan.branches[0]?.branch.id ?? null,
        beforeState: {
          branchIds: plan.branches.map(({ branch }) => branch.id),
          periodStart: plan.periodStart.toISOString(),
          periodEnd: plan.periodEnd.toISOString(),
          status: plan.status,
        },
        afterState: { deletedAt: deletedAt.toISOString() },
        requestId: requestId(request),
      });
      return { id: planId, deletedAt };
    });
  }

  private assertStaff(actor: ActorContext) {
    if (actor.type !== 'STAFF') {
      throw new ForbiddenException({ code: 'STAFF_ACCESS_REQUIRED' });
    }
  }
}
