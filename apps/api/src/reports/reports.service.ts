import { ForbiddenException, Injectable, BadRequestException } from '@nestjs/common';
import { AccessScope, Prisma } from '../generated/prisma/client.js';
import { ActorContext } from '../common/actor-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { ReportPeriod, ReportQueryDto, ReportType } from './reports.dto.js';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 500;

type PeriodBounds = { start: Date; endExclusive: Date };
type ReportScope = {
  all: boolean;
  branchIds: string[];
  ownAll: boolean;
  ownBranchIds: string[];
  assignedAll: boolean;
  assignedBranchIds: string[];
};
type ReportSelection = { branchId?: string; adviserId?: string };
type ReportFilterOption = { id: string; name: string };
type ReportFilterMetadata = {
  access: 'self' | 'branch' | 'all';
  branchId: string | null;
  adviserId: string | null;
  branches: ReportFilterOption[];
  advisers: ReportFilterOption[];
};
type ReportFilterContext = { selection: ReportSelection; metadata: ReportFilterMetadata };
type TrendPoint = { label: string; value: number };
type TrendSeries = { id: string; label: string; values: number[] };
type ReportMetric = {
  key: string;
  label: string;
  value: number | string | null;
  format: 'number' | 'currency' | 'percent';
  detail?: string;
};
type ReportTableColumn = {
  key: string;
  label: string;
  format?: 'number' | 'currency' | 'percent' | 'staff' | 'status' | 'text';
};
type ReportTable = {
  title: string;
  description?: string;
  columns: ReportTableColumn[];
  rows: Array<Record<string, string | number | null>>;
  footer?: Record<string, string | number | null>;
};
type ReportResult = {
  report: ReportType;
  period: { type: ReportPeriod; offset: number; start: string; endExclusive: string };
  metrics: ReportMetric[];
  trendTitle: string;
  trendFormat: 'number' | 'currency';
  trend: TrendPoint[];
  trendSeries?: TrendSeries[];
  statuses: Array<{ key: string; label: string; count: number; percentage: number }>;
  table: ReportTable;
  staffTable?: ReportTable;
};
type ReportPayload = ReportResult & { filters: ReportFilterMetadata };
type AssignmentAtEvent = {
  id: string;
  adviserId: string;
  branchId: string;
  isPrimary: boolean;
  assignedAt: Date;
  endedAt: Date | null;
  adviser: { displayName: string };
};
type AttributedDisbursement = {
  id: string;
  amount: Prisma.Decimal;
  disbursedAt: Date;
  owner: AssignmentAtEvent | null;
};

export function assignmentAt(assignments: AssignmentAtEvent[], instant: Date): AssignmentAtEvent | null {
  return assignments
    .filter((assignment) => assignment.isPrimary
      && assignment.assignedAt <= instant
      && (!assignment.endedAt || assignment.endedAt > instant))
    .sort((left, right) => right.assignedAt.getTime() - left.assignedAt.getTime()
      || left.id.localeCompare(right.id))[0] ?? null;
}

export function resolveReportSelection(
  query: ReportSelection,
  branches: ReportFilterOption[],
  advisers: ReportFilterOption[],
): ReportSelection {
  if (query.branchId && !branches.some(({ id }) => id === query.branchId)) {
    throw new ForbiddenException({ code: 'REPORT_BRANCH_SCOPE_DENIED' });
  }
  if (query.adviserId && !advisers.some(({ id }) => id === query.adviserId)) {
    throw new ForbiddenException({ code: 'REPORT_ADVISER_SCOPE_DENIED' });
  }
  return {
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.adviserId ? { adviserId: query.adviserId } : {}),
  };
}

export function disbursementWithinScope(
  actorId: string,
  scope: ReportScope,
  selection: ReportSelection,
  owner: AssignmentAtEvent | null,
) {
  if (!owner) return false;
  const inScope = scope.all
    || scope.branchIds.includes(owner.branchId)
    || ((scope.ownAll || scope.ownBranchIds.includes(owner.branchId)) && owner.adviserId === actorId)
    || ((scope.assignedAll || scope.assignedBranchIds.includes(owner.branchId)) && owner.adviserId === actorId);
  return inScope
    && (!selection.branchId || selection.branchId === owner.branchId)
    && (!selection.adviserId || selection.adviserId === owner.adviserId);
}

const customerStatusLabels: Record<string, string> = {
  NEW: 'Mới',
  CONTACTED: 'Đã liên hệ',
  QUALIFIED: 'Tiềm năng',
  IN_PROGRESS: 'Đang tư vấn',
  CONVERTED: 'Đã chuyển đổi',
  CLOSED: 'Đã đóng',
};
const planStatusLabels: Record<string, string> = {
  DRAFT: 'Bản nháp',
  PENDING_APPROVAL: 'Chờ duyệt',
  ACTIVE: 'Đang thực hiện',
  REJECTED: 'Bị từ chối',
  ARCHIVED: 'Đã lưu trữ',
};
const contractStatusLabels: Record<string, string> = {
  PENDING_REVIEW: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  AWAITING_CUSTOMER_CONFIRMATION: 'Chờ khách xác nhận',
  COMPLETED: 'Hoàn tất',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

function vietnameseCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function localMidnightUtc(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day) - VIETNAM_OFFSET_MS);
}

