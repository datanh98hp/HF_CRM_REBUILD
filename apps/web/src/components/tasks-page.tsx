'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  ListFilter,
  Plus,
  RotateCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { useCrmSession } from '@/components/crm-session';
import type { ManagedUser } from '@/lib/crm-access';
import { request } from '@/lib/crm-api';

type PlanMetric = {
  id: string;
  name: string;
  unit: string;
  target: number;
};

type PlanBranch = { id: string; code: string; name: string };
type Plan = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  branches: PlanBranch[];
  metrics: PlanMetric[];
};

type Kpi = {
  metricId: string;
  name: string;
  unit: string;
  target: number;
  verifiedTotal: number;
  remaining: number;
  achievementRate: number | null;
};

type Person = { id: string; username: string; displayName: string };
type Verification = {
  id: string;
  status: 'VERIFIED' | 'NEEDS_INFO' | 'REJECTED';
  reason: string | null;
  createdAt: string;
  verifier: Person;
};
type TaskEvidenceFile = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: 'QUARANTINED' | 'AVAILABLE' | 'REJECTED' | 'DELETED';
  scannedAt: string | null;
  expiresAt: string | null;
  legalHold: boolean;
  deletedAt: string | null;
};
type TaskResultEvidence = { id: string; file: TaskEvidenceFile };
type TaskResult = {
  id: string;
  revision: number;
  reportedValue: number;
  reportedUnit: string;
  narrative: string;
  occurredAt: string;
  createdAt: string;
  submittedBy: Person;
  verification: Verification | null;
  verificationStatus: 'PENDING_VERIFICATION' | 'VERIFIED' | 'NEEDS_INFO' | 'REJECTED';
  evidenceFiles: TaskResultEvidence[];
};
type TaskRecord = {
  id: string;
  planId: string;
  metricId: string;
  branchId: string;
  title: string;
  description: string | null;
  status: 'TODO' | 'IN_PROGRESS' | 'COMPLETED';
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  metric: Pick<PlanMetric, 'id' | 'name' | 'unit'>;
  branch: PlanBranch;
  assignee: Person;
  createdBy: Person;
  results: TaskResult[];
};

type TaskView = 'OPEN' | 'ALL';
type ReviewDecision = 'NEEDS_INFO' | 'REJECTED';

const ALL_BRANCHES = '__all__';
const SELF_ASSIGNMENT = '__self__';

const verificationLabels: Record<string, string> = {
  NOT_SUBMITTED: 'Chưa nộp',
  PENDING_VERIFICATION: 'Chờ xác minh',
  VERIFIED: 'Đã xác minh',
  NEEDS_INFO: 'Cần bổ sung',
  REJECTED: 'Bị từ chối',
};

