import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessScope, BranchStatus, Prisma } from '../generated/prisma/client.js';
import { AccessControlService } from '../access-control/access-control.service.js';
import { ActorContext, ActorRequest } from '../common/actor-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { CreatePlanDto, PlanListQueryDto } from './plans.dto.js';

function requestId(request?: ActorRequest): string | null {
  const value = request?.headers['x-request-id'];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const planInclude = {
  branch: { select: { id: true, code: true, name: true } },
  metrics: { orderBy: { name: 'asc' as const } },
};

function serializePlan<T extends { metrics: Array<{ target: Prisma.Decimal }> }>(plan: T) {
  return {
    ...plan,
    metrics: plan.metrics.map((metric) => ({ ...metric, target: metric.target.toNumber() })),
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
    const where: Prisma.PlanWhereInput = {};
    if (globallyAllowed) {
      if (query.branchId) where.branchId = query.branchId;
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
      where.branchId = query.branchId
        ? allowedBranchIds.has(query.branchId) ? query.branchId : { in: [] }
        : { in: [...allowedBranchIds] };
    }

    const plans = await this.prisma.plan.findMany({
      where,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.take,
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      include: planInclude,
    });
    return plans.map(serializePlan);
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

    await this.access.assertResourceAccess(
      actor.id,
      'plans.manage',
      undefined,
      { branchId: dto.branchId },
    );
    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
      select: { id: true, status: true },
    });
    if (!branch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND' });
    if (branch.status !== BranchStatus.ACTIVE) {
      throw new ConflictException({ code: 'PLAN_BRANCH_INACTIVE' });
    }

    try {
      const plan = await this.prisma.$transaction(async (tx) => {
        const created = await tx.plan.create({
          data: {
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            branchId: branch.id,
            createdById: actor.id,
            periodStart,
            periodEnd,
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
          branchId: created.branchId,
          afterState: {
            name: created.name,
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

  private assertStaff(actor: ActorContext) {
    if (actor.type !== 'STAFF') {
      throw new ForbiddenException({ code: 'STAFF_ACCESS_REQUIRED' });
    }
  }
}
