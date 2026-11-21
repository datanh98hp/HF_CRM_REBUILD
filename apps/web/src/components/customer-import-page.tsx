'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  CircleHelp,
  FileSpreadsheet,
  LoaderCircle,
  ShieldAlert,
  TableProperties,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { useCrmSession } from '@/components/crm-session';
import { request } from '@/lib/crm-api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type ImportReadiness = {
  ready: boolean;
  status: 'READY' | 'BLOCKED';
  missingRequirements: string[];
  messageVi: string;
};

type BranchOption = {
  id: string;
  code: string;
  name: string;
  status: string;
};

type ImportBatch = {
  id: string;
  status: string;
  importedRows: number;
  duplicateRows: number;
  invalidRows: number;
  failedInsertRows: number;
  errorCode: string | null;
  failureDetailsExpiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
};

type ImportRowFailure = {
  rowNumber: number;
  errorCodes: string[];
};

type ImportBatchDetails = ImportBatch & {
  failedRows: ImportRowFailure[];
  failureDetailsExpired: boolean;
};

type MobilePanel = 'prepare' | 'preview';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACTIVE_BATCH_STATUSES = new Set(['QUEUED', 'SCANNING', 'PROCESSING', 'COMMITTING']);

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function batchStatusLabel(status: string): string {
  switch (status) {
    case 'QUEUED': return 'Đang chờ worker';
    case 'SCANNING': return 'Đang quét ClamAV';
    case 'PROCESSING': return 'Đang kiểm tra dữ liệu';
    case 'COMMITTING': return 'Đang xóa tệp tạm';
    case 'COMPLETED': return 'Hoàn tất';
    case 'FAILED': return 'Không thể nhập';
    case 'CANCELLED': return 'Đã hủy';
    case 'EXPIRED': return 'Đã hết hạn';
    default: return status;
  }
}

function batchErrorMessage(batch: ImportBatch): string {
  if (batch.errorCode === 'FILE_INFECTED') return 'ClamAV phát hiện tệp không an toàn; tệp đã bị xóa.';
  if (batch.errorCode === 'SCANNER_UNAVAILABLE') return 'Không kết nối được ClamAV; dữ liệu chưa được nhập.';
  if (batch.errorCode === 'IMPORT_QUEUE_UNAVAILABLE') return 'Hàng đợi không khả dụng; batch chưa được nhập.';
  if (batch.errorCode === 'MISSING_REQUIRED_COLUMNS') return 'Không tìm thấy đủ cột Họ tên và Số điện thoại; không có dòng nào được nhập.';
  if (batch.errorCode === 'INVALID_IMPORT_DATA') return 'Tệp chứa dữ liệu không thể đọc; không có dòng nào được nhập.';
  if (batch.failedInsertRows > 0) return 'Giao dịch đã rollback; không có dữ liệu nhập dở.';
  return 'Tệp hoặc dữ liệu không hợp lệ; không có khách hàng nào được nhập.';
}

function failureMessage(code: string): string {
  switch (code) {
    case 'FULL_NAME_REQUIRED': return 'Thiếu họ tên';
    case 'INVALID_FULL_NAME': return 'Họ tên phải có từ 2 đến 160 ký tự';
    case 'PHONE_REQUIRED': return 'Thiếu số điện thoại';
    case 'INVALID_PHONE': return 'Số điện thoại không hợp lệ';
    case 'INVALID_EMAIL': return 'Email không hợp lệ';
    case 'INVALID_DATE_OF_BIRTH': return 'Ngày sinh không hợp lệ hoặc ở tương lai';
    case 'INVALID_CCCD': return 'CCCD vượt quá 32 ký tự';
    case 'INVALID_ADDRESS': return 'Địa chỉ vượt quá 500 ký tự';
    case 'INVALID_PLACE_OF_ORIGIN': return 'Quê quán vượt quá 160 ký tự';
    case 'INVALID_SEX': return 'Giới tính phải là Nam, Nữ hoặc Khác';
    case 'INVALID_PLACE_OF_ISSUE': return 'Nơi cấp vượt quá 160 ký tự';
    case 'DATABASE_INSERT_FAILED': return 'Lỗi ghi dữ liệu; giao dịch đã hoàn tác';
    default: return 'Dữ liệu không hợp lệ';
  }
}