function formatNumber(value: number) {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

function evidenceStatusLabel(file: TaskEvidenceFile) {
  if (file.deletedAt || file.scanStatus === 'DELETED') return 'Đã xóa';
  if (file.scanStatus === 'QUARANTINED') return 'Đang cách ly để kiểm tra';
  if (file.scanStatus === 'REJECTED') return 'Không đạt kiểm tra bảo mật';
  if (file.expiresAt && Date.parse(file.expiresAt) <= Date.now() && !file.legalHold) return 'Hết hạn lưu trữ';
  return 'Đã quét';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

function dateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return Date.UTC(year, month - 1, day);
}

function dueLabel(dueAt: string | null) {
  if (!dueAt) return 'Chưa đặt hạn';
  const days = Math.round((dateKey(new Date(dueAt)) - dateKey(new Date())) / 86_400_000);
  if (days < 0) return `Quá hạn ${Math.abs(days)} ngày`;
  if (days === 0) return 'Hôm nay';
  return formatDate(dueAt);
}

function taskVerificationStatus(task: TaskRecord) {
  const latest = task.results[0];
  if (!latest) return task.status === 'COMPLETED' ? 'VERIFIED' : 'NOT_SUBMITTED';
  return latest.verification?.status ?? latest.verificationStatus;
}

function taskStatusLabel(task: TaskRecord) {
  return verificationLabels[taskVerificationStatus(task)] ?? task.status;
}

function StatusBadge({ task }: { task: TaskRecord }) {
  const status = taskVerificationStatus(task);
  const statusClass = status === 'VERIFIED'
    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
    : status === 'REJECTED'
      ? 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300'
      : status === 'NEEDS_INFO' || status === 'PENDING_VERIFICATION'
        ? 'bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-300'
        : 'bg-muted text-muted-foreground';

  return (
    <Badge variant="secondary" className={`h-6 shrink-0 gap-1.5 px-2 ${statusClass}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {taskStatusLabel(task)}
    </Badge>
  );
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function withinPlanPeriod(date: string, plan: Plan) {
  const instant = Date.parse(`${date}T00:00:00.000Z`);
  return instant >= Date.parse(plan.periodStart) && instant < Date.parse(plan.periodEnd);
}

function KpiCard({ item, spanClass }: { item: Kpi; spanClass?: string }) {
  const rate = item.achievementRate;
  const progress = rate === null ? 0 : Math.min(100, Math.max(0, rate));

  return (
    <Card className={`gap-3 rounded-xl border-border p-4 sm:p-5 ${spanClass ?? ''}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{item.name}</p>
        <p className="mt-1 break-words text-lg font-semibold tabular-nums text-foreground sm:text-xl">
          {formatNumber(item.verifiedTotal)} / {formatNumber(item.target)} {item.unit}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {item.unit} · mục tiêu {formatNumber(item.target)}
        </p>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`Tiến độ ${item.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Đã xác minh</span>
        <strong className="tabular-nums text-foreground">
          {rate === null ? 'Chưa có mục tiêu' : `${formatNumber(rate)}%`}
        </strong>
      </div>
    </Card>
  );
}

function TaskQueue({
  tasks,
  selectedTaskId,
  loading,
  error,
  onSelect,
  onRetry,
}: {
  tasks: TaskRecord[];
  selectedTaskId: string | null;
  loading: boolean;
  error: string;
  onSelect: (taskId: string) => void;
  onRetry: () => void;
}) {
  const horizontalListRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const element = horizontalListRef.current;
    if (!element) return;

    const updateScrollState = () => {
      setCanScrollLeft(element.scrollLeft > 0);
      setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
    };
    updateScrollState();
    element.addEventListener('scroll', updateScrollState, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', updateScrollState);
      observer.disconnect();
    };
  }, [tasks.length]);

  function renderTaskButton(task: TaskRecord, horizontal = false) {
    const latest = task.results[0];
    const due = dueLabel(task.dueAt);
    const overdue = due.startsWith('Quá hạn');
    const selected = task.id === selectedTaskId;

    return (
      <button
        key={task.id}
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(task.id)}
        className={`group flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
          horizontal ? 'w-[250px] shrink-0 sm:w-auto' : 'w-full'
        } ${
          selected
            ? 'border-border bg-secondary text-foreground'
            : 'border-transparent bg-card text-foreground hover:bg-muted/70'
        }`}
      >
        <span className="line-clamp-2 text-sm font-medium leading-5 text-pretty" title={task.title}>
          {task.title}
        </span>
        <span className="flex min-w-0 items-center justify-between gap-2">
          <StatusBadge task={task} />
          <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground" title={latest ? `${formatNumber(latest.reportedValue)} ${latest.reportedUnit}` : undefined}>
            {latest ? `${formatNumber(latest.reportedValue)} ${latest.reportedUnit}` : '—'}
          </span>
        </span>
        <span className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate" title={task.assignee.displayName}>{task.assignee.displayName}</span>
          <span className={overdue ? 'shrink-0 font-medium text-amber-700 dark:text-orange-400' : 'shrink-0'}>
            {due}
          </span>
        </span>
      </button>
    );
  }

  if (loading) {
    return (
      <div className="grid gap-1 p-2" aria-busy="true">
        {[0, 1, 2].map((item) => (
          <div className="flex flex-col gap-3 rounded-xl p-3" key={item}>
            <Skeleton className="h-4 w-4/5" />
            <div className="flex justify-between gap-3">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
        <span className="sr-only" role="status">Đang tải hàng đợi công việc</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-8 text-center" role="alert">
        <div>
          <p className="text-sm font-medium text-red-700 dark:text-red-300">Không tải được hàng đợi công việc</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" type="button" onClick={onRetry}>
          <RotateCw aria-hidden="true" />
          Thử lại
        </Button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">Không có công việc trong mục này.</p>;
  }

  const maskImage = canScrollLeft && canScrollRight
    ? 'linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)'
    : canScrollLeft
      ? 'linear-gradient(to right, transparent, black 32px)'
      : canScrollRight
        ? 'linear-gradient(to left, transparent, black 32px)'
        : undefined;

  return (
    <>
      <div className="hidden gap-1 p-2 sm:grid">
        {tasks.map((task) => renderTaskButton(task))}
      </div>
      <div className="relative min-w-0 sm:hidden">
        <div
          ref={horizontalListRef}
          className="scrollbar-clean flex min-w-0 gap-2 overflow-x-auto px-3 py-3"
          style={{ maskImage, WebkitMaskImage: maskImage }}
          aria-label="Danh sách task"
        >
          {tasks.map((task) => renderTaskButton(task, true))}
        </div>
        {canScrollLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 hidden items-center pl-1 [@media(any-pointer:fine)]:flex">
            <Button
              className="pointer-events-auto size-8 min-h-8 rounded-full border-border bg-card"
              variant="outline"
              size="icon-sm"
              type="button"
              aria-label="Cuộn danh sách task sang trái"
              onClick={() => horizontalListRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
          </div>
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden items-center pr-1 [@media(any-pointer:fine)]:flex">
            <Button
              className="pointer-events-auto size-8 min-h-8 rounded-full border-border bg-card"
              variant="outline"
              size="icon-sm"
              type="button"
              aria-label="Cuộn danh sách task sang phải"
              onClick={() => horizontalListRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

export function TasksPage() {
  const { session, staff, can } = useCrmSession();
  const accessToken = session?.accessToken;
  const canReadPlans = can('plans.read');
  const canManageTasks = can('tasks.manage');
  const canSubmitTasks = can('tasks.submit');
  const canVerifyTasks = can('tasks.verify');
  const canReadKpi = can('kpi.read');
  const canReadUsers = can('users.read');

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState('');
  const [plansRequestVersion, setPlansRequestVersion] = useState(0);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loadingKpis, setLoadingKpis] = useState(false);
  const [kpiError, setKpiError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [taskView, setTaskView] = useState<TaskView>('OPEN');
  const [branchFilter, setBranchFilter] = useState(ALL_BRANCHES);
  const [notice, setNotice] = useState('');
  const [assignableUsers, setAssignableUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState('');

  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskCreating, setTaskCreating] = useState(false);
  const [taskFormError, setTaskFormError] = useState('');
  const [taskDraft, setTaskDraft] = useState({
    metricId: '',
    branchId: '',
    title: '',
    description: '',
    dueAt: '',
    assigneeId: SELF_ASSIGNMENT,
  });

  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [resultSubmitting, setResultSubmitting] = useState(false);
  const [resultFormError, setResultFormError] = useState('');
  const [resultDraft, setResultDraft] = useState({ value: '', narrative: '', occurredAt: '' });
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const branchFilteredTasks = useMemo(
    () => tasks.filter((task) => branchFilter === ALL_BRANCHES || task.branchId === branchFilter),
    [branchFilter, tasks],
  );
  const openTaskCount = branchFilteredTasks.filter((task) => task.status !== 'COMPLETED').length;
  const visibleTasks = useMemo(() => {
    if (taskView === 'OPEN') return branchFilteredTasks.filter((task) => task.status !== 'COMPLETED');
    return branchFilteredTasks;
  }, [branchFilteredTasks, taskView]);
  const selectedTask = visibleTasks.find((task) => task.id === selectedTaskId) ?? null;
  const latestResult = selectedTask?.results[0] ?? null;
  const pendingVerification = Boolean(latestResult && !latestResult.verification);
  const canVerifySelected = Boolean(
    canVerifyTasks
    && latestResult
    && pendingVerification
    && latestResult.submittedBy.id !== staff?.id,
  );
  const canSubmitSelected = Boolean(
    canSubmitTasks
    && selectedTask
    && (!latestResult || Boolean(latestResult.verification)),
  );
  const canCreateTask = Boolean(canManageTasks && selectedPlan?.status === 'ACTIVE');

  useEffect(() => {
    let active = true;
    setPlans([]);
    setSelectedPlanId('');
    setPlansError('');
    if (!accessToken || !canReadPlans) {
      setLoadingPlans(false);
      return () => { active = false; };
    }

    setLoadingPlans(true);
    void request<Plan[]>('/plans', {}, accessToken)
      .then((nextPlans) => {
        if (!active) return;
        const sorted = [...nextPlans].sort((a, b) =>
          b.periodStart.localeCompare(a.periodStart) || b.id.localeCompare(a.id),
        );
        setPlans(sorted);
        setSelectedPlanId(sorted.find((plan) => plan.status === 'ACTIVE')?.id ?? sorted[0]?.id ?? '');
      })
      .catch((cause: unknown) => {
        if (active) setPlansError(errorMessage(cause, 'Không thể tải danh sách kế hoạch.'));
      })
      .finally(() => {
        if (active) setLoadingPlans(false);
      });

    return () => { active = false; };
  }, [accessToken, canReadPlans, plansRequestVersion]);

  useEffect(() => {
    let active = true;
    setTasks([]);
    setSelectedTaskId(null);
    setTasksError('');
    setKpis([]);
    setKpiError('');
    if (!accessToken || !selectedPlanId) {
      setLoadingTasks(false);
      setLoadingKpis(false);
      return () => { active = false; };
    }

    setLoadingTasks(true);
    void request<TaskRecord[]>(`/plans/${selectedPlanId}/tasks`, {}, accessToken)
      .then((nextTasks) => {
        if (!active) return;
        setTasks(nextTasks);
        const firstTask = nextTasks.find((task) => task.status !== 'COMPLETED') ?? nextTasks[0];
        setSelectedTaskId(firstTask?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (active) setTasksError(errorMessage(cause, 'Không thể tải danh sách công việc.'));
      })
      .finally(() => {
        if (active) setLoadingTasks(false);
      });

    if (canReadKpi) {
      setLoadingKpis(true);
      void request<Kpi[]>(`/plans/${selectedPlanId}/kpi`, {}, accessToken)
        .then((nextKpis) => { if (active) setKpis(nextKpis); })
        .catch((cause: unknown) => {
          if (active) setKpiError(errorMessage(cause, 'Không thể tải KPI đã xác minh.'));
        })
        .finally(() => {
          if (active) setLoadingKpis(false);
        });
    } else {
      setLoadingKpis(false);
    }

    return () => { active = false; };
  }, [accessToken, canReadKpi, refreshVersion, selectedPlanId]);

  useEffect(() => {
    setTaskView('OPEN');
    setBranchFilter(ALL_BRANCHES);
    setNotice('');
  }, [selectedPlanId]);

  useEffect(() => {
    let active = true;
    setAssignableUsers([]);
    setUsersError('');
    if (!accessToken || !canManageTasks || !canReadUsers) {
      setLoadingUsers(false);
      return () => { active = false; };
    }

    setLoadingUsers(true);
    void request<ManagedUser[]>('/access/users', {}, accessToken)
      .then((users) => {
        if (active) {
          setAssignableUsers(users.filter((user) =>
            user.status === 'ACTIVE'
            && user.roleGrants.some(({ role }) => role.key !== 'CUSTOMER'),
          ));
        }
      })
      .catch((cause: unknown) => {
        if (active) setUsersError(errorMessage(cause, 'Không thể tải danh sách nhân viên.'));
      })
      .finally(() => {
        if (active) setLoadingUsers(false);
      });

    return () => { active = false; };
  }, [accessToken, canManageTasks, canReadUsers]);

  useEffect(() => {
    if (!visibleTasks.length) {
      setSelectedTaskId(null);
      return;
    }
    if (!visibleTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(visibleTasks[0].id);
    }
  }, [selectedTaskId, visibleTasks]);

  useEffect(() => {
    setActionError('');
  }, [selectedTaskId]);

  function openTaskDialog() {
    setTaskDraft({
      metricId: '',
      branchId: '',
      title: '',
      description: '',
      dueAt: '',
      assigneeId: SELF_ASSIGNMENT,
    });
    setTaskFormError('');
    setTaskDialogOpen(true);
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !selectedPlan || !canManageTasks) {
      setTaskFormError('Bạn không có quyền tạo công việc trong kế hoạch này.');
      return;
    }
    const title = taskDraft.title.trim();
    if (title.length < 2 || title.length > 160) {
      setTaskFormError('Tên công việc cần có từ 2 đến 160 ký tự.');
      return;
    }
    if (!selectedPlan.metrics.some((metric) => metric.id === taskDraft.metricId)) {
      setTaskFormError('Hãy chọn một chỉ tiêu trong kế hoạch.');
      return;
    }
    if (!selectedPlan.branches.some((branch) => branch.id === taskDraft.branchId)) {
      setTaskFormError('Hãy chọn một chi nhánh trong kế hoạch.');
      return;
    }
    if (taskDraft.description.trim().length > 2000) {
      setTaskFormError('Mô tả không được vượt quá 2.000 ký tự.');
      return;
    }
    if (taskDraft.dueAt && !withinPlanPeriod(taskDraft.dueAt, selectedPlan)) {
      setTaskFormError('Hạn chót phải nằm trong kỳ của kế hoạch.');
      return;
    }

    setTaskCreating(true);
    setTaskFormError('');
    try {
      const created = await request<TaskRecord>(`/plans/${selectedPlan.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          metricId: taskDraft.metricId,
          branchId: taskDraft.branchId,
          title,
          ...(taskDraft.description.trim() ? { description: taskDraft.description.trim() } : {}),
          ...(taskDraft.assigneeId !== SELF_ASSIGNMENT ? { assigneeId: taskDraft.assigneeId } : {}),
          ...(taskDraft.dueAt ? { dueAt: new Date(`${taskDraft.dueAt}T00:00:00.000Z`).toISOString() } : {}),
        }),
      }, accessToken);
      setSelectedTaskId(created.id);
      setTaskDialogOpen(false);
      setNotice('Đã tạo và giao công việc.');
      setRefreshVersion((current) => current + 1);
    } catch (cause) {
      setTaskFormError(errorMessage(cause, 'Không thể tạo công việc.'));
    } finally {
      setTaskCreating(false);
    }
  }

  function openResultDialog() {
    setResultDraft({ value: '', narrative: '', occurredAt: '' });
    setResultFormError('');
    setResultDialogOpen(true);
  }

  async function submitResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !selectedTask || !canSubmitTasks) {
      setResultFormError('Bạn không có quyền nộp kết quả cho công việc này.');
      return;
    }
    const valueText = resultDraft.value.trim();
    const reportedValue = Number(valueText);
    if (!/^\d+(\.\d{1,3})?$/.test(valueText) || !Number.isFinite(reportedValue) || reportedValue > 9999999999999) {
      setResultFormError('Số thực đạt phải từ 0 đến 9.999.999.999.999, tối đa 3 chữ số thập phân.');
      return;
    }
    if (!resultDraft.narrative.trim() || resultDraft.narrative.trim().length > 4000) {
      setResultFormError('Nội dung giải trình cần có từ 1 đến 4.000 ký tự.');
      return;
    }
    if (!resultDraft.occurredAt || !selectedPlan || !withinPlanPeriod(resultDraft.occurredAt, selectedPlan)) {
      setResultFormError('Ngày thực hiện phải nằm trong kỳ của kế hoạch.');
      return;
    }

    setResultSubmitting(true);
    setResultFormError('');
    try {
      await request<TaskResult>(`/tasks/${selectedTask.id}/results`, {
        method: 'POST',
        body: JSON.stringify({
          reportedValue,
          reportedUnit: selectedTask.metric.unit,
          narrative: resultDraft.narrative.trim(),
          occurredAt: new Date(`${resultDraft.occurredAt}T00:00:00.000Z`).toISOString(),
        }),
      }, accessToken);
      setResultDialogOpen(false);
      setNotice('Đã nộp kết quả mới. Kết quả đang chờ xác minh.');
      setRefreshVersion((current) => current + 1);
    } catch (cause) {
      setResultFormError(errorMessage(cause, 'Không thể nộp kết quả.'));
    } finally {
      setResultSubmitting(false);
    }
  }

  async function verifyResult(status: 'VERIFIED' | ReviewDecision, reason?: string) {
    if (!accessToken || !latestResult || !canVerifyTasks) {
      setActionError('Bạn không có quyền xác minh kết quả này.');
      return;
    }
    setReviewSubmitting(true);
    setActionError('');
    try {
      await request<Verification>(`/task-results/${latestResult.id}/verifications`, {
        method: 'POST',
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      }, accessToken);
      setReviewDecision(null);
      setReviewReason('');
      setNotice(status === 'VERIFIED'
        ? 'Đã xác minh kết quả. KPI đã được cập nhật.'
        : status === 'NEEDS_INFO'
          ? 'Đã yêu cầu bổ sung kết quả.'
          : 'Đã từ chối kết quả.');
      setRefreshVersion((current) => current + 1);
    } catch (cause) {
      setActionError(errorMessage(cause, 'Không thể cập nhật trạng thái xác minh.'));
    } finally {
      setReviewSubmitting(false);
    }
  }

  function openReviewDialog(decision: ReviewDecision) {
    setReviewDecision(decision);
    setReviewReason('');
    setActionError('');
  }

  async function submitReviewReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewDecision || !reviewReason.trim()) {
      setActionError('Hãy nhập lý do trước khi gửi quyết định.');
      return;
    }
    await verifyResult(reviewDecision, reviewReason.trim());
  }

  function refreshAll() {
    setNotice('');
    setRefreshVersion((current) => current + 1);
  }

  const metricSpanClass = (index: number) => {
    if (kpis.length <= 1) return '';
    const isLast = index === kpis.length - 1;
    if (isLast && kpis.length % 3 === 1) return 'col-span-2 md:col-span-2 xl:col-span-3';
    if (isLast && kpis.length % 2 === 1) return 'col-span-2 md:col-span-2 xl:col-span-1';
    return '';
  };

  return (
    <WorkspaceLayout activeSection="tasks" requiredPermission="tasks.read">
      <div className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-5">
        <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-balance">Công việc</h1>
            <p className="mt-1 max-w-[55ch] text-sm text-pretty text-muted-foreground">
              Thực hiện task và theo dõi kết quả đã xác minh trong kế hoạch.
            </p>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-start">
            {canReadPlans && plans.length > 0 && (
              <Select value={selectedPlanId} onValueChange={(value) => setSelectedPlanId(value ?? '')}>
                <SelectTrigger className="h-10 w-full bg-card sm:w-[260px]" aria-label="Chọn kế hoạch">
                  <CalendarDays aria-hidden="true" className="text-muted-foreground" />
                  <SelectValue placeholder="Chọn kế hoạch" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} · {formatDate(plan.periodStart)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {canManageTasks && (
              <Button
                className="min-h-10 w-full sm:w-auto"
                variant="default"
                type="button"
                onClick={openTaskDialog}
                disabled={!canCreateTask}
              >
                <Plus aria-hidden="true" />
                Tạo task
              </Button>
            )}
          </div>
        </header>

        {!canReadPlans ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
            Màn công việc cần quyền <code>plans.read</code> để chọn kế hoạch. Hãy nhờ quản trị viên cấp quyền trong đúng phạm vi chi nhánh.
          </div>
        ) : plansError ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-8 text-center" role="alert">
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-300">Không tải được kế hoạch</p>
              <p className="mt-1 text-sm text-muted-foreground">{plansError}</p>
            </div>
            <Button variant="outline" type="button" onClick={() => setPlansRequestVersion((value) => value + 1)}>
              <RotateCw aria-hidden="true" />
              Thử lại
            </Button>
          </div>
        ) : loadingPlans ? (
          <Card className="gap-4 p-4 sm:p-5" aria-busy="true">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <span className="sr-only" role="status">Đang tải kế hoạch</span>
          </Card>
        ) : plans.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            Chưa có kế hoạch nào trong phạm vi được cấp quyền.
          </p>
        ) : selectedPlan ? (
          <>
            {notice && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
                {notice}
              </p>
            )}
            {selectedPlan.status !== 'ACTIVE' && canManageTasks && (
              <p className="text-sm text-amber-800" role="status">
                Chỉ kế hoạch đang thực hiện mới nhận được công việc mới.
              </p>
            )}
            <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Hàng đợi công việc và KPI">
              <header className="flex min-w-0 flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-balance">Hàng đợi công việc</h2>
                  <p className="mt-1 text-sm text-pretty text-muted-foreground">
                    {selectedPlan.name} · {openTaskCount} việc cần xử lý
                  </p>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    aria-label="Tải lại công việc và KPI"
                    onClick={refreshAll}
                  >
                    <RotateCw aria-hidden="true" />
                  </Button>
                  {canManageTasks && (
                    <Button
                      className="min-h-10"
                      variant="outline"
                      type="button"
                      onClick={openTaskDialog}
                      disabled={!canCreateTask}
                    >
                      <Plus aria-hidden="true" />
                      Tạo task
                    </Button>
                  )}
                </div>
              </header>

              {canReadKpi && (
                <section className="border-b border-border p-4 sm:p-5" aria-label="KPI đã xác minh">
                  {loadingKpis ? (
                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3" aria-busy="true">
                      {[0, 1, 2].map((item) => (
                        <Card className={`gap-3 p-4 ${item === 2 ? 'col-span-2 xl:col-span-1' : ''}`} key={item}>
                          <Skeleton className="h-4 w-2/3" />
                          <Skeleton className="h-6 w-4/5" />
                          <Skeleton className="h-2 w-full" />
                          <Skeleton className="h-3 w-1/2" />
                        </Card>
                      ))}
                      <span className="sr-only" role="status">Đang tải KPI đã xác minh</span>
                    </div>
                  ) : kpiError ? (
                    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between" role="alert">
                      <div>
                        <p className="text-sm font-medium text-red-700 dark:text-red-300">Không tải được KPI đã xác minh</p>
                        <p className="mt-1 text-sm text-muted-foreground">{kpiError}</p>
                      </div>
                      <Button variant="outline" type="button" onClick={refreshAll}>
                        <RotateCw aria-hidden="true" />
                        Thử lại
                      </Button>
                    </div>
                  ) : kpis.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">Kế hoạch này chưa có chỉ tiêu KPI.</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                        {kpis.map((item, index) => (
                          <KpiCard item={item} key={item.metricId} spanClass={metricSpanClass(index)} />
                        ))}
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Chỉ tính revision mới nhất đã xác minh.
                      </p>
                    </>
                  )}
                </section>
              )}

              <div className="flex min-w-0 flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex min-w-0 items-center gap-2" role="group" aria-label="Lọc trạng thái công việc">
                  <Button
                    className="min-h-9 rounded-lg px-3"
                    variant={taskView === 'OPEN' ? 'secondary' : 'ghost'}
                    type="button"
                    aria-pressed={taskView === 'OPEN'}
                    onClick={() => setTaskView('OPEN')}
                  >
                    Cần xử lý <span className="tabular-nums">{openTaskCount}</span>
                  </Button>
                  <Button
                    className="min-h-9 rounded-lg px-3"
                    variant={taskView === 'ALL' ? 'secondary' : 'ghost'}
                    type="button"
                    aria-pressed={taskView === 'ALL'}
                    onClick={() => setTaskView('ALL')}
                  >
                    Tất cả <span className="tabular-nums">{branchFilteredTasks.length}</span>
                  </Button>
                </div>
                <Select value={branchFilter} onValueChange={(value) => setBranchFilter(value ?? ALL_BRANCHES)}>
                  <SelectTrigger className="h-10 w-full bg-card sm:w-[220px]" aria-label="Lọc theo chi nhánh">
                    <ListFilter aria-hidden="true" className="text-muted-foreground" />
                    <SelectValue>
                      {branchFilter === ALL_BRANCHES
                          ? 'Lọc'
                          : selectedPlan.branches.find((branch) => branch.id === branchFilter)?.name ?? 'Lọc'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_BRANCHES}>Tất cả chi nhánh</SelectItem>
                    {selectedPlan.branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid min-h-[32rem] min-w-0 grid-cols-1 lg:grid-cols-[minmax(16rem,0.9fr)_minmax(0,1.6fr)]">
                <aside className="min-w-0 border-b border-border lg:border-b-0 lg:border-r" aria-label="Danh sách task cần xử lý">
                  <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <h3 className="text-sm font-semibold">
                      {taskView === 'OPEN' ? 'Chờ bạn xử lý' : 'Tất cả công việc'}
                    </h3>
                    <span className="text-xs tabular-nums text-muted-foreground">{visibleTasks.length}</span>
                  </div>
                  <div className="max-h-[28rem] overflow-y-auto lg:max-h-[calc(100vh-25rem)]">
                    <TaskQueue
                      tasks={visibleTasks}
                      selectedTaskId={selectedTaskId}
                      loading={loadingTasks}
                      error={tasksError}
                      onSelect={setSelectedTaskId}
                      onRetry={refreshAll}
                    />
                  </div>
                </aside>

                <article className="min-w-0 p-4 sm:p-5" aria-label="Chi tiết công việc đang chọn">
                  {loadingTasks ? (
                    <div className="flex flex-col gap-4" aria-busy="true">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                      <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                        {[0, 1, 2, 3, 4, 5].map((item) => <Skeleton className="h-14" key={item} />)}
                      </div>
                      <Skeleton className="h-28 w-full" />
                      <span className="sr-only" role="status">Đang tải chi tiết công việc</span>
                    </div>
                  ) : tasksError ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Chi tiết sẽ hiển thị sau khi tải lại hàng đợi.</p>
                  ) : !selectedTask ? (
                    <div className="flex min-h-64 items-center justify-center text-center">
                      <p className="max-w-[35ch] text-sm text-muted-foreground">
                        {taskView === 'OPEN'
                          ? 'Không có công việc cần xử lý trong kế hoạch này.'
                          : 'Chọn một công việc trong hàng đợi để xem chi tiết.'}
                      </p>
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-col gap-5">
                      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold text-pretty">{selectedTask.title}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Cập nhật {formatDate(selectedTask.updatedAt)}
                          </p>
                        </div>
                        <StatusBadge task={selectedTask} />
                      </div>

                      {selectedTask.description && (
                        <p className="text-sm text-pretty text-muted-foreground">{selectedTask.description}</p>
                      )}

                      <dl className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                        <div className="min-w-0 rounded-lg border border-border p-3">
                          <dt className="text-xs text-muted-foreground">Chỉ tiêu</dt>
                          <dd className="mt-1 break-words text-sm font-medium">{selectedTask.metric.name} · {selectedTask.metric.unit}</dd>
                        </div>
                        <div className="min-w-0 rounded-lg border border-border p-3">
                          <dt className="text-xs text-muted-foreground">Chi nhánh</dt>
                          <dd className="mt-1 break-words text-sm font-medium">{selectedTask.branch.name}</dd>
                        </div>
                        <div className="min-w-0 rounded-lg border border-border p-3">
                          <dt className="text-xs text-muted-foreground">Người nhận</dt>
                          <dd className="mt-1 break-words text-sm font-medium">{selectedTask.assignee.displayName}</dd>
                        </div>
                        <div className="min-w-0 rounded-lg border border-border p-3">
                          <dt className="text-xs text-muted-foreground">Hạn chót</dt>
                          <dd className={`mt-1 text-sm font-medium ${dueLabel(selectedTask.dueAt).startsWith('Quá hạn') ? 'text-amber-700 dark:text-orange-400' : ''}`}>
                            {dueLabel(selectedTask.dueAt)}
                          </dd>
                        </div>
                        <div className="min-w-0 rounded-lg border border-border p-3">
                          <dt className="text-xs text-muted-foreground">Người tạo</dt>
                          <dd className="mt-1 break-words text-sm font-medium">{selectedTask.createdBy.displayName}</dd>
                        </div>
                        <div className="min-w-0 rounded-lg border border-border p-3">
                          <dt className="text-xs text-muted-foreground">Kỳ kế hoạch</dt>
                          <dd className="mt-1 text-sm font-medium tabular-nums">
                            {formatDate(selectedPlan.periodStart)} – {formatDate(selectedPlan.periodEnd)}
                          </dd>
                        </div>
                      </dl>

                      <section className="min-w-0">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <h4 className="text-sm font-semibold">Kết quả mới nhất</h4>
                          {latestResult && <StatusBadge task={selectedTask} />}
                        </div>
                        {latestResult ? (
                          <div className="rounded-xl border border-border p-4">
                            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="break-words text-lg font-semibold tabular-nums">
                                  {formatNumber(latestResult.reportedValue)} {latestResult.reportedUnit}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Thực hiện {formatDate(latestResult.occurredAt)} · nộp bởi {latestResult.submittedBy.displayName}
                                </p>
                              </div>
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                Revision {latestResult.revision}
                              </span>
                            </div>
                            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-pretty text-muted-foreground">
                              {latestResult.narrative}
                            </p>
                            {latestResult.verification?.reason && (
                              <p className="mt-3 border-l-2 border-amber-500 pl-3 text-sm text-pretty text-amber-900 dark:text-amber-200">
                                {latestResult.verification.reason}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="rounded-xl border border-border px-4 py-6 text-center text-sm text-muted-foreground">
                            Chưa có kết quả được nộp.
                          </p>
                        )}
                      </section>

                      <section>
                        <h4 className="mb-3 text-sm font-semibold">Lịch sử kết quả</h4>
                        {selectedTask.results.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Lịch sử sẽ xuất hiện sau lần nộp kết quả đầu tiên.</p>
                        ) : (
                          <ol className="flex flex-col gap-3">
                            {selectedTask.results.map((result) => (
                              <li className="flex min-w-0 gap-3 border-l-2 border-border pl-3" key={result.id}>
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                                    <p className="text-sm font-medium">
                                      Revision {result.revision} · {verificationLabels[result.verification?.status ?? result.verificationStatus] ?? 'Chưa xác minh'}
                                    </p>
                                    <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                      {formatDate(result.verification?.createdAt ?? result.createdAt)}
                                    </time>
                                  </div>
                                  <p className="mt-1 text-sm text-pretty text-muted-foreground">
                                    {formatNumber(result.reportedValue)} {result.reportedUnit} · nộp bởi {result.submittedBy.displayName}
                                  </p>
                                  {result.evidenceFiles.length > 0 && (
                                    <ul className="mt-2 grid gap-2" aria-label={`Minh chứng revision ${result.revision}`}>
                                      {result.evidenceFiles.map(({ id, file }) => (
                                        <li className="grid min-w-0 grid-cols-[16px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs sm:grid-cols-[16px_minmax(0,1fr)_auto] sm:items-start" key={id}>
                                          <FileCheck2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                          <span className="min-w-0 break-words font-medium">{file.originalName}</span>
                                          <span className="col-start-2 text-muted-foreground sm:col-auto sm:shrink-0">
                                            {evidenceStatusLabel(file)} · {formatFileSize(file.sizeBytes)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {result.verification?.reason && (
                                    <p className="mt-1 text-sm text-pretty text-muted-foreground">{result.verification.reason}</p>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>

                      {(canSubmitSelected || canVerifySelected || (pendingVerification && latestResult?.submittedBy.id === staff?.id && canVerifyTasks)) && (
                        <section className="border-t border-border pt-4">
                          {actionError && <p className="mb-3 text-sm text-red-700 dark:text-red-300" role="alert">{actionError}</p>}
                          {pendingVerification && latestResult?.submittedBy.id === staff?.id && canVerifyTasks && (
                            <p className="mb-3 text-sm text-muted-foreground" role="status">
                              Bạn không thể tự xác minh revision mình đã nộp.
                            </p>
                          )}
                          {canSubmitSelected && (
                            <Button variant="default" type="button" onClick={openResultDialog}>
                              <FileCheck2 aria-hidden="true" />
                              {!latestResult
                                ? 'Nộp kết quả'
                                : latestResult.verification?.status === 'NEEDS_INFO' || latestResult.verification?.status === 'REJECTED'
                                  ? 'Nộp lại kết quả'
                                  : 'Nộp bản điều chỉnh'}
                            </Button>
                          )}
                          {canVerifySelected && latestResult && (
                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                              <Button
                                className="min-h-10"
                                variant="default"
                                type="button"
                                onClick={() => { void verifyResult('VERIFIED'); }}
                                disabled={reviewSubmitting}
                              >
                                <Check aria-hidden="true" />
                                Xác minh kết quả
                              </Button>
                              <Button
                                className="min-h-10"
                                variant="outline"
                                type="button"
                                onClick={() => openReviewDialog('NEEDS_INFO')}
                              >
                                Yêu cầu bổ sung
                              </Button>
                              <Button
                                className="min-h-10"
                                variant="destructive"
                                type="button"
                                onClick={() => openReviewDialog('REJECTED')}
                              >
                                Từ chối
                              </Button>
                            </div>
                          )}
                        </section>
                      )}
                    </div>
                  )}
                </article>
              </div>
            </section>
          </>
        ) : null}
      </div>

      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Tạo task</DialogTitle>
            <DialogDescription>Task được gắn với một chỉ tiêu và chi nhánh trong kế hoạch đang chọn.</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => { void createTask(event); }}>
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Tên công việc <span className="text-red-600">*</span></Label>
              <Input
                id="task-title"
                className="h-11 bg-card text-base md:h-10 md:text-sm"
                value={taskDraft.title}
                maxLength={160}
                onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))}
                required
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-metric">Chỉ tiêu <span className="text-red-600">*</span></Label>
                <Select value={taskDraft.metricId} onValueChange={(value) => setTaskDraft((current) => ({ ...current, metricId: value ?? '' }))}>
                  <SelectTrigger id="task-metric" className="h-11 w-full bg-card text-base md:h-10 md:text-sm">
                    <SelectValue placeholder="Chọn chỉ tiêu" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedPlan?.metrics.map((metric) => (
                      <SelectItem key={metric.id} value={metric.id}>{metric.name} · {metric.unit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-branch">Chi nhánh <span className="text-red-600">*</span></Label>
                <Select value={taskDraft.branchId} onValueChange={(value) => setTaskDraft((current) => ({ ...current, branchId: value ?? '' }))}>
                  <SelectTrigger id="task-branch" className="h-11 w-full bg-card text-base md:h-10 md:text-sm">
                    <SelectValue placeholder="Chọn chi nhánh" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedPlan?.branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {canReadUsers ? (
              <div className="space-y-1.5">
                <Label htmlFor="task-assignee">Người nhận</Label>
                <Select
                  value={taskDraft.assigneeId}
                  onValueChange={(value) => setTaskDraft((current) => ({ ...current, assigneeId: value ?? SELF_ASSIGNMENT }))}
                >
                  <SelectTrigger id="task-assignee" className="h-11 w-full bg-card text-base md:h-10 md:text-sm">
                    <SelectValue placeholder="Chọn người nhận" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELF_ASSIGNMENT}>Giao cho tôi</SelectItem>
                    {assignableUsers
                      .filter((user) => user.id !== staff?.id)
                      .map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.displayName} · @{user.username}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {loadingUsers && <p className="text-xs text-muted-foreground" role="status">Đang tải nhân viên…</p>}
                {usersError && <p className="text-xs text-amber-800" role="status">{usersError} Task vẫn có thể được giao cho bạn.</p>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Task sẽ được giao cho bạn. Cần quyền <code>users.read</code> để chọn người nhận khác.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Hạn chót</Label>
              <Input
                id="task-due"
                type="date"
                className="h-11 bg-card text-base md:h-10 md:text-sm"
                value={taskDraft.dueAt}
                onChange={(event) => setTaskDraft((current) => ({ ...current, dueAt: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-description">Mô tả</Label>
              <Textarea
                id="task-description"
                className="min-h-24 bg-card text-base md:text-sm"
                value={taskDraft.description}
                maxLength={2000}
                onChange={(event) => setTaskDraft((current) => ({ ...current, description: event.target.value }))}
              />
            </div>
            <div className="min-h-5">
              {taskFormError && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{taskFormError}</p>}
            </div>
            <DialogFooter>
              <Button className="min-h-11 md:min-h-10" variant="outline" type="button" onClick={() => setTaskDialogOpen(false)}>
                Hủy
              </Button>
              <Button className="min-h-11 md:min-h-10" variant="default" type="submit" disabled={taskCreating}>
                {taskCreating && <RotateCw className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                Tạo task
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {!latestResult
                ? 'Nộp kết quả'
                : latestResult.verification?.status === 'NEEDS_INFO' || latestResult.verification?.status === 'REJECTED'
                  ? 'Nộp lại kết quả'
                  : 'Nộp bản điều chỉnh'}
            </DialogTitle>
            <DialogDescription>
              Kết quả được lưu thành revision mới; đơn vị đo được cố định theo chỉ tiêu của task.
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => { void submitResult(event); }}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="result-value">Số thực đạt <span className="text-red-600">*</span></Label>
                <Input
                  id="result-value"
                  type="number"
                  min="0"
                  max="9999999999999"
                  step="0.001"
                  className="h-11 bg-card text-base md:h-10 md:text-sm"
                  value={resultDraft.value}
                  onChange={(event) => setResultDraft((current) => ({ ...current, value: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Đơn vị</Label>
                <p className="flex h-11 items-center rounded-lg border border-input bg-muted px-3 text-sm md:h-10">
                  {selectedTask?.metric.unit ?? '—'}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="result-date">Ngày thực hiện <span className="text-red-600">*</span></Label>
              <Input
                id="result-date"
                type="date"
                className="h-11 bg-card text-base md:h-10 md:text-sm"
                value={resultDraft.occurredAt}
                onChange={(event) => setResultDraft((current) => ({ ...current, occurredAt: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="result-narrative">Giải trình <span className="text-red-600">*</span></Label>
              <Textarea
                id="result-narrative"
                className="min-h-28 bg-card text-base md:text-sm"
                value={resultDraft.narrative}
                maxLength={4000}
                onChange={(event) => setResultDraft((current) => ({ ...current, narrative: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Minh chứng</Label>
              <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground" role="status">
                Tải tệp minh chứng (PDF, JPG/JPEG, PNG; tối đa 10 MB) đang bị khóa cho đến khi cấu hình scanner, retention, quyền xóa và legal hold.
              </p>
            </div>
            <div className="min-h-5">
              {resultFormError && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{resultFormError}</p>}
            </div>
            <DialogFooter>
              <Button className="min-h-11 md:min-h-10" variant="outline" type="button" onClick={() => setResultDialogOpen(false)}>
                Hủy
              </Button>
              <Button className="min-h-11 md:min-h-10" variant="default" type="submit" disabled={resultSubmitting}>
                {resultSubmitting && <RotateCw className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                Nộp kết quả
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewDecision !== null} onOpenChange={(open) => { if (!open) setReviewDecision(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{reviewDecision === 'REJECTED' ? 'Từ chối kết quả' : 'Yêu cầu bổ sung'}</DialogTitle>
            <DialogDescription>
              Lý do được lưu trong lịch sử xác minh để người nhận biết nội dung cần xử lý.
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => { void submitReviewReason(event); }}>
            <div className="space-y-1.5">
              <Label htmlFor="review-reason">Lý do <span className="text-red-600">*</span></Label>
              <Textarea
                id="review-reason"
                className="min-h-24 bg-card text-base md:text-sm"
                value={reviewReason}
                maxLength={1000}
                onChange={(event) => setReviewReason(event.target.value)}
                required
              />
            </div>
            <div className="min-h-5">
              {actionError && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{actionError}</p>}
            </div>
            <DialogFooter>
              <Button className="min-h-11 md:min-h-10" variant="outline" type="button" onClick={() => setReviewDecision(null)}>
                Hủy
              </Button>
              <Button
                className="min-h-11 md:min-h-10"
                variant={reviewDecision === 'REJECTED' ? 'destructive' : 'default'}
                type="submit"
                disabled={reviewSubmitting}
              >
                {reviewSubmitting && <RotateCw className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                Gửi quyết định
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </WorkspaceLayout>
  );
}
