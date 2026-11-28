'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Eye, RefreshCw, Search } from 'lucide-react';
import { useCrmSession } from '@/components/crm-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { downloadFile, request } from '@/lib/crm-api';

type AuditEvent = { id: string; actorId: string | null; action: string; targetType: string; targetId: string | null; reason: string | null; beforeState: unknown; afterState: unknown; createdAt: string };
type AuditPageResult = { items: AuditEvent[]; page: number; pageSize: number; total: number; totalPages: number };
type CareItem = { id: string; customer: { id: string; fullName: string; phone: string; address: string | null }; adviserId: string | null; adviser: string | null; fromStatus: string; result: string; notes: string; occurredAt: string };
type CarePage = { items: CareItem[]; page: number; pageSize: number; total: number; totalPages: number };
type UserOption = { id: string; displayName: string; username: string };
type Filters = { from: string; to: string; action: string; actorId: string; data: string; adviserId: string; result: string; search: string };
type Tab = 'audit' | 'care';

const emptyFilters: Filters = { from: '', to: '', action: '', actorId: '', data: '', adviserId: '', result: '', search: '' };
const resultOptions = ['NEW', 'CONTACTED', 'QUALIFIED', 'IN_PROGRESS', 'CONVERTED', 'CLOSED'];

function localDate(value: string) { return new Date(value).toLocaleString('vi-VN'); }
function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

