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
import { CreateTaskDto, KpiQueryDto, SubmitTaskResultDto, VerifyTaskResultDto } from './tasks.dto.js';
import { KpiPeriodType } from './plans.dto.js';

function requestId(request?: ActorRequest): string | null {
  const value = request?.headers['x-request-id'];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const taskInclude = {
  metric: { select: { id: true, name: true, unit: true } },
  branch: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, username: true, displayName: true } },
  assignments: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      assignee: { select: { id: true, username: true, displayName: true } },
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

function serializeAssignment<T extends {
  target: Prisma.Decimal | null;
  results: Array<{
    reportedValue: Prisma.Decimal;
    verification: { status: TaskVerificationStatus } | null;
  }>;
}>(task: {
  id: string;
  planId: string;
  metricId: string;
  branchId: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  createdAt: Date;
  metric: { id: string; name: string; unit: string };
  branch: { id: string; code: string; name: string };
  createdBy: { id: string; username: string; displayName: string };
}, assignment: T & {
  id: string;
  status: TaskStatus;
  updatedAt: Date;
  assignee: { id: string; username: string; displayName: string };
}) {
  return {
    id: assignment.id,
    taskId: task.id,
    planId: task.planId,
    metricId: task.metricId,
    branchId: task.branchId,
    title: task.title,
    description: task.description,
    status: assignment.status,
    target: assignment.target?.toNumber() ?? null,
    dueAt: task.dueAt,
    createdAt: task.createdAt,
    updatedAt: assignment.updatedAt,
    metric: task.metric,
    branch: task.branch,
    assignee: assignment.assignee,
    createdBy: task.createdBy,
    results: assignment.results.map((result) => ({
      ...result,
      reportedValue: result.reportedValue.toNumber(),
      verificationStatus: result.verification?.status ??
        TaskVerificationStatus.PENDING_VERIFICATION,
    })),
  };
}

const KPI_TIME_ZONE_OFFSET_MS = 7 * 60 * 60 * 1000;

