'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, RotateCw, Send, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { useCrmSession } from '@/components/crm-session';
import type { BranchOption } from '@/lib/crm-access';
import { request } from '@/lib/crm-api';

type PlanMetric = {
  id: string;
  name: string;
  unit: string;
  target: number;
};

type PlanApproval = {
  id: string;
  version: number;
  decision: 'APPROVED' | 'REJECTED';
  reason: string | null;
  createdAt: string;
  reviewer: { id: string; username: string; displayName: string };
};

type Plan = {
  id: string;
  name: string;
  description: string | null;
  createdById: string;
  branches: Pick<BranchOption, 'id' | 'code' | 'name'>[];
  periodStart: string;
  periodEnd: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'ARCHIVED';
  approvalVersion: number;
  createdAt: string;
  metrics: PlanMetric[];
  approvals: PlanApproval[];
};

type CatalogItem = { id: string; name: string; unit: string; isActive: boolean };
type MetricDraft = { catalogId: string; target: string };
type ApprovalDecision = 'APPROVED' | 'REJECTED';

const emptyMetric = (): MetricDraft => ({ catalogId: '', target: '' });

const statusLabels: Record<string, string> = {
  DRAFT: 'Bản nháp',
  PENDING_APPROVAL: 'Chờ duyệt',
  ACTIVE: 'Đang thực hiện',
  REJECTED: 'Bị từ chối',
  ARCHIVED: 'Đã lưu trữ',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

function dateInputValue(value: string) {
  return value.slice(0, 10);
}

function dateStartIso(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function formatTarget(value: number) {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
}

function sortPlans(plans: Plan[]) {
  return [...plans].sort((a, b) =>
    b.periodStart.localeCompare(a.periodStart) || b.id.localeCompare(a.id),
  );
}

function useDelayedLoading(isLoading: boolean) {
  const [visible, setVisible] = useState(false);
  const visibleSince = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isLoading && !visible) {
      timer = setTimeout(() => {
        visibleSince.current = Date.now();
        setVisible(true);
      }, 300);
    } else if (!isLoading && visible) {
      timer = setTimeout(
        () => setVisible(false),
        Math.max(0, 500 - (Date.now() - visibleSince.current)),
      );
    }

    return () => { if (timer) clearTimeout(timer); };
  }, [isLoading, visible]);

  return visible;
}

