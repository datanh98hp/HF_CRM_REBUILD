'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, File as FileIcon, FileImage, FileText, History, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { useCrmSession } from '@/components/crm-session';
import { downloadFile, request } from '@/lib/crm-api';

type Contract = {
  id: string;
  customerId: string;
  customerName?: string;
  branchId: string;
  branchName?: string;
  canReview?: boolean;
  contractNumber: string;
  packageCode: string | null;
  packageName: string;
  packageVersion: string | null;
  loanType: string | null;
  termMonths: number | null;
  loanAmount: string | null;
  monthlyPayment: string | null;
  status: string;
  approvedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

type ContractPage = { items: Contract[]; pageSize: number; nextCursor: string | null };
type ContractRequest = <T>(path: string, options?: RequestInit, accessToken?: string) => Promise<T>;
type ContractDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: { displayName: string; username: string } | null;
  downloadPath: string;
};
type ContractHistoryItem = {
  id: string;
  action: string;
  beforeState: { status?: string; fileName?: string } | null;
  afterState: { status?: string; reason?: string; fileName?: string; deletedAt?: string } | null;
  changedBy: { displayName: string; username: string | null } | null;
  createdAt: string;
};

const statusLabels: Record<string, string> = {
  PENDING_REVIEW: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  AWAITING_CUSTOMER_CONFIRMATION: 'Chờ khách xác nhận',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
};

const statusOptions = [
  ['ALL', 'Tất cả trạng thái'],
  ['PENDING_REVIEW', 'Chờ duyệt'],
  ['APPROVED', 'Đã duyệt'],
  ['AWAITING_CUSTOMER_CONFIRMATION', 'Chờ khách xác nhận'],
  ['COMPLETED', 'Hoàn tất'],
  ['REJECTED', 'Từ chối'],
  ['CANCELLED', 'Đã hủy'],
] as const;
const pageSizeOptions = [10, 20, 50, 100] as const;
const contractDocumentAccept = '.docx,.pdf,.png,.jpg,.jpeg';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