function hasFailureDetails(batch: ImportBatch): boolean {
  return batch.invalidRows + batch.failedInsertRows > 0 &&
    batch.failureDetailsExpiresAt !== null &&
    Date.parse(batch.failureDetailsExpiresAt) > Date.now();
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes === 0) return '0 B';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(sizeBytes / (1024 * 1024))} MB`;
}

export function CustomerImportPage() {
  const { session } = useCrmSession();
  const [readiness, setReadiness] = useState<ImportReadiness | null>(null);
  const [readinessError, setReadinessError] = useState('');
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState('');
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [pageError, setPageError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [detailsBatch, setDetailsBatch] = useState<ImportBatch | null>(null);
  const [details, setDetails] = useState<ImportBatchDetails | null>(null);
  const [detailsError, setDetailsError] = useState('');
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const detailsRequestId = useRef(0);
  const [activePanel, setActivePanel] = useState<MobilePanel>('prepare');

  useEffect(() => {
    if (!session) return;
    let active = true;
    void Promise.allSettled([
      request<ImportReadiness>('/customers/import-batches/readiness', {}, session.accessToken),
      request<BranchOption[]>('/access/branches', {}, session.accessToken),
      request<ImportBatch[]>('/customers/import-batches', {}, session.accessToken),
    ]).then(([readinessResult, branchesResult, batchesResult]) => {
      if (!active) return;
      if (readinessResult.status === 'fulfilled') setReadiness(readinessResult.value);
      else setReadinessError(messageFor(readinessResult.reason, 'Không thể kiểm tra trạng thái nhập dữ liệu.'));
      if (branchesResult.status === 'fulfilled') {
        const activeBranches = branchesResult.value.filter((branch) => branch.status === 'ACTIVE');
        setBranches(activeBranches);
        setBranchId((current) => current || activeBranches[0]?.id || '');
      } else {
        setPageError(messageFor(branchesResult.reason, 'Không thể tải danh sách chi nhánh.'));
      }
      if (batchesResult.status === 'fulfilled') setBatches(batchesResult.value);
      else setPageError(messageFor(batchesResult.reason, 'Không thể tải lịch sử nhập.'));
    });
    return () => { active = false; };
  }, [session]);

  const hasPendingBatches = batches.some((batch) => ACTIVE_BATCH_STATUSES.has(batch.status));

  async function showFailureDetails(batch: ImportBatch) {
    if (!session) return;
    const requestId = ++detailsRequestId.current;
    setDetailsBatch(batch);
    setDetails(null);
    setDetailsError('');
    setIsLoadingDetails(true);
    try {
      const result = await request<ImportBatchDetails>(
        `/customers/import-batches/${batch.id}`,
        {},
        session.accessToken,
      );
      if (detailsRequestId.current === requestId) setDetails(result);
    } catch (error) {
      if (detailsRequestId.current === requestId) {
        setDetailsError(messageFor(error, 'Không thể tải chi tiết dòng lỗi.'));
      }
    } finally {
      if (detailsRequestId.current === requestId) setIsLoadingDetails(false);
    }
  }

  useEffect(() => {
    if (!session || !hasPendingBatches) return;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = await request<ImportBatch[]>('/customers/import-batches', {}, session.accessToken);
        if (active) setBatches(result);
      } catch (error) {
        if (active) setPageError(messageFor(error, 'Không thể cập nhật trạng thái nhập.'));
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [session, hasPendingBatches]);

  async function uploadSelectedFile() {
    if (!session || !selectedFile || !branchId || !readiness?.ready || isUploading) return;
    setIsUploading(true);
    setUploadError('');
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('branchId', branchId);
    try {
      const batch = await request<ImportBatch>('/customers/import-batches', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current ?? crypto.randomUUID() },
        body: formData,
      }, session.accessToken);
      setBatches((current) => [batch, ...current.filter((item) => item.id !== batch.id)].slice(0, 50));
      setSelectedFile(null);
      idempotencyKey.current = null;
      if (fileInput.current) fileInput.current.value = '';
      setActivePanel('preview');
    } catch (error) {
      setUploadError(messageFor(error, 'Không thể tiếp nhận tệp. Vui lòng thử lại.'));
    } finally {
      setIsUploading(false);
    }
  }

  function chooseFile(file: File | undefined) {
    setUploadError('');
    if (!file) {
      setSelectedFile(null);
      idempotencyKey.current = null;
      return;
    }
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setSelectedFile(null);
      idempotencyKey.current = null;
      setUploadError('Chỉ chấp nhận tệp CSV hoặc XLSX.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setSelectedFile(null);
      idempotencyKey.current = null;
      setUploadError('Tệp vượt quá giới hạn 20 MB.');
      return;
    }
    idempotencyKey.current = crypto.randomUUID();
    setSelectedFile(file);
  }

  return (
    <WorkspaceLayout activeSection="customer-import" requiredPermission="customers.import">
      <div className="space-y-4">
        <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-crm-muted">Khách hàng</p>
            <h1 className="text-xl font-semibold text-foreground">Nhập khách hàng theo lô</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Tệp sạch được nhập tự động; trạng thái và số liệu được lưu ở bên phải.
            </p>
          </div>
          <Link
            href="/customers"
            className={buttonVariants({ variant: 'outline', className: 'h-10 min-h-10 w-full rounded-xl px-4 sm:w-auto' })}
          >
            <ArrowLeft aria-hidden="true" />
            Quay lại khách hàng
          </Link>
        </header>

        <Dialog
          open={detailsBatch !== null}
          onOpenChange={(open) => {
            if (!open) {
              detailsRequestId.current += 1;
              setDetailsBatch(null);
              setDetails(null);
              setDetailsError('');
              setIsLoadingDetails(false);
            }
          }}
        >
          <DialogContent className="sm:max-w-2xl" closeLabel="Đóng">
            <DialogHeader className="pr-10">
              <DialogTitle>Các dòng chưa được nhập</DialogTitle>
              <DialogDescription>
                Chỉ hiển thị số dòng và lý do; chi tiết này được tự xóa sau 30 ngày.
              </DialogDescription>
            </DialogHeader>
            {isLoadingDetails ? (
              <p className="py-4 text-sm text-muted-foreground" role="status">Đang tải chi tiết dòng lỗi…</p>
            ) : detailsError ? (
              <p className="py-4 text-sm text-destructive" role="alert">{detailsError}</p>
            ) : details?.failureDetailsExpired ? (
              <p className="py-4 text-sm text-muted-foreground">Chi tiết dòng lỗi đã hết hạn và được xóa.</p>
            ) : details?.failedRows.length ? (
              <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-xs leading-5 text-foreground">
                {details.failedRows
                  .map(({ rowNumber, errorCodes }) => `Dòng ${rowNumber}: ${errorCodes.map(failureMessage).join(' · ')}`)
                  .join('\n')}
              </pre>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">Không có dòng lỗi cần hiển thị.</p>
            )}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" className="min-h-10" />}>
                Đóng
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 lg:hidden" role="group" aria-label="Các bước nhập khách hàng">
          <Button
            type="button"
            variant="ghost"
            aria-pressed={activePanel === 'prepare'}
            className={`h-10 min-h-10 ${activePanel === 'prepare' ? 'bg-card text-foreground' : 'text-muted-foreground'}`}
            onClick={() => setActivePanel('prepare')}
          >
            Chuẩn bị
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-pressed={activePanel === 'preview'}
            className={`h-10 min-h-10 ${activePanel === 'preview' ? 'bg-card text-foreground' : 'text-muted-foreground'}`}
            onClick={() => setActivePanel('preview')}
          >
            Kết quả
          </Button>
        </div>

        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <Card className={activePanel === 'prepare' ? 'min-w-0 gap-4 py-4 sm:py-5' : 'hidden min-w-0 gap-4 py-4 sm:py-5 lg:flex'}>
            <CardHeader className="px-4 sm:px-5">
              <CardTitle className="text-base">Chuẩn bị dữ liệu</CardTitle>
              <CardDescription>
                CSV hoặc XLSX · tối đa 20 MB · cần chọn chi nhánh.
              </CardDescription>
              <CardAction>
                <Dialog>
                  <DialogTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 min-h-10 rounded-xl px-3"
                      />
                    }
                  >
                    <CircleHelp aria-hidden="true" />
                    Hướng dẫn
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-2xl" closeLabel="Đóng">
                    <DialogHeader className="pr-10">
                      <DialogTitle>Cách tạo file khách hàng</DialogTitle>
                      <DialogDescription>
                        Dùng tiêu đề cột nhận diện được; hệ thống sẽ tự quét và nhập tệp sạch.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5 text-sm">
                      <section className="space-y-2" aria-labelledby="import-file-fields">
                        <h3 id="import-file-fields" className="font-semibold">Cột bắt buộc và tùy chọn</h3>
                        <dl className="divide-y divide-border rounded-xl border border-border">
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 p-3">
                            <dt className="font-medium">Họ tên · bắt buộc</dt>
                            <dd className="break-words text-muted-foreground">Nguyễn Thị Lan Anh</dd>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 p-3">
                            <dt className="font-medium">Số điện thoại · bắt buộc</dt>
                            <dd className="break-words text-muted-foreground">0912345678</dd>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 p-3">
                            <dt>Email · tùy chọn</dt>
                            <dd className="break-words text-muted-foreground">lananh@example.com</dd>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 p-3">
                            <dt>Ngày sinh · tùy chọn</dt>
                            <dd className="break-words text-muted-foreground">14/03/1992</dd>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 p-3">
                            <dt>CCCD · tùy chọn</dt>
                            <dd className="break-words text-muted-foreground">001234567890</dd>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 p-3">
                            <dt>Địa chỉ · tùy chọn</dt>
                            <dd className="break-words text-muted-foreground">12 Nguyễn Trãi, Thanh Xuân, Hà Nội</dd>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 p-3">
                            <dt>Quê quán · tùy chọn</dt>
                            <dd className="break-words text-muted-foreground">Hà Nam</dd>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 p-3">
                            <dt>Giới tính · tùy chọn</dt>
                            <dd className="break-words text-muted-foreground">Nam / Nữ / Khác</dd>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 p-3">
                            <dt>Nơi cấp · tùy chọn</dt>
                            <dd className="break-words text-muted-foreground">Cục Cảnh sát QLHC về TTXH</dd>
                          </div>
                        </dl>
                        <p className="text-xs text-muted-foreground">
                          Mỗi dòng là một khách hàng. Các cột mới không bắt buộc. Có thể dùng tiêu đề tiếng Việt hoặc CCCD, address, place_of_origin, sex, place_of_issue; ví dụ các tên phổ biến khác là Full name, Phone, Email và Date of birth. Chọn chi nhánh cho cả lô.
                        </p>
                        <p className="text-xs text-muted-foreground">Trong XLSX, đặt cột CCCD dạng Văn bản hoặc định dạng số có đủ số 0 đầu.</p>
                      </section>

                      <section className="space-y-2" aria-labelledby="import-file-example">
                        <h3 id="import-file-example" className="font-semibold">Ví dụ CSV</h3>
                        <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 text-foreground">
{`Họ tên,Số điện thoại,Email,Ngày sinh,CCCD,Địa chỉ,Quê quán,Giới tính,Nơi cấp
Nguyễn Thị Lan Anh,0912345678,lananh@example.com,14/03/1992,001234567890,"12 Nguyễn Trãi, Thanh Xuân, Hà Nội",Hà Nam,Nữ,Cục Cảnh sát QLHC về TTXH
Trần Quốc Bảo,0987654321,,,,,,,`}
                        </pre>
                      </section>

                      <section className="space-y-2" aria-labelledby="import-file-rules">
                        <h3 id="import-file-rules" className="font-semibold">Định dạng và giới hạn</h3>
                        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                          <li>CSV mã hóa UTF-8, dùng dấu phẩy; hoặc XLSX không mã hóa.</li>
                          <li>Tối đa 20 MB, 10.000 dòng dữ liệu và 10 sheet.</li>
                          <li>XLSX không được có macro, liên kết ngoài hoặc ô công thức; không nhận XLS/XLSM.</li>
                          <li>Workbook tối đa 100 MB sau giải nén và 1.000 mục ZIP.</li>
                          <li>Ngày sinh chấp nhận dd/MM/yyyy (ví dụ 28/10/2006) hoặc yyyy-MM-dd; ngày phải hợp lệ và không ở tương lai.</li>
                          <li>Không thêm dữ liệu ngoài các trường khách hàng được liệt kê.</li>
                        </ul>
                      </section>
                      <p className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                        Sau khi ClamAV báo an toàn, các dòng hợp lệ được nhập tự động trong một giao dịch. Dòng lỗi dữ liệu được bỏ qua và báo số dòng; dòng trùng được đếm riêng. Lỗi tệp hoặc scanner sẽ dừng toàn batch.
                      </p>
                      <p className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                        Tệp tạm tự xóa sau xử lý. Lịch sử không lưu giá trị trong tệp; số dòng và mã lỗi được giữ 30 ngày.
                      </p>
                    </div>

                    <DialogFooter>
                      <DialogClose
                        render={
                          <Button type="button" variant="outline" className="min-h-10" />
                        }
                      >
                        Đã hiểu
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4 px-4 sm:px-5">
              <div className="space-y-1.5">
                <label htmlFor="customer-import-branch" className="w-fit text-sm font-medium">Chi nhánh</label>
                <Select
                  value={branchId}
                  items={branches.map((branch) => ({
                    value: branch.id,
                    label: `${branch.code} · ${branch.name}`,
                  }))}
                  onValueChange={(value) => {
                    if (typeof value !== 'string') return;
                    setBranchId(value);
                    if (selectedFile) idempotencyKey.current = crypto.randomUUID();
                  }}
                >
                  <SelectTrigger id="customer-import-branch" className="h-11 w-full rounded-xl md:h-10">
                    <SelectValue placeholder="Chọn chi nhánh" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.code} · {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <label
                htmlFor="customer-import-file"
                className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-4 py-5 text-center transition-colors ${readiness?.ready ? 'hover:bg-muted' : 'cursor-not-allowed opacity-60'}`}
              >
                <input
                  ref={fileInput}
                  id="customer-import-file"
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  disabled={!readiness?.ready || isUploading}
                  onChange={(event) => chooseFile(event.currentTarget.files?.[0])}
                />
                {readiness?.ready
                  ? <FileSpreadsheet className="size-6 text-muted-foreground" aria-hidden="true" />
                  : <ShieldAlert className="size-6 text-muted-foreground" aria-hidden="true" />}
                <span className="mt-2 text-sm font-medium text-foreground">
                  {selectedFile ? <span className="max-w-full break-all">{selectedFile.name}</span> : readiness?.ready ? 'Chọn tệp khách hàng' : 'Chưa thể tiếp nhận tệp'}
                </span>
                <span className="mt-1 text-sm text-muted-foreground">
                  {readiness?.messageVi ?? 'Đang kiểm tra điều kiện lưu trữ và quét tệp.'}
                </span>
                <span className="mt-3 inline-flex min-h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground">
                  Duyệt tệp
                </span>
              </label>

              {readinessError ? <p className="text-sm text-destructive" role="alert">{readinessError}</p> : null}
              {pageError ? <p className="text-sm text-destructive" role="alert">{pageError}</p> : null}
              {uploadError ? <p className="text-sm text-destructive" role="alert">{uploadError}</p> : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 text-sm text-muted-foreground">
                  {selectedFile
                    ? `${formatFileSize(selectedFile.size)} · tệp tạm sẽ tự xóa sau xử lý`
                    : 'CSV hoặc XLSX · tối đa 20 MB · tối đa 10.000 dòng'}
                </div>
                <Button
                  type="button"
                  variant="default"
                  aria-disabled={isUploading || undefined}
                  aria-busy={isUploading || undefined}
                  disabled={!readiness?.ready || !selectedFile || !branchId}
                  onClick={(event) => {
                    if (isUploading) {
                      event.preventDefault();
                      return;
                    }
                    void uploadSelectedFile();
                  }}
                  className="min-h-11 w-full rounded-xl px-4 md:min-h-10 sm:w-auto"
                >
                  {isUploading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                  Tải lên và nhập
                </Button>
              </div>

              <dl className="grid grid-cols-1 gap-3 rounded-xl bg-muted/50 p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Định dạng</dt>
                  <dd className="mt-1 font-medium">CSV, XLSX</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Giới hạn</dt>
                  <dd className="mt-1 font-medium">20 MB / tệp</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className={activePanel === 'preview' ? 'min-w-0 gap-4 py-4 sm:py-5' : 'hidden min-w-0 gap-4 py-4 sm:py-5 lg:flex'}>
            <CardHeader className="px-4 sm:px-5">
              <CardTitle className="text-base">Kết quả nhập gần đây</CardTitle>
              <CardDescription>
                Trạng thái và số liệu tổng hợp; chỉ giữ số dòng lỗi và mã lỗi trong 30 ngày.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 sm:px-5">
              {batches.length ? (
                <ul className="divide-y divide-border">
                  {batches.map((batch) => {
                    const isPending = ACTIVE_BATCH_STATUSES.has(batch.status);
                    return (
                      <li key={batch.id} className="flex min-w-0 items-start gap-3 py-3">
                        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                          {isPending
                            ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            : batch.status === 'COMPLETED'
                              ? <CheckCircle2 className="size-4" aria-hidden="true" />
                              : <ShieldAlert className="size-4" aria-hidden="true" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <p className="text-sm font-medium text-foreground">{batchStatusLabel(batch.status)}</p>
                            <time className="text-xs tabular-nums text-muted-foreground" dateTime={batch.createdAt}>
                              {new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(batch.createdAt))}
                            </time>
                          </div>
                          {batch.status === 'COMPLETED' ? (
                            <>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Đã nhập dữ liệu và xóa tệp tạm thành công.
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {batch.importedRows} nhập thành công · {batch.duplicateRows} trùng · {batch.invalidRows} dòng lỗi dữ liệu · {batch.failedInsertRows} lỗi ghi
                              </p>
                              {hasFailureDetails(batch) ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="mt-2 min-h-9"
                                  disabled={isLoadingDetails}
                                  onClick={() => { void showFailureDetails(batch); }}
                                >
                                  Xem dòng lỗi
                                </Button>
                              ) : batch.invalidRows > 0 ? (
                                <p className="mt-1 text-xs text-muted-foreground">Chi tiết dòng lỗi đã hết hạn.</p>
                              ) : null}
                            </>
                          ) : batch.status === 'FAILED' ? (
                            <>
                              <p className="mt-1 text-sm text-muted-foreground">{batchErrorMessage(batch)}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {batch.importedRows} nhập thành công · {batch.duplicateRows} trùng · {batch.invalidRows} dòng lỗi dữ liệu · {batch.failedInsertRows} lỗi ghi
                              </p>
                              {hasFailureDetails(batch) ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="mt-2 min-h-9"
                                  disabled={isLoadingDetails}
                                  onClick={() => { void showFailureDetails(batch); }}
                                >
                                  Xem dòng lỗi
                                </Button>
                              ) : batch.invalidRows + batch.failedInsertRows > 0 ? (
                                <p className="mt-1 text-xs text-muted-foreground">Chi tiết dòng lỗi đã hết hạn.</p>
                              ) : null}
                            </>
                          ) : (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {batch.status === 'COMMITTING'
                                ? 'Dữ liệu đã ghi; chỉ báo hoàn tất sau khi xóa tệp tạm thành công.'
                                : 'Đang quét, kiểm tra và xử lý tệp trong nền.'}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
                  <div className="grid size-11 place-items-center rounded-xl bg-card text-muted-foreground">
                    <TableProperties className="size-5" aria-hidden="true" />
                  </div>
                  <h2 className="mt-3 text-base font-semibold">Chưa có batch nhập nào</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Khi tải tệp lên, kết quả scan và số lượng nhập sẽ xuất hiện tại đây.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
