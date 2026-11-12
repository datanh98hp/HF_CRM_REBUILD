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
  FileScanStatus,
  PlanStatus,
  Prisma,
  TaskStatus,
  TaskVerificationStatus,
} from '../generated/prisma/client.js';
import { AccessControlService } from '../access-control/access-control.service.js';
import { ActorContext, ActorRequest } from '../common/actor-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { CreateTaskDto, SubmitTaskResultDto, VerifyTaskResultDto } from './tasks.dto.js';

function requestId(request?: ActorRequest): string | null {
  const value = request?.headers['x-request-id'];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const taskInclude = {
  metric: { select: { id: true, name: true, unit: true } },
  branch: { select: { id: true, code: true, name: true } },
  assignee: { select: { id: true, username: true, displayName: true } },
  createdBy: { select: { id: true, username: true, displayName: true } },
  results: {
    orderBy: { revision: 'desc' as const },
    include: {
      submittedBy: { select: { id: true, username: true, displayName: true } },
      verification: {
        include: { verifier: { select: { id: true, username: true, displayName: true } } },
      },
      evidenceFiles: {
        orderBy: { createdAt: 'asc' as const },
        include: {
          file: {
            select: {
              id: true,
              originalName: true,
              mimeType: true,
              sizeBytes: true,
              scanStatus: true,
              scannedAt: true,
              expiresAt: true,
              legalHold: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  },
};

const resultEvidenceInclude = {
  evidenceFiles: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      file: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          scanStatus: true,
          scannedAt: true,
          expiresAt: true,
          legalHold: true,
          deletedAt: true,
        },
      },
    },
  },
};

function serializeTask<T extends {
  results: Array<{
    reportedValue: Prisma.Decimal;
    verification: { status: TaskVerificationStatus } | null;
  }>;
}>(task: T) {
  return {
    ...task,
    results: task.results.map((result) => ({
      ...result,
      reportedValue: result.reportedValue.toNumber(),
      verificationStatus: result.verification?.status ??
        TaskVerificationStatus.PENDING_VERIFICATION,
    })),
  };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessControlService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: ActorContext, planId: string) {
    this.assertStaff(actor);
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null },
      select: { id: true },
    });
    if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });

    const tasks = await this.prisma.task.findMany({
      where: { planId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: taskInclude,
    });
    const visible = [];
    for (const task of tasks) {
      if (await this.access.hasResourceAccess(actor.id, 'tasks.read', undefined, {
        ownerId: task.createdById,
        assigneeId: task.assigneeId,
        branchId: task.branchId,
      })) {
        visible.push(serializeTask(task));
      }
    }
    return visible;
  }

  async create(
    actor: ActorContext,
    planId: string,
    dto: CreateTaskDto,
    request?: ActorRequest,
  ) {
    this.assertStaff(actor);
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null },
      include: {
        branches: { select: { branchId: true, branch: { select: { status: true } } } },
        metrics: { select: { id: true, name: true, unit: true } },
      },
    });
    if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });
    if (plan.status !== PlanStatus.ACTIVE) {
      throw new ConflictException({ code: 'TASK_PLAN_NOT_ACTIVE' });
    }
    const metric = plan.metrics.find(({ id }) => id === dto.metricId);
    if (!metric) throw new BadRequestException({ code: 'TASK_METRIC_NOT_IN_PLAN' });
    const planBranch = plan.branches.find(({ branchId }) => branchId === dto.branchId);
    if (!planBranch) throw new BadRequestException({ code: 'TASK_BRANCH_NOT_IN_PLAN' });
    if (planBranch.branch.status !== BranchStatus.ACTIVE) {
      throw new ConflictException({ code: 'TASK_BRANCH_INACTIVE' });
    }
    await this.access.assertResourceAccess(
      actor.id,
      'tasks.manage',
      undefined,
      { branchId: dto.branchId },
    );

    const assigneeId = dto.assigneeId ?? actor.id;
    const assignee = await this.prisma.user.findFirst({
      where: { id: assigneeId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!assignee) throw new NotFoundException({ code: 'TASK_ASSIGNEE_NOT_FOUND' });
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dueAt && (dueAt < plan.periodStart || dueAt >= plan.periodEnd)) {
      throw new BadRequestException({ code: 'TASK_DUE_DATE_OUTSIDE_PLAN_PERIOD' });
    }

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          planId,
          metricId: metric.id,
          branchId: dto.branchId,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          createdById: actor.id,
          assigneeId,
          dueAt,
        },
        include: taskInclude,
      });
      await this.audit.write(tx, {
        actor,
        action: 'task.created',
        targetType: 'task',
        targetId: created.id,
        branchId: created.branchId,
        afterState: {
          planId,
          metricId: metric.id,
          assigneeId,
          dueAt: dueAt?.toISOString() ?? null,
        },
        requestId: requestId(request),
      });
      return created;
    });
    return serializeTask(task);
  }

  async submitResult(
    actor: ActorContext,
    taskId: string,
    dto: SubmitTaskResultDto,
    request?: ActorRequest,
  ) {
    this.assertStaff(actor);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        plan: { select: { periodStart: true, periodEnd: true, deletedAt: true } },
        metric: { select: { unit: true } },
        results: {
          orderBy: { revision: 'desc' },
          take: 1,
          include: { verification: true },
        },
      },
    });
    if (!task || task.plan.deletedAt) throw new NotFoundException({ code: 'TASK_NOT_FOUND' });
    await this.access.assertResourceAccess(actor.id, 'tasks.submit', undefined, {
      ownerId: task.createdById,
      assigneeId: task.assigneeId,
      branchId: task.branchId,
    });
    const occurredAt = new Date(dto.occurredAt);
    if (occurredAt < task.plan.periodStart || occurredAt >= task.plan.periodEnd) {
      throw new BadRequestException({ code: 'TASK_RESULT_OUTSIDE_PLAN_PERIOD' });
    }
    if (dto.reportedUnit.trim() !== task.metric.unit) {
      throw new BadRequestException({ code: 'TASK_RESULT_UNIT_MISMATCH' });
    }
    const latest = task.results[0];
    if (task.status === TaskStatus.COMPLETED &&
      latest?.verification?.status !== TaskVerificationStatus.VERIFIED) {
      throw new ConflictException({ code: 'TASK_ALREADY_COMPLETED' });
    }
    if (latest && !latest.verification) {
      throw new ConflictException({ code: 'TASK_RESULT_AWAITING_VERIFICATION' });
    }
    if (latest?.verification?.status === TaskVerificationStatus.PENDING_VERIFICATION) {
      throw new ConflictException({ code: 'TASK_RESULT_AWAITING_VERIFICATION' });
    }

    const evidenceFileIds = dto.evidenceFileIds ?? [];
    if (evidenceFileIds.length > 0) {
      const availableFiles = await this.prisma.fileAsset.findMany({
        where: {
          id: { in: evidenceFileIds },
          branchId: task.branchId,
          scanStatus: FileScanStatus.AVAILABLE,
          deletedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (availableFiles.length !== evidenceFileIds.length) {
        throw new BadRequestException({ code: 'TASK_EVIDENCE_FILE_UNAVAILABLE' });
      }
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const created = await tx.taskResult.create({
          data: {
            taskId,
            revision: (latest?.revision ?? 0) + 1,
            submittedById: actor.id,
            reportedValue: new Prisma.Decimal(dto.reportedValue),
            reportedUnit: dto.reportedUnit.trim(),
            narrative: dto.narrative.trim(),
            occurredAt,
            ...(evidenceFileIds.length > 0 ? {
              evidenceFiles: {
                create: evidenceFileIds.map((fileId) => ({
                  file: { connect: { id: fileId } },
                  linkedBy: { connect: { id: actor.id } },
                })),
              },
            } : {}),
          },
          include: resultEvidenceInclude,
        });
        await tx.task.update({
          where: { id: taskId },
          data: { status: TaskStatus.IN_PROGRESS },
        });
        await this.audit.write(tx, {
          actor,
          action: 'task.result.submitted',
          targetType: 'task-result',
          targetId: created.id,
          branchId: task.branchId,
          afterState: {
            taskId,
            revision: created.revision,
            reportedValue: dto.reportedValue,
            reportedUnit: dto.reportedUnit.trim(),
            occurredAt: occurredAt.toISOString(),
            evidenceFileIds,
          },
          requestId: requestId(request),
        });
        return created;
      });
      return {
        ...result,
        reportedValue: result.reportedValue.toNumber(),
        verificationStatus: TaskVerificationStatus.PENDING_VERIFICATION,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'TASK_RESULT_CONCURRENT_SUBMISSION' });
      }
      throw error;
    }
  }

  async verifyResult(
    actor: ActorContext,
    resultId: string,
    dto: VerifyTaskResultDto,
    request?: ActorRequest,
  ) {
    this.assertStaff(actor);
    if (dto.status === TaskVerificationStatus.PENDING_VERIFICATION) {
      throw new BadRequestException({ code: 'TASK_VERIFICATION_DECISION_REQUIRED' });
    }
    const requiresReason = dto.status !== TaskVerificationStatus.VERIFIED;
    const reason = dto.reason?.trim() || null;
    if (requiresReason && !reason) {
      throw new BadRequestException({ code: 'TASK_VERIFICATION_REASON_REQUIRED' });
    }

    const result = await this.prisma.taskResult.findUnique({
      where: { id: resultId },
      include: {
        task: {
          include: {
            plan: { select: { deletedAt: true } },
            results: { orderBy: { revision: 'desc' }, take: 1, select: { id: true } },
          },
        },
        verification: true,
      },
    });
    if (!result || result.task.plan.deletedAt) {
      throw new NotFoundException({ code: 'TASK_RESULT_NOT_FOUND' });
    }
    if (result.task.results[0]?.id !== result.id) {
      throw new ConflictException({ code: 'TASK_RESULT_NOT_LATEST' });
    }
    if (result.verification) {
      throw new ConflictException({ code: 'TASK_RESULT_ALREADY_REVIEWED' });
    }
    if (result.submittedById === actor.id) {
      throw new ForbiddenException({ code: 'TASK_RESULT_SELF_VERIFICATION' });
    }
    await this.access.assertResourceAccess(actor.id, 'tasks.verify', undefined, {
      ownerId: result.task.createdById,
      assigneeId: result.task.assigneeId,
      branchId: result.task.branchId,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const verification = await tx.taskVerification.create({
          data: {
            resultId,
            verifierId: actor.id,
            status: dto.status,
            reason,
          },
          include: { verifier: { select: { id: true, username: true, displayName: true } } },
        });
        await tx.task.update({
          where: { id: result.taskId },
          data: {
            status: dto.status === TaskVerificationStatus.VERIFIED
              ? TaskStatus.COMPLETED
              : TaskStatus.IN_PROGRESS,
          },
        });
        await this.audit.write(tx, {
          actor,
          action: 'task.result.reviewed',
          targetType: 'task-result',
          targetId: resultId,
          branchId: result.task.branchId,
          reason,
          afterState: { status: dto.status },
          requestId: requestId(request),
        });
        return verification;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'TASK_RESULT_ALREADY_REVIEWED' });
      }
      throw error;
    }
  }

  async kpi(actor: ActorContext, planId: string) {
    this.assertStaff(actor);
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null },
      include: {
        branches: { select: { branchId: true } },
        metrics: { orderBy: { name: 'asc' } },
      },
    });
    if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });

    const permittedBranchIds: string[] = [];
    for (const { branchId } of plan.branches) {
      if (await this.access.hasResourceAccess(actor.id, 'kpi.read', undefined, { branchId })) {
        permittedBranchIds.push(branchId);
      }
    }
    if (permittedBranchIds.length === 0) {
      await this.access.assertPermission(actor.id, 'kpi.read', AccessScope.ALL);
    }
    if (permittedBranchIds.length !== plan.branches.length) {
      throw new ForbiddenException({ code: 'KPI_REQUIRES_FULL_PLAN_BRANCH_SCOPE' });
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        planId,
        branchId: { in: permittedBranchIds },
      },
      select: {
        metricId: true,
        results: {
          orderBy: { revision: 'desc' },
          take: 1,
          include: {
            verification: { select: { status: true } },
          },
        },
      },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const task of tasks) {
      const latest = task.results[0];
      if (latest?.verification?.status !== TaskVerificationStatus.VERIFIED) continue;
      totals.set(
        task.metricId,
        (totals.get(task.metricId) ?? new Prisma.Decimal(0)).plus(latest.reportedValue),
      );
    }

    return plan.metrics.map((metric) => {
      const verifiedTotal = totals.get(metric.id) ?? new Prisma.Decimal(0);
      const target = metric.target;
      const remaining = target.minus(verifiedTotal);
      return {
        metricId: metric.id,
        name: metric.name,
        unit: metric.unit,
        target: target.toNumber(),
        verifiedTotal: verifiedTotal.toNumber(),
        remaining: (remaining.isPositive() ? remaining : new Prisma.Decimal(0)).toNumber(),
        achievementRate: target.isZero()
          ? null
          : verifiedTotal.dividedBy(target).times(100).toDecimalPlaces(2).toNumber(),
      };
    });
  }

  private assertStaff(actor: ActorContext) {
    if (actor.type !== 'STAFF') {
      throw new ForbiddenException({ code: 'STAFF_ACCESS_REQUIRED' });
    }
  }
}