export function getReportPeriodBounds(
  period: ReportPeriod,
  offset: number,
  now = new Date(),
): PeriodBounds {
  const current = vietnameseCalendarDate(now);
  const anchor = new Date(Date.UTC(current.year, current.month - 1, current.day));

  if (period === ReportPeriod.DAY) {
    anchor.setUTCDate(anchor.getUTCDate() + offset);
    return {
      start: localMidnightUtc(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()),
      endExclusive: localMidnightUtc(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + 1),
    };
  }

  if (period === ReportPeriod.WEEK) {
    const mondayOffset = (anchor.getUTCDay() + 6) % 7;
    anchor.setUTCDate(anchor.getUTCDate() - mondayOffset + offset * 7);
    return {
      start: localMidnightUtc(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()),
      endExclusive: localMidnightUtc(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + 7),
    };
  }

  if (period === ReportPeriod.MONTH) {
    const monthIndex = current.year * 12 + current.month - 1 + offset;
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex - year * 12;
    return {
      start: localMidnightUtc(year, month, 1),
      endExclusive: localMidnightUtc(year, month + 1, 1),
    };
  }

  if (period === ReportPeriod.QUARTER) {
    const startMonth = Math.floor((current.month - 1) / 3) * 3 + offset * 3;
    const monthIndex = current.year * 12 + startMonth;
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex - year * 12;
    return {
      start: localMidnightUtc(year, month, 1),
      endExclusive: localMidnightUtc(year, month + 3, 1),
    };
  }

  if (period === ReportPeriod.YEAR) {
    const year = current.year + offset;
    return {
      start: localMidnightUtc(year, 0, 1),
      endExclusive: localMidnightUtc(year + 1, 0, 1),
    };
  }

  throw new BadRequestException({ code: 'REPORT_PERIOD_INVALID' });
}

function amount(value: Prisma.Decimal | null | undefined) {
  return value ?? new Prisma.Decimal(0);
}

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 10000) / 100 : 0;
}

function groupCounts<T>(rows: T[], keyOf: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function localParts(value: Date) {
  const local = new Date(value.getTime() + VIETNAM_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
  };
}

function formatLocalDate(value: Date) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(value);
}

function trendBucketIndex(value: Date, start: Date, period: ReportPeriod) {
  const local = localParts(value);
  const localStart = localParts(start);
  if (period === ReportPeriod.DAY) return Math.min(5, Math.floor(local.hour / 4));
  if (period === ReportPeriod.WEEK) {
    const delta = Date.UTC(local.year, local.month, local.day) - Date.UTC(localStart.year, localStart.month, localStart.day);
    return Math.max(0, Math.min(6, Math.floor(delta / DAY_MS)));
  }
  if (period === ReportPeriod.MONTH) return Math.min(4, Math.floor((local.day - 1) / 7));
  if (period === ReportPeriod.QUARTER) return (local.month - localStart.month + 12) % 12;
  return local.month;
}

function trendLabels(period: ReportPeriod, start: Date): string[] {
  if (period === ReportPeriod.DAY) return ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];
  if (period === ReportPeriod.MONTH) return ['01–07', '08–14', '15–21', '22–28', '29–cuối tháng'];
  if (period === ReportPeriod.QUARTER) {
    const month = localParts(start).month;
    return [0, 1, 2].map((index) => `T${((month + index) % 12) + 1}`);
  }
  if (period === ReportPeriod.YEAR) return Array.from({ length: 12 }, (_, index) => `T${index + 1}`);
  const localStart = localParts(start);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(localStart.year, localStart.month, localStart.day + index));
    const weekday = new Intl.DateTimeFormat('vi-VN', { weekday: 'short', timeZone: 'UTC' }).format(date);
    return `${weekday} ${String(date.getUTCDate()).padStart(2, '0')}`;
  });
}

function makeTrend<T>(
  rows: T[],
  period: ReportPeriod,
  bounds: PeriodBounds,
  dateOf: (row: T) => Date,
  valueOf: (row: T) => number,
): TrendPoint[] {
  const labels = trendLabels(period, bounds.start);
  const buckets = labels.map((label) => ({ label, value: 0 }));
  for (const row of rows) {
    const index = trendBucketIndex(dateOf(row), bounds.start, period);
    if (buckets[index]) buckets[index].value += valueOf(row);
  }
  return buckets;
}