function kpiPeriodBounds(
  query: KpiQueryDto,
  planStart: Date,
  planEnd: Date,
): { start: Date; end: Date } {
  if (query.periodType === KpiPeriodType.PLAN) {
    return { start: planStart, end: planEnd };
  }

  const date = query.date ?? new Date(Date.now() + KPI_TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestException({ code: 'KPI_PERIOD_DATE_INVALID' });
  }
  const [year, month, day] = date.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.toISOString().slice(0, 10) !== date) {
    throw new BadRequestException({ code: 'KPI_PERIOD_DATE_INVALID' });
  }

  let firstMonth = 1;
  let monthCount = 12;
  if (query.periodType === KpiPeriodType.MONTH) {
    firstMonth = month;
    monthCount = 1;
  } else if (query.periodType === KpiPeriodType.QUARTER) {
    firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
    monthCount = 3;
  }
  const start = new Date(Date.UTC(year, firstMonth - 1, 1) - KPI_TIME_ZONE_OFFSET_MS);
  const end = new Date(Date.UTC(year, firstMonth - 1 + monthCount, 1) - KPI_TIME_ZONE_OFFSET_MS);
  return {
    start: start > planStart ? start : planStart,
    end: end < planEnd ? end : planEnd,
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
      for (const assignment of task.assignments) {
        if (await this.access.hasResourceAccess(actor.id, 'tasks.read', undefined, {
          assigneeId: assignment.assigneeId,
          branchId: task.branchId,
        })) {
          visible.push(serializeAssignment(task, assignment));
        }
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

    const assignees = await this.prisma.user.findMany({
      where: {
        id: { in: dto.assigneeIds },
        status: 'ACTIVE',
        roleGrants: {
          some: {
            branchId: dto.branchId,
            role: { key: { not: 'CUSTOMER' } },
          },
        },
      },
      select: { id: true },
    });
    if (assignees.length !== dto.assigneeIds.length) {
      throw new BadRequestException({ code: 'TASK_ASSIGNEES_OUTSIDE_BRANCH' });
    }
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
          assigneeId: null,
          dueAt,
        },
      });
      await tx.taskAssignment.createMany({
        data: dto.assigneeIds.map((assigneeId) => ({
          taskId: created.id,
          assigneeId,
          target: new Prisma.Decimal(dto.target),
        })),
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
          assigneeIds: dto.assigneeIds,
          targetPerAssignee: dto.target,
          dueAt: dueAt?.toISOString() ?? null,
        },
        requestId: requestId(request),
      });
      return tx.task.findUniqueOrThrow({
        where: { id: created.id },
        include: taskInclude,
      });
    });
    return task.assignments.map((assignment) => serializeAssignment(task, assignment));
  }

  async submitResult(
    actor: ActorContext,
    assignmentId: string,
    dto: SubmitTaskResultDto,
    request?: ActorRequest,
  ) {
    this.assertStaff(actor);
    const assignment = await this.prisma.taskAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        task: {
          include: {
            plan: { select: { periodStart: true, periodEnd: true, deletedAt: true } },
            metric: { select: { unit: true } },
          },
        },
        results: {
          orderBy: { revision: 'desc' },
          take: 1,
          include: { verification: true },
        },
      },
    });
    const ownedAssignment = assignment ?? await this.prisma.taskAssignment.findFirst({
      where: { taskId: assignmentId, assigneeId: actor.id },
      include: {
        task: {
          include: {
            plan: { select: { periodStart: true, periodEnd: true, deletedAt: true } },
            metric: { select: { unit: true } },
          },
        },
        results: {
          orderBy: { revision: 'desc' },
          take: 1,
          include: { verification: true },
        },
      },
    });
    if (!ownedAssignment || ownedAssignment.task.plan.deletedAt) {
      throw new NotFoundException({ code: 'TASK_NOT_FOUND' });
    }
    const task = ownedAssignment.task;
    await this.access.assertResourceAccess(actor.id, 'tasks.submit', undefined, {
      assigneeId: ownedAssignment.assigneeId,
      branchId: task.branchId,
    });
    const occurredAt = new Date(dto.occurredAt);
    if (occurredAt < task.plan.periodStart || occurredAt >= task.plan.periodEnd) {
      throw new BadRequestException({ code: 'TASK_RESULT_OUTSIDE_PLAN_PERIOD' });
    }
    if (dto.reportedUnit.trim() !== task.metric.unit) {
      throw new BadRequestException({ code: 'TASK_RESULT_UNIT_MISMATCH' });
    }
    const latest = ownedAssignment.results[0];
    if (ownedAssignment.status === TaskStatus.COMPLETED &&
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
            taskId: task.id,
            assignmentId: ownedAssignment.id,
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
        await tx.taskAssignment.update({
          where: { id: ownedAssignment.id },
          data: { status: TaskStatus.IN_PROGRESS },
        });
        await tx.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.IN_PROGRESS },
        });
        await this.audit.write(tx, {
          actor,
          action: 'task.result.submitted',
          targetType: 'task-result',
          targetId: created.id,
          branchId: task.branchId,
          afterState: {
            taskId: task.id,
            assignmentId: ownedAssignment.id,
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
        task: { include: { plan: { select: { deletedAt: true } } } },
        assignment: {
          include: {
            results: { orderBy: { revision: 'desc' }, take: 1, select: { id: true } },
          },
        },
        verification: true,
      },
    });
    if (!result || result.task.plan.deletedAt) {
      throw new NotFoundException({ code: 'TASK_RESULT_NOT_FOUND' });
    }
    if (result.assignment.results[0]?.id !== result.id) {
      throw new ConflictException({ code: 'TASK_RESULT_NOT_LATEST' });
    }
    if (result.verification) {
      throw new ConflictException({ code: 'TASK_RESULT_ALREADY_REVIEWED' });
    }
    if (result.submittedById === actor.id) {
      throw new ForbiddenException({ code: 'TASK_RESULT_SELF_VERIFICATION' });
    }
    await this.access.assertResourceAccess(actor.id, 'tasks.verify', undefined, {
      assigneeId: result.assignment.assigneeId,
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
        await tx.taskAssignment.update({
          where: { id: result.assignmentId },
          data: {
            status: dto.status === TaskVerificationStatus.VERIFIED
              ? TaskStatus.COMPLETED
              : TaskStatus.IN_PROGRESS,
          },
        });
        const incompleteAssignments = await tx.taskAssignment.count({
          where: {
            taskId: result.taskId,
            status: { not: TaskStatus.COMPLETED },
          },
        });
        await tx.task.update({
          where: { id: result.taskId },
          data: { status: incompleteAssignments === 0 ? TaskStatus.COMPLETED : TaskStatus.IN_PROGRESS },
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

  async kpi(actor: ActorContext, planId: string, query: KpiQueryDto = new KpiQueryDto()) {
    this.assertStaff(actor);
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null },
      include: {
        branches: { select: { branchId: true } },
        metrics: { orderBy: { name: 'asc' } },
      },
    });
    if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });

    const hasGlobalScope = await this.access.hasPermission(actor.id, 'kpi.read', AccessScope.ALL);
    const branchWideIds: string[] = [];
    const assignedIds: string[] = [];
    for (const { branchId } of plan.branches) {
      if (await this.access.hasPermission(actor.id, 'kpi.read', AccessScope.BRANCH, branchId)) {
        branchWideIds.push(branchId);
      }
      if (await this.access.hasPermission(actor.id, 'kpi.read', AccessScope.ASSIGNED, branchId)) {
        assignedIds.push(branchId);
      }
    }

    const assignedOnly = !hasGlobalScope && branchWideIds.length === 0;
    const permittedBranchIds = hasGlobalScope
      ? plan.branches.map(({ branchId }) => branchId)
      : assignedOnly
        ? assignedIds
        : branchWideIds;
    if (permittedBranchIds.length === 0) {
      throw new ForbiddenException({ code: 'RESOURCE_SCOPE_DENIED' });
    }
    if (!assignedOnly && permittedBranchIds.length !== plan.branches.length) {
      throw new ForbiddenException({ code: 'KPI_REQUIRES_FULL_PLAN_BRANCH_SCOPE' });
    }
    const period = kpiPeriodBounds(query, plan.periodStart, plan.periodEnd);

    const assignments = await this.prisma.taskAssignment.findMany({
      where: {
        task: {
          planId,
          branchId: { in: permittedBranchIds },
        },
        ...(assignedOnly ? { assigneeId: actor.id } : {}),
      },
      select: {
        target: true,
        task: { select: { metricId: true } },
        results: {
          where: {
            verification: { is: { status: TaskVerificationStatus.VERIFIED } },
          },
          orderBy: { revision: 'desc' },
          take: 1,
          select: { reportedValue: true, occurredAt: true },
        },
      },
    });
    const totals = new Map<string, Prisma.Decimal>();
    const personalTargets = new Map<string, Prisma.Decimal>();
    const metricsWithoutCompletePersonalTarget = new Set<string>();
    for (const assignment of assignments) {
      if (assignedOnly) {
        const metricIdForTarget = assignment.task.metricId;
        if (assignment.target === null) {
          metricsWithoutCompletePersonalTarget.add(metricIdForTarget);
        } else {
          personalTargets.set(
            metricIdForTarget,
            (personalTargets.get(metricIdForTarget) ?? new Prisma.Decimal(0)).plus(assignment.target),
          );
        }
      }
      const latest = assignment.results[0];
      if (!latest || latest.occurredAt < period.start || latest.occurredAt >= period.end) continue;
      totals.set(
        assignment.task.metricId,
        (totals.get(assignment.task.metricId) ?? new Prisma.Decimal(0)).plus(latest.reportedValue),
      );
    }

    return plan.metrics.map((metric) => {
      const verifiedTotal = totals.get(metric.id) ?? new Prisma.Decimal(0);
      const target = assignedOnly
        ? metricsWithoutCompletePersonalTarget.has(metric.id)
          ? null
          : personalTargets.get(metric.id) ?? null
        : metric.target;
      const remaining = target?.minus(verifiedTotal) ?? null;
      return {
        metricId: metric.id,
        name: metric.name,
        unit: metric.unit,
        target: target?.toNumber() ?? null,
        verifiedTotal: verifiedTotal.toNumber(),
        remaining: remaining ? (remaining.isPositive() ? remaining : new Prisma.Decimal(0)).toNumber() : null,
        achievementRate: !target || target.isZero()
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
