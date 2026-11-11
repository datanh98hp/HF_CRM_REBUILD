'use client';

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';

type Request = <T>(path: string, options?: RequestInit, accessToken?: string) => Promise<T>;

type Customer = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  dateOfBirth: string | null;
  provenance: string;
  verificationStatus: string;
  status: string;
  branchId: string;
  primaryAdviserId: string | null;
  primaryAssignedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};
type LoanRequest = {
  id: string;
  customerId: string;
  topic: string;
  notes: string | null;
  status: string;
  source?: string;
  createdAt: string;
};
type Contract = {
  id: string;
  customerId: string;
  contractNumber: string;
  packageName: string;
  packageCode: string | null;
  packageVersion: string | null;
  loanType: string | null;
  termMonths: number | null;
  status: string;
  approvedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};
type Assignment = {
  id: string;
  adviserId: string;
  assignedAt: string;
  endedAt: string | null;
  isPrimary: boolean;
  adviser: { id: string; username: string; displayName: string };
};
type DuplicateCandidate = {
  id: string;
  status: string;
  matchReasons: string[];
  resolutionReason: string | null;
  candidateCustomer: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    dateOfBirth: string | null;
    branchId: string;
  };
};
type BranchOption = { id: string; code: string; name: string; parentId: string | null; status: string };
type AdviserOption = {
  id: string;
  displayName: string;
  username: string;
  status: string;
  roleGrants: { role: { key: string }; branch: { id: string } | null }[];
};
type CapabilityNotice = { status: string; ready: boolean; messageVi: string };

type Props = {
  accessToken: string;
  request: Request;
  canManageCustomers: boolean;
  canAssignCustomers: boolean;
  canReviewDuplicates: boolean;
  canReadUsers: boolean;
  canReadBranches: boolean;
  canManageRequests: boolean;
  canManageContracts: boolean;
  canReviewContracts: boolean;
  contractCompletionOtp?: CapabilityNotice;
};

const customerStatuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'IN_PROGRESS', 'CONVERTED', 'CLOSED'];
const CUSTOMER_PAGE_SIZES = [5, 10, 20, 50, 100];
const statusLabels: Record<string, string> = {
  NEW: 'Mới',
  CONTACTED: 'Đã liên hệ',
  QUALIFIED: 'Đủ điều kiện',
  IN_PROGRESS: 'Đang xử lý',
  CONVERTED: 'Đã chuyển đổi',
  CLOSED: 'Đã đóng',
  OPEN: 'Đang mở',
  PENDING_REVIEW: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  AWAITING_CUSTOMER_CONFIRMATION: 'Chờ khách hàng xác nhận OTP',
  COMPLETED: 'Hoàn tất',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
  CONFIRMED_DUPLICATE: 'Đã xác nhận trùng',
  NOT_DUPLICATE: 'Không trùng',
};
const matchReasonLabels: Record<string, string> = {
  PHONE: 'Trùng số điện thoại',
  EMAIL: 'Trùng email',
  NAME_AND_DATE_OF_BIRTH: 'Trùng họ tên và ngày sinh',
};

function label(value: string) {
  return statusLabels[value] ?? value;
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(value)) : '—';
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function dateKey(value: Date) {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed
    : null;
}

function dateRangeBound(value: string, endOfDay: boolean) {
  const parsed = parseDateKey(value);
  if (!parsed) return null;
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  return parsed.toISOString();
}

function DateFilterInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => parseDateKey(value) ?? new Date());
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedDate = parseDateKey(value);
  const today = dateKey(new Date());
  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const firstDayOffset = (monthStart.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) =>
    new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), index - firstDayOffset + 1));
  const yearRangeStart = Math.floor(calendarMonth.getFullYear() / 12) * 12;
  const calendarHeading = view === 'days'
    ? new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(calendarMonth)
    : view === 'months'
      ? String(calendarMonth.getFullYear())
      : `${yearRangeStart}–${yearRangeStart + 11}`;

  useEffect(() => {
    if (!value) return;
    const parsed = parseDateKey(value);
    if (parsed) setCalendarMonth(parsed);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function moveMonth(amount: number) {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  function selectDate(date: Date) {
    onChange(dateKey(date));
    setOpen(false);
    setView('days');
    triggerRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}: ${selectedDate ? selectedDate.toLocaleDateString('vi-VN') : 'Chọn ngày'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 md:h-10"
      >
        <span className={selectedDate ? '' : 'text-slate-500'}>
          {selectedDate ? selectedDate.toLocaleDateString('vi-VN') : 'Chọn ngày'}
        </span>
        <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-slate-500" />
      </button>
      {open && <div role="dialog" aria-label={label} className="absolute left-0 top-full z-50 mt-2 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3 text-slate-900 shadow-lg">
        <div className="mb-2 flex h-9 items-center justify-between gap-1">
          <button type="button" aria-label={view === 'years' ? '12 năm trước' : view === 'months' ? 'Năm trước' : 'Tháng trước'} onClick={() => {
            if (view === 'years') setCalendarMonth((current) => new Date(current.getFullYear() - 12, current.getMonth(), 1));
            else if (view === 'months') setCalendarMonth((current) => new Date(current.getFullYear() - 1, current.getMonth(), 1));
            else moveMonth(-1);
          }} className="grid size-8 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100">
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <button type="button" onClick={() => setView((current) => current === 'days' ? 'months' : current === 'months' ? 'years' : 'months')} className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-slate-800 hover:bg-slate-100">
            <span className="truncate">{calendarHeading}</span>
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
          </button>
          <button type="button" aria-label={view === 'years' ? '12 năm sau' : view === 'months' ? 'Năm sau' : 'Tháng sau'} onClick={() => {
            if (view === 'years') setCalendarMonth((current) => new Date(current.getFullYear() + 12, current.getMonth(), 1));
            else if (view === 'months') setCalendarMonth((current) => new Date(current.getFullYear() + 1, current.getMonth(), 1));
            else moveMonth(1);
          }} className="grid size-8 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100">
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
        {view === 'days'
          ? <>
            <div className="mb-1 grid grid-cols-7 text-center text-xs font-medium text-slate-500">
              {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day) => <span key={day} className="py-1">{day}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {days.map((day) => {
                const key = dateKey(day);
                const outsideMonth = day.getMonth() !== calendarMonth.getMonth();
                const disabled = Boolean((min && key < min) || (max && key > max));
                const selected = key === value;
                return <button
                  type="button"
                  key={key}
                  aria-label={day.toLocaleDateString('vi-VN')}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => selectDate(day)}
                  className={`flex h-9 flex-col items-center justify-center rounded-md text-sm tabular-nums hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35 ${outsideMonth ? 'text-slate-400' : 'text-slate-800'} ${key === today ? 'font-semibold' : ''} ${selected ? 'bg-teal-700 text-white hover:bg-teal-800' : ''}`}
                >
                  <span>{day.getDate()}</span>
                  {key === today && <span className={`h-1 w-1 rounded-full ${selected ? 'bg-white' : 'bg-teal-700'}`} />}
                </button>;
              })}
            </div>
          </>
          : view === 'months'
            ? <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, index) => {
                const month = new Date(calendarMonth.getFullYear(), index, 1);
                return <button key={index} type="button" onClick={() => { setCalendarMonth(month); setView('days'); }} className="h-10 rounded-md text-sm text-slate-700 hover:bg-slate-100">
                  {new Intl.DateTimeFormat('vi-VN', { month: 'short' }).format(month)}
                </button>;
              })}
            </div>
            : <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, index) => yearRangeStart + index).map((year) => <button key={year} type="button" onClick={() => { setCalendarMonth((current) => new Date(year, current.getMonth(), 1)); setView('months'); }} className="h-10 rounded-md text-sm text-slate-700 hover:bg-slate-100">
                {year}
              </button>)}
            </div>}
        {value && <div className="mt-2 border-t border-slate-200 pt-2">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="flex h-9 w-full items-center rounded-md px-2 text-left text-sm text-slate-700 hover:bg-slate-100">Xóa ngày</button>
        </div>}
      </div>}
    </div>
  );
}