export function AuditPage() {
  const { session } = useCrmSession();
  const [tab, setTab] = useState<Tab>('audit');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [audit, setAudit] = useState<AuditPageResult | null>(null);
  const [care, setCare] = useState<CarePage | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedAudit, setSelectedAudit] = useState<AuditEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadAudit = useCallback(async (nextPage: number, activeFilters: Filters, rowsPerPage = pageSize) => {
    if (!session) return;
    const query = queryString({ page: nextPage, pageSize: rowsPerPage, from: activeFilters.from || undefined, to: activeFilters.to ? `${activeFilters.to}T23:59:59.999` : undefined, action: activeFilters.action || undefined, actorId: activeFilters.actorId || undefined, data: activeFilters.data || undefined });
    setBusy(true); setError('');
    try {
      const response = await request<AuditPageResult>(`/access/audit-events?${query}`, {}, session.accessToken);
      setAudit(response);
      if (response.page !== nextPage && response.totalPages > 0) setPage(response.page);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Không thể tải nhật ký.'); }
    finally { setBusy(false); }
  }, [session, pageSize]);

  const loadCare = useCallback(async (nextPage: number, activeFilters: Filters, rowsPerPage = pageSize) => {
    if (!session) return;
    const query = queryString({ page: nextPage, pageSize: rowsPerPage, from: activeFilters.from || undefined, to: activeFilters.to ? `${activeFilters.to}T23:59:59.999` : undefined, adviserId: activeFilters.adviserId || undefined, result: activeFilters.result || undefined, search: activeFilters.search || undefined });
    setBusy(true); setError('');
    try {
      const response = await request<CarePage>(`/access/customer-care-history?${query}`, {}, session.accessToken);
      setCare(response);
      if (response.page !== nextPage && response.totalPages > 0) setPage(response.page);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Không thể tải lịch sử chăm sóc.'); }
    finally { setBusy(false); }
  }, [session, pageSize]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void request<Array<{ id: string; username: string; displayName: string }>>('/access/users', {}, session.accessToken)
      .then((rows) => { if (active) setUsers(rows); })
      .catch(() => { if (active) setUsers([]); });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (tab === 'audit') void loadAudit(1, appliedFilters);
    else void loadCare(1, appliedFilters);
    setPage(1);
  }, [tab, appliedFilters, loadAudit, loadCare]);

  function applyFilters() {
    setPage(1);
    setAppliedFilters({ ...filters });
    if (tab === 'audit') void loadAudit(1, filters);
    else void loadCare(1, filters);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    if (tab === 'audit') void loadAudit(nextPage, appliedFilters);
    else void loadCare(nextPage, appliedFilters);
  }

  function changePageSize(value: string | number | null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    setPageSize(parsed);
    setPage(1);
    if (tab === 'audit') void loadAudit(1, appliedFilters, parsed);
    else void loadCare(1, appliedFilters, parsed);
  }

  function auditSummary(event: AuditEvent) {
    const value = [event.reason, JSON.stringify({ before: event.beforeState, after: event.afterState })].filter(Boolean).join(' · ');
    return value.length > 20 ? `${value.slice(0, 20)}…` : value || '—';
  }

  async function exportCare() {
    if (!session) return;
    const activeFilters = { ...appliedFilters, ...filters };
    const query = queryString({ from: activeFilters.from || undefined, to: activeFilters.to ? `${activeFilters.to}T23:59:59.999` : undefined, adviserId: activeFilters.adviserId || undefined, result: activeFilters.result || undefined, search: activeFilters.search || undefined });
    try {
      const blob = await downloadFile(`/access/customer-care-history/export?${query}`, session.accessToken);
      const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      if (signature.length !== 4 || signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 0x03 || signature[3] !== 0x04) {
        throw new Error('Tệp xuất không đúng định dạng XLSX nên chưa được lưu. Vui lòng tải lại hoặc liên hệ quản trị hệ thống.');
      }
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'customer-care-history.xlsx'; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể xuất Excel.'); }
  }

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  return <main className="mx-auto w-full max-w-7xl space-y-6 p-5 md:p-8">
    <header><h1 className="text-2xl font-semibold text-slate-900">Nhật ký hệ thống</h1><p className="mt-1 text-sm text-slate-600">Tra cứu lịch sử thao tác và thay đổi trạng thái khách hàng.</p></header>
    <div className="flex flex-wrap gap-2 border-b pb-3"><Button variant={tab === 'audit' ? 'default' : 'outline'} onClick={() => setTab('audit')}>Nhật ký thao tác</Button><Button variant={tab === 'care' ? 'default' : 'outline'} onClick={() => setTab('care')}>Lịch sử chăm sóc</Button></div>
    <section className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Từ ngày<Input type="date" value={filters.from} onChange={(e) => updateFilter('from', e.target.value)} /></label>
      <label className="text-sm">Đến ngày<Input type="date" value={filters.to} onChange={(e) => updateFilter('to', e.target.value)} /></label>
      {tab === 'audit' ? <>
        <label className="text-sm">Loại hành động<Input placeholder="Ví dụ: customer.updated" value={filters.action} onChange={(e) => updateFilter('action', e.target.value)} /></label>
        <label className="text-sm">Người dùng<select className="mt-1 h-10 w-full rounded-md border px-3 text-sm" value={filters.actorId} onChange={(e) => updateFilter('actorId', e.target.value)}><option value="">Tất cả người dùng</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName} ({user.username})</option>)}</select></label>
        <label className="text-sm sm:col-span-2">Data (JSON string)<Input placeholder="Tìm trong dữ liệu trước/sau hoặc ghi chú" value={filters.data} onChange={(e) => updateFilter('data', e.target.value)} /></label>
      </> : <>
        <label className="text-sm">Người chăm sóc<select className="mt-1 h-10 w-full rounded-md border px-3 text-sm" value={filters.adviserId} onChange={(e) => updateFilter('adviserId', e.target.value)}><option value="">Tất cả nhân viên</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName} ({user.username})</option>)}</select></label>
        <label className="text-sm">Kết quả<select className="mt-1 h-10 w-full rounded-md border px-3 text-sm" value={filters.result} onChange={(e) => updateFilter('result', e.target.value)}><option value="">Tất cả kết quả</option>{resultOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label className="text-sm">Khách hàng<Input placeholder="Tên, số điện thoại, địa chỉ" value={filters.search} onChange={(e) => updateFilter('search', e.target.value)} /></label>
      </>}
      <div className="flex items-end gap-2"><Button disabled={busy} onClick={applyFilters}><Search className="mr-2 size-4" />Lọc</Button><Button variant="outline" disabled={busy} onClick={() => tab === 'audit' ? void loadAudit(page, appliedFilters) : void loadCare(page, appliedFilters)}><RefreshCw className="mr-2 size-4" />Tải lại</Button>{tab === 'care' && <Button variant="outline" disabled={busy} onClick={() => void exportCare()}><Download className="mr-2 size-4" />Xuất Excel</Button>}</div>
    </section>
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {tab === 'audit' ? <>
      <p className="text-sm text-slate-600">{audit?.total ?? 0} bản ghi</p>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50"><tr>{['Thời gian', 'Người dùng', 'Hành động', 'Đối tượng', 'Ghi chú / Data'].map((label) => <th className="px-4 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>
        {audit?.items.map((event) => <tr className="border-t align-top" key={event.id}><td className="whitespace-nowrap px-4 py-3">{localDate(event.createdAt)}</td><td className="px-4 py-3">{users.find((user) => user.id === event.actorId)?.displayName ?? '—'}</td><td className="px-4 py-3 font-mono text-xs">{event.action}</td><td className="px-4 py-3">{event.targetType}{event.targetId ? ` · ${event.targetId}` : ''}</td><td className="px-4 py-3"><button type="button" className="flex max-w-44 items-center gap-1 text-left text-xs text-slate-700 hover:text-blue-700" title="Xem ghi chú và dữ liệu đầy đủ" onClick={() => setSelectedAudit(event)}><span className="truncate">{auditSummary(event)}</span><Eye className="size-3.5 shrink-0" aria-hidden="true" /><span className="sr-only">Xem chi tiết ghi chú và dữ liệu</span></button></td></tr>)}
        {(!audit || audit.items.length === 0) && <tr><td colSpan={5} className="p-8 text-center text-slate-500">{busy ? 'Đang tải…' : 'Không có dữ liệu phù hợp.'}</td></tr>}
      </tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-1 py-3"><p className="text-xs tabular-nums text-slate-600">Hiển thị {audit?.total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, audit?.total ?? 0)} nhật ký · Trang {audit?.page ?? page}</p><div className="flex items-center gap-3"><label id="audit-page-size-label" className="text-xs text-slate-600">Mỗi trang</label><Select value={String(pageSize)} onValueChange={changePageSize}><SelectTrigger aria-labelledby="audit-page-size-label" className="w-[4.5rem] bg-white"><SelectValue /></SelectTrigger><SelectContent align="end">{[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select><nav aria-label="Phân trang nhật ký thao tác" className="flex items-center gap-1"><button type="button" aria-label="Trang trước" disabled={page <= 1 || busy} onClick={() => changePage(page - 1)} className="inline-flex size-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">‹</button><span aria-current="page" className="min-w-12 text-center text-sm tabular-nums text-slate-700">Trang {audit?.page ?? page} / {Math.max(1, audit?.totalPages ?? 0)}</span><button type="button" aria-label="Trang sau" disabled={busy || page >= (audit?.totalPages ?? 0)} onClick={() => changePage(page + 1)} className="inline-flex size-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">›</button></nav></div></div>
    </> : <>
      <p className="text-sm text-slate-600">{care?.total ?? 0} bản ghi · trang {care?.page ?? 1} / {care?.totalPages ?? 1}</p>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50"><tr>{['Thời gian', 'Khách hàng', 'Điện thoại', 'Địa chỉ', 'Người chăm sóc', 'Kết quả', 'Ghi chú'].map((label) => <th className="px-4 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>
        {care?.items.map((item) => <tr className="border-t align-top" key={item.id}><td className="whitespace-nowrap px-4 py-3">{localDate(item.occurredAt)}</td><td className="px-4 py-3">{item.customer.fullName}</td><td className="px-4 py-3">{item.customer.phone}</td><td className="px-4 py-3">{item.customer.address ?? '—'}</td><td className="px-4 py-3">{item.adviser ?? '—'}</td><td className="px-4 py-3">{item.result}</td><td className="max-w-sm whitespace-pre-wrap px-4 py-3">{item.notes}</td></tr>)}
        {(!care || care.items.length === 0) && <tr><td colSpan={7} className="p-8 text-center text-slate-500">{busy ? 'Đang tải…' : 'Không có dữ liệu phù hợp.'}</td></tr>}
      </tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-1 py-3"><p className="text-xs tabular-nums text-slate-600">Hiển thị {care?.total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, care?.total ?? 0)} lịch sử · Trang {care?.page ?? page}</p><div className="flex items-center gap-3"><label id="care-page-size-label" className="text-xs text-slate-600">Mỗi trang</label><Select value={String(pageSize)} onValueChange={changePageSize}><SelectTrigger aria-labelledby="care-page-size-label" className="w-[4.5rem] bg-white"><SelectValue /></SelectTrigger><SelectContent align="end">{[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select><nav aria-label="Phân trang lịch sử chăm sóc" className="flex items-center gap-1"><button type="button" aria-label="Trang trước" disabled={page <= 1 || busy} onClick={() => changePage(page - 1)} className="inline-flex size-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">‹</button><span aria-current="page" className="min-w-12 text-center text-sm tabular-nums text-slate-700">Trang {care?.page ?? page} / {Math.max(1, care?.totalPages ?? 0)}</span><button type="button" aria-label="Trang sau" disabled={busy || page >= (care?.totalPages ?? 0)} onClick={() => changePage(page + 1)} className="inline-flex size-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">›</button></nav></div></div>
    </>}
    <Dialog open={selectedAudit !== null} onOpenChange={(open) => { if (!open) setSelectedAudit(null); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" closeLabel="Đóng">
        <DialogHeader><DialogTitle>Chi tiết nhật ký</DialogTitle><DialogDescription>{selectedAudit ? `${selectedAudit.action} · ${localDate(selectedAudit.createdAt)}` : ''}</DialogDescription></DialogHeader>
        {selectedAudit && <div className="space-y-4 text-sm"><div><h3 className="mb-1 font-medium">Ghi chú</h3><p className="whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3">{selectedAudit.reason || 'Không có ghi chú.'}</p></div><div><h3 className="mb-1 font-medium">Data (JSON)</h3><pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-3 text-xs text-slate-50">{JSON.stringify({ before: selectedAudit.beforeState, after: selectedAudit.afterState }, null, 2)}</pre></div><p className="text-xs text-slate-500">Đối tượng: {selectedAudit.targetType}{selectedAudit.targetId ? ` · ${selectedAudit.targetId}` : ''}</p></div>}
      </DialogContent>
    </Dialog>
    <p className="text-xs text-slate-500">Lịch sử chăm sóc hiện phản ánh các lần thay đổi trạng thái khách hàng; ghi chú là lý do chuyển trạng thái đã lưu trong hồ sơ.</p>
  </main>;
}
