'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, Check, ChevronRight, CircleAlert, FlaskConical, History, Plus, Save, Tags } from 'lucide-react';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { useCrmSession } from '@/components/crm-session';
import { AccordionItem } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogOverlay, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { request } from '@/lib/crm-api';

type ApiRequest = <T>(path: string, options?: RequestInit, accessToken?: string) => Promise<T>;
type Branch = { id: string; code: string; name: string; status: string };
type LoanProduct = {
  id: string;
  branchId: string | null;
  branch: { id: string; code: string; name: string } | null;
  code: string;
  name: string;
  loanType: string;
  source: string;
  description: string | null;
  sourceUrl: string | null;
  thumbnailUrl: string | null;
  minTermMonths: number;
  maxTermMonths: number;
  minAmount: string | null;
  maxAmount: string | null;
  annualInterestRate: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  currentFormulaVersion: number;
  createdAt: string;
  updatedAt: string;
};
type FormulaVariable = { key: string; label: string; min: string; max: string; defaultValue: string };
type FormulaVersion = {
  version: number;
  interestFormula: string;
  monthlyPaymentFormula: string;
  variables: FormulaVariable[];
};
type FormulaHistoryEntry = FormulaVersion & {
  createdAt: string;
  createdBy: { displayName: string; username: string };
};
type FormulaHistoryPage = { items: FormulaHistoryEntry[]; nextBeforeVersion: number | null };
type ProductForm = {
  branchId: string;
  code: string;
  name: string;
  loanType: string;
  source: string;
  description: string;
  sourceUrl: string;
  thumbnailUrl: string;
  minTermMonths: string;
  maxTermMonths: string;
  minAmount: string;
  maxAmount: string;
  annualInterestRate: string;
};

const statusLabels: Record<LoanProduct['status'], string> = {
  DRAFT: 'Bản nháp',
  ACTIVE: 'Đang công bố',
  INACTIVE: 'Ngừng bán',
};
const statusVariants: Record<LoanProduct['status'], 'secondary' | 'default' | 'outline'> = {
  DRAFT: 'outline',
  ACTIVE: 'default',
  INACTIVE: 'secondary',
};
const inputClass = 'h-11 bg-white text-base md:h-10 md:text-sm';
const loanTypeOptions = [
  'Gói hỗ trợ ngắn hạn',
  'Gói sản phẩm trung, dài hạn',
  'Gói hỗ trợ mua sắm tiêu dùng',
  'Gói hỗ trợ thế chấp bất động sản',
  'Vay thế chấp mua xe ô tô',
] as const;
const emptyProductForm: ProductForm = {
  branchId: '', code: '', name: '', loanType: '', source: '', description: '', sourceUrl: '', thumbnailUrl: '',
  minTermMonths: '', maxTermMonths: '', minAmount: '', maxAmount: '', annualInterestRate: '',
};

function formatCurrency(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('vi-VN').format(amount) : value;
}

function formatAmountRange(minAmount: string | null, maxAmount: string | null) {
  if (minAmount && maxAmount) return `${formatCurrency(minAmount)}–${formatCurrency(maxAmount)} ₫`;
  if (minAmount) return `Từ ${formatCurrency(minAmount)} ₫`;
  if (maxAmount) return `Đến ${formatCurrency(maxAmount)} ₫`;
  return 'Không giới hạn theo số tiền';
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi khi xử lý danh mục sản phẩm.';
}

function productFormFrom(product: LoanProduct): ProductForm {
  return {
    branchId: product.branchId ?? '',
    code: product.code,
    name: product.name,
    loanType: product.loanType,
    source: product.source,
    description: product.description ?? '',
    sourceUrl: product.sourceUrl ?? '',
    thumbnailUrl: product.thumbnailUrl ?? '',
    minTermMonths: String(product.minTermMonths),
    maxTermMonths: String(product.maxTermMonths),
    minAmount: product.minAmount ?? '',
    maxAmount: product.maxAmount ?? '',
    annualInterestRate: product.annualInterestRate,
  };
}

function ProductField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-800">{label}{children}</label>;
}

export function LoanProductsPage() {
  const { session, can } = useCrmSession();
  if (!session) return <main className="loading-screen"><span className="spinner" aria-hidden="true" /><p>Đang tải danh mục sản phẩm…</p></main>;

  const canManage = can('loan-products.manage');
  const canPublish = can('loan-products.publish');
  const canManageFormula = can('loan-products.formula.manage');
  return (
    <WorkspaceLayout activeSection="products" requiredPermission={['loan-products.read', 'loan-products.manage']}>
      <LoanProductsWorkspace
        accessToken={session.accessToken}
        request={request}
        canManage={canManage}
        canPublish={canPublish}
        canManageFormula={canManageFormula}
        canReadBranches={can('branches.read')}
      />
    </WorkspaceLayout>
  );
}