function createStatusRows(
  counts: Map<string, number>,
  labels: Record<string, string>,
  total: number,
) {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labels[key] ?? key, count, percentage: percentage(count, total) }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'vi'));
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(actor: ActorContext, reportTypeValue: string, query: ReportQueryDto): Promise<ReportPayload> {
    if (actor.type !== 'STAFF') throw new ForbiddenException({ code: 'STAFF_PERMISSION_REQUIRED' });
    if (!Object.values(ReportType).includes(reportTypeValue as ReportType)) {
      throw new BadRequestException({ code: 'REPORT_TYPE_INVALID' });
    }

    const reportType = reportTypeValue as ReportType;
    const period = query.period ?? ReportPeriod.MONTH;
    const offset = query.offset ?? 0;
    const bounds = getReportPeriodBounds(period, offset);
    const scope = await this.getScope(actor.id);
    const filterContext = await this.resolveReportFilters(actor, scope, query);
    const report = reportType === ReportType.CUSTOMERS
      ? await this.customerReport(actor, scope, filterContext.selection, period, offset, bounds)
      : reportType === ReportType.PLANS
        ? await this.planReport(actor, scope, filterContext.selection, period, offset, bounds)
        : reportType === ReportType.LOANS
          ? await this.loanReport(actor, scope, filterContext, period, offset, bounds)
          : await this.summaryReport(actor, scope, filterContext, period, offset, bounds);
    return { ...report, filters: filterContext.metadata };
  }

  private async getScope(userId: string): Promise<ReportScope> {
    const grants = await this.prisma.userRoleGrant.findMany({
      where: {
        userId,
        role: { permissions: { some: { permissionKey: 'reports.read' } } },
      },
      select: {
        branchId: true,
        role: {
          select: {
            permissions: {
              where: { permissionKey: 'reports.read' },
              select: { scope: true },
            },
          },
        },
      },
    });

    const scope: ReportScope = {
      all: false,
      branchIds: [],
      ownAll: false,
      ownBranchIds: [],
      assignedAll: false,
      assignedBranchIds: [],
    };
    const branchIds = new Set<string>();
    const ownBranchIds = new Set<string>();
    const assignedBranchIds = new Set<string>();
    const anchors = new Set(grants.map(({ branchId }) => branchId).filter((value): value is string => value !== null));
    const branches = anchors.size
      ? await this.prisma.branch.findMany({ select: { id: true, parentId: true } })
      : [];
    const childrenByParent = new Map<string, string[]>();
    for (const branch of branches) {
      if (!branch.parentId) continue;
      const children = childrenByParent.get(branch.parentId) ?? [];
      children.push(branch.id);
      childrenByParent.set(branch.parentId, children);
    }
    const expand = (rootId: string) => {
      const result = new Set<string>([rootId]);
      const pending = [rootId];
      for (let index = 0; index < pending.length; index += 1) {
        for (const childId of childrenByParent.get(pending[index]) ?? []) {
          if (result.has(childId)) continue;
          result.add(childId);
          pending.push(childId);
        }
      }
      return result;
    };

    for (const grant of grants) {
      for (const permission of grant.role.permissions) {
        if (permission.scope === AccessScope.ALL && grant.branchId === null) scope.all = true;
        if (!grant.branchId) {
          if (permission.scope === AccessScope.OWN) scope.ownAll = true;
          if (permission.scope === AccessScope.ASSIGNED) scope.assignedAll = true;
          continue;
        }
        const expanded = expand(grant.branchId);
        const destination = permission.scope === AccessScope.BRANCH
          ? branchIds
          : permission.scope === AccessScope.OWN
            ? ownBranchIds
            : permission.scope === AccessScope.ASSIGNED
              ? assignedBranchIds
              : null;
        if (destination) for (const id of expanded) destination.add(id);
      }
    }
    scope.branchIds = [...branchIds];
    scope.ownBranchIds = [...ownBranchIds];
    scope.assignedBranchIds = [...assignedBranchIds];
    if (!scope.all && !scope.branchIds.length && !scope.ownAll && !scope.ownBranchIds.length
      && !scope.assignedAll && !scope.assignedBranchIds.length) {
      throw new ForbiddenException({ code: 'RESOURCE_SCOPE_DENIED' });
    }
    return scope;
  }

  private async resolveReportFilters(
    actor: ActorContext,
    scope: ReportScope,
    query: ReportQueryDto,
  ): Promise<ReportFilterContext> {
    const access = scope.all ? 'all' : scope.branchIds.length ? 'branch' : 'self';
    const self = access === 'self'
      ? await this.prisma.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: { id: true, displayName: true },
      })
      : null;
    const branches = access === 'self'
      ? []
      : await this.prisma.branch.findMany({
        where: scope.all ? {} : { id: { in: scope.branchIds } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      });
    const branchSelection = resolveReportSelection(
      query.branchId ? { branchId: query.branchId } : {},
      branches,
      [],
    );
    const grants = access === 'self'
      ? []
      : await this.prisma.userRoleGrant.findMany({
        where: {
          role: { key: 'ADVISING' },
          user: { deletedAt: null, status: 'ACTIVE' },
          ...(scope.all ? {} : { branchId: { in: scope.branchIds } }),
        },
        orderBy: { user: { displayName: 'asc' } },
        select: { branchId: true, user: { select: { id: true, displayName: true } } },
      });
    const advisersById = new Map<string, ReportFilterOption>();
    for (const grant of grants) {
      if (!grant.branchId || (branchSelection.branchId && grant.branchId !== branchSelection.branchId)) continue;
      advisersById.set(grant.user.id, { id: grant.user.id, name: grant.user.displayName });
    }
    const advisers = [...advisersById.values()].sort((left, right) => left.name.localeCompare(right.name, 'vi'));
    const selection = resolveReportSelection(query, branches, advisers);
    return {
      selection,
      metadata: {
        access,
        branchId: selection.branchId ?? null,
        adviserId: selection.adviserId ?? null,
        branches,
        advisers: self ? [{ id: self.id, name: self.displayName }] : advisers,
      },
    };
  }

  private customerScope(
    actor: ActorContext,
    scope: ReportScope,
    selection: ReportSelection,
  ): Prisma.CustomerWhereInput {
    const clauses: Prisma.CustomerWhereInput[] = [];
    if (!scope.all) {
      const accessClauses: Prisma.CustomerWhereInput[] = [];
      if (scope.branchIds.length) accessClauses.push({ branchId: { in: scope.branchIds } });
      if (scope.ownAll) accessClauses.push({ createdById: actor.id });
      else if (scope.ownBranchIds.length) {
        accessClauses.push({ createdById: actor.id, branchId: { in: scope.ownBranchIds } });
      }
      if (scope.assignedAll) {
        accessClauses.push({ assignments: { some: { adviserId: actor.id, endedAt: null } } });
      } else if (scope.assignedBranchIds.length) {
        accessClauses.push({
          branchId: { in: scope.assignedBranchIds },
          assignments: { some: { adviserId: actor.id, endedAt: null } },
        });
      }
      clauses.push(accessClauses.length ? { OR: accessClauses } : { id: { in: [] } });
    }
    if (selection.branchId) clauses.push({ branchId: selection.branchId });
    if (selection.adviserId) {
      clauses.push({ assignments: { some: { adviserId: selection.adviserId, endedAt: null } } });
    }
    return clauses.length ? { AND: clauses } : {};
  }

  private contractScope(
    actor: ActorContext,
    scope: ReportScope,
    selection: ReportSelection,
  ): Prisma.LoanContractWhereInput {
    const clauses: Prisma.LoanContractWhereInput[] = [];
    if (!scope.all) {
      const accessClauses: Prisma.LoanContractWhereInput[] = [];
      if (scope.branchIds.length) accessClauses.push({ branchId: { in: scope.branchIds } });
      if (scope.ownAll) accessClauses.push({ createdById: actor.id });
      else if (scope.ownBranchIds.length) {
        accessClauses.push({ createdById: actor.id, branchId: { in: scope.ownBranchIds } });
      }
      const assignedCustomer = { assignments: { some: { adviserId: actor.id, endedAt: null } } };
      if (scope.assignedAll) accessClauses.push({ customer: assignedCustomer });
      else if (scope.assignedBranchIds.length) {
        accessClauses.push({ branchId: { in: scope.assignedBranchIds }, customer: assignedCustomer });
      }
      clauses.push(accessClauses.length ? { OR: accessClauses } : { id: { in: [] } });
    }
    if (selection.branchId) clauses.push({ branchId: selection.branchId });
    if (selection.adviserId) {
      clauses.push({ customer: { assignments: { some: { adviserId: selection.adviserId, endedAt: null } } } });
    }
    return clauses.length ? { AND: clauses } : {};
  }

  private planScope(
    actor: ActorContext,
    scope: ReportScope,
    selection: ReportSelection,
  ): Prisma.PlanWhereInput {
    const clauses: Prisma.PlanWhereInput[] = [];
    if (!scope.all) {
      const accessClauses: Prisma.PlanWhereInput[] = [];
      if (scope.branchIds.length) {
        accessClauses.push({ branches: { some: { branchId: { in: scope.branchIds } } } });
      }
      if (scope.ownAll) accessClauses.push({ createdById: actor.id });
      else if (scope.ownBranchIds.length) {
        accessClauses.push({
          createdById: actor.id,
          branches: { some: { branchId: { in: scope.ownBranchIds } } },
        });
      }
      if (scope.assignedAll) {
        accessClauses.push({ tasks: { some: { assignments: { some: { assigneeId: actor.id } } } } });
      } else if (scope.assignedBranchIds.length) {
        accessClauses.push({
          tasks: {
            some: {
              branchId: { in: scope.assignedBranchIds },
              assignments: { some: { assigneeId: actor.id } },
            },
          },
        });
      }
      clauses.push(accessClauses.length ? { OR: accessClauses } : { id: { in: [] } });
    }
    if (selection.branchId) clauses.push({ branches: { some: { branchId: selection.branchId } } });
    if (selection.adviserId) {
      clauses.push({ tasks: { some: { assignments: { some: { assigneeId: selection.adviserId } } } } });
    }
    return clauses.length ? { AND: clauses } : {};
  }

  private requestScope(
    actor: ActorContext,
    scope: ReportScope,
    selection: ReportSelection,
  ): Prisma.LoanRequestWhereInput {
    const clauses: Prisma.LoanRequestWhereInput[] = [];
    if (!scope.all) {
      const accessClauses: Prisma.LoanRequestWhereInput[] = [];
      if (scope.branchIds.length) accessClauses.push({ branchId: { in: scope.branchIds } });
      if (scope.ownAll) accessClauses.push({ customer: { createdById: actor.id } });
      else if (scope.ownBranchIds.length) {
        accessClauses.push({ branchId: { in: scope.ownBranchIds }, customer: { createdById: actor.id } });
      }
      const assignedCustomer = { assignments: { some: { adviserId: actor.id, endedAt: null } } };
      if (scope.assignedAll) accessClauses.push({ customer: assignedCustomer });
      else if (scope.assignedBranchIds.length) {
        accessClauses.push({ branchId: { in: scope.assignedBranchIds }, customer: assignedCustomer });
      }
      clauses.push(accessClauses.length ? { OR: accessClauses } : { id: { in: [] } });
    }
    if (selection.branchId) clauses.push({ branchId: selection.branchId });
    if (selection.adviserId) {
      clauses.push({ customer: { assignments: { some: { adviserId: selection.adviserId, endedAt: null } } } });
    }
    return clauses.length ? { AND: clauses } : {};
  }

  private async allPages<T extends { id: string }>(fetchPage: (cursor?: string) => Promise<T[]>): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | undefined;
    while (true) {
      const page = await fetchPage(cursor);
      if (!page.length) break;
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      cursor = page[page.length - 1].id;
    }
    return rows;
  }

  private dateFilter(bounds: PeriodBounds) {
    return { gte: bounds.start, lt: bounds.endExclusive };
  }

  private response(
    report: ReportType,
    period: ReportPeriod,
    offset: number,
    bounds: PeriodBounds,
    metrics: ReportMetric[],
    trendTitle: string,
    trendFormat: 'number' | 'currency',
    trend: TrendPoint[],
    statuses: ReportResult['statuses'],
    table: ReportTable,
    extras: Pick<ReportResult, 'trendSeries' | 'staffTable'> = {},
  ): ReportResult {
    return {
      report,
      period: { type: period, offset, start: bounds.start.toISOString(), endExclusive: bounds.endExclusive.toISOString() },
      metrics,
      trendTitle,
      trendFormat,
      trend,
      statuses,
      table,
      ...extras,
    };
  }

  private async customerReport(
    actor: ActorContext,
    scope: ReportScope,
    selection: ReportSelection,
    period: ReportPeriod,
    offset: number,
    bounds: PeriodBounds,
  ) {
    const where: Prisma.CustomerWhereInput = {
      AND: [this.customerScope(actor, scope, selection), { createdAt: this.dateFilter(bounds) }],
    };
    const customers = await this.allPages((cursor) => this.prisma.customer.findMany({
      where,
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, branchId: true, status: true, createdAt: true },
    }));
    const statusCounts = groupCounts(customers, (row) => row.status);
    const branchCounts = groupCounts(customers, (row) => row.branchId);
    const branchIds = [...branchCounts.keys()];
    const branches = branchIds.length
      ? await this.prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
      : [];
    const branchNames = new Map(branches.map(({ id, name }) => [id, name]));
    const tableRows = [...branchCounts.entries()]
      .map(([id, count]) => ({ id, name: branchNames.get(id) ?? 'Chi nhánh không còn hoạt động', count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'vi'))
      .slice(0, 10);
    const activeCount = customers.filter(({ status }) => ['CONTACTED', 'QUALIFIED', 'IN_PROGRESS'].includes(status)).length;
    const convertedCount = statusCounts.get('CONVERTED') ?? 0;

    return this.response(
      ReportType.CUSTOMERS,
      period,
      offset,
      bounds,
      [
        { key: 'new', label: 'Khách hàng mới', value: customers.length, format: 'number', detail: 'Tạo trong kỳ đã chọn' },
        { key: 'active', label: 'Đang tư vấn', value: activeCount, format: 'number', detail: 'Trạng thái hiện tại' },
        { key: 'converted', label: 'Đã chuyển đổi', value: convertedCount, format: 'number', detail: 'Trạng thái hiện tại' },
        { key: 'branches', label: 'Chi nhánh có khách mới', value: branchCounts.size, format: 'number', detail: 'Trong kỳ đã chọn' },
      ],
      'Khách hàng mới theo kỳ',
      'number',
      makeTrend(customers, period, bounds, (row) => row.createdAt, () => 1),
      createStatusRows(statusCounts, customerStatusLabels, customers.length),
      {
        title: 'Khách hàng mới theo chi nhánh',
        columns: [{ key: 'name', label: 'Chi nhánh', format: 'text' }, { key: 'count', label: 'Khách hàng', format: 'number' }],
        rows: tableRows.map(({ id, name, count }) => ({ id, name, count })),
      },
    );
  }

  private async planReport(
    actor: ActorContext,
    scope: ReportScope,
    selection: ReportSelection,
    period: ReportPeriod,
    offset: number,
    bounds: PeriodBounds,
  ) {
    const visiblePlanScope = this.planScope(actor, scope, selection);
    const where: Prisma.PlanWhereInput = {
      AND: [visiblePlanScope, { deletedAt: null, createdAt: this.dateFilter(bounds) }],
    };
    const plans = await this.allPages((cursor) => this.prisma.plan.findMany({
      where,
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, name: true, status: true, periodStart: true, periodEnd: true, createdAt: true },
    }));
    const statusCounts = groupCounts(plans, (row) => row.status);
    const latestPlans = await this.prisma.plan.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: {
        id: true,
        name: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        branches: { select: { branch: { select: { name: true } } } },
      },
    });
    const active = statusCounts.get('ACTIVE') ?? 0;
    const pending = statusCounts.get('PENDING_APPROVAL') ?? 0;
    return this.response(
      ReportType.PLANS,
      period,
      offset,
      bounds,
      [
        { key: 'created', label: 'Kế hoạch tạo mới', value: plans.length, format: 'number', detail: 'Tạo trong kỳ đã chọn' },
        { key: 'active', label: 'Đang thực hiện', value: active, format: 'number', detail: 'Trạng thái hiện tại' },
        { key: 'pending', label: 'Chờ duyệt', value: pending, format: 'number', detail: 'Trạng thái hiện tại' },
        { key: 'other', label: 'Trạng thái khác', value: Math.max(plans.length - active - pending, 0), format: 'number', detail: 'Bản nháp, từ chối hoặc lưu trữ' },
      ],
      'Kế hoạch tạo mới theo kỳ',
      'number',
      makeTrend(plans, period, bounds, (row) => row.createdAt, () => 1),
      createStatusRows(statusCounts, planStatusLabels, plans.length),
      {
        title: 'Kế hoạch mới nhất',
        columns: [
          { key: 'name', label: 'Kế hoạch', format: 'text' },
          { key: 'branches', label: 'Chi nhánh', format: 'text' },
          { key: 'period', label: 'Thời gian thực hiện', format: 'text' },
          { key: 'status', label: 'Trạng thái', format: 'status' },
        ],
        rows: latestPlans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          branches: plan.branches.map(({ branch }) => branch.name).join(', ') || '—',
          period: `${formatLocalDate(plan.periodStart)} – ${formatLocalDate(plan.periodEnd)}`,
          status: planStatusLabels[plan.status] ?? plan.status,
        })),
      },
    );
  }

  private async loanReport(
    actor: ActorContext,
    scope: ReportScope,
    filters: ReportFilterContext,
    period: ReportPeriod,
    offset: number,
    bounds: PeriodBounds,
  ) {
    const { selection } = filters;
    const contractAccess = this.contractScope(actor, scope, selection);
    const cohortWhere: Prisma.LoanContractWhereInput = {
      AND: [contractAccess, { createdAt: this.dateFilter(bounds) }],
    };
    const contracts = await this.allPages((cursor) => this.prisma.loanContract.findMany({
      where: cohortWhere,
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        createdAt: true,
        customer: {
          select: {
            assignments: {
              where: { isPrimary: true, endedAt: null },
              select: { adviserId: true, branchId: true, adviser: { select: { displayName: true } } },
            },
          },
        },
      },
    }));
    const statusCounts = groupCounts(contracts, (row) => row.status);
    const approvedWhere: Prisma.LoanContractWhereInput = {
      AND: [contractAccess, { approvedAt: this.dateFilter(bounds) }],
    };
    const approvedContracts = await this.allPages((cursor) => this.prisma.loanContract.findMany({
      where: approvedWhere,
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, productId: true, packageName: true, loanAmount: true, product: { select: { name: true } } },
    }));
    const disbursementWhere: Prisma.LoanContractDisbursementWhereInput = {
      AND: [this.contractScopeAsDisbursement(actor, scope), { disbursedAt: this.dateFilter(bounds) }],
    };
    const disbursements = await this.allPages((cursor) => this.prisma.loanContractDisbursement.findMany({
      where: disbursementWhere,
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        amount: true,
        disbursedAt: true,
        contract: {
          select: {
            productId: true,
            packageName: true,
            product: { select: { name: true } },
            customer: {
              select: {
                assignments: {
                  select: {
                    id: true,
                    adviserId: true,
                    branchId: true,
                    isPrimary: true,
                    assignedAt: true,
                    endedAt: true,
                    adviser: { select: { displayName: true } },
                  },
                },
              },
            },
          },
        },
      },
    }));
    const cohortDisbursements = await this.allPages((cursor) => this.prisma.loanContractDisbursement.findMany({
      where: {
        AND: [
          this.contractScopeAsDisbursement(actor, scope),
          { contract: { approvedAt: this.dateFilter(bounds) } },
          { disbursedAt: { lt: bounds.endExclusive } },
        ],
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        amount: true,
        disbursedAt: true,
        contract: {
          select: {
            customer: {
              select: {
                assignments: {
                  select: {
                    id: true,
                    adviserId: true,
                    branchId: true,
                    isPrimary: true,
                    assignedAt: true,
                    endedAt: true,
                    adviser: { select: { displayName: true } },
                  },
                },
              },
            },
          },
        },
      },
    }));
    const requests = await this.allPages((cursor) => this.prisma.loanRequest.findMany({
      where: {
        AND: [this.requestScope(actor, scope, selection), { createdAt: this.dateFilter(bounds) }],
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, productId: true, product: { select: { name: true } } },
    }));

    const attributedDisbursements = disbursements
      .map((row) => ({ ...row, owner: assignmentAt(row.contract.customer.assignments, row.disbursedAt) }))
      .filter((row) => disbursementWithinScope(actor.id, scope, selection, row.owner));
    const attributedCohortDisbursements = cohortDisbursements
      .map((row) => ({ ...row, owner: assignmentAt(row.contract.customer.assignments, row.disbursedAt) }))
      .filter((row) => disbursementWithinScope(actor.id, scope, selection, row.owner));
    const approvedAmount = approvedContracts.reduce((total, contract) => total.plus(amount(contract.loanAmount)), new Prisma.Decimal(0));
    const disbursedAmount = attributedDisbursements.reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0));
    const cohortDisbursedAmount = attributedCohortDisbursements.reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0));
    const approvedCount = contracts.filter(({ status }) => ['APPROVED', 'AWAITING_CUSTOMER_CONFIRMATION', 'COMPLETED'].includes(status)).length;
    const waitingCount = statusCounts.get('PENDING_REVIEW') ?? 0;
    const disbursementRate = approvedAmount.isZero()
      ? null
      : cohortDisbursedAmount.dividedBy(approvedAmount).times(100).toDecimalPlaces(2).toNumber();
    const productRows = this.productBreakdown(requests, approvedContracts, attributedDisbursements);
    const trend = makeTrend(attributedDisbursements, period, bounds, (row) => row.disbursedAt, (row) => row.amount.toNumber());
    const staffRows = this.staffBreakdown(
      filters,
      actor.id,
      contracts,
      attributedDisbursements,
    );
    const trendSeries = this.disbursementSeries(attributedDisbursements, period, bounds);

    return this.response(
      ReportType.LOANS,
      period,
      offset,
      bounds,
      [
        { key: 'rate', label: 'Tỷ lệ giải ngân', value: disbursementRate, format: 'percent', detail: 'Giải ngân lũy kế đến cuối kỳ cho hợp đồng được duyệt trong kỳ / số tiền được duyệt' },
        { key: 'approvedAmount', label: 'Số tiền được duyệt', value: approvedAmount.toFixed(2), format: 'currency', detail: 'Theo ngày duyệt trong kỳ' },
        { key: 'disbursedAmount', label: 'Số tiền giải ngân thực tế', value: disbursedAmount.toFixed(2), format: 'currency', detail: 'Theo ngày giải ngân trong kỳ' },
        { key: 'applications', label: 'Tổng hồ sơ vay', value: contracts.length, format: 'number', detail: 'Hợp đồng tạo trong kỳ' },
      ],
      'Số tiền giải ngân thực tế theo kỳ',
      'currency',
      trend,
      createStatusRows(statusCounts, contractStatusLabels, contracts.length),
      {
        title: 'Sản phẩm vay · đối chiếu hồ sơ',
        columns: [
          { key: 'name', label: 'Sản phẩm vay', format: 'text' },
          { key: 'requests', label: 'Yêu cầu vay', format: 'number' },
          { key: 'approved', label: 'Hợp đồng được duyệt', format: 'number' },
          { key: 'approvedAmount', label: 'Số tiền được duyệt', format: 'currency' },
          { key: 'disbursedAmount', label: 'Đã giải ngân', format: 'currency' },
        ],
        rows: productRows,
      },
      {
        trendSeries,
        staffTable: {
          title: 'Kết quả theo tư vấn viên',
          description: 'Số tiền được ghi nhận cho tư vấn viên đang sở hữu hồ sơ tại thời điểm giải ngân.',
          columns: [
            { key: 'name', label: 'Tư vấn viên', format: 'staff' },
            { key: 'principal', label: 'Đã giải ngân', format: 'currency' },
            { key: 'share', label: 'Tỷ trọng', format: 'percent' },
            { key: 'approved', label: 'Đã duyệt', format: 'number' },
            { key: 'pending', label: 'Chờ duyệt', format: 'number' },
            { key: 'rejected', label: 'Từ chối', format: 'number' },
            { key: 'approvalRate', label: 'Tỷ lệ duyệt', format: 'percent' },
          ],
          rows: staffRows,
          footer: {
            id: 'total',
            name: 'Tổng cộng',
            principal: disbursedAmount.toFixed(2),
            share: disbursedAmount.isZero() ? 0 : 100,
            approved: approvedCount,
            pending: waitingCount,
            rejected: statusCounts.get('REJECTED') ?? 0,
            approvalRate: contracts.length ? approvedCount / contracts.length * 100 : 0,
          },
        },
      },
    );
  }

  private contractScopeAsDisbursement(
    actor: ActorContext,
    scope: ReportScope,
  ): Prisma.LoanContractDisbursementWhereInput {
    if (scope.all) return {};
    const ownerBranches = [...new Set([...scope.branchIds, ...scope.ownBranchIds, ...scope.assignedBranchIds])];
    const assignmentClauses: Prisma.CustomerAssignmentWhereInput[] = [];
    if (ownerBranches.length) assignmentClauses.push({ branchId: { in: ownerBranches } });
    if (scope.ownAll || scope.assignedAll) assignmentClauses.push({ adviserId: actor.id });
    if (!assignmentClauses.length) return { id: { in: [] } };
    return {
      contract: {
        customer: { assignments: { some: { OR: assignmentClauses } } },
      },
    };
  }

  private disbursementSeries(
    rows: AttributedDisbursement[],
    period: ReportPeriod,
    bounds: PeriodBounds,
  ): TrendSeries[] {
    const labels = trendLabels(period, bounds.start);
    const byAdviser = new Map<string, TrendSeries>();
    for (const row of rows) {
      if (!row.owner) continue;
      let series = byAdviser.get(row.owner.adviserId);
      if (!series) {
        series = { id: row.owner.adviserId, label: row.owner.adviser.displayName, values: labels.map(() => 0) };
        byAdviser.set(row.owner.adviserId, series);
      }
      const index = trendBucketIndex(row.disbursedAt, bounds.start, period);
      if (series.values[index] !== undefined) series.values[index] += row.amount.toNumber();
    }
    const ranked = [...byAdviser.values()]
      .sort((left, right) =>
        right.values.reduce((sum, value) => sum + value, 0) - left.values.reduce((sum, value) => sum + value, 0)
        || left.label.localeCompare(right.label, 'vi'));
    if (ranked.length <= 5) return ranked;
    const other = ranked.slice(4);
    return [
      ...ranked.slice(0, 4),
      {
        id: 'other',
        label: 'Khác',
        values: labels.map((_, index) => other.reduce((sum, item) => sum + item.values[index], 0)),
      },
    ];
  }

  private staffBreakdown(
    filters: ReportFilterContext,
    actorId: string,
    contracts: Array<{
      status: string;
      customer: { assignments: Array<{ adviserId: string; branchId: string; adviser: { displayName: string } }> };
    }>,
    disbursements: AttributedDisbursement[],
  ): Array<Record<string, string | number>> {
    const matchesSelection = (id: string, branchId?: string) =>
      (!filters.selection.adviserId || id === filters.selection.adviserId)
      && (!filters.selection.branchId || branchId === filters.selection.branchId);
    const staff = new Map(filters.metadata.advisers
      .filter(({ id }) => !filters.selection.adviserId || id === filters.selection.adviserId)
      .map(({ id, name }) => [id, name]));
    for (const contract of contracts) {
      for (const assignment of contract.customer.assignments) {
        if (!matchesSelection(assignment.adviserId, assignment.branchId)) continue;
        staff.set(assignment.adviserId, assignment.adviser.displayName);
      }
    }
    for (const row of disbursements) {
      if (row.owner && matchesSelection(row.owner.adviserId, row.owner.branchId)) {
        staff.set(row.owner.adviserId, row.owner.adviser.displayName);
      }
    }
    if (filters.metadata.access === 'self') {
      const own = filters.metadata.advisers.find(({ id }) => id === actorId);
      if (own) staff.set(own.id, own.name);
    }

    const total = disbursements.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
    return [...staff.entries()]
      .map(([id, name]) => {
        const assignedContracts = contracts.filter(({ customer }) =>
          customer.assignments.some((assignment) =>
            assignment.adviserId === id
            && (!filters.selection.branchId || assignment.branchId === filters.selection.branchId)));
        const approved = assignedContracts.filter(({ status }) =>
          ['APPROVED', 'AWAITING_CUSTOMER_CONFIRMATION', 'COMPLETED'].includes(status)).length;
        const principal = disbursements
          .filter(({ owner }) => owner?.adviserId === id)
          .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
        return {
          id,
          name,
          principal: principal.toFixed(2),
          share: total.isZero() ? 0 : principal.dividedBy(total).times(100).toDecimalPlaces(2).toNumber(),
          approved,
          pending: assignedContracts.filter(({ status }) => status === 'PENDING_REVIEW').length,
          rejected: assignedContracts.filter(({ status }) => status === 'REJECTED').length,
          approvalRate: assignedContracts.length ? approved / assignedContracts.length * 100 : 0,
        };
      })
      .sort((left, right) => Number(right.principal) - Number(left.principal) || left.name.localeCompare(right.name, 'vi'));
  }

  private productBreakdown(
    requests: Array<{ productId: string | null; product: { name: string } | null }>,
    approvedContracts: Array<{ productId: string | null; packageName: string; loanAmount: Prisma.Decimal | null; product: { name: string } | null }>,
    disbursements: Array<{
      amount: Prisma.Decimal;
      contract: { productId: string | null; packageName: string; product: { name: string } | null };
    }>,
  ) {
    type ProductRow = {
      id: string;
      name: string;
      requests: number;
      approved: number;
      approvedAmount: Prisma.Decimal;
      disbursedAmount: Prisma.Decimal;
    };
    const rows = new Map<string, ProductRow>();
    const findRow = (id: string | null, name: string | null | undefined) => {
      const key = id ? `id:${id}` : `name:${name?.trim().toLocaleLowerCase('vi-VN') || 'unknown'}`;
      const existing = rows.get(key);
      if (existing) return existing;
      const created: ProductRow = {
        id: key,
        name: name?.trim() || 'Sản phẩm chưa xác định',
        requests: 0,
        approved: 0,
        approvedAmount: new Prisma.Decimal(0),
        disbursedAmount: new Prisma.Decimal(0),
      };
      rows.set(key, created);
      return created;
    };
    for (const request of requests) findRow(request.productId, request.product?.name).requests += 1;
    for (const contract of approvedContracts) {
      const row = findRow(contract.productId, contract.product?.name ?? contract.packageName);
      row.approved += 1;
      row.approvedAmount = row.approvedAmount.plus(amount(contract.loanAmount));
    }
    for (const disbursement of disbursements) {
      const row = findRow(disbursement.contract.productId, disbursement.contract.product?.name ?? disbursement.contract.packageName);
      row.disbursedAmount = row.disbursedAmount.plus(disbursement.amount);
    }
    return [...rows.values()]
      .sort((left, right) => right.requests - left.requests || right.disbursedAmount.comparedTo(left.disbursedAmount))
      .slice(0, 10)
      .map((row) => ({
        id: row.id,
        name: row.name,
        requests: row.requests,
        approved: row.approved,
        approvedAmount: row.approvedAmount.toFixed(2),
        disbursedAmount: row.disbursedAmount.toFixed(2),
      }));
  }

  private async summaryReport(
    actor: ActorContext,
    scope: ReportScope,
    filters: ReportFilterContext,
    period: ReportPeriod,
    offset: number,
    bounds: PeriodBounds,
  ) {
    const [customerReport, planReport, loanReport] = await Promise.all([
      this.customerReport(actor, scope, filters.selection, period, offset, bounds),
      this.planReport(actor, scope, filters.selection, period, offset, bounds),
      this.loanReport(actor, scope, filters, period, offset, bounds),
    ]);
    const customerTotal = customerReport.metrics.find(({ key }) => key === 'new')?.value ?? 0;
    const planTotal = planReport.metrics.find(({ key }) => key === 'created')?.value ?? 0;
    const loanTotal = loanReport.metrics.find(({ key }) => key === 'applications')?.value ?? 0;
    const disbursed = loanReport.metrics.find(({ key }) => key === 'disbursedAmount')?.value ?? '0.00';
    const table: ReportTable = {
      title: 'Tổng hợp theo nghiệp vụ',
      columns: [
        { key: 'name', label: 'Nghiệp vụ', format: 'text' },
        { key: 'value', label: 'Kết quả', format: 'text' },
        { key: 'note', label: 'Ghi chú', format: 'text' },
      ],
      rows: [
        { id: 'customers', name: 'Khách hàng mới', value: customerTotal, note: 'Hồ sơ tạo trong kỳ' },
        { id: 'plans', name: 'Kế hoạch', value: planTotal, note: 'Kế hoạch tạo trong kỳ' },
        { id: 'loans', name: 'Hợp đồng vay', value: loanTotal, note: 'Hợp đồng tạo trong kỳ' },
        { id: 'disbursed', name: 'Giải ngân thực tế', value: `${disbursed} đ`, note: 'Tiền ghi nhận giải ngân trong kỳ' },
      ],
    };
    return this.response(
      ReportType.SUMMARY,
      period,
      offset,
      bounds,
      [
        { key: 'customers', label: 'Khách hàng mới', value: customerTotal, format: 'number', detail: 'Tạo trong kỳ' },
        { key: 'plans', label: 'Kế hoạch mới', value: planTotal, format: 'number', detail: 'Tạo trong kỳ' },
        { key: 'loans', label: 'Hợp đồng vay', value: loanTotal, format: 'number', detail: 'Tạo trong kỳ' },
        { key: 'disbursed', label: 'Giải ngân thực tế', value: disbursed, format: 'currency', detail: 'Theo ngày giải ngân' },
      ],
      loanReport.trendTitle,
      loanReport.trendFormat,
      loanReport.trend,
      loanReport.statuses,
      table,
      {
        trendSeries: loanReport.trendSeries,
        staffTable: loanReport.staffTable,
      },
    );
  }
}