function formatMoney(value: string | null) {
  if (!value) return '—';
  const [whole, fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const normalizedFraction = fraction?.replace(/0+$/, '');
  return `${grouped}${normalizedFraction ? `,${normalizedFraction}` : ''} ₫`;
}

function badgeClass(status: string) {
  if (status === 'PENDING_REVIEW') return 'border-amber-200 bg-amber-50 text-amber-900';
  if (status === 'REJECTED' || status === 'CANCELLED') return 'border-red-200 bg-red-50 text-red-800';
  if (status === 'COMPLETED') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  return 'border-slate-200 bg-slate-100 text-slate-800';
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${new Intl.NumberFormat('vi-VN').format(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}

function documentIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType === 'application/pdf' || mimeType.includes('wordprocessingml')) return FileText;
  return FileIcon;
}

function historySummary(item: ContractHistoryItem) {
  if (item.action === 'STATUS_CHANGED') {
    const from = item.beforeState?.status ? statusLabels[item.beforeState.status] ?? item.beforeState.status : 'Tạo mới';
    const to = item.afterState?.status ? statusLabels[item.afterState.status] ?? item.afterState.status : '—';
    return `Trạng thái: ${from} → ${to}${item.afterState?.reason ? ` · ${item.afterState.reason}` : ''}`;
  }
  if (item.action === 'DOCUMENT_UPLOADED') return `Đã thêm tài liệu: ${item.afterState?.fileName ?? 'Tài liệu'}`;
  if (item.action === 'DOCUMENT_REPLACED') return `Đã cập nhật tài liệu: ${item.beforeState?.fileName ?? 'Tài liệu'} → ${item.afterState?.fileName ?? 'Tài liệu mới'}`;
  if (item.action === 'DOCUMENT_SOFT_DELETED') return `Đã xóa mềm tài liệu: ${item.beforeState?.fileName ?? 'Tài liệu'}`;
  return 'Đã cập nhật thông tin hợp đồng.';
}

export function LoanContractsPage() {
  const { session, can } = useCrmSession();
  if (!session) return <main className="loading-screen"><span className="spinner" aria-hidden="true" /><p>Đang tải hợp đồng…</p></main>;

  return (
    <WorkspaceLayout activeSection="contracts" requiredPermission="loan-contracts.read">
      <ContractWorkspace
        accessToken={session.accessToken}
        request={request}
        canReview={can('loan-contracts.review')}
        canManageDocuments={can('loan-contracts.manage')}
      />
    </WorkspaceLayout>
  );
}

function ContractWorkspace({
  accessToken,
  request: apiRequest,
  canReview,
  canManageDocuments,
}: {
  accessToken: string;
  request: ContractRequest;
  canReview: boolean;
  canManageDocuments: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchText, setSearchText] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [pageSize, setPageSize] = useState<number>(20);
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [documents, setDocuments] = useState<ContractDocument[]>([]);
  const [history, setHistory] = useState<ContractHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [documentsError, setDocumentsError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [documentBusy, setDocumentBusy] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ContractDocument | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestVersion = useRef(0);
  const detailRequestVersion = useRef(0);
  const cursor = pageCursors.at(-1);
  const selected = contracts.find((contract) => contract.id === selectedId) ?? null;
  const canGoBack = pageCursors.length > 1;

  useEffect(() => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    const query = new URLSearchParams();
    if (statusFilter !== 'ALL') query.set('status', statusFilter);
    if (searchFilter) query.set('search', searchFilter);
    query.set('pageSize', String(pageSize));
    if (cursor) query.set('cursor', cursor);
    void apiRequest<ContractPage>(`/loan-contracts?${query.toString()}`, {}, accessToken)
      .then((result) => {
        if (version !== requestVersion.current) return;
        setContracts(result.items);
        setNextCursor(result.nextCursor);
        setSelectedId((current) => result.items.some((contract) => contract.id === current)
          ? current
          : result.items[0]?.id ?? '');
      })
      .catch((cause: unknown) => {
        if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách hợp đồng.');
      })
      .finally(() => {
        if (version === requestVersion.current) setLoading(false);
      });
    return () => { requestVersion.current += 1; };
  }, [accessToken, apiRequest, cursor, pageSize, reloadVersion, searchFilter, statusFilter]);

  useEffect(() => {
    if (!selectedId) {
      setDocuments([]);
      setHistory([]);
      setDocumentsError('');
      setHistoryError('');
      setDocumentsLoading(false);
      setHistoryLoading(false);
      return;
    }

    const version = ++detailRequestVersion.current;
    setDocumentsLoading(true);
    setHistoryLoading(true);
    setDocumentsError('');
    setHistoryError('');
    void apiRequest<ContractDocument[]>(`/loan-contracts/${selectedId}/documents`, {}, accessToken)
      .then((result) => { if (version === detailRequestVersion.current) setDocuments(result); })
      .catch((cause: unknown) => {
        if (version === detailRequestVersion.current) setDocumentsError(cause instanceof Error ? cause.message : 'Không thể tải tài liệu hợp đồng.');
      })
      .finally(() => { if (version === detailRequestVersion.current) setDocumentsLoading(false); });
    void apiRequest<{ items: ContractHistoryItem[] }>(`/loan-contracts/${selectedId}/history`, {}, accessToken)
      .then((result) => { if (version === detailRequestVersion.current) setHistory(result.items); })
      .catch((cause: unknown) => {
        if (version === detailRequestVersion.current) setHistoryError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử hợp đồng.');
      })
      .finally(() => { if (version === detailRequestVersion.current) setHistoryLoading(false); });
    return () => { detailRequestVersion.current += 1; };
  }, [accessToken, apiRequest, reloadVersion, selectedId]);

  function changeStatusFilter(value: string) {
    setStatusFilter(value);
    setPageCursors([undefined]);
    setSelectedId('');
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchFilter(searchText.trim());
    setPageCursors([undefined]);
    setSelectedId('');
  }

  function changePageSize(value: string) {
    const nextPageSize = pageSizeOptions.find((option) => String(option) === value);
    if (nextPageSize === undefined) return;
    setPageSize(nextPageSize);
    setPageCursors([undefined]);
    setSelectedId('');
  }

  async function approveSelected() {
    if (!selected) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/loan-contracts/${selected.id}/approve`, { method: 'POST' }, accessToken);
      setNotice('Đã duyệt hợp đồng. Khách hàng cần xác nhận theo quy trình hiện hành.');
      setReloadVersion((version) => version + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể duyệt hợp đồng.');
    } finally {
      setSaving(false);
    }
  }

  async function rejectSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || rejectReason.trim().length < 2) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/loan-contracts/${selected.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason.trim() }),
      }, accessToken);
      setRejectReason('');
      setRejecting(false);
      setNotice('Đã từ chối hợp đồng và lưu lý do.');
      setReloadVersion((version) => version + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể từ chối hợp đồng.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadDocuments(files: FileList | null) {
    if (!selected || !files?.length) return;
    const selectedFiles = Array.from(files);
    setDocumentBusy('upload');
    setDocumentsError('');
    setNotice('');
    try {
      for (const file of selectedFiles) {
        const body = new FormData();
        body.append('file', file);
        await apiRequest<ContractDocument>(`/loan-contracts/${selected.id}/documents`, { method: 'POST', body }, accessToken);
      }
      setNotice(`Đã thêm ${selectedFiles.length} tài liệu vào hợp đồng.`);
      setReloadVersion((version) => version + 1);
    } catch (cause) {
      setDocumentsError(cause instanceof Error ? cause.message : 'Không thể tải tài liệu lên.');
    } finally {
      setDocumentBusy('');
    }
  }

  async function replaceDocument(documentId: string, file: File | undefined) {
    if (!selected || !file) return;
    setDocumentBusy(documentId);
    setDocumentsError('');
    setNotice('');
    try {
      const body = new FormData();
      body.append('file', file);
      await apiRequest<ContractDocument>(`/loan-contracts/${selected.id}/documents/${documentId}`, { method: 'PUT', body }, accessToken);
      setNotice('Đã cập nhật tài liệu hợp đồng.');
      setReloadVersion((version) => version + 1);
    } catch (cause) {
      setDocumentsError(cause instanceof Error ? cause.message : 'Không thể cập nhật tài liệu.');
    } finally {
      setDocumentBusy('');
    }
  }

  async function deleteDocument() {
    if (!selected || !deleteTarget) return;
    setDocumentBusy(deleteTarget.id);
    setDocumentsError('');
    setNotice('');
    try {
      await apiRequest(`/loan-contracts/${selected.id}/documents/${deleteTarget.id}`, { method: 'DELETE' }, accessToken);
      setNotice(`Đã xóa mềm tài liệu “${deleteTarget.fileName}”.`);
      setDeleteTarget(null);
      setReloadVersion((version) => version + 1);
    } catch (cause) {
      setDocumentsError(cause instanceof Error ? cause.message : 'Không thể xóa tài liệu.');
    } finally {
      setDocumentBusy('');
    }
  }

  async function downloadDocument(document: ContractDocument) {
    setDocumentBusy(document.id);
    setDocumentsError('');
    try {
      const blob = await downloadFile(document.downloadPath, accessToken);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setDocumentsError(cause instanceof Error ? cause.message : 'Không thể tải tài liệu xuống.');
    } finally {
      setDocumentBusy('');
    }
  }

  return (
    <main className="w-full min-w-0">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-950">Quản lý Hợp đồng</h1>
          <p className="mt-1 text-sm text-slate-600">Theo dõi hồ sơ và xử lý hợp đồng trong phạm vi được cấp.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setReloadVersion((version) => version + 1)} disabled={loading}>
          <RefreshCw aria-hidden="true" /> Làm mới
        </Button>
      </header>

      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

      <section className="mb-4 grid min-w-0 grid-cols-1 items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-[minmax(18rem,1.5fr)_minmax(12rem,1fr)_minmax(10rem,0.7fr)_auto]" aria-label="Bộ lọc hợp đồng">
        <form onSubmit={submitSearch} className="grid min-w-0 gap-1.5">
          <label htmlFor="contract-search" className="text-sm font-medium text-slate-800">Mã hợp đồng</label>
          <div className="flex min-w-0 gap-2">
            <Input id="contract-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} maxLength={120} placeholder="Nhập mã hợp đồng" className="h-10 min-w-0 bg-white" />
            <Button type="submit" variant="outline" aria-label="Tìm hợp đồng"><Search aria-hidden="true" />Tìm</Button>
          </div>
        </form>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="contract-status-filter" className="text-sm font-medium text-slate-800">Trạng thái</label>
          <Select value={statusFilter} onValueChange={(value) => { if (typeof value === 'string') changeStatusFilter(value); }}>
            <SelectTrigger id="contract-status-filter" className="w-full bg-white"><SelectValue /></SelectTrigger>
            <SelectContent align="start">
              {statusOptions.map(([value, label]) => <SelectItem key={value} value={value} label={label}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="contract-page-size" className="text-sm font-medium text-slate-800">Số hợp đồng mỗi trang</label>
          <Select value={String(pageSize)} onValueChange={(value) => { if (typeof value === 'string') changePageSize(value); }}>
            <SelectTrigger id="contract-page-size" className="w-full bg-white"><SelectValue /></SelectTrigger>
            <SelectContent align="start">
              {pageSizeOptions.map((value) => <SelectItem key={value} value={String(value)} label={`${value} hợp đồng`}>{value} hợp đồng</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-slate-600 sm:col-span-2 xl:col-span-1 xl:text-right" aria-live="polite">{loading ? 'Đang tải…' : `${contracts.length} hợp đồng trong trang này`}</p>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white" aria-labelledby="contract-list-heading">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 id="contract-list-heading" className="font-semibold text-slate-950">Danh sách hợp đồng</h2>
              <p className="text-xs text-slate-500">Tối đa {pageSize} hồ sơ mỗi trang</p>
            </div>
            <span className="text-sm tabular-nums text-slate-600">Trang {pageCursors.length}</span>
          </div>
          {loading
            ? <p className="p-5 text-sm text-slate-600">Đang tải hợp đồng…</p>
            : contracts.length === 0
              ? <div className="p-8 text-center">
                <p className="font-medium text-slate-800">Không có hợp đồng phù hợp</p>
                <p className="mt-1 text-sm text-slate-600">Thử chọn trạng thái khác hoặc kiểm tra phạm vi quyền của bạn.</p>
              </div>
              : <div className="overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Hợp đồng / Khách hàng</th>
                      <th className="px-4 py-3">Khoản vay</th>
                      <th className="px-4 py-3">Trạng thái</th>
                      <th className="px-4 py-3">Ngày tạo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.map((contract) => (
                      <tr key={contract.id} className={`cursor-pointer border-t border-slate-100 hover:bg-teal-50 ${selectedId === contract.id ? 'bg-teal-50' : ''}`} onClick={() => setSelectedId(contract.id)}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-950">{contract.contractNumber}</p>
                          <p className="mt-0.5 text-xs text-slate-600">{contract.customerName ?? `Khách hàng ${contract.customerId.slice(0, 8)}`}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-slate-800">{contract.packageName}</p>
                          <p className="mt-0.5 text-xs tabular-nums text-slate-600">{formatMoney(contract.loanAmount)}</p>
                        </td>
                        <td className="px-4 py-3"><Badge variant="outline" className={badgeClass(contract.status)}>{statusLabels[contract.status] ?? contract.status}</Badge></td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{formatDate(contract.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <Button type="button" variant="outline" size="sm" disabled={!canGoBack || loading} onClick={() => { setPageCursors((pages) => pages.slice(0, -1)); setSelectedId(''); }}>
              <ChevronLeft aria-hidden="true" /> Trang trước
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!nextCursor || loading} onClick={() => { if (nextCursor) { setPageCursors((pages) => [...pages, nextCursor]); setSelectedId(''); } }}>
              Trang sau <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </section>

        <aside className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="contract-detail-heading">
          <div className="border-b border-slate-200 pb-3">
            <p className="text-xs font-medium uppercase text-slate-500">Chi tiết</p>
            <h2 id="contract-detail-heading" className="mt-1 break-words text-lg font-semibold text-slate-950">{selected?.contractNumber ?? 'Chọn một hợp đồng'}</h2>
          </div>
          {!selected
            ? <p className="py-6 text-sm text-slate-600">Chọn hồ sơ trong danh sách để xem thông tin và thao tác khả dụng.</p>
            : <>
              <dl className="grid gap-3 py-4 text-sm sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <div><dt className="text-xs text-slate-500">Khách hàng</dt><dd className="mt-1 font-medium text-slate-900">{selected.customerName ?? `Mã ${selected.customerId.slice(0, 8)}`}</dd></div>
                <div><dt className="text-xs text-slate-500">Gói vay</dt><dd className="mt-1 font-medium text-slate-900">{selected.packageName}{selected.packageVersion ? ` · v${selected.packageVersion}` : ''}</dd></div>
                <div><dt className="text-xs text-slate-500">Số tiền vay</dt><dd className="mt-1 tabular-nums font-medium text-slate-900">{formatMoney(selected.loanAmount)}</dd></div>
                <div><dt className="text-xs text-slate-500">Khoản trả/tháng</dt><dd className="mt-1 tabular-nums font-medium text-slate-900">{formatMoney(selected.monthlyPayment)}</dd></div>
                <div><dt className="text-xs text-slate-500">Kỳ hạn</dt><dd className="mt-1 font-medium text-slate-900">{selected.termMonths ? `${selected.termMonths} tháng` : '—'}</dd></div>
                <div><dt className="text-xs text-slate-500">Ngày tạo</dt><dd className="mt-1 font-medium text-slate-900">{formatDate(selected.createdAt)}</dd></div>
                <div><dt className="text-xs text-slate-500">Chi nhánh</dt><dd className="mt-1 break-words font-medium text-slate-900">{selected.branchName ?? '—'}</dd></div>
                <div><dt className="text-xs text-slate-500">Trạng thái</dt><dd className="mt-1"><Badge variant="outline" className={badgeClass(selected.status)}>{statusLabels[selected.status] ?? selected.status}</Badge></dd></div>
              </dl>
              {selected.status === 'PENDING_REVIEW' && canReview && selected.canReview
                ? rejecting
                  ? <form onSubmit={rejectSelected} className="grid gap-3 border-t border-slate-200 pt-4">
                    <label htmlFor="contract-reject-reason" className="text-sm font-medium text-slate-800">Lý do từ chối</label>
                    <Textarea id="contract-reject-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} minLength={2} maxLength={1000} required placeholder="Nhập lý do để lưu vào lịch sử hợp đồng" />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="destructive" disabled={saving || rejectReason.trim().length < 2}><X aria-hidden="true" /> Xác nhận từ chối</Button>
                      <Button type="button" variant="outline" disabled={saving} onClick={() => { setRejecting(false); setRejectReason(''); }}>Hủy</Button>
                    </div>
                  </form>
                  : <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                    <Button type="button" disabled={saving} onClick={() => void approveSelected()}><Check aria-hidden="true" /> Duyệt hợp đồng</Button>
                    <Button type="button" variant="outline" disabled={saving} onClick={() => setRejecting(true)}><X aria-hidden="true" /> Từ chối</Button>
                  </div>
                : <div className="border-t border-slate-200 pt-4 text-sm text-slate-600">
                  {selected.status === 'PENDING_REVIEW'
                    ? selected.canReview === false
                      ? 'Bạn không thể duyệt hợp đồng này: chỉ Admin/Operator toàn hệ thống hoặc Quản lý được phân công mới có quyền.'
                      : 'Hợp đồng đang chờ Admin, Operator hoặc Quản lý chi nhánh được phân công duyệt.'
                    : selected.status === 'APPROVED'
                      ? 'Đã duyệt; bước hoàn tất cần khách hàng xác nhận theo OTP.'
                      : selected.status === 'AWAITING_CUSTOMER_CONFIRMATION'
                        ? 'Đang chờ khách hàng xác nhận hoàn tất.'
                        : selected.status === 'COMPLETED'
                          ? `Hoàn tất${selected.completedAt ? ` · ${formatDate(selected.completedAt)}` : ''}.`
                          : 'Không có thao tác cần xử lý ở trạng thái này.'}
                </div>}
              <section className="mt-5 border-t border-slate-200 pt-4" aria-labelledby="contract-documents-heading">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 id="contract-documents-heading" className="font-semibold text-slate-900">Tài liệu liên quan</h3>
                    <p className="mt-1 text-xs text-slate-500">DOCX, PDF, PNG, JPG · Tối đa 25 MB mỗi tệp</p>
                  </div>
                  {canManageDocuments && <label className={`${buttonVariants({ variant: 'outline' })} cursor-pointer`}>
                    <Upload aria-hidden="true" />
                    Thêm tài liệu
                    <input
                      type="file"
                      multiple
                      accept={contractDocumentAccept}
                      disabled={Boolean(documentBusy)}
                      className="sr-only"
                      aria-label="Thêm tài liệu liên quan đến hợp đồng"
                      onChange={(event) => {
                        void uploadDocuments(event.currentTarget.files);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>}
                </div>
                {documentsError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{documentsError}</p>}
                {documentsLoading && documents.length === 0
                  ? <p className="py-4 text-sm text-slate-600">Đang tải tài liệu…</p>
                  : documents.length === 0
                    ? <p className="py-4 text-sm text-slate-600">Chưa có tài liệu liên quan.</p>
                    : <ul className="mt-3 divide-y divide-slate-200">
                      {documents.map((document) => {
                        const Icon = documentIcon(document.mimeType);
                        return <li key={document.id} className="flex min-w-0 items-center gap-2 py-3">
                          <Icon aria-hidden="true" className="size-5 shrink-0 text-slate-500" />
                          <div className="min-w-0 flex-1">
                            <p className="break-all text-sm font-medium text-slate-900">{document.fileName}</p>
                            <p className="mt-0.5 text-xs text-slate-500">{formatFileSize(document.sizeBytes)} · {formatDate(document.createdAt)}</p>
                            {document.uploadedBy && <p className="text-xs text-slate-500">{document.uploadedBy.displayName} · {document.uploadedBy.username}</p>}
                          </div>
                          <div className="flex shrink-0 items-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Tải xuống ${document.fileName}`}
                              title={`Tải xuống ${document.fileName}`}
                              disabled={Boolean(documentBusy)}
                              onClick={() => void downloadDocument(document)}
                            ><Download aria-hidden="true" /></Button>
                            {canManageDocuments && <>
                              <label className={`${buttonVariants({ variant: 'ghost', size: 'icon' })} cursor-pointer`} aria-label={`Thay thế ${document.fileName}`} title={`Thay thế ${document.fileName}`}>
                                <Upload aria-hidden="true" />
                                <input
                                  type="file"
                                  accept={contractDocumentAccept}
                                  disabled={Boolean(documentBusy)}
                                  className="sr-only"
                                  aria-label={`Chọn tệp thay thế cho ${document.fileName}`}
                                  onChange={(event) => {
                                    void replaceDocument(document.id, event.currentTarget.files?.[0]);
                                    event.currentTarget.value = '';
                                  }}
                                />
                              </label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Xóa ${document.fileName}`}
                                title={`Xóa ${document.fileName}`}
                                disabled={Boolean(documentBusy)}
                                onClick={() => setDeleteTarget(document)}
                              ><Trash2 aria-hidden="true" /></Button>
                            </>}
                          </div>
                        </li>;
                      })}
                    </ul>}
              </section>
              <section className="mt-5 border-t border-slate-200 pt-4" aria-labelledby="contract-history-heading">
                <div className="flex items-start gap-2">
                  <History aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-slate-500" />
                  <div>
                    <h3 id="contract-history-heading" className="font-semibold text-slate-900">Lịch sử thay đổi</h3>
                    <p className="mt-1 text-xs text-slate-500">Ghi lại trạng thái và các lần thêm, cập nhật hoặc xóa tài liệu.</p>
                  </div>
                </div>
                {historyError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{historyError}</p>}
                {historyLoading && history.length === 0
                  ? <p className="py-4 text-sm text-slate-600">Đang tải lịch sử…</p>
                  : history.length === 0
                    ? <p className="py-4 text-sm text-slate-600">Chưa có thay đổi được ghi nhận.</p>
                    : <ol className="mt-3 space-y-3">
                      {history.map((item) => <li key={item.id} className="border-l-2 border-slate-200 pl-3">
                        <p className="break-words text-sm text-slate-800">{historySummary(item)}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.changedBy?.displayName ?? 'Tài khoản đã xóa'}{item.changedBy?.username ? ` · ${item.changedBy.username}` : ''} · {formatDate(item.createdAt)}</p>
                      </li>)}
                    </ol>}
              </section>
            </>}
        </aside>
      </div>
      <p className="mt-4 text-xs text-slate-500">Admin và Operator được duyệt toàn hệ thống; Manager chỉ duyệt tại chi nhánh được phân công. Người tạo không thể tự duyệt.</p>
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !documentBusy) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md" closeLabel="Đóng">
          <DialogHeader>
            <DialogTitle>Xóa tài liệu hợp đồng?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `Tài liệu “${deleteTarget.fileName}” sẽ bị ẩn khỏi danh sách. Đây là xóa mềm; thao tác được ghi vào lịch sử hợp đồng.` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={Boolean(documentBusy)} onClick={() => setDeleteTarget(null)}>Hủy</Button>
            <Button type="button" variant="destructive" disabled={Boolean(documentBusy)} onClick={() => void deleteDocument()}>
              {documentBusy === deleteTarget?.id ? 'Đang xóa…' : 'Xóa tài liệu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}