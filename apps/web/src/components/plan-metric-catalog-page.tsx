'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus, RotateCw, Tags } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { useCrmSession } from '@/components/crm-session';
import { request } from '@/lib/crm-api';

type CatalogItem = {
  id: string;
  key: string;
  name: string;
  unit: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type CatalogDraft = { key: string; name: string; unit: string };
const emptyDraft = (): CatalogDraft => ({ key: '', name: '', unit: '' });

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

export function PlanMetricCatalogPage() {
  const { session, staff, can } = useCrmSession();
  const accessToken = session?.accessToken;
  const canReadCatalog = can('plans.read');
  const canManageCatalog = Boolean(
    can('plans.catalog.manage')
    && staff?.roles.some((role) => ['ADMIN', 'OPERATOR'].includes(role.key) && role.scope.global),
  );
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [draft, setDraft] = useState<CatalogDraft>(emptyDraft);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [notice, setNotice] = useState('');

  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    let active = true;
    setItems([]);
    setSelectedId(null);
    setError('');
    if (!accessToken || !canReadCatalog) {
      setLoading(false);
      return () => { active = false; };
    }

    setLoading(true);
    void request<CatalogItem[]>('/plans/metric-catalog', {}, accessToken)
      .then((nextItems) => {
        if (!active) return;
        const sortedItems = [...nextItems].sort((a, b) =>
          Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, 'vi'),
        );
        setItems(sortedItems);
        setSelectedId(sortedItems[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause, 'Không thể tải danh mục KPI.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [accessToken, canReadCatalog, requestVersion]);

  function openCreateDialog() {
    setEditingItem(null);
    setDraft(emptyDraft());
    setFormError('');
    setDialogOpen(true);
  }

  function openEditDialog(item: CatalogItem) {
    setEditingItem(item);
    setDraft({ key: item.key, name: item.name, unit: item.unit });
    setFormError('');
    setDialogOpen(true);
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !canManageCatalog) {
      setFormError('Bạn không có quyền quản lý danh mục KPI.');
      return;
    }
    const key = draft.key.trim();
    const name = draft.name.trim();
    const unit = draft.unit.trim();
    if (!editingItem && !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(key)) {
      setFormError('Mã chỉ gồm chữ thường, số, dấu gạch ngang hoặc gạch dưới; dài từ 2 đến 80 ký tự.');
      return;
    }
    if (name.length < 2 || name.length > 160 || unit.length < 1 || unit.length > 40) {
      setFormError('Tên cần từ 2 đến 160 ký tự; đơn vị cần từ 1 đến 40 ký tự.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const saved = await request<CatalogItem>(
        editingItem ? `/plans/metric-catalog/${editingItem.id}` : '/plans/metric-catalog',
        {
          method: editingItem ? 'PATCH' : 'POST',
          body: JSON.stringify(editingItem ? { name, unit } : { key, name, unit }),
        },
        accessToken,
      );
      setItems((current) => {
        const updated = current.filter((item) => item.id !== saved.id);
        updated.push(saved);
        return updated.sort((a, b) =>
          Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, 'vi'),
        );
      });
      setSelectedId(saved.id);
      setNotice(editingItem ? 'Đã cập nhật danh mục KPI.' : 'Đã tạo hạng mục KPI.');
      setDialogOpen(false);
    } catch (cause) {
      setFormError(errorMessage(cause, 'Không thể lưu hạng mục KPI.'));
    } finally {
      setSaving(false);
    }
  }

  async function setItemActive(item: CatalogItem, isActive: boolean) {
    if (!accessToken || !canManageCatalog) return;
    setUpdatingStatus(true);
    setError('');
    setNotice('');
    try {
      const updated = await request<CatalogItem>(`/plans/metric-catalog/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }, accessToken);
      setItems((current) => current
        .map((currentItem) => currentItem.id === updated.id ? updated : currentItem)
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, 'vi')));
      setNotice(isActive ? 'Đã kích hoạt lại hạng mục KPI.' : 'Đã ngừng sử dụng hạng mục KPI.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không thể cập nhật trạng thái hạng mục KPI.'));
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <WorkspaceLayout activeSection="catalog" requiredPermission="plans.read">
      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Danh mục hạng mục / đơn vị</h1>
            <p className="text-sm text-muted-foreground">
              Quản lý các chỉ tiêu dùng chung khi tạo kế hoạch và công việc KPI.
            </p>
          </div>
          {canManageCatalog && (
            <Button type="button" onClick={openCreateDialog}>
              <Plus data-icon="inline-start" />
              Tạo mới
            </Button>
          )}
        </div>

        {notice && <p className="text-sm text-emerald-800" role="status">{notice}</p>}
        {error && !loading && (
          <div className="flex flex-wrap items-center gap-2" role="alert">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setRequestVersion((value) => value + 1)}>
              <RotateCw data-icon="inline-start" />
              Thử lại
            </Button>
          </div>
        )}

        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(260px,0.82fr)_minmax(0,1.18fr)]">
          <Card className="min-w-0 gap-0 overflow-hidden py-0">
            <CardHeader className="flex grid-cols-[1fr_auto] items-center gap-2 border-b px-4 py-4">
              <CardTitle className="text-base">Danh sách hạng mục</CardTitle>
              <span className="text-sm text-muted-foreground">{loading ? '' : items.length}</span>
            </CardHeader>
            {loading ? (
              <CardContent aria-busy="true" className="grid gap-3 p-4">
                {[0, 1, 2, 3].map((index) => (
                  <div className="grid gap-2" key={index}>
                    <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
                  </div>
                ))}
                <span className="sr-only" role="status">Đang tải danh mục KPI.</span>
              </CardContent>
            ) : error ? (
              <p className="p-5 text-sm text-muted-foreground">Danh sách chưa tải được.</p>
            ) : items.length === 0 ? (
              <div className="grid justify-items-center gap-2 p-6 text-center">
                <Tags className="size-5 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium">Danh mục chưa có hạng mục</p>
                <p className="text-sm text-muted-foreground">
                  {canManageCatalog ? 'Tạo hạng mục để có thể dùng khi lập kế hoạch.' : 'Liên hệ quản trị viên để bổ sung hạng mục.'}
                </p>
              </div>
            ) : (
              <CardContent className="max-h-none divide-y overflow-y-auto p-0 lg:max-h-[min(68vh,680px)]">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`grid w-full min-w-0 gap-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                      selectedId === item.id ? 'bg-accent hover:bg-accent' : 'bg-card hover:bg-primary/10'
                    }`}
                    aria-current={selectedId === item.id ? 'true' : undefined}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <strong className="line-clamp-2 min-w-0 break-words text-sm font-medium" title={item.name}>
                        {item.name}
                      </strong>
                      <Badge variant={item.isActive ? 'secondary' : 'outline'} className="shrink-0">
                        {item.isActive ? 'Đang dùng' : 'Đã ngừng'}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.unit} · Mã {item.key}
                    </span>
                  </button>
                ))}
              </CardContent>
            )}
          </Card>

          <Card className="min-w-0 gap-0 py-0">
            {selectedItem ? (
              <>
                <CardHeader className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                  <div className="min-w-0 space-y-2">
                    <CardTitle className="break-words text-lg">{selectedItem.name}</CardTitle>
                    <Badge variant={selectedItem.isActive ? 'secondary' : 'outline'} className="w-fit">
                      {selectedItem.isActive ? 'Đang sử dụng' : 'Đã ngừng sử dụng'}
                    </Badge>
                  </div>
                  {canManageCatalog && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => openEditDialog(selectedItem)}>
                        <Pencil data-icon="inline-start" />
                        Chỉnh sửa
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={updatingStatus}
                        onClick={() => { void setItemActive(selectedItem, !selectedItem.isActive); }}
                      >
                        {updatingStatus ? 'Đang cập nhật…' : selectedItem.isActive ? 'Ngừng sử dụng' : 'Kích hoạt lại'}
                      </Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="grid gap-4 p-4 sm:p-5">
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Mã hệ thống</span>
                    <strong className="break-all font-mono text-sm font-medium">{selectedItem.key}</strong>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Đơn vị đo</span>
                    <strong className="text-sm font-medium">{selectedItem.unit}</strong>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Cập nhật lần cuối</span>
                    <strong className="text-sm font-medium">{formatDate(selectedItem.updatedAt)}</strong>
                  </div>
                  {!canManageCatalog && (
                    <p className="border-t pt-4 text-sm text-muted-foreground">
                      Chỉ Admin hoặc Operator có phạm vi toàn hệ thống được quản lý danh mục.
                    </p>
                  )}
                </CardContent>
              </>
            ) : (
              <CardContent className="grid min-h-60 place-items-center p-6 text-center">
                <p className="max-w-sm text-sm text-muted-foreground">
                  {loading ? 'Đang tải danh mục KPI…' : 'Chọn một hạng mục để xem chi tiết.'}
                </p>
              </CardContent>
            )}
          </Card>
        </div>

        {canManageCatalog && (
          <Dialog
            open={dialogOpen}
            disablePointerDismissal
            onOpenChange={(open, details) => {
              if (open || details.reason === 'close-press') {
                setDialogOpen(open);
                if (!open) setFormError('');
              }
            }}
          >
            <DialogContent className="sm:max-w-xl" closeLabel="Đóng">
              <DialogHeader className="pr-10">
                <DialogTitle>{editingItem ? 'Chỉnh sửa hạng mục' : 'Tạo hạng mục KPI'}</DialogTitle>
                <DialogDescription>
                  Hạng mục và đơn vị này sẽ dùng chung khi lập kế hoạch và công việc.
                </DialogDescription>
              </DialogHeader>
              {formError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                  {formError}
                </p>
              )}
              <form className="grid gap-4" onSubmit={(event) => { void saveItem(event); }}>
                <div className="grid gap-2">
                  <Label htmlFor="catalog-key">Mã hạng mục</Label>
                  <Input
                    id="catalog-key"
                    className="bg-card"
                    value={draft.key}
                    onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
                    disabled={Boolean(editingItem)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="catalog-name">Tên hạng mục</Label>
                  <Input
                    id="catalog-name"
                    className="bg-card"
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    minLength={2}
                    maxLength={160}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="catalog-unit">Đơn vị đo</Label>
                  <Input
                    id="catalog-unit"
                    className="bg-card"
                    value={draft.unit}
                    onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))}
                    maxLength={40}
                    required
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Đang lưu…' : editingItem ? 'Lưu thay đổi' : 'Tạo hạng mục'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </section>
    </WorkspaceLayout>
  );
}