export function PlansPage() {
  const { session, staff, can } = useCrmSession();
  const canReadPlans = can('plans.read');
  const canManagePlans = can('plans.manage');
  const canApprovePlans = can('plans.approve');
  const canManageCatalog = Boolean(
    can('plans.catalog.manage')
    && staff?.roles.some((role) => ['ADMIN', 'OPERATOR'].includes(role.key) && role.scope.global),
  );
  const canDeletePlans = Boolean(staff?.roles.some((role) =>
    ['ADMIN', 'OPERATOR'].includes(role.key) && role.scope.global,
  ));
  const canReadBranches = can('branches.read');
  const accessToken = session?.accessToken;
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState('');
  const [plansRequestVersion, setPlansRequestVersion] = useState(0);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRequestVersion, setCatalogRequestVersion] = useState(0);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchesError, setBranchesError] = useState('');
  const [branchesRequestVersion, setBranchesRequestVersion] = useState(0);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [approvalDecision, setApprovalDecision] = useState<ApprovalDecision | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [createError, setCreateError] = useState('');
  const [editError, setEditError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [approvalError, setApprovalError] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [branchId, setBranchId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [metrics, setMetrics] = useState<MetricDraft[]>([emptyMetric()]);
  const [editPeriodStart, setEditPeriodStart] = useState('');
  const [editPeriodEnd, setEditPeriodEnd] = useState('');
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [branchToAdd, setBranchToAdd] = useState('');

  const activeBranches = useMemo(
    () => branches.filter((branch) => branch.status === 'ACTIVE'),
    [branches],
  );
  const activeCatalogItems = useMemo(
    () => catalogItems.filter((item) => item.isActive),
    [catalogItems],
  );
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const selectedBranchIds = selectedPlan?.branches.map((branch) => branch.id) ?? [];
  const addableBranches = activeBranches.filter((branch) => !editBranchIds.includes(branch.id));
  const showPlanSkeleton = useDelayedLoading(loadingPlans);

  useEffect(() => {
    let active = true;
    setPlans([]);
    setSelectedPlanId(null);
    setPlansError('');
    if (!accessToken || !canReadPlans) {
      setLoadingPlans(false);
      return () => { active = false; };
    }

    setLoadingPlans(true);
    void request<Plan[]>('/plans', {}, accessToken)
      .then((nextPlans) => {
        if (!active) return;
        const sortedPlans = sortPlans(nextPlans);
        setPlans(sortedPlans);
        setSelectedPlanId(sortedPlans[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (active) {
          setPlansError(cause instanceof Error ? cause.message : 'Không thể tải danh sách kế hoạch.');
        }
      })
      .finally(() => {
        if (active) setLoadingPlans(false);
      });

    return () => { active = false; };
  }, [accessToken, canReadPlans, plansRequestVersion]);

  useEffect(() => {
    let active = true;
    setCatalogItems([]);
    setCatalogError('');
    if (!accessToken || !canReadPlans) {
      setLoadingCatalog(false);
      return () => { active = false; };
    }

    setLoadingCatalog(true);
    void request<CatalogItem[]>('/plans/metric-catalog', {}, accessToken)
      .then((items) => {
        if (active) setCatalogItems(items);
      })
      .catch((cause: unknown) => {
        if (active) {
          setCatalogError(cause instanceof Error ? cause.message : 'Không thể tải danh mục KPI.');
        }
      })
      .finally(() => {
        if (active) setLoadingCatalog(false);
      });

    return () => { active = false; };
  }, [accessToken, canReadPlans, catalogRequestVersion]);

  useEffect(() => {
    if (!accessToken || !canReadBranches) {
      setBranches([]);
      setBranchId('');
      setBranchesError('');
      setLoadingBranches(false);
      return;
    }

    let active = true;
    setBranches([]);
    setBranchId('');
    setLoadingBranches(true);
    setBranchesError('');
    void request<BranchOption[]>('/access/branches', {}, accessToken)
      .then((nextBranches) => {
        if (!active) return;
        setBranches(nextBranches);
        setBranchId((current) =>
          nextBranches.some((branch) => branch.id === current && branch.status === 'ACTIVE')
            ? current
            : nextBranches.find((branch) => branch.status === 'ACTIVE')?.id ?? '',
        );
      })
      .catch((cause: unknown) => {
        if (active) {
          setBranchesError(cause instanceof Error ? cause.message : 'Không thể tải danh sách chi nhánh.');
        }
      })
      .finally(() => {
        if (active) setLoadingBranches(false);
      });

    return () => { active = false; };
  }, [accessToken, branchesRequestVersion, canReadBranches]);

  function updateMetric(index: number, field: keyof MetricDraft, value: string) {
    setMetrics((current) => current.map((metric, metricIndex) =>
      metricIndex === index ? { ...metric, [field]: value } : metric,
    ));
  }

  function resetForm() {
    setName('');
    setDescription('');
    setPeriodStart('');
    setPeriodEnd('');
    setMetrics([emptyMetric()]);
    setCreateError('');
  }

  function openEditDialog(plan: Plan) {
    setEditPeriodStart(dateInputValue(plan.periodStart));
    setEditPeriodEnd(dateInputValue(plan.periodEnd));
    setEditBranchIds(plan.branches.map((branch) => branch.id));
    setBranchToAdd('');
    setEditError('');
    setEditDialogOpen(true);
  }

  async function updatePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !selectedPlan) {
      setEditError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }
    if (!editPeriodStart || !editPeriodEnd || editPeriodStart >= editPeriodEnd) {
      setEditError('Ngày kết thúc phải sau ngày bắt đầu.');
      return;
    }

    const currentBranchIds = selectedPlan.branches.map((branch) => branch.id);
    const addBranchIds = editBranchIds.filter((id) => !currentBranchIds.includes(id));
    const removeBranchIds = currentBranchIds.filter((id) => !editBranchIds.includes(id));
    setEditing(true);
    setEditError('');
    try {
      const updated = await request<Plan>(`/plans/${selectedPlan.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          periodStart: dateStartIso(editPeriodStart),
          periodEnd: dateStartIso(editPeriodEnd),
          addBranchIds,
          removeBranchIds,
        }),
      }, accessToken);
      setPlans((current) => sortPlans(current.map((plan) => plan.id === updated.id ? updated : plan)));
      setSelectedPlanId(updated.id);
      setNotice('Đã cập nhật kế hoạch.');
      setEditDialogOpen(false);
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : 'Không thể cập nhật kế hoạch.');
    } finally {
      setEditing(false);
    }
  }

  async function deletePlan() {
    if (!accessToken || !selectedPlan || !canDeletePlans) {
      setDeleteError('Chỉ quản trị viên hoặc vận hành hệ thống toàn hệ thống mới được phép xóa kế hoạch.');
      return;
    }

    const deletedPlanId = selectedPlan.id;
    setDeleting(true);
    setDeleteError('');
    try {
      await request<{ id: string; deletedAt: string }>(`/plans/${deletedPlanId}`, {
        method: 'DELETE',
      }, accessToken);
      const remaining = sortPlans(plans.filter((plan) => plan.id !== deletedPlanId));
      setPlans(remaining);
      setSelectedPlanId((currentSelectedId) =>
        currentSelectedId === deletedPlanId ? remaining[0]?.id ?? null : currentSelectedId,
      );
      setNotice('Đã xóa kế hoạch.');
      setDeleteDialogOpen(false);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Không thể xóa kế hoạch.');
    } finally {
      setDeleting(false);
    }
  }

  async function submitPlanForApproval(plan: Plan) {
    if (!accessToken || !canManagePlans) return;
    setApprovalSubmitting(true);
    setApprovalError('');
    try {
      const updated = await request<Plan>(`/plans/${plan.id}/submissions`, { method: 'POST' }, accessToken);
      setPlans((current) => sortPlans(current.map((item) => item.id === updated.id ? updated : item)));
      setSelectedPlanId(updated.id);
      setNotice('Đã gửi kế hoạch để phê duyệt.');
    } catch (cause) {
      setApprovalError(cause instanceof Error ? cause.message : 'Không thể gửi kế hoạch để phê duyệt.');
    } finally {
      setApprovalSubmitting(false);
    }
  }

  async function reviewPlan(decision: ApprovalDecision, reason = '') {
    if (!accessToken || !selectedPlan || !canApprovePlans) return;
    setApprovalSubmitting(true);
    setApprovalError('');
    try {
      const updated = await request<Plan>(`/plans/${selectedPlan.id}/approvals`, {
        method: 'POST',
        body: JSON.stringify({ decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      }, accessToken);
      setPlans((current) => sortPlans(current.map((item) => item.id === updated.id ? updated : item)));
      setSelectedPlanId(updated.id);
      setNotice(decision === 'APPROVED' ? 'Đã duyệt kế hoạch.' : 'Đã từ chối kế hoạch.');
      setApprovalDialogOpen(false);
      setApprovalDecision(null);
      setApprovalReason('');
    } catch (cause) {
      setApprovalError(cause instanceof Error ? cause.message : 'Không thể cập nhật quyết định phê duyệt.');
    } finally {
      setApprovalSubmitting(false);
    }
  }

  async function archivePlan(plan: Plan) {
    if (!accessToken || !canManagePlans || plan.status !== 'ACTIVE') return;
    setArchiving(true);
    setApprovalError('');
    try {
      const updated = await request<Plan>(`/plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ARCHIVED' }),
      }, accessToken);
      setPlans((current) => sortPlans(current.map((item) => item.id === updated.id ? updated : item)));
      setNotice('Đã lưu trữ kế hoạch.');
    } catch (cause) {
      setApprovalError(cause instanceof Error ? cause.message : 'Không thể lưu trữ kế hoạch.');
    } finally {
      setArchiving(false);
    }
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      setCreateError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }

    const normalizedMetrics = metrics.map((metric) => ({
      catalogId: metric.catalogId,
      target: Number(metric.target),
    }));

    if (name.trim().length < 2 || name.trim().length > 160) {
      setCreateError('Tên kế hoạch cần có từ 2 đến 160 ký tự.');
      return;
    }
    if (!branchId || !activeBranches.some((branch) => branch.id === branchId)) {
      setCreateError('Hãy chọn một chi nhánh đang hoạt động.');
      return;
    }
    if (periodStart >= periodEnd) {
      setCreateError('Ngày kết thúc phải sau ngày bắt đầu.');
      return;
    }
    if (new Set(normalizedMetrics.map((metric) => metric.catalogId)).size !== normalizedMetrics.length) {
      setCreateError('Mỗi hạng mục chỉ được chọn một lần trong cùng kế hoạch.');
      return;
    }
    if (normalizedMetrics.some((metric) =>
      !activeCatalogItems.some((item) => item.id === metric.catalogId),
    )) {
      setCreateError('Hãy chọn hạng mục đang hoạt động trong danh mục KPI.');
      return;
    }
    if (normalizedMetrics.some((metric) => !Number.isFinite(metric.target) || metric.target < 0)) {
      setCreateError('Chỉ tiêu phải là số không âm.');
      return;
    }

    setSubmitting(true);
    setCreateError('');
    try {
      const created = await request<Plan>('/plans', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          branchIds: [branchId],
          periodStart: dateStartIso(periodStart),
          periodEnd: dateStartIso(periodEnd),
          metrics: normalizedMetrics,
        }),
      }, accessToken);
      if (canReadPlans) {
        setPlans((current) => sortPlans([created, ...current.filter((plan) => plan.id !== created.id)]));
        setSelectedPlanId(created.id);
      }
      setNotice('Đã tạo kế hoạch nháp.');
      setCreateDialogOpen(false);
      resetForm();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Không thể tạo kế hoạch.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <WorkspaceLayout
      activeSection="plans"
      requiredPermission={['plans.read', 'plans.manage']}
    >
      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Kế hoạch &amp; chỉ tiêu</h1>
            <p className="text-sm text-muted-foreground">Theo dõi mục tiêu theo chi nhánh và kỳ.</p>
            {canManagePlans && !canReadBranches && (
              <p className="pt-1 text-sm text-amber-800" role="status">
                Cần quyền xem chi nhánh để chọn nơi tạo kế hoạch.
              </p>
            )}
            {canManagePlans && canReadBranches && !loadingBranches && !branchesError && activeBranches.length === 0 && (
              <p className="pt-1 text-sm text-amber-800" role="status">
                Chưa có chi nhánh đang hoạt động trong phạm vi được cấp.
              </p>
            )}
            {branchesError && (
              <div className="flex flex-wrap items-center gap-2 pt-1" role="alert">
                <p className="text-sm text-destructive">{branchesError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBranchesRequestVersion((version) => version + 1)}
                >
                  <RotateCw data-icon="inline-start" />
                  Tải lại chi nhánh
                </Button>
              </div>
            )}
            {canManagePlans && catalogError && (
              <div className="flex flex-wrap items-center gap-2 pt-1" role="alert">
                <p className="text-sm text-destructive">{catalogError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCatalogRequestVersion((version) => version + 1)}
                >
                  <RotateCw data-icon="inline-start" />
                  Tải lại danh mục
                </Button>
              </div>
            )}
          </div>
          {canManagePlans && (
            <Dialog
              open={createDialogOpen}
              disablePointerDismissal
              onOpenChange={(open, details) => {
                if (open || details.reason === 'close-press') {
                  setCreateDialogOpen(open);
                  if (!open) resetForm();
                }
              }}
            >
              <DialogTrigger
                render={
                  <Button
                    type="button"
                    disabled={!canReadBranches || loadingBranches || Boolean(branchesError) || activeBranches.length === 0 || loadingCatalog || Boolean(catalogError) || activeCatalogItems.length === 0}
                  >
                    <Plus data-icon="inline-start" />
                    Tạo kế hoạch
                  </Button>
                }
              />
              <DialogContent className="sm:max-w-2xl" closeLabel="Đóng">
                <DialogHeader className="pr-10">
                  <DialogTitle>Tạo kế hoạch nháp</DialogTitle>
                  <DialogDescription>
                    Nhập thông tin kỳ kế hoạch và các chỉ tiêu cần theo dõi.
                  </DialogDescription>
                </DialogHeader>
                {loadingCatalog && <p className="text-sm text-muted-foreground" role="status">Đang tải danh mục hạng mục KPI…</p>}
                {catalogError && (
                  <div className="flex flex-wrap items-center gap-2" role="alert">
                    <p className="text-sm text-destructive">{catalogError}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => setCatalogRequestVersion((version) => version + 1)}>
                      <RotateCw data-icon="inline-start" />
                      Tải lại
                    </Button>
                  </div>
                )}
                {!loadingCatalog && !catalogError && activeCatalogItems.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Chưa có hạng mục KPI đang hoạt động. {canManageCatalog
                      ? <a className="font-medium text-foreground underline-offset-4 hover:underline" href="/plans/catalog">Mở danh mục để tạo mới.</a>
                      : 'Vui lòng liên hệ quản trị viên để bổ sung danh mục.'}
                  </p>
                )}
                {createError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{createError}</p>}
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { void createPlan(event); }}>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="plan-name">Tên kế hoạch</Label>
                    <Input
                      id="plan-name"
                      autoFocus
                      className="bg-white"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      minLength={2}
                      maxLength={160}
                      required
                    />
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="plan-description">Mô tả <span className="text-muted-foreground">(không bắt buộc)</span></Label>
                    <Textarea
                      id="plan-description"
                      className="bg-white"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      maxLength={1000}
                    />
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="plan-branch">Chi nhánh</Label>
                    <Select value={branchId} onValueChange={(value) => setBranchId(value ?? '')}>
                      <SelectTrigger id="plan-branch" className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10 bg-card">
                        <SelectValue placeholder="Chọn chi nhánh">
                          {activeBranches.find((branch) => branch.id === branchId)?.name}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {activeBranches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id} className="mb-1">{branch.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="plan-start">Ngày bắt đầu</Label>
                    <Input
                      id="plan-start"
                      type="date"
                      className="bg-card"
                      value={periodStart}
                      onChange={(event) => setPeriodStart(event.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="plan-end">Ngày kết thúc</Label>
                    <Input
                      id="plan-end"
                      type="date"
                      className="bg-card"
                      value={periodEnd}
                      onChange={(event) => setPeriodEnd(event.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-3 sm:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Chỉ tiêu</h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={metrics.length >= 100 || metrics.length >= activeCatalogItems.length}
                        onClick={() => setMetrics((current) => [...current, emptyMetric()])}
                      >
                        <Plus data-icon="inline-start" />
                        Thêm chỉ tiêu
                      </Button>
                    </div>
                    {metrics.map((metric, index) => {
                      const chosenElsewhere = new Set(
                        metrics.filter((_, metricIndex) => metricIndex !== index).map((item) => item.catalogId),
                      );
                      const availableCatalogItems = activeCatalogItems.filter(
                        (item) => item.id === metric.catalogId || !chosenElsewhere.has(item.id),
                      );
                      const chosenItem = activeCatalogItems.find((item) => item.id === metric.catalogId);
                      return (
                      <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_auto]" key={index}>
                        <div className="grid min-w-0 gap-2">
                          <Label htmlFor={`metric-catalog-${index}`}>Hạng mục</Label>
                          <Select value={metric.catalogId} onValueChange={(value) => updateMetric(index, 'catalogId', value ?? '')}>
                            <SelectTrigger id={`metric-catalog-${index}`} className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10 bg-card" disabled={activeCatalogItems.length === 0}>
                              <SelectValue placeholder="Chọn hạng mục">
                                {chosenItem ? `${chosenItem.name} · ${chosenItem.unit}` : undefined}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {availableCatalogItems.map((item) => (
                                <SelectItem key={item.id} value={item.id}>{item.name} · {item.unit}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid min-w-0 gap-2">
                          <Label htmlFor={`metric-target-${index}`}>Mục tiêu</Label>
                          <Input
                            id={`metric-target-${index}`}
                            className="bg-card"
                            type="number"
                            min="0"
                            max="9999999999999"
                            step="0.001"
                            value={metric.target}
                            onChange={(event) => updateMetric(index, 'target', event.target.value)}
                            required
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Xóa chỉ tiêu ${index + 1}`}
                            disabled={metrics.length === 1}
                            onClick={() => setMetrics((current) => current.filter((_, metricIndex) => metricIndex !== index))}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    );})}
                  </div>
                  <div className="flex justify-end sm:col-span-2">
                    <Button type="submit" disabled={submitting || !branchId || !canManagePlans || loadingCatalog || Boolean(catalogError) || activeCatalogItems.length === 0}>
                      {submitting ? 'Đang tạo…' : 'Tạo kế hoạch'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {canManagePlans && selectedPlan && (
          <Dialog
            open={editDialogOpen}
            disablePointerDismissal
            onOpenChange={(open, details) => {
              if (open || details.reason === 'close-press') {
                setEditDialogOpen(open);
                if (!open) setEditError('');
              }
            }}
          >
            <DialogContent className="sm:max-w-xl" closeLabel="Đóng">
              <DialogHeader className="pr-10">
                <DialogTitle>Chỉnh sửa kế hoạch</DialogTitle>
                <DialogDescription>{selectedPlan.name}</DialogDescription>
              </DialogHeader>
              {editError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{editError}</p>}
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { void updatePlan(event); }}>
                <div className="grid gap-2">
                  <Label htmlFor="edit-plan-start">Ngày bắt đầu</Label>
                  <Input
                    id="edit-plan-start"
                    type="date"
                    className="bg-card"
                    value={editPeriodStart}
                    onChange={(event) => setEditPeriodStart(event.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-plan-end">Ngày kết thúc</Label>
                  <Input
                    id="edit-plan-end"
                    type="date"
                    className="bg-card"
                    value={editPeriodEnd}
                    onChange={(event) => setEditPeriodEnd(event.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="edit-plan-branch">Chi nhánh áp dụng</Label>
                  <div className="flex flex-wrap gap-2">
                    {editBranchIds.map((id) => {
                      const branch = activeBranches.find((item) => item.id === id)
                        ?? selectedPlan.branches.find((item) => item.id === id);
                      if (!branch) return null;
                      return (
                        <span className="inline-flex min-w-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-sm" key={id}>
                          <span className="max-w-64 truncate" title={branch.name}>{branch.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Xóa chi nhánh ${branch.name}`}
                            onClick={() => setEditBranchIds((current) => current.filter((branchId) => branchId !== id))}
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </span>
                      );
                    })}
                    {editBranchIds.length === 0 && (
                      <span className="text-sm text-muted-foreground">Chưa áp dụng cho chi nhánh nào.</span>
                    )}
                  </div>
                  <Select value={branchToAdd} onValueChange={(value) => {
                    if (!value) return;
                    setEditBranchIds((current) => current.includes(value) ? current : [...current, value]);
                    setBranchToAdd('');
                  }}>
                    <SelectTrigger id="edit-plan-branch" className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10 bg-card" disabled={addableBranches.length === 0}>
                      <SelectValue placeholder={addableBranches.length ? 'Thêm chi nhánh áp dụng' : 'Không còn chi nhánh để thêm'} />
                    </SelectTrigger>
                    <SelectContent>
                      {addableBranches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id} className="mb-1">{branch.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end sm:col-span-2">
                  <Button type="submit" disabled={editing}>
                    {editing ? 'Đang lưu…' : 'Lưu thay đổi'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}

        {canApprovePlans && (
          <Dialog
            open={approvalDialogOpen}
            disablePointerDismissal
            onOpenChange={(open, details) => {
              if (open || details.reason === 'close-press') {
                setApprovalDialogOpen(open);
                if (!open) {
                  setApprovalDecision(null);
                  setApprovalReason('');
                  setApprovalError('');
                }
              }
            }}
          >
            <DialogContent className="sm:max-w-lg" closeLabel="Đóng">
              <DialogHeader className="pr-10">
                <DialogTitle>Từ chối kế hoạch</DialogTitle>
                <DialogDescription>
                  Vui lòng nêu lý do để người tạo có thể điều chỉnh và gửi lại kế hoạch.
                </DialogDescription>
              </DialogHeader>
              {approvalError && <p className="text-sm text-destructive" role="alert">{approvalError}</p>}
              <form className="grid gap-4" onSubmit={(event) => {
                event.preventDefault();
                if (approvalDecision === 'REJECTED') void reviewPlan('REJECTED', approvalReason);
              }}>
                <div className="grid gap-2">
                  <Label htmlFor="plan-rejection-reason">Lý do từ chối <span className="text-red-600">*</span></Label>
                  <Textarea
                    id="plan-rejection-reason"
                    className="min-h-24 bg-card"
                    value={approvalReason}
                    onChange={(event) => setApprovalReason(event.target.value)}
                    minLength={1}
                    maxLength={1000}
                    required
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={approvalSubmitting || !approvalReason.trim()}>
                    {approvalSubmitting ? 'Đang gửi…' : 'Từ chối kế hoạch'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}

        {canDeletePlans && selectedPlan && (
          <Dialog
            open={deleteDialogOpen}
            disablePointerDismissal
            onOpenChange={(open, details) => {
              if (open || details.reason === 'close-press') {
                setDeleteDialogOpen(open);
                if (!open) setDeleteError('');
              }
            }}
          >
            <DialogContent className="sm:max-w-md" closeLabel="Đóng">
              <DialogHeader className="pr-10">
                <DialogTitle>Xóa kế hoạch?</DialogTitle>
                <DialogDescription>
                  Kế hoạch <strong className="break-words text-foreground">{selectedPlan.name}</strong> sẽ được ẩn khỏi danh sách. Dữ liệu được giữ lại.
                </DialogDescription>
              </DialogHeader>
              {deleteError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{deleteError}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={deleting} onClick={() => setDeleteDialogOpen(false)}>
                  Hủy
                </Button>
                <Button type="button" disabled={deleting} onClick={() => { void deletePlan(); }}>
                  {deleting ? 'Đang xóa…' : 'Xóa kế hoạch'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {notice && <p className="text-sm text-emerald-800" role="status">{notice}</p>}
        {loadingPlans && <span className="sr-only" role="status">Đang tải danh sách kế hoạch.</span>}

        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(260px,0.82fr)_minmax(0,1.18fr)]">
          <Card className="min-w-0 gap-0 overflow-hidden py-0">
            <CardHeader className="flex grid-cols-[1fr_auto] items-center gap-2 border-b px-4 py-4">
              <CardTitle className="text-base">Kế hoạch</CardTitle>
              <span className="text-sm text-muted-foreground">
                {loadingPlans ? '' : canReadPlans ? plans.length : '—'}
              </span>
            </CardHeader>
            {showPlanSkeleton ? (
              <CardContent aria-busy="true" className="divide-y p-0">
                <ul className="divide-y" aria-hidden="true">
                  {Array.from({ length: 4 }, (_, index) => (
                    <li className="grid gap-2 p-4" key={index}>
                      <Skeleton className="h-4 w-4/5 bg-foreground/5 motion-reduce:animate-none" />
                      <Skeleton className="h-3 w-3/5 bg-foreground/5 motion-reduce:animate-none" />
                      <Skeleton className="h-5 w-16 bg-foreground/5 motion-reduce:animate-none" />
                    </li>
                  ))}
                </ul>
              </CardContent>
            ) : loadingPlans ? (
              <CardContent aria-busy="true" className="min-h-60 p-0" />
            ) : plansError ? (
              <div className="grid justify-items-center gap-3 p-6 text-center" role="alert">
                <div>
                  <p className="text-sm font-medium text-destructive">Không tải được danh sách kế hoạch</p>
                  <p className="mt-1 text-sm text-muted-foreground">{plansError}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPlansRequestVersion((version) => version + 1)}
                >
                  <RotateCw data-icon="inline-start" />
                  Thử lại
                </Button>
              </div>
            ) : !canReadPlans ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Bạn chưa được cấp quyền xem danh sách kế hoạch.
              </p>
            ) : plans.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Chưa có kế hoạch nào trong phạm vi này.
              </p>
            ) : (
              <CardContent className="max-h-none divide-y overflow-y-auto p-0 lg:max-h-[min(68vh,680px)]">
                {plans.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    className={`grid w-full min-w-0 gap-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedPlanId === plan.id ? 'bg-accent hover:bg-accent' : 'bg-card hover:bg-primary/10'}`}
                    aria-current={selectedPlanId === plan.id ? 'true' : undefined}
                    onClick={() => setSelectedPlanId(plan.id)}
                  >
                    <strong className="line-clamp-1 break-words text-sm font-medium md:line-clamp-2" title={plan.name}>{plan.name}</strong>
                    <span className="flex min-w-0 flex-nowrap items-center gap-x-3 text-xs text-muted-foreground md:flex-wrap md:gap-y-1">
                      <span className="min-w-0 flex-1 truncate md:flex-none md:overflow-visible md:text-clip md:whitespace-normal">
                        {plan.branches.map((branch) => branch.name).join(', ') || 'Chưa gán chi nhánh'}
                      </span>
                      <span className="shrink-0 whitespace-nowrap">{formatDate(plan.periodStart)} – {formatDate(plan.periodEnd)}</span>
                    </span>
                    <Badge variant={plan.status === 'DRAFT' ? 'outline' : 'secondary'} className="w-fit">
                      {statusLabels[plan.status] ?? plan.status}
                    </Badge>
                  </button>
                ))}
              </CardContent>
            )}
          </Card>

          <Card className="min-w-0 gap-0 py-0">
            {showPlanSkeleton ? (
              <CardContent aria-busy="true" className="grid gap-5 p-5 sm:p-6">
                <Skeleton className="h-6 w-3/4 bg-foreground/5 motion-reduce:animate-none" />
                <Skeleton className="h-4 w-2/5 bg-foreground/5 motion-reduce:animate-none" />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Skeleton className="h-16 bg-foreground/5 motion-reduce:animate-none" />
                  <Skeleton className="h-16 bg-foreground/5 motion-reduce:animate-none" />
                  <Skeleton className="h-16 bg-foreground/5 motion-reduce:animate-none" />
                </div>
                <Skeleton className="h-28 bg-foreground/5 motion-reduce:animate-none" />
              </CardContent>
            ) : loadingPlans ? (
              <CardContent aria-busy="true" className="min-h-60 p-0" />
            ) : plansError ? (
              <p className="p-5 text-sm text-muted-foreground">
                Chi tiết kế hoạch sẽ hiển thị sau khi tải lại danh sách.
              </p>
            ) : !canReadPlans ? (
              <p className="p-5 text-sm text-muted-foreground">
                Chi tiết chỉ khả dụng khi tài khoản được cấp quyền xem kế hoạch.
              </p>
            ) : selectedPlan ? (
              <CardContent className="grid gap-5 p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <h2 className="break-words text-lg font-semibold tracking-tight">{selectedPlan.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedPlan.branches.map((branch) => branch.name).join(', ') || 'Chưa gán chi nhánh'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge variant={selectedPlan.status === 'DRAFT' ? 'outline' : 'secondary'} className="w-fit">
                      {statusLabels[selectedPlan.status] ?? selectedPlan.status}
                    </Badge>
                    {canManagePlans && (selectedPlan.status === 'DRAFT' || selectedPlan.status === 'REJECTED') && (
                      <Button
                        type="button"
                        disabled={approvalSubmitting}
                        onClick={() => { void submitPlanForApproval(selectedPlan); }}
                      >
                        <Send data-icon="inline-start" />
                        {selectedPlan.status === 'REJECTED' ? 'Gửi lại duyệt' : 'Gửi duyệt'}
                      </Button>
                    )}
                    {canApprovePlans && selectedPlan.status === 'PENDING_APPROVAL' && selectedPlan.createdById !== staff?.id && (
                      <>
                        <Button
                          type="button"
                          disabled={approvalSubmitting}
                          onClick={() => { void reviewPlan('APPROVED'); }}
                        >
                          <Check data-icon="inline-start" />
                          Duyệt
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={approvalSubmitting}
                          onClick={() => {
                            setApprovalDecision('REJECTED');
                            setApprovalReason('');
                            setApprovalError('');
                            setApprovalDialogOpen(true);
                          }}
                        >
                          Từ chối
                        </Button>
                      </>
                    )}
                    {canApprovePlans && selectedPlan.status === 'PENDING_APPROVAL' && selectedPlan.createdById === staff?.id && (
                      <span className="text-xs text-muted-foreground">Người tạo không thể tự duyệt</span>
                    )}
                    {canManagePlans && selectedPlan.status === 'ACTIVE' && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={archiving}
                        onClick={() => { void archivePlan(selectedPlan); }}
                      >
                        {archiving ? 'Đang lưu trữ…' : 'Lưu trữ'}
                      </Button>
                    )}
                    {canManagePlans && (
                      <Button type="button" variant="outline" onClick={() => openEditDialog(selectedPlan)}>
                        <Pencil data-icon="inline-start" />
                        Chỉnh sửa
                      </Button>
                    )}
                    {canDeletePlans && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => { setDeleteError(''); setDeleteDialogOpen(true); }}
                      >
                        <Trash2 data-icon="inline-start" />
                        Xóa
                      </Button>
                    )}
                  </div>
                </div>
                {approvalError && (
                  <p className="text-sm text-destructive" role="alert">{approvalError}</p>
                )}
                <div className="grid gap-3 border-y py-4 sm:grid-cols-3">
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Chi nhánh áp dụng</span>
                    <strong className="text-sm font-medium">
                      {selectedPlan.branches.map((branch) => branch.name).join(', ') || 'Chưa gán chi nhánh'}
                    </strong>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Ngày bắt đầu</span>
                    <strong className="text-sm font-medium">{formatDate(selectedPlan.periodStart)}</strong>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Ngày kết thúc</span>
                    <strong className="text-sm font-medium">{formatDate(selectedPlan.periodEnd)}</strong>
                  </div>
                </div>
                {selectedPlan.description && (
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                    {selectedPlan.description}
                  </p>
                )}
                <div className="grid gap-3">
                  <h3 className="text-sm font-semibold">Chỉ tiêu trong kế hoạch</h3>
                  {selectedPlan.metrics.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedPlan.metrics.map((metric) => (
                        <div className="grid gap-2 rounded-lg border p-4" key={metric.id}>
                          <strong className="break-words text-sm font-medium">{metric.name}</strong>
                          <span className="text-2xl font-semibold tracking-tight">{formatTarget(metric.target)}</span>
                          <span className="text-xs text-muted-foreground">Đơn vị: {metric.unit}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Kế hoạch này chưa có chỉ tiêu.</p>
                  )}
                  <p className="text-xs leading-5 text-muted-foreground">
                    Tiến độ và KPI được theo dõi trong trang Công việc.
                  </p>
                </div>
                {selectedPlan.approvals.length > 0 && (
                  <section className="grid gap-3 border-t pt-4" aria-labelledby="plan-approval-history">
                    <h3 id="plan-approval-history" className="text-sm font-semibold">Lịch sử phê duyệt</h3>
                    <ol className="grid gap-3">
                      {selectedPlan.approvals.map((approval) => (
                        <li className="grid gap-1 border-l-2 border-border pl-3" key={approval.id}>
                          <p className="text-sm font-medium">
                            {approval.decision === 'APPROVED' ? 'Đã duyệt' : 'Đã từ chối'}
                            <span className="font-normal text-muted-foreground"> · {approval.reviewer.displayName}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Lần gửi {approval.version} · {formatDate(approval.createdAt)}
                          </p>
                          {approval.reason && (
                            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{approval.reason}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </CardContent>
            ) : (
              <CardContent className="grid min-h-60 place-items-center p-6 text-center">
                <p className="max-w-sm text-sm text-muted-foreground">
                  Chọn một kế hoạch để xem chi tiết, hoặc tạo kế hoạch mới nếu bạn có quyền.
                </p>
              </CardContent>
            )}
          </Card>
        </div>
      </section>
    </WorkspaceLayout>
  );
}