function LoanProductsWorkspace({
  accessToken,
  request: apiRequest,
  canManage,
  canPublish,
  canManageFormula,
  canReadBranches,
}: {
  accessToken: string;
  request: ApiRequest;
  canManage: boolean;
  canPublish: boolean;
  canManageFormula: boolean;
  canReadBranches: boolean;
}) {
  const [products, setProducts] = useState<LoanProduct[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyProductForm);
  const [formula, setFormula] = useState<FormulaVersion | null>(null);
  const [interestFormula, setInterestFormula] = useState('');
  const [monthlyPaymentFormula, setMonthlyPaymentFormula] = useState('');
  const [variablesJson, setVariablesJson] = useState('[]');
  const [formulaError, setFormulaError] = useState('');
  const [formulaHistory, setFormulaHistory] = useState<FormulaHistoryEntry[]>([]);
  const [formulaHistoryCursor, setFormulaHistoryCursor] = useState<number | null>(null);
  const [formulaHistoryLoading, setFormulaHistoryLoading] = useState(false);
  const [formulaHistoryError, setFormulaHistoryError] = useState('');
  const [formulaHistoryReloadKey, setFormulaHistoryReloadKey] = useState(0);
  const [applyingFormulaVersion, setApplyingFormulaVersion] = useState<number | null>(null);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const formulaHistoryRequestId = useRef(0);
  const selectedProduct = useMemo(() => products.find((product) => product.id === selectedId) ?? null, [products, selectedId]);
  const activeBranches = branches.filter((branch) => branch.status === 'ACTIVE');

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1279px)');
    const updateLayout = () => setIsMobileLayout(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  useEffect(() => {
    if (!isMobileLayout) setMobileDetailOpen(false);
  }, [isMobileLayout]);

  async function loadProducts() {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest<LoanProduct[]>('/loan-products', {}, accessToken);
      setProducts(result);
      setSelectedId((current) => result.some((product) => product.id === current) ? current : result[0]?.id ?? '');
    } catch (loadError) {
      setError(messageFor(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProducts();
    if (canReadBranches) {
      void apiRequest<Branch[]>('/access/branches', {}, accessToken).then(setBranches).catch((loadError: unknown) => setError(messageFor(loadError)));
    }
  }, [accessToken, apiRequest, canReadBranches]);

  useEffect(() => {
    setFormula(null);
    setFormulaError('');
    if (!selectedProduct || !canManageFormula || selectedProduct.currentFormulaVersion === 0) {
      setInterestFormula('');
      setMonthlyPaymentFormula('');
      setVariablesJson('[]');
      return;
    }
    let current = true;
    void apiRequest<FormulaVersion | null>(`/loan-products/${selectedProduct.id}/formula`, {}, accessToken)
      .then((result) => {
        if (!current || !result) return;
        setFormula(result);
        setInterestFormula(result.interestFormula);
        setMonthlyPaymentFormula(result.monthlyPaymentFormula);
        setVariablesJson(JSON.stringify(result.variables, null, 2));
      })
      .catch((loadError: unknown) => { if (current) setFormulaError(messageFor(loadError)); });
    return () => { current = false; };
  }, [accessToken, apiRequest, canManageFormula, selectedProduct?.id, selectedProduct?.currentFormulaVersion]);

  useEffect(() => {
    const requestId = ++formulaHistoryRequestId.current;
    setFormulaHistory([]);
    setFormulaHistoryCursor(null);
    setFormulaHistoryError('');
    if (!selectedProduct || !canManageFormula) {
      setFormulaHistoryLoading(false);
      return;
    }

    let current = true;
    setFormulaHistoryLoading(true);
    void apiRequest<FormulaHistoryPage>(`/loan-products/${selectedProduct.id}/formula-versions`, {}, accessToken)
      .then((page) => {
        if (!current || requestId !== formulaHistoryRequestId.current) return;
        setFormulaHistory(page.items);
        setFormulaHistoryCursor(page.nextBeforeVersion);
      })
      .catch((loadError: unknown) => {
        if (current && requestId === formulaHistoryRequestId.current) setFormulaHistoryError(messageFor(loadError));
      })
      .finally(() => {
        if (current && requestId === formulaHistoryRequestId.current) setFormulaHistoryLoading(false);
      });
    return () => {
      current = false;
      if (formulaHistoryRequestId.current === requestId) formulaHistoryRequestId.current += 1;
    };
  }, [accessToken, apiRequest, canManageFormula, formulaHistoryReloadKey, selectedProduct?.id]);

  function updateForm(field: keyof ProductForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startCreate() {
    setError('');
    setNotice('');
    setForm({ ...emptyProductForm, branchId: activeBranches.length === 1 ? activeBranches[0].id : '' });
    setEditorMode('create');
    setSelectedId('');
  }

  function startEdit() {
    if (!selectedProduct) return;
    setError('');
    setNotice('');
    setForm(productFormFrom(selectedProduct));
    setEditorMode('edit');
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.loanType) {
      setError('Hãy chọn loại gói.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    const shouldSaveLoanType = editorMode !== 'edit'
      || form.loanType !== selectedProduct?.loanType
      || loanTypeOptions.some((option) => option === form.loanType);
    const payload = {
      ...(editorMode === 'create' && form.branchId ? { branchId: form.branchId } : {}),
      ...(editorMode === 'create' && form.code.trim() ? { code: form.code.trim() } : {}),
      name: form.name.trim(),
      ...(shouldSaveLoanType ? { loanType: form.loanType } : {}),
      source: form.source.trim(),
      description: form.description.trim() || undefined,
      sourceUrl: form.sourceUrl.trim() || undefined,
      thumbnailUrl: form.thumbnailUrl.trim() || undefined,
      minTermMonths: Number(form.minTermMonths), maxTermMonths: Number(form.maxTermMonths),
      minAmount: form.minAmount.trim() || null,
      maxAmount: form.maxAmount.trim() || null,
      annualInterestRate: form.annualInterestRate,
    };
    try {
      const saved = await apiRequest<LoanProduct>(editorMode === 'create' ? '/loan-products' : `/loan-products/${selectedId}`, {
        method: editorMode === 'create' ? 'POST' : 'PATCH',
        body: JSON.stringify(payload),
      }, accessToken);
      setProducts((current) => editorMode === 'create' ? [...current, saved].sort((a, b) => a.name.localeCompare(b.name, 'vi')) : current.map((item) => item.id === saved.id ? saved : item));
      setSelectedId(saved.id);
      setEditorMode(null);
      setNotice(editorMode === 'create' ? 'Đã tạo sản phẩm ở trạng thái bản nháp.' : 'Đã lưu thay đổi sản phẩm.');
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function saveFormula(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProduct) return;
    setSaving(true);
    setFormulaError('');
    setError('');
    setNotice('');
    try {
      const variables = JSON.parse(variablesJson) as FormulaVariable[];
      const saved = await apiRequest<FormulaVersion>(`/loan-products/${selectedProduct.id}/formula`, {
        method: 'POST',
        body: JSON.stringify({ interestFormula: interestFormula.trim(), monthlyPaymentFormula: monthlyPaymentFormula.trim(), variables }),
      }, accessToken);
      setFormula(saved);
      setProducts((current) => current.map((product) => product.id === selectedProduct.id ? { ...product, currentFormulaVersion: saved.version } : product));
      setFormulaHistoryReloadKey((current) => current + 1);
      setNotice(`Đã lưu phiên bản công thức ${saved.version}. Các hợp đồng đã tạo giữ snapshot cũ.`);
    } catch (saveError) {
      setFormulaError(saveError instanceof SyntaxError ? 'Danh sách biến phải là JSON hợp lệ.' : messageFor(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function reapplyFormulaVersion(entry: FormulaHistoryEntry) {
    if (!selectedProduct || saving) return;
    setSaving(true);
    setApplyingFormulaVersion(entry.version);
    setFormulaError('');
    setError('');
    setNotice('');
    try {
      const saved = await apiRequest<FormulaVersion>(`/loan-products/${selectedProduct.id}/formula`, {
        method: 'POST',
        body: JSON.stringify({
          interestFormula: entry.interestFormula,
          monthlyPaymentFormula: entry.monthlyPaymentFormula,
          variables: entry.variables,
        }),
      }, accessToken);
      setFormula(saved);
      setInterestFormula(saved.interestFormula);
      setMonthlyPaymentFormula(saved.monthlyPaymentFormula);
      setVariablesJson(JSON.stringify(saved.variables, null, 2));
      setProducts((current) => current.map((product) => product.id === selectedProduct.id ? { ...product, currentFormulaVersion: saved.version } : product));
      setFormulaHistoryReloadKey((current) => current + 1);
      setNotice(`Đã áp dụng lại phiên bản ${entry.version} dưới dạng phiên bản mới ${saved.version}. Các hợp đồng cũ giữ nguyên snapshot.`);
    } catch (applyError) {
      setFormulaError(messageFor(applyError));
    } finally {
      setSaving(false);
      setApplyingFormulaVersion(null);
    }
  }

  async function loadOlderFormulaVersions() {
    if (!selectedProduct || formulaHistoryCursor === null || formulaHistoryLoading) return;
    const requestId = formulaHistoryRequestId.current;
    const beforeVersion = formulaHistoryCursor;
    setFormulaHistoryLoading(true);
    setFormulaHistoryError('');
    try {
      const page = await apiRequest<FormulaHistoryPage>(
        `/loan-products/${selectedProduct.id}/formula-versions?beforeVersion=${beforeVersion}`,
        {},
        accessToken,
      );
      if (requestId !== formulaHistoryRequestId.current) return;
      setFormulaHistory((current) => [...current, ...page.items]);
      setFormulaHistoryCursor(page.nextBeforeVersion);
    } catch (loadError) {
      if (requestId === formulaHistoryRequestId.current) setFormulaHistoryError(messageFor(loadError));
    } finally {
      if (requestId === formulaHistoryRequestId.current) setFormulaHistoryLoading(false);
    }
  }

  async function changeStatus(status: 'ACTIVE' | 'INACTIVE') {
    if (!selectedProduct) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = await apiRequest<LoanProduct>(`/loan-products/${selectedProduct.id}/status`, {
        method: 'POST', body: JSON.stringify({ status }),
      }, accessToken);
      setProducts((current) => current.map((product) => product.id === updated.id ? updated : product));
      setNotice(status === 'ACTIVE' ? 'Sản phẩm đã được công bố.' : 'Sản phẩm đã ngừng bán.');
    } catch (statusError) {
      setError(messageFor(statusError));
    } finally {
      setSaving(false);
    }
  }

  const selectClass = `${inputClass} w-full rounded-lg border border-input px-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`;
  const editable = canManage && selectedProduct?.status !== 'ACTIVE';

  return (
    <main className="min-w-0 p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-950">Sản phẩm vay</h1>
          <p className="mt-1 text-sm text-slate-600">Điều kiện, kỳ hạn và phiên bản công thức của từng gói.</p>
        </div>
        {canManage && <Button variant="default" onClick={() => { startCreate(); if (isMobileLayout) setMobileDetailOpen(true); }}><Plus aria-hidden="true" className="size-4" />Tạo sản phẩm</Button>}
      </header>

      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><p className="font-medium">Không thể hoàn tất thao tác</p><p className="mt-1">{error}</p></div>}
      {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</p>}

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.4fr)]">
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white" aria-labelledby="products-list-heading">
          <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
            <div><h2 id="products-list-heading" className="font-semibold text-slate-950">Danh mục</h2><p className="mt-0.5 text-xs text-slate-500">{loading ? 'Đang tải…' : `${products.length} sản phẩm`}</p></div>
            <Tags aria-hidden="true" className="size-4 text-slate-500" />
          </header>
          {loading ? <p className="py-6 text-center text-sm text-slate-600">Đang tải sản phẩm…</p> : products.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-600">Chưa có sản phẩm trong phạm vi này.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {products.map((product) => (
                <li key={product.id}>
                  <button type="button" aria-current={selectedId === product.id ? 'true' : undefined} onClick={() => { setSelectedId(product.id); setEditorMode(null); if (isMobileLayout) setMobileDetailOpen(true); }} className={`flex w-full min-w-0 items-start justify-between gap-3 px-4 py-3 text-left hover:bg-teal-50 sm:px-5 ${selectedId === product.id ? 'bg-teal-50' : ''}`}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-950">{product.name}</span>
                      <span className="mt-1 block text-xs text-slate-500">{product.code} · {product.loanType}</span>
                      <span className="mt-1 block text-xs text-slate-600 tabular-nums">{product.minTermMonths}–{product.maxTermMonths} tháng · {formatAmountRange(product.minAmount, product.maxAmount)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2"><Badge variant={statusVariants[product.status]}>{statusLabels[product.status]}</Badge><ChevronRight aria-hidden="true" className="size-4 text-slate-400" /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Dialog
          open={isMobileLayout ? mobileDetailOpen : true}
          modal={isMobileLayout}
          disablePointerDismissal
          onOpenChange={(open, eventDetails) => {
            if (open || eventDetails.reason === 'close-press') setMobileDetailOpen(open);
          }}
        >
          <DialogOverlay className="hidden max-xl:block" />
          <DialogPopup
            role={isMobileLayout ? 'dialog' : 'region'}
            aria-modal={isMobileLayout || undefined}
            aria-labelledby={isMobileLayout ? 'mobile-product-detail-title' : 'product-details-heading'}
            initialFocus={isMobileLayout ? true : false}
            className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 xl:col-start-2 xl:row-start-1 max-xl:fixed max-xl:inset-x-0 max-xl:bottom-0 max-xl:top-auto max-xl:z-50 max-xl:flex max-xl:h-[92dvh] max-xl:max-h-[92dvh] max-xl:w-full max-xl:max-w-none max-xl:translate-x-0 max-xl:translate-y-0 max-xl:flex-col max-xl:gap-0 max-xl:overflow-hidden max-xl:rounded-t-2xl max-xl:rounded-b-none max-xl:border-b-0 max-xl:p-0 max-xl:shadow-xl"
          >
            <div className="hidden h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4 max-xl:flex">
              <DialogTitle id="mobile-product-detail-title" className="text-sm font-semibold">Chi tiết sản phẩm vay</DialogTitle>
              <DialogClose
                render={<Button type="button" variant="outline" className="h-9 px-3" />}
              >
                Đóng
              </DialogClose>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain max-xl:pb-4">
          {editorMode ? (
            <form onSubmit={saveProduct} className="p-4 sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div><h2 id="product-details-heading" className="text-base font-semibold text-slate-950">{editorMode === 'create' ? 'Sản phẩm mới' : 'Chỉnh sửa sản phẩm'}</h2><p className="mt-1 text-sm text-slate-600">Sản phẩm được lưu ở trạng thái bản nháp.</p></div>
                <Button type="button" variant="outline" onClick={() => setEditorMode(null)}>Huỷ</Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ProductField label="Tên sản phẩm *"><Input className={inputClass} value={form.name} onChange={(event) => updateForm('name', event.target.value)} minLength={2} maxLength={200} required /></ProductField>
                <ProductField label="Viết tắt"><Input className={inputClass} value={form.code} onChange={(event) => updateForm('code', event.target.value)} pattern="[A-Za-z0-9._-]+" minLength={2} maxLength={80} placeholder="Để trống để hệ thống tự tạo" disabled={editorMode === 'edit'} /></ProductField>
                <ProductField label="Loại gói *">
                  <Select value={form.loanType || undefined} onValueChange={(value) => { if (typeof value === 'string') updateForm('loanType', value); }}>
                    <SelectTrigger className={selectClass}><SelectValue placeholder="Chọn loại gói" /></SelectTrigger>
                    <SelectContent align="start">
                      {loanTypeOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                      {editorMode === 'edit' && form.loanType && !loanTypeOptions.some((option) => option === form.loanType)
                        && <SelectItem value={form.loanType}>Giá trị hiện tại: {form.loanType}</SelectItem>}
                    </SelectContent>
                  </Select>
                </ProductField>
                <ProductField label="Nguồn *"><Input className={inputClass} value={form.source} onChange={(event) => updateForm('source', event.target.value)} minLength={2} maxLength={200} required /></ProductField>
                <ProductField label="Chi nhánh"><Select value={form.branchId} onValueChange={(value) => { if (typeof value === 'string') updateForm('branchId', value); }}><SelectTrigger className={selectClass}><SelectValue placeholder="Toàn hệ thống">{branches.find((branch) => branch.id === form.branchId)?.name}</SelectValue></SelectTrigger><SelectContent align="start"><SelectItem value="">Toàn hệ thống</SelectItem>{activeBranches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.code} · {branch.name}</SelectItem>)}</SelectContent></Select></ProductField>
                <ProductField label="Lãi suất năm (%) *"><Input className={inputClass} type="number" min="0" step="0.0001" value={form.annualInterestRate} onChange={(event) => updateForm('annualInterestRate', event.target.value)} required /></ProductField>
                <ProductField label="Kỳ hạn tối thiểu (tháng) *"><Input className={inputClass} type="number" min="1" max="1200" step="1" value={form.minTermMonths} onChange={(event) => updateForm('minTermMonths', event.target.value)} required /></ProductField>
                <ProductField label="Kỳ hạn tối đa (tháng) *"><Input className={inputClass} type="number" min="1" max="1200" step="1" value={form.maxTermMonths} onChange={(event) => updateForm('maxTermMonths', event.target.value)} required /></ProductField>
                <ProductField label="Số tiền tối thiểu (₫)"><Input className={inputClass} inputMode="decimal" value={form.minAmount} onChange={(event) => updateForm('minAmount', event.target.value)} pattern="[0-9]+(\.[0-9]{1,2})?" /><span className="text-xs font-normal text-slate-600">Không bắt buộc; để trống nếu không giới hạn mức tối thiểu.</span></ProductField>
                <ProductField label="Số tiền tối đa (₫)"><Input className={inputClass} inputMode="decimal" value={form.maxAmount} onChange={(event) => updateForm('maxAmount', event.target.value)} pattern="[0-9]+(\.[0-9]{1,2})?" /><span className="text-xs font-normal text-slate-600">Không bắt buộc; để trống nếu không giới hạn mức tối đa.</span></ProductField>
                <ProductField label="Link nguồn"><Input className={inputClass} type="url" value={form.sourceUrl} onChange={(event) => updateForm('sourceUrl', event.target.value)} placeholder="https://" /></ProductField>
                <ProductField label="Thumbnail URL"><Input className={inputClass} type="url" value={form.thumbnailUrl} onChange={(event) => updateForm('thumbnailUrl', event.target.value)} placeholder="https://" /></ProductField>
                <label className="grid gap-1.5 text-sm font-medium text-slate-800 sm:col-span-2">Mô tả<textarea className="min-h-24 rounded-lg border border-input bg-white px-3 py-2 text-base focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm" value={form.description} onChange={(event) => updateForm('description', event.target.value)} maxLength={4000} /></label>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2"><Button variant="outline" type="button" onClick={() => setEditorMode(null)}>Huỷ</Button><Button variant="default" type="submit" aria-busy={saving}><Save aria-hidden="true" className="size-4" />{saving ? 'Đang lưu…' : 'Lưu bản nháp'}</Button></div>
            </form>
          ) : selectedProduct ? (
            <div className="divide-y divide-slate-200">
              <header className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 id="product-details-heading" className="text-lg font-semibold text-slate-950">{selectedProduct.name}</h2><Badge variant={statusVariants[selectedProduct.status]}>{statusLabels[selectedProduct.status]}</Badge></div><p className="mt-1 text-sm text-slate-600">{selectedProduct.code} · {selectedProduct.loanType} · {selectedProduct.branch?.name ?? 'Toàn hệ thống'}</p></div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {editable && <Button variant="outline" onClick={startEdit}>Chỉnh sửa</Button>}
                  {canPublish && selectedProduct.status !== 'ACTIVE' && selectedProduct.currentFormulaVersion > 0 && <Button variant="default" onClick={() => void changeStatus('ACTIVE')} aria-busy={saving}><Check aria-hidden="true" className="size-4" />Công bố</Button>}
                  {canPublish && selectedProduct.status === 'ACTIVE' && <Button variant="outline" onClick={() => void changeStatus('INACTIVE')}>Ngừng bán</Button>}
                </div>
              </header>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-4 sm:grid-cols-2 sm:p-5">
                <div><dt className="text-xs text-slate-500">Khoảng vay</dt><dd className="mt-1 font-medium tabular-nums">{formatAmountRange(selectedProduct.minAmount, selectedProduct.maxAmount)}</dd></div>
                <div><dt className="text-xs text-slate-500">Kỳ hạn</dt><dd className="mt-1 font-medium tabular-nums">{selectedProduct.minTermMonths}–{selectedProduct.maxTermMonths} tháng</dd></div>
                <div><dt className="text-xs text-slate-500">Lãi suất năm</dt><dd className="mt-1 font-medium tabular-nums">{selectedProduct.annualInterestRate}%</dd></div>
                <div><dt className="text-xs text-slate-500">Nguồn</dt><dd className="mt-1 break-words font-medium">{selectedProduct.source}</dd></div>
                {selectedProduct.sourceUrl && <div className="min-w-0"><dt className="text-xs text-slate-500">Link nguồn</dt><dd className="mt-1 break-all"><a className="text-teal-800 underline" href={selectedProduct.sourceUrl} target="_blank" rel="noreferrer">{selectedProduct.sourceUrl}</a></dd></div>}
                {selectedProduct.description && <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Mô tả</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{selectedProduct.description}</dd></div>}
              </dl>
              <section className="p-4 sm:p-5" aria-labelledby="formula-heading">
                <div className="mb-4 flex items-start justify-between gap-3"><div><h3 id="formula-heading" className="font-semibold text-slate-950">Công thức tính</h3><p className="mt-1 text-sm text-slate-600">{selectedProduct.currentFormulaVersion ? `Phiên bản hiện hành ${selectedProduct.currentFormulaVersion}` : 'Chưa có phiên bản công thức'}</p></div><FlaskConical aria-hidden="true" className="size-4 text-slate-500" /></div>
                {canManageFormula ? (
                  <form onSubmit={saveFormula} className="grid grid-cols-1 gap-3">
                    <ProductField label="Công thức lãi *"><Input className={`${inputClass} font-mono`} value={interestFormula} onChange={(event) => setInterestFormula(event.target.value)} placeholder="principal * annualRatePercent / 100" required /></ProductField>
                    <ProductField label="Công thức khoản trả tháng *"><Input className={`${inputClass} font-mono`} value={monthlyPaymentFormula} onChange={(event) => setMonthlyPaymentFormula(event.target.value)} placeholder="Nhập biểu thức đã được phê duyệt" required /></ProductField>
                    <label className="grid gap-1.5 text-sm font-medium text-slate-800">Biến bổ sung (JSON)<textarea className="min-h-28 rounded-lg border border-input bg-white px-3 py-2 font-mono text-base focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm" value={variablesJson} onChange={(event) => setVariablesJson(event.target.value)} aria-invalid={Boolean(formulaError)} /></label>
                    <AccordionItem title="Cách sử dụng biến và công thức">
                      <div className="grid gap-3">
                        <div className="grid gap-1">
                          <p className="text-sm text-slate-700">Mỗi công thức là một biểu thức số. Biến có phân biệt chữ hoa/thường; lãi suất được nhập theo phần trăm nên cần chia 100 khi đổi sang hệ số.</p>
                        </div>
                        <dl className="grid gap-2 text-sm sm:grid-cols-3">
                          <div>
                            <dt className="font-mono font-semibold text-slate-900">principal</dt>
                            <dd className="text-slate-600">Số tiền gốc khách vay, đơn vị đồng (₫).</dd>
                          </div>
                          <div>
                            <dt className="font-mono font-semibold text-slate-900">annualRatePercent</dt>
                            <dd className="text-slate-600">Lãi suất năm của sản phẩm. Ví dụ 8.45 là 8,45%.</dd>
                          </div>
                          <div>
                            <dt className="font-mono font-semibold text-slate-900">termMonths</dt>
                            <dd className="text-slate-600">Kỳ hạn vay, đơn vị tháng (1–1.200).</dd>
                          </div>
                        </dl>
                        <p className="text-sm text-slate-700">Cú pháp hỗ trợ: <code className="font-mono">+ - * /</code>, ngoặc <code className="font-mono">()</code>, <code className="font-mono">min(a, b)</code>, <code className="font-mono">max(a, b)</code> và <code className="font-mono">round(biểu_thức, số_chữ_số)</code> (số chữ số là số nguyên từ 0–6). Không dùng mã JavaScript, lũy thừa hoặc điều kiện.</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="grid content-start gap-1.5">
                            <p className="text-sm font-medium text-slate-800">Ví dụ lãi đơn theo kỳ hạn</p>
                            <code className="break-words rounded-md bg-white p-2 font-mono text-xs text-slate-700">principal * annualRatePercent / 100 * termMonths / 12</code>
                            <p className="text-xs text-slate-600">Công thức khoản trả tháng phải tính độc lập; để chia đều gốc và lãi, nhập:</p>
                            <code className="break-words rounded-md bg-white p-2 font-mono text-xs text-slate-700">(principal + principal * annualRatePercent / 100 * termMonths / 12) / termMonths</code>
                            <p className="text-xs text-slate-600">Với gốc 12.000.000 ₫, lãi 12% và 12 tháng, ví dụ này cho tổng lãi 1.440.000 ₫, trả tháng 1.120.000 ₫. Đây là lãi đơn, không phải dư nợ giảm dần.</p>
                          </div>
                          <div className="grid content-start gap-1.5">
                            <p className="text-sm font-medium text-slate-800">Ví dụ biến bổ sung</p>
                            <pre className="whitespace-pre-wrap break-words rounded-md bg-white p-2 font-mono text-xs text-slate-700">{`[
  {
    "key": "insuranceRatePercent",
    "label": "Tỷ lệ bảo hiểm (%)",
    "min": "0",
    "max": "5",
    "defaultValue": "0.5"
  }
]`}</pre>
                            <p className="text-xs text-slate-600"><code className="font-mono">key</code> dùng trong công thức; <code className="font-mono">label</code> hiện cho người nhập; <code className="font-mono">min</code>, <code className="font-mono">max</code> và <code className="font-mono">defaultValue</code> là chuỗi số; giá trị mặc định phải nằm trong giới hạn. Tối đa 20 biến; key bắt đầu bằng chữ cái, chỉ gồm chữ, số hoặc dấu gạch dưới, không trùng tên biến có sẵn. Để không khai báo biến bổ sung, dùng <code className="font-mono">[]</code>.</p>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600">Kết quả lãi và trả tháng được làm tròn 2 chữ số thập phân. Tổng phải trả = tiền gốc + tổng lãi; hai công thức được tính riêng. Ví dụ chỉ minh họa lãi đơn; hãy dùng công thức đã được nghiệp vụ phê duyệt.</p>
                      </div>
                    </AccordionItem>
                    {formulaError && <p role="alert" className="text-xs text-red-700">{formulaError}</p>}
                    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-600">Phiên bản mới không sửa snapshot hợp đồng cũ. Không có công thức tài chính mặc định; chỉ lưu công thức đã được nghiệp vụ phê duyệt.</p><Button variant="outline" type="submit" disabled={saving} aria-busy={saving}><Save aria-hidden="true" className="size-4" />{saving ? 'Đang lưu…' : 'Lưu phiên bản mới'}</Button></div>
                  </form>
                ) : <p className="text-sm text-slate-600">Bạn chưa có quyền quản lý phiên bản công thức.</p>}
              </section>
              {canManageFormula && <>
                {formulaHistoryError && <div className="p-4 sm:p-5">
                  <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <span>{formulaHistoryError}</span>
                    <Button variant="outline" type="button" onClick={() => setFormulaHistoryReloadKey((current) => current + 1)}>Tải lại lịch sử</Button>
                  </div>
                </div>}
                <div className="p-4 sm:p-5">
                  <AccordionItem title="Lịch sử phiên bản công thức" headingLevel={3}>
                    <p className="mb-4 text-sm">Phiên bản mới nhất hiển thị trước. Áp dụng bản cũ sẽ tạo phiên bản mới; hợp đồng hiện có giữ nguyên snapshot.</p>
                    {formulaHistoryLoading && formulaHistory.length === 0 ? <p className="text-sm">Đang tải lịch sử phiên bản…</p>
                      : formulaHistory.length === 0 && formulaHistoryError ? null
                        : formulaHistory.length === 0 ? <p className="text-sm">Chưa có phiên bản công thức.</p>
                          : <ol className="space-y-4">
                            {formulaHistory.map((entry) => <li key={entry.version} className="relative pl-7 before:absolute before:bottom-[-1rem] before:left-[9px] before:top-5 before:w-px before:bg-slate-200 last:before:hidden">
                              <span className="absolute left-0 top-1 flex size-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500"><History aria-hidden="true" className="size-3" /></span>
                              <div className="grid min-w-0 gap-3 rounded-lg border border-slate-200 p-3 sm:p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="font-medium text-slate-900">Phiên bản {entry.version}</h4>
                                  {entry.version === selectedProduct.currentFormulaVersion && <Badge variant="default">Đang áp dụng</Badge>}
                                  <span className="text-xs text-slate-500">{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))}</span>
                                  <span className="text-xs text-slate-500">{entry.createdBy.displayName} · {entry.createdBy.username}</span>
                                </div>
                                <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                                  <div className="min-w-0">
                                    <dt className="text-xs text-slate-500">Công thức lãi</dt>
                                    <dd className="mt-1 break-all rounded-md bg-slate-50 p-2 font-mono text-xs text-slate-800">{entry.interestFormula}</dd>
                                  </div>
                                  <div className="min-w-0">
                                    <dt className="text-xs text-slate-500">Công thức khoản trả tháng</dt>
                                    <dd className="mt-1 break-all rounded-md bg-slate-50 p-2 font-mono text-xs text-slate-800">{entry.monthlyPaymentFormula}</dd>
                                  </div>
                                  <div className="min-w-0 sm:col-span-2">
                                    <dt className="text-xs text-slate-500">Biến bổ sung</dt>
                                    {entry.variables.length
                                      ? <pre className="mt-1 whitespace-pre-wrap break-all rounded-md bg-slate-50 p-2 font-mono text-xs text-slate-800">{JSON.stringify(entry.variables, null, 2)}</pre>
                                      : <dd className="mt-1 text-sm text-slate-700">Không có biến bổ sung.</dd>}
                                  </div>
                                </dl>
                                {entry.version !== selectedProduct.currentFormulaVersion && <div className="flex justify-end">
                                  <Button variant="outline" type="button" disabled={saving} aria-busy={applyingFormulaVersion === entry.version} onClick={() => void reapplyFormulaVersion(entry)}>
                                    {applyingFormulaVersion === entry.version ? 'Đang áp dụng…' : 'Áp dụng lại phiên bản này'}
                                  </Button>
                                </div>}
                              </div>
                            </li>)}
                          </ol>}
                    {formulaHistoryCursor !== null && <div className="mt-4">
                      <Button variant="outline" type="button" onClick={() => void loadOlderFormulaVersions()} disabled={formulaHistoryLoading} aria-busy={formulaHistoryLoading}>
                        {formulaHistoryLoading ? 'Đang tải…' : 'Xem phiên bản cũ hơn'}
                      </Button>
                    </div>}
                  </AccordionItem>
                </div>
              </>}
              {selectedProduct.status === 'DRAFT' && selectedProduct.currentFormulaVersion === 0 && <p role="note" className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 sm:mx-5"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Cần lưu công thức đã được duyệt trước khi công bố sản phẩm.</p>}
            </div>
          ) : loading ? <p className="py-8 text-center text-sm text-slate-600">Đang tải chi tiết sản phẩm…</p> : <p className="px-4 py-6 text-sm text-slate-600">Chọn một sản phẩm để xem điều kiện và công thức.</p>}
            </div>
          </DialogPopup>
        </Dialog>
      </div>
    </main>
  );
}