export function CustomerWorkspace({
  accessToken,
  request,
  canManageCustomers,
  canAssignCustomers,
  canReviewDuplicates,
  canReadUsers,
  canReadBranches,
  canManageRequests,
  canManageContracts,
  canReviewContracts,
  contractCompletionOtp,
}: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [requests, setRequests] = useState<LoanRequest[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [advisers, setAdvisers] = useState<AdviserOption[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [assignmentFrom, setAssignmentFrom] = useState('');
  const [assignmentTo, setAssignmentTo] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const [customerPageSize, setCustomerPageSize] = useState(20);
  const [hasNextCustomerPage, setHasNextCustomerPage] = useState(false);
  const [customerListError, setCustomerListError] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [branchId, setBranchId] = useState('');
  const [provenance, setProvenance] = useState('Nhập trực tiếp');
  const [showStatusForm, setShowStatusForm] = useState(false);
  const [statusDraft, setStatusDraft] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [adviserId, setAdviserId] = useState('');
  const [assignmentReason, setAssignmentReason] = useState('');
  const [duplicateAction, setDuplicateAction] = useState<{ candidateId: string; status: string } | null>(null);
  const [duplicateReason, setDuplicateReason] = useState('');
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [showContractForm, setShowContractForm] = useState(false);
  const [contractNumber, setContractNumber] = useState('');
  const [packageName, setPackageName] = useState('');
  const [loanType, setLoanType] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [rejectingContractId, setRejectingContractId] = useState('');
  const [contractRejectionReason, setContractRejectionReason] = useState('');
  const selectionVersion = useRef(0);
  const customerPageCursors = useRef<Array<string | undefined>>([undefined]);
  const customerListRequestVersion = useRef(0);
  const mobileDetailTriggerRef = useRef<HTMLElement | null>(null);
  const mobileDetailCloseRef = useRef<HTMLButtonElement>(null);

  const activeBranches = useMemo(() => branches.filter((branch) => branch.status === 'ACTIVE'), [branches]);
  const adviserBranchScope = useMemo(() => {
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const scope = new Set<string>();
    let branch = selected ? branchById.get(selected.branchId) : undefined;
    while (branch && !scope.has(branch.id)) {
      scope.add(branch.id);
      branch = branch.parentId ? branchById.get(branch.parentId) : undefined;
    }
    return scope;
  }, [branches, selected?.branchId]);
  const visibleCustomers = customers;
  const paginatedCustomers = customers;
  const eligibleAdvisers = useMemo(
    () => advisers.filter((user) => user.status === 'ACTIVE' && user.roleGrants.some(
      (grant) => grant.role.key === 'ADVISING' && (!grant.branch || adviserBranchScope.has(grant.branch.id)),
    )),
    [advisers, adviserBranchScope],
  );
  const currentAssignment = assignments.find((assignment) => assignment.endedAt === null);

  async function loadCustomers(cursor: string | undefined, targetPage: number, version: number) {
    setLoading(true);
    setError('');
    setCustomerListError(false);
    setCustomers([]);
    setHasNextCustomerPage(false);
    const query = new URLSearchParams({ take: String(customerPageSize + 1) });
    if (search.trim()) query.set('search', search.trim());
    if (statusFilter !== 'ALL') query.set('status', statusFilter);
    const assignedFrom = dateRangeBound(assignmentFrom, false);
    const assignedTo = dateRangeBound(assignmentTo, true);
    if (assignedFrom) query.set('assignedFrom', assignedFrom);
    if (assignedTo) query.set('assignedTo', assignedTo);
    if (cursor) query.set('cursor', cursor);
    try {
      const results = await request<Customer[]>(`/customers?${query}`, {}, accessToken);
      if (version !== customerListRequestVersion.current) return;
      setCustomers(results.slice(0, customerPageSize));
      setHasNextCustomerPage(results.length > customerPageSize);
      setCustomerPage(targetPage);
    } catch (err) {
      if (version === customerListRequestVersion.current) {
        setCustomerListError(true);
        setError(errorMessage(err, 'Không thể tải khách hàng.'));
      }
    } finally {
      if (version === customerListRequestVersion.current) setLoading(false);
    }
  }

  function refreshCustomerPage(page = customerPage) {
    const version = ++customerListRequestVersion.current;
    void loadCustomers(customerPageCursors.current[page], page, version);
  }

  function goToNextCustomerPage() {
    const cursor = customers[customers.length - 1]?.id;
    if (!hasNextCustomerPage || !cursor || loading) return;
    const nextPage = customerPage + 1;
    customerPageCursors.current[nextPage] = cursor;
    const version = ++customerListRequestVersion.current;
    void loadCustomers(cursor, nextPage, version);
  }

  function goToPreviousCustomerPage() {
    if (customerPage <= 1 || loading) return;
    const previousPage = customerPage - 1;
    const version = ++customerListRequestVersion.current;
    void loadCustomers(customerPageCursors.current[previousPage], previousPage, version);
  }

  async function selectCustomer(customer: Customer) {
    const version = ++selectionVersion.current;
    setSelected(customer);
    if (window.matchMedia('(max-width: 1279px)').matches) setMobileDetailOpen(true);
    setRequests([]);
    setContracts([]);
    setAssignments([]);
    setDuplicates([]);
    setLoadingDetail(true);
    setError('');
    setNotice('');
    setShowStatusForm(false);
    setShowAssignmentForm(false);
    setDuplicateAction(null);
    setShowContractForm(false);
    setStatusDraft(customer.status);

    try {
      const [detail, loanRequests, loanContracts, customerAssignments, duplicateCandidates] = await Promise.all([
        request<Customer>(`/customers/${customer.id}`, {}, accessToken),
        request<LoanRequest[]>(`/loan-requests?customerId=${customer.id}`, {}, accessToken),
        request<{ items: Contract[] }>(`/loan-contracts?customerId=${customer.id}`, {}, accessToken),
        request<Assignment[]>(`/customers/${customer.id}/assignments`, {}, accessToken),
        request<DuplicateCandidate[]>(`/customers/${customer.id}/duplicates`, {}, accessToken),
      ]);
      if (version !== selectionVersion.current) return;
      setSelected(detail);
      setCustomers((current) => current.map((item) => item.id === detail.id
        ? { ...item, primaryAdviserId: detail.primaryAdviserId, primaryAssignedAt: detail.primaryAssignedAt }
        : item));
      setStatusDraft(detail.status);
      setRequests(loanRequests);
      setContracts(loanContracts.items);
      setAssignments(customerAssignments);
      setDuplicates(duplicateCandidates);
    } catch (err) {
      if (version === selectionVersion.current) setError(errorMessage(err, 'Không thể tải hồ sơ khách hàng.'));
    } finally {
      if (version === selectionVersion.current) setLoadingDetail(false);
    }
  }

  useEffect(() => {
    const loadOptions = async () => {
      const lookups: Promise<void>[] = [];
      if (canReadBranches) {
        lookups.push(request<BranchOption[]>('/access/branches', {}, accessToken).then(setBranches));
      }
      if (canAssignCustomers && canReadUsers) {
        lookups.push(request<AdviserOption[]>('/access/users', {}, accessToken).then(setAdvisers));
      }
      try {
        await Promise.all(lookups);
      } catch (err) {
        setError(errorMessage(err, 'Không thể tải danh sách chi nhánh hoặc tư vấn viên.'));
      }
    };
    void loadOptions();
    return () => {
      selectionVersion.current += 1;
    };
  }, [accessToken, request, canReadBranches, canAssignCustomers, canReadUsers]);

  useEffect(() => {
    const version = ++customerListRequestVersion.current;
    customerPageCursors.current = [undefined];
    setCustomerPage(1);
    setCustomers([]);
    setHasNextCustomerPage(false);
    setCustomerListError(false);
    setLoading(true);
    const timer = window.setTimeout(() => void loadCustomers(undefined, 1, version), search ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      if (customerListRequestVersion.current === version) customerListRequestVersion.current += 1;
    };
  }, [accessToken, assignmentFrom, assignmentTo, customerPageSize, request, search, statusFilter]);

  useEffect(() => {
    if (!mobileDetailOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileDetailOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector<HTMLElement>('[data-customer-detail-dialog]');
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleResize = () => {
      if (!window.matchMedia('(max-width: 1279px)').matches) setMobileDetailOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    mobileDetailCloseRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      document.body.style.overflow = previousBodyOverflow;
      mobileDetailTriggerRef.current?.focus();
      mobileDetailTriggerRef.current = null;
    };
  }, [mobileDetailOpen]);

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const created = await request<Customer>('/customers', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          phone,
          email: email || undefined,
          dateOfBirth: dateOfBirth || undefined,
          provenance,
          branchId,
        }),
      }, accessToken);
      customerPageCursors.current = [undefined];
      setCustomerPage(1);
      setShowCreate(false);
      setFullName('');
      setPhone('');
      setEmail('');
      setDateOfBirth('');
      setBranchId('');
      setProvenance('Nhập trực tiếp');
      await selectCustomer(created);
      refreshCustomerPage(1);
      setNotice('Đã tạo khách hàng.');
    } catch (err) {
      setError(errorMessage(err, 'Không thể tạo khách hàng.'));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const updated = await request<Customer>(`/customers/${selected.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: statusDraft, reason: statusReason.trim() }),
      }, accessToken);
      setSelected(updated);
      setCustomers((current) => current.map((item) => item.id === updated.id ? { ...item, status: updated.status, updatedAt: updated.updatedAt } : item));
      refreshCustomerPage();
      setShowStatusForm(false);
      setStatusReason('');
      setNotice('Đã cập nhật trạng thái khách hàng.');
    } catch (err) {
      setError(errorMessage(err, 'Không thể cập nhật trạng thái.'));
    } finally {
      setSaving(false);
    }
  }

  async function assignAdviser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      await request(`/customers/${selected.id}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ adviserId, reason: assignmentReason.trim() }),
      }, accessToken);
      await selectCustomer(selected);
      refreshCustomerPage();
      setShowAssignmentForm(false);
      setAssignmentReason('');
      setNotice('Đã phân công tư vấn viên; lịch sử phân công được lưu lại.');
    } catch (err) {
      setError(errorMessage(err, 'Không thể phân công tư vấn viên.'));
    } finally {
      setSaving(false);
    }
  }

  async function resolveDuplicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !duplicateAction) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      await request(`/customers/${selected.id}/duplicates/${duplicateAction.candidateId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ status: duplicateAction.status, reason: duplicateReason.trim() }),
      }, accessToken);
      setDuplicates((current) => current.map((candidate) => candidate.id === duplicateAction.candidateId
        ? { ...candidate, status: duplicateAction.status, resolutionReason: duplicateReason.trim() }
        : candidate));
      setDuplicateAction(null);
      setDuplicateReason('');
      setNotice('Đã ghi nhận kết quả rà soát; hệ thống không tự gộp hồ sơ.');
    } catch (err) {
      setError(errorMessage(err, 'Không thể ghi nhận kết quả rà soát.'));
    } finally {
      setSaving(false);
    }
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const created = await request<LoanRequest>('/loan-requests', {
        method: 'POST',
        body: JSON.stringify({ customerId: selected.id, topic, notes: notes || undefined }),
      }, accessToken);
      setRequests((current) => [created, ...current]);
      setTopic('');
      setNotes('');
      setNotice('Đã ghi nhận yêu cầu vay; yêu cầu này không đồng nghĩa với phê duyệt khoản vay.');
    } catch (err) {
      setError(errorMessage(err, 'Không thể tạo yêu cầu vay.'));
    } finally {
      setSaving(false);
    }
  }

  async function updateRequestStatus(requestId: string, status: string) {
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const updated = await request<LoanRequest>(`/loan-requests/${requestId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }, accessToken);
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice('Đã cập nhật trạng thái yêu cầu vay.');
    } catch (err) {
      setError(errorMessage(err, 'Không thể cập nhật trạng thái yêu cầu vay.'));
    } finally {
      setSaving(false);
    }
  }

  async function approve(contractId: string) {
    setError('');
    setNotice('');
    setSaving(true);
    try {
      await request(`/loan-contracts/${contractId}/approve`, { method: 'POST' }, accessToken);
      setContracts((current) => current.map((item) => item.id === contractId
        ? { ...item, status: 'APPROVED', approvedAt: new Date().toISOString() }
        : item));
      setNotice('Đã duyệt hợp đồng. Việc hoàn tất vẫn cần khách hàng xác nhận OTP.');
    } catch (err) {
      setError(errorMessage(err, 'Không thể duyệt hợp đồng.'));
    } finally {
      setSaving(false);
    }
  }

  async function rejectContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectingContractId) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      await request(`/loan-contracts/${rejectingContractId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: contractRejectionReason.trim() }),
      }, accessToken);
      setContracts((current) => current.map((item) => item.id === rejectingContractId ? { ...item, status: 'REJECTED' } : item));
      setRejectingContractId('');
      setContractRejectionReason('');
      setNotice('Đã từ chối hợp đồng.');
    } catch (err) {
      setError(errorMessage(err, 'Không thể từ chối hợp đồng.'));
    } finally {
      setSaving(false);
    }
  }

  async function createContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const created = await request<Contract>('/loan-contracts', {
        method: 'POST',
        body: JSON.stringify({
          customerId: selected.id,
          contractNumber,
          packageName,
          loanType: loanType || undefined,
          termMonths: termMonths ? Number(termMonths) : undefined,
        }),
      }, accessToken);
      setContracts((current) => [created, ...current]);
      setShowContractForm(false);
      setContractNumber('');
      setPackageName('');
      setLoanType('');
      setTermMonths('');
      setNotice('Đã tạo hợp đồng chờ duyệt.');
    } catch (err) {
      setError(errorMessage(err, 'Không thể tạo hợp đồng.'));
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
  const secondaryButtonClass = buttonVariants({ variant: 'outline', size: 'default' });

  return (
    <main className="w-full min-w-0">
      <header className="mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-950">Khách hàng</h1>
          <p className="mt-1 text-sm text-slate-600">Tra cứu, phân công và theo dõi hồ sơ trong phạm vi quyền được cấp.</p>
        </div>
      </header>

      {contractCompletionOtp?.ready
        ? <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Khách hàng cần xác nhận hoàn tất hợp đồng bằng OTP; nhân viên không thể xác nhận thay.</div>
        : <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong>OTP hoàn tất hợp đồng đang chờ cấu hình.</strong>{' '}
          {contractCompletionOtp?.messageVi ?? 'Chưa thể xác nhận hoàn tất từ giao diện staff.'}
        </div>}
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

      <section
        className={`mb-4 grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 ${canManageCustomers && canReadBranches ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}
        aria-label="Tìm kiếm và lọc khách hàng"
      >
        <div className="relative grid min-w-0 content-start gap-1 sm:col-span-2 xl:col-span-2">
          <label className="text-sm font-medium text-slate-800" htmlFor="customer-search">Tìm khách hàng</label>
          <Input id="customer-search" aria-label="Tìm khách hàng" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setCustomerPage(1); }} placeholder="Tìm tên, số điện thoại, email" className="h-11 bg-white pr-9 text-sm md:h-10 [&::-webkit-search-cancel-button]:hidden" />
          {search && <button type="button" aria-label="Xóa tìm kiếm" onClick={() => { setSearch(''); setCustomerPage(1); }} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <X aria-hidden="true" className="size-4" />
          </button>}
        </div>
        <div className="grid min-w-0 gap-1">
          <span id="customer-status-filter-label" className="text-sm font-medium text-slate-800">Trạng thái</span>
          <Select value={statusFilter} onValueChange={(value) => {
            if (typeof value === 'string') {
              setStatusFilter(value);
              setCustomerPage(1);
            }
          }}>
            <SelectTrigger aria-labelledby="customer-status-filter-label" className="w-full bg-white data-[size=default]:h-11 md:data-[size=default]:h-10">
              <SelectValue placeholder="Tất cả trạng thái" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
              {customerStatuses.map((status) => <SelectItem value={status} key={status}>{label(status)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1">
          <span className="text-sm font-medium text-slate-800">Ngày phân công từ</span>
          <DateFilterInput label="Ngày phân công từ" value={assignmentFrom} max={assignmentTo || undefined} onChange={(value) => { setAssignmentFrom(value); setCustomerPage(1); }} />
        </div>
        <div className="grid min-w-0 gap-1">
          <span className="text-sm font-medium text-slate-800">Đến ngày</span>
          <DateFilterInput label="Đến ngày phân công" value={assignmentTo} min={assignmentFrom || undefined} onChange={(value) => { setAssignmentTo(value); setCustomerPage(1); }} />
        </div>
        {canManageCustomers && canReadBranches && <button
          type="button"
          onClick={() => {
            setShowCreate((value) => !value);
            if (!branchId && activeBranches.length === 1) setBranchId(activeBranches[0].id);
          }}
          className="inline-flex h-10 items-center justify-center gap-2 self-end whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span aria-hidden="true">＋</span>{showCreate ? 'Đóng biểu mẫu' : 'Thêm khách hàng'}
        </button>}
      </section>

      {showCreate && (
        <form onSubmit={createCustomer} className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-sm font-medium text-slate-800">Họ tên *
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} required className={inputClass} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-800">Số điện thoại *
            <input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" required className={inputClass} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-800">Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" className={inputClass} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-800">Ngày sinh
            <input value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} type="date" className={inputClass} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-800">Chi nhánh *
            <select value={branchId} onChange={(event) => setBranchId(event.target.value)} required className={inputClass}>
              <option value="">Chọn chi nhánh trong phạm vi được cấp</option>
              {activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-800">Nguồn dữ liệu *
            <input value={provenance} onChange={(event) => setProvenance(event.target.value)} minLength={2} required className={inputClass} />
          </label>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <button disabled={saving || activeBranches.length === 0} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
              {saving ? 'Đang lưu…' : 'Lưu khách hàng'}
            </button>
            {activeBranches.length === 0 && <p className="ml-3 text-sm text-amber-800">Không có chi nhánh hoạt động trong phạm vi được cấp.</p>}
          </div>
        </form>
      )}

      {mobileDetailOpen && <button
        type="button"
        aria-label="Đóng chi tiết khách hàng"
        onClick={() => setMobileDetailOpen(false)}
        className="fixed inset-0 z-40 bg-slate-950/40 xl:hidden"
      />}
      <div className="grid gap-4 xl:grid-cols-12">
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white xl:col-span-8" aria-labelledby="customer-list-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <h2 id="customer-list-heading" className="font-semibold text-slate-950">Danh sách khách hàng</h2>
              <p className="text-sm text-slate-600">{loading ? 'Đang tải…' : `${visibleCustomers.length}${hasNextCustomerPage ? '+' : ''} khách hàng · Trang ${customerPage}`}</p>
            </div>
          </div>
          {loading
            ? <p className="p-4 text-sm text-slate-600">Đang tải dữ liệu khách hàng…</p>
            : customerListError
              ? <div className="p-6 text-center text-sm text-slate-600">
                Không thể tải danh sách khách hàng.
                <button type="button" onClick={() => refreshCustomerPage()} className="ml-1 font-semibold text-teal-700 underline">Thử lại</button>
              </div>
            : visibleCustomers.length
              ? <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr><th className="px-4 py-3">Khách hàng</th><th className="px-4 py-3">Liên hệ</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Ngày phân công</th></tr>
                    </thead>
                    <tbody>
                      {paginatedCustomers.map((customer) => (
                        <tr
                          key={customer.id}
                          onClick={(event) => {
                            if (window.matchMedia('(max-width: 1279px)').matches) mobileDetailTriggerRef.current = event.currentTarget;
                            void selectCustomer(customer);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              if (window.matchMedia('(max-width: 1279px)').matches) mobileDetailTriggerRef.current = event.currentTarget;
                              void selectCustomer(customer);
                            }
                          }}
                          tabIndex={0}
                          aria-selected={selected?.id === customer.id}
                          className={`cursor-pointer border-t border-slate-100 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-teal-700 ${selected?.id === customer.id ? 'bg-teal-50' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-950">{customer.fullName}</p>
                            <p className="mt-0.5 text-xs text-slate-500">{customer.email ?? 'Chưa có email'}</p>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-slate-700">{customer.phone}</td>
                          <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{label(customer.status)}</span></td>
                          <td className="px-4 py-3 text-slate-600">{date(customer.primaryAssignedAt ?? null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
                  <p className="min-w-0 basis-full truncate text-xs tabular-nums text-slate-600 sm:basis-auto">
                    Hiển thị {(customerPage - 1) * customerPageSize + (visibleCustomers.length ? 1 : 0)}–{(customerPage - 1) * customerPageSize + visibleCustomers.length} khách hàng · Trang {customerPage}
                  </p>
                  <div className="flex shrink-0 items-center gap-3">
                    <label id="customer-page-size-label" className="text-xs text-slate-600">Mỗi trang</label>
                    <Select value={String(customerPageSize)} onValueChange={(value) => {
                      if (typeof value === 'string') setCustomerPageSize(Number(value));
                    }}>
                      <SelectTrigger aria-labelledby="customer-page-size-label" className="w-[4.5rem] bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {CUSTOMER_PAGE_SIZES.map((pageSize) => <SelectItem value={String(pageSize)} key={pageSize}>{pageSize}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <nav aria-label="Phân trang khách hàng" className="flex shrink-0 items-center gap-1">
                      <button type="button" aria-label="Trang trước" disabled={customerPage === 1 || loading} onClick={goToPreviousCustomerPage} className="inline-flex size-9 items-center justify-center rounded-lg border border-transparent text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">‹</button>
                      <span aria-current="page" className="min-w-12 text-center text-sm tabular-nums text-slate-700">Trang {customerPage}</span>
                      <button type="button" aria-label="Trang sau" disabled={!hasNextCustomerPage || loading} onClick={goToNextCustomerPage} className="inline-flex size-9 items-center justify-center rounded-lg border border-transparent text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">›</button>
                    </nav>
                  </div>
                </div>
              </>
              : <div className="p-8 text-center text-sm text-slate-600">
                Không tìm thấy khách hàng phù hợp.
                {(search || statusFilter !== 'ALL' || assignmentFrom || assignmentTo) && <button className="ml-1 font-semibold text-teal-700 underline" onClick={() => { setSearch(''); setStatusFilter('ALL'); setAssignmentFrom(''); setAssignmentTo(''); setCustomerPage(1); }}>Xóa bộ lọc</button>}
              </div>}
        </section>

        <section
          className={mobileDetailOpen
            ? 'fixed inset-3 z-50 max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl xl:static xl:z-auto xl:col-span-4 xl:max-h-[calc(100dvh-2rem)] xl:shadow-none'
            : 'hidden xl:sticky xl:top-4 xl:col-span-4 xl:block xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto'}
          aria-labelledby="customer-detail-heading"
          role={mobileDetailOpen ? 'dialog' : undefined}
          aria-modal={mobileDetailOpen ? true : undefined}
          data-customer-detail-dialog={mobileDetailOpen ? '' : undefined}
        >
          {selected
            ? <>
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-[0.12em] text-teal-700">HỒ SƠ KHÁCH HÀNG</p>
                  <h2 id="customer-detail-heading" className="mt-1 break-words text-xl font-semibold text-slate-950">{selected.fullName}</h2>
                  <p className="mt-1 break-words text-sm text-slate-600">{selected.phone} · {selected.email ?? 'Chưa có email'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{label(selected.status)}</span>
                  <button ref={mobileDetailCloseRef} type="button" onClick={() => setMobileDetailOpen(false)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 xl:hidden">‹ Danh sách</button>
                </div>
              </div>

              {loadingDetail
                ? <p className="py-6 text-sm text-slate-600">Đang tải chi tiết hồ sơ…</p>
                : <>
                  <dl className="my-4 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-slate-500">Nguồn</dt><dd className="mt-1 break-words font-medium text-slate-900">{selected.provenance}</dd></div>
                    <div><dt className="text-slate-500">Xác minh</dt><dd className="mt-1 font-medium text-slate-900">{selected.verificationStatus === 'VERIFIED' ? 'Đã xác minh' : 'Chưa xác minh'}</dd></div>
                    <div><dt className="text-slate-500">Ngày sinh</dt><dd className="mt-1 font-medium text-slate-900">{date(selected.dateOfBirth)}</dd></div>
                    <div><dt className="text-slate-500">Tạo lúc</dt><dd className="mt-1 font-medium text-slate-900">{date(selected.createdAt)}</dd></div>
                  </dl>

                  {canManageCustomers && <section className="border-t border-slate-200 py-4" aria-labelledby="customer-status-heading">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id="customer-status-heading" className="font-semibold text-slate-950">Trạng thái khách hàng</h3>
                      <button type="button" className="text-sm font-semibold text-teal-700 hover:underline" onClick={() => setShowStatusForm((value) => !value)}>
                        {showStatusForm ? 'Đóng' : 'Cập nhật'}
                      </button>
                    </div>
                    {showStatusForm && <form onSubmit={changeStatus} className="mt-3 grid gap-2">
                      <label className="grid gap-1 text-sm font-medium text-slate-800">Trạng thái mới
                        <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)} className={inputClass}>
                          {customerStatuses.map((status) => <option value={status} key={status}>{label(status)}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-800">Lý do (tối thiểu 2 ký tự)
                        <textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value)} required minLength={2} maxLength={1000} rows={2} className={inputClass} />
                      </label>
                      <button disabled={saving || statusDraft === selected.status} className={secondaryButtonClass}>Lưu trạng thái</button>
                    </form>}
                  </section>}

                  <section className="border-t border-slate-200 py-4" aria-labelledby="assignment-heading">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id="assignment-heading" className="font-semibold text-slate-950">Tư vấn viên phụ trách</h3>
                      {canAssignCustomers && canReadUsers && <button type="button" className="text-sm font-semibold text-teal-700 hover:underline" onClick={() => setShowAssignmentForm((value) => !value)}>
                        {showAssignmentForm ? 'Đóng' : currentAssignment ? 'Đổi phân công' : 'Phân công'}
                      </button>}
                    </div>
                    {currentAssignment
                      ? <p className="mt-2 text-sm text-slate-700">{currentAssignment.adviser.displayName} <span className="text-slate-500">· từ {date(currentAssignment.assignedAt)}</span></p>
                      : <p className="mt-2 text-sm text-slate-600">Chưa có tư vấn viên chính.</p>}
                    {canAssignCustomers && !canReadUsers && <p className="mt-2 text-sm text-amber-800">Không có quyền đọc danh sách nhân viên để chọn tư vấn viên.</p>}
                    {showAssignmentForm && <form onSubmit={assignAdviser} className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3">
                      <label className="grid gap-1 text-sm font-medium text-slate-800">Tư vấn viên
                        <select value={adviserId} onChange={(event) => setAdviserId(event.target.value)} required className={inputClass}>
                          <option value="">Chọn tư vấn viên đang hoạt động</option>
                          {eligibleAdvisers.map((adviser) => <option key={adviser.id} value={adviser.id}>{adviser.displayName} · @{adviser.username}</option>)}
                        </select>
                      </label>
                      {eligibleAdvisers.length === 0 && <p className="text-sm text-amber-800">Không có tư vấn viên đang hoạt động thuộc chi nhánh này.</p>}
                      <label className="grid gap-1 text-sm font-medium text-slate-800">Lý do phân công
                        <textarea value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} required minLength={2} maxLength={1000} rows={2} className={inputClass} />
                      </label>
                      <button disabled={saving || eligibleAdvisers.length === 0} className={secondaryButtonClass}>Lưu phân công</button>
                    </form>}
                    {assignments.length > 1 && <details className="mt-3 text-sm">
                      <summary className="cursor-pointer font-medium text-teal-800">Lịch sử phân công ({assignments.length})</summary>
                      <ul className="mt-2 space-y-2 border-l border-slate-200 pl-3">
                        {assignments.map((assignment) => <li key={assignment.id} className="text-slate-700">
                          <span className="font-medium">{assignment.adviser.displayName}</span>
                          <span className="text-slate-500"> · {date(assignment.assignedAt)}{assignment.endedAt ? ` – ${date(assignment.endedAt)}` : ' – hiện tại'}</span>
                        </li>)}
                      </ul>
                    </details>}
                  </section>

                  <section className="border-t border-slate-200 py-4" aria-labelledby="duplicates-heading">
                    <div className="flex items-center justify-between gap-3">
                      <h3 id="duplicates-heading" className="font-semibold text-slate-950">Hồ sơ có thể trùng</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{duplicates.length}</span>
                    </div>
                    {duplicates.length
                      ? <ul className="mt-3 space-y-3">
                        {duplicates.map((candidate) => <li key={candidate.id} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-slate-900">{candidate.candidateCustomer.fullName}</p>
                              <p className="mt-1 text-sm text-slate-600">{candidate.candidateCustomer.phone} · {candidate.candidateCustomer.email ?? 'Chưa có email'}</p>
                              <p className="mt-1 text-xs text-slate-500">{candidate.matchReasons.map((reason) => matchReasonLabels[reason] ?? reason).join(' · ')}</p>
                            </div>
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">{label(candidate.status)}</span>
                          </div>
                          {candidate.resolutionReason && <p className="mt-2 text-xs text-slate-600">Lý do rà soát: {candidate.resolutionReason}</p>}
                          {candidate.status === 'OPEN' && canReviewDuplicates && (
                            duplicateAction?.candidateId === candidate.id
                              ? <form onSubmit={resolveDuplicate} className="mt-3 grid gap-2">
                                <p className="text-sm font-medium text-slate-800">{duplicateAction.status === 'CONFIRMED_DUPLICATE' ? 'Xác nhận đây là hồ sơ trùng' : 'Xác nhận hai hồ sơ không trùng'}</p>
                                <label className="grid gap-1 text-xs font-medium text-slate-700">Lý do (tối thiểu 2 ký tự)
                                  <textarea value={duplicateReason} onChange={(event) => setDuplicateReason(event.target.value)} required minLength={2} maxLength={1000} rows={2} className={inputClass} />
                                </label>
                                <div className="flex flex-wrap gap-2">
                                  <button disabled={saving} className={secondaryButtonClass}>Xác nhận rà soát</button>
                                  <button type="button" onClick={() => { setDuplicateAction(null); setDuplicateReason(''); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Hủy</button>
                                </div>
                              </form>
                              : <div className="mt-3 flex flex-wrap gap-2">
                                <button type="button" disabled={saving} onClick={() => setDuplicateAction({ candidateId: candidate.id, status: 'CONFIRMED_DUPLICATE' })} className={secondaryButtonClass}>Xác nhận trùng</button>
                                <button type="button" disabled={saving} onClick={() => setDuplicateAction({ candidateId: candidate.id, status: 'NOT_DUPLICATE' })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Không trùng</button>
                              </div>
                          )}
                        </li>)}
                      </ul>
                      : <p className="mt-2 text-sm text-slate-600">Không có ứng viên trùng hiện tại.</p>}
                    <p className="mt-3 text-xs text-slate-500">Quyết định rà soát được lưu audit; hồ sơ không tự động gộp.</p>
                  </section>

                  <section className="border-t border-slate-200 py-4" aria-labelledby="loan-requests-heading">
                    <h3 id="loan-requests-heading" className="font-semibold text-slate-950">Yêu cầu vay</h3>
                    {requests.length
                      ? <ul className="mt-2 space-y-2">
                        {requests.map((item) => <li className="rounded-lg bg-slate-50 p-3 text-sm" key={item.id}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div><p className="font-medium text-slate-900">{item.topic}</p><p className="mt-1 text-slate-600">{item.notes ?? 'Không có ghi chú'}</p></div>
                            {canManageRequests
                              ? <label className="sr-only" htmlFor={`request-status-${item.id}`}>Trạng thái yêu cầu {item.topic}</label>
                              : null}
                            {canManageRequests
                              ? <select id={`request-status-${item.id}`} value={item.status} disabled={saving} onChange={(event) => void updateRequestStatus(item.id, event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
                                {['OPEN', 'CLOSED', 'CANCELLED'].map((status) => <option value={status} key={status}>{label(status)}</option>)}
                              </select>
                              : <span className="h-fit rounded-full bg-white px-2 py-1 text-xs text-slate-700">{label(item.status)}</span>}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">{item.source === 'CUSTOMER' ? 'Khách hàng gửi' : 'Nhân viên ghi nhận'} · {date(item.createdAt)}</p>
                        </li>)}
                      </ul>
                      : <p className="mt-2 text-sm text-slate-600">Chưa có yêu cầu vay.</p>}
                    {canManageRequests && <form onSubmit={createRequest} className="mt-3 grid gap-2">
                      <label className="sr-only" htmlFor="loan-topic">Nội dung yêu cầu vay</label>
                      <input id="loan-topic" value={topic} onChange={(event) => setTopic(event.target.value)} required minLength={2} maxLength={200} placeholder="Nội dung yêu cầu vay" className={inputClass} />
                      <label className="sr-only" htmlFor="loan-notes">Ghi chú yêu cầu vay</label>
                      <textarea id="loan-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="Ghi chú (không bắt buộc)" className={`${inputClass} min-h-20`} />
                      <button disabled={saving} className={secondaryButtonClass}>Ghi nhận yêu cầu</button>
                    </form>}
                  </section>

                  <section className="border-t border-slate-200 pt-4" aria-labelledby="contracts-heading">
                    <div className="flex items-center justify-between gap-3">
                      <h3 id="contracts-heading" className="font-semibold text-slate-950">Hợp đồng</h3>
                      {canManageContracts && <button type="button" onClick={() => setShowContractForm((value) => !value)} className="text-sm font-semibold text-teal-700 hover:underline">{showContractForm ? 'Đóng biểu mẫu' : 'Tạo hợp đồng'}</button>}
                    </div>
                    {showContractForm && <form onSubmit={createContract} className="mt-3 grid gap-2 rounded-lg border border-slate-200 p-3">
                      <label className="sr-only" htmlFor="contract-number">Số hợp đồng</label>
                      <input id="contract-number" value={contractNumber} onChange={(event) => setContractNumber(event.target.value)} required minLength={2} placeholder="Số hợp đồng" className={inputClass} />
                      <label className="sr-only" htmlFor="package-name">Tên gói vay</label>
                      <input id="package-name" value={packageName} onChange={(event) => setPackageName(event.target.value)} required minLength={2} placeholder="Tên gói vay" className={inputClass} />
                      <label className="sr-only" htmlFor="loan-type">Loại khoản vay</label>
                      <input id="loan-type" value={loanType} onChange={(event) => setLoanType(event.target.value)} placeholder="Loại khoản vay" className={inputClass} />
                      <label className="sr-only" htmlFor="term-months">Kỳ hạn tháng</label>
                      <input id="term-months" value={termMonths} onChange={(event) => setTermMonths(event.target.value)} type="number" min="1" max="1200" placeholder="Kỳ hạn (tháng)" className={inputClass} />
                      <button disabled={saving} className={secondaryButtonClass}>Tạo hợp đồng chờ duyệt</button>
                    </form>}
                    {contracts.length
                      ? <ul className="mt-2 space-y-2">
                        {contracts.map((item) => <li className="rounded-lg bg-slate-50 p-3 text-sm" key={item.id}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="break-all font-medium text-slate-900">{item.contractNumber}</p>
                              <p className="mt-1 text-slate-600">{item.packageName}{item.termMonths ? ` · ${item.termMonths} tháng` : ''}</p>
                            </div>
                            <span className="h-fit rounded-full bg-white px-2 py-1 text-xs text-slate-700">{label(item.status)}</span>
                          </div>
                          {canReviewContracts && item.status === 'PENDING_REVIEW' && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button type="button" disabled={saving} onClick={() => void approve(item.id)} className={secondaryButtonClass}>Duyệt hợp đồng</button>
                              {rejectingContractId === item.id
                                ? <form onSubmit={rejectContract} className="mt-2 grid w-full gap-2">
                                  <label className="grid gap-1 text-xs font-medium text-slate-700">Lý do từ chối
                                    <textarea value={contractRejectionReason} onChange={(event) => setContractRejectionReason(event.target.value)} required minLength={2} maxLength={1000} rows={2} className={inputClass} />
                                  </label>
                                  <div className="flex gap-2">
                                    <button disabled={saving} className="rounded-lg border border-red-700 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50">Xác nhận từ chối</button>
                                    <button type="button" onClick={() => { setRejectingContractId(''); setContractRejectionReason(''); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Hủy</button>
                                  </div>
                                </form>
                                : <button type="button" disabled={saving} onClick={() => setRejectingContractId(item.id)} className="rounded-lg border border-red-700 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50">Từ chối</button>}
                            </div>
                          )}
                        </li>)}
                      </ul>
                      : <p className="mt-2 text-sm text-slate-600">Chưa có hợp đồng trong hồ sơ này.</p>}
                    <p className="mt-3 text-xs text-slate-500">Yêu cầu vay và hợp đồng là hai hồ sơ riêng; chỉ hợp đồng hoàn tất mới cho phép chuyển khách hàng sang “Đã chuyển đổi”.</p>
                  </section>
                </>}
            </>
            : <div className="flex min-h-72 items-center justify-center text-center text-sm text-slate-600">
              <p>Chọn một khách hàng ở danh sách để xem hồ sơ, rà soát trùng và xử lý luồng vay.</p>
            </div>}
        </section>
      </div>
    </main>
  );
}
