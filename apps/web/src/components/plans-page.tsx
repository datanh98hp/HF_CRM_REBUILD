'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, RotateCw, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

type Plan = {
  id: string;
  name: string;
  description: string | null;
  branches: Pick<BranchOption, 'id' | 'code' | 'name'>[];
  periodStart: string;
  periodEnd: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  metrics: PlanMetric[];
};

type MetricDraft = {
  name: string;
  unit: string;
  target: string;
};

const emptyMetric = (): MetricDraft => ({ name: '', unit: '', target: '' });

const statusLabels: Record<string, string> = {
  DRAFT: 'Bản nháp',
  ACTIVE: 'Đang thực hiện',
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
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchesError, setBranchesError] = useState('');
  const [branchesRequestVersion, setBranchesRequestVersion] = useState(0);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createError, setCreateError] = useState('');
  const [editError, setEditError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [branchId, setBranchId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [metrics, setMetrics] = useState<MetricDraft[]>([emptyMetric()]);
  const [editPeriodStart, setEditPeriodStart] = useState('');
  const [editPeriodEnd, setEditPeriodEnd] = useState('');
  const [editStatus, setEditStatus] = useState<Plan['status']>('DRAFT');
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [branchToAdd, setBranchToAdd] = useState('');

  const activeBranches = useMemo(
    () => branches.filter((branch) => branch.status === 'ACTIVE'),
    [branches],
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
    setEditStatus(plan.status);
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
          periodStart: new Date(`${editPeriodStart}T00:00:00.000Z`).toISOString(),
          periodEnd: new Date(`${editPeriodEnd}T00:00:00.000Z`).toISOString(),
          status: editStatus,
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

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      setCreateError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }

    const normalizedMetrics = metrics.map((metric) => ({
      name: metric.name.trim(),
      unit: metric.unit.trim(),
      target: Number(metric.target),
    }));
    const metricNames = normalizedMetrics.map((metric) => metric.name.toLocaleLowerCase('vi-VN'));

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
    if (new Set(metricNames).size !== metricNames.length) {
      setCreateError('Tên chỉ tiêu không được trùng lặp.');
      return;
    }
    if (normalizedMetrics.some((metric) =>
      metric.name.length < 2 || metric.name.length > 160 || metric.unit.length < 1 || metric.unit.length > 40,
    )) {
      setCreateError('Tên chỉ tiêu cần có 2–160 ký tự và đơn vị cần có 1–40 ký tự.');
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
          periodStart: new Date(`${periodStart}T00:00:00.000Z`).toISOString(),
          periodEnd: new Date(`${periodEnd}T00:00:00.000Z`).toISOString(),
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
                    disabled={!canReadBranches || loadingBranches || Boolean(branchesError) || activeBranches.length === 0}
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
                      <SelectTrigger id="plan-branch" className="w-full bg-white">
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
                      className="bg-white"
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
                      className="bg-white"
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
                        disabled={metrics.length >= 100}
                        onClick={() => setMetrics((current) => [...current, emptyMetric()])}
                      >
                        <Plus data-icon="inline-start" />
                        Thêm chỉ tiêu
                      </Button>
                    </div>
                    {metrics.map((metric, index) => (
                      <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,0.65fr)_auto]" key={index}>
                        <div className="grid min-w-0 gap-2">
                          <Label htmlFor={`metric-name-${index}`}>Tên chỉ tiêu</Label>
                          <Input
                            id={`metric-name-${index}`}
                            className="bg-white"
                            value={metric.name}
                            onChange={(event) => updateMetric(index, 'name', event.target.value)}
                            minLength={2}
                            maxLength={160}
                            required
                          />
                        </div>
                        <div className="grid min-w-0 gap-2">
                          <Label htmlFor={`metric-unit-${index}`}>Đơn vị</Label>
                          <Input
                            id={`metric-unit-${index}`}
                            className="bg-white"
                            value={metric.unit}
                            onChange={(event) => updateMetric(index, 'unit', event.target.value)}
                            maxLength={40}
                            required
                          />
                        </div>
                        <div className="grid min-w-0 gap-2">
                          <Label htmlFor={`metric-target-${index}`}>Mục tiêu</Label>
                          <Input
                            id={`metric-target-${index}`}
                            className="bg-white"
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
                    ))}
                  </div>
                  <div className="flex justify-end sm:col-span-2">
                    <Button type="submit" disabled={submitting || !branchId || !canManagePlans}>
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
                    className="bg-white"
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
                    className="bg-white"
                    value={editPeriodEnd}
                    onChange={(event) => setEditPeriodEnd(event.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="edit-plan-status">Trạng thái</Label>
                  <Select value={editStatus} onValueChange={(value) => { if (value) setEditStatus(value as Plan['status']); }}>
                    <SelectTrigger id="edit-plan-status" className="w-full bg-white">
                      <SelectValue>{statusLabels[editStatus]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value} className="mb-1">{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    <SelectTrigger id="edit-plan-branch" className="w-full bg-white" disabled={addableBranches.length === 0}>
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
                    Tiến độ và KPI chưa khả dụng ở lát cắt hiện tại.
                  </p>
                </div>
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
