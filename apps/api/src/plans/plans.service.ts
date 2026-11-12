import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessScope, BranchStatus, PlanStatus, Prisma } from '../generated/prisma/client.js';
import { AccessControlService } from '../access-control/access-control.service.js';
import { ActorContext, ActorRequest } from '../common/actor-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { CreatePlanDto, PlanListQueryDto, UpdatePlanDto } from './plans.dto.js';

function requestId(request?: ActorRequest): string | null {
  const value = request?.headers['x-request-id'];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const planInclude = {
  branches: { include: { branch: { select: { id: true, code: true, name: true } } } },
  metrics: { orderBy: { name: 'asc' as const } },
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
    let visibleBranchIds: Set<string> | undefined;
    if (globallyAllowed) {
      if (query.branchId) where.branches = { some: { branchId: query.branchId } };
    } else {
      const branchGrants = await this.prisma.userRoleGrant.findMany({
        where: {
          userId: actor.id,
          branchId: { not: null },
          role: {
            permissions: {
              some: { permissionKey: 'plans.read', scope: AccessScope.BRANCH },
            },
          },
        },
        select: { branchId: true },
      });
      const branches = await this.prisma.branch.findMany({
        select: { id: true, parentId: true },
      });
      const allowedBranchIds = new Set(
        branchGrants.flatMap(({ branchId }) => branchId ? [branchId] : []),
      );
      const childrenByParent = new Map<string, string[]>();
      for (const branch of branches) {
        if (!branch.parentId) continue;
        const children = childrenByParent.get(branch.parentId) ?? [];
        children.push(branch.id);
        childrenByParent.set(branch.parentId, children);
      }
      const pendingBranches = [...allowedBranchIds];
      for (let index = 0; index < pendingBranches.length; index += 1) {
        for (const childId of childrenByParent.get(pendingBranches[index]) ?? []) {
          if (allowedBranchIds.has(childId)) continue;
          allowedBranchIds.add(childId);
          pendingBranches.push(childId);
        }
      }
      visibleBranchIds = allowedBranchIds;
      const filterBranchIds = query.branchId
        ? allowedBranchIds.has(query.branchId) ? [query.branchId] : []
        : [...allowedBranchIds];
      where.branches = { some: { branchId: { in: filterBranchIds } } };
    }

    const plans = await this.prisma.plan.findMany({
      where,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.take,
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      include: planInclude,
    });
    return plans.map((plan) => serializePlan(plan, visibleBranchIds));
  }

  async create(actor: ActorContext, dto: CreatePlanDto, request?: ActorRequest) {
    this.assertStaff(actor);
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodStart.getTime() >= periodEnd.getTime()) {
      throw new BadRequestException({ code: 'INVALID_PLAN_PERIOD' });
    }
    if (new Set(dto.metrics.map(({ name }) => name.trim().toLocaleLowerCase())).size !== dto.metrics.length) {
      throw new ConflictException({ code: 'DUPLICATE_PLAN_METRIC' });
    }

    const uniqueBranchIds = [...new Set(dto.branchIds)];
    for (const branchId of uniqueBranchIds) {
      await this.access.assertResourceAccess(
        actor.id,
        'plans.manage',
        undefined,
        { branchId },
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
              create: dto.metrics.map((metric) => ({
                name: metric.name.trim(),
                unit: metric.unit.trim(),
                target: new Prisma.Decimal(metric.target),
              })),
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
          { branchId },
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
