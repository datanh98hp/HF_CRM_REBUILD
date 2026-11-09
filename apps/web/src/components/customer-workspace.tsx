'use client';

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

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
  const visibleCustomers = useMemo(
    () => customers.filter((item) => `${item.fullName} ${item.phone} ${item.email ?? ''}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi'))),
    [customers, search],
  );
  const eligibleAdvisers = useMemo(
    () => advisers.filter((user) => user.status === 'ACTIVE' && user.roleGrants.some(
      (grant) => grant.role.key === 'ADVISING' && (!grant.branch || adviserBranchScope.has(grant.branch.id)),
    )),
    [advisers, adviserBranchScope],
  );
  const currentAssignment = assignments.find((assignment) => assignment.endedAt === null);

  async function loadCustomers() {
    setLoading(true);
    setError('');
    try {
      setCustomers(await request<Customer[]>('/customers?take=100', {}, accessToken));
    } catch (err) {
      setError(errorMessage(err, 'Không thể tải khách hàng.'));
    } finally {
      setLoading(false);
    }
  }

  async function selectCustomer(customer: Customer) {
    const version = ++selectionVersion.current;
    setSelected(customer);
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
    void loadCustomers();
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
      setCustomers((current) => [created, ...current]);
      setShowCreate(false);
      setFullName('');
      setPhone('');
      setEmail('');
      setDateOfBirth('');
      setBranchId('');
      setProvenance('Nhập trực tiếp');
      await selectCustomer(created);
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

  const inputClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';
  const secondaryButtonClass = 'rounded-lg border border-teal-700 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-teal-700">CRM · P0-2</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Khách hàng & luồng vay</h1>
          <p className="mt-1 text-sm text-slate-600">Tra cứu và xử lý hồ sơ trong phạm vi quyền được cấp.</p>
        </div>
        {canManageCustomers && canReadBranches && (
          <button
            type="button"
            onClick={() => {
              setShowCreate((value) => !value);
              if (!branchId && activeBranches.length === 1) setBranchId(activeBranches[0].id);
            }}
            className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            {showCreate ? 'Đóng biểu mẫu' : '＋ Tạo khách hàng'}
          </button>
        )}
      </header>

      {contractCompletionOtp?.ready
        ? <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Khách hàng cần xác nhận hoàn tất hợp đồng bằng OTP; nhân viên không thể xác nhận thay.</div>
        : <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong>OTP hoàn tất hợp đồng đang chờ cấu hình.</strong>{' '}
          {contractCompletionOtp?.messageVi ?? 'Chưa thể xác nhận hoàn tất từ giao diện staff.'}
        </div>}
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

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
            <button disabled={saving || activeBranches.length === 0} className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
              {saving ? 'Đang lưu…' : 'Lưu khách hàng'}
            </button>
            {activeBranches.length === 0 && <p className="ml-3 text-sm text-amber-800">Không có chi nhánh hoạt động trong phạm vi được cấp.</p>}
          </div>
        </form>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white" aria-labelledby="customer-list-heading">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="customer-list-heading" className="font-semibold text-slate-950">Danh sách khách hàng</h2>
              <p className="text-sm text-slate-600">{loading ? 'Đang tải…' : `${visibleCustomers.length} hồ sơ trong phạm vi`}</p>
            </div>
            <label className="sr-only" htmlFor="customer-search">Tìm khách hàng</label>
            <input id="customer-search" aria-label="Tìm khách hàng" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tên, SĐT, email" className={`${inputClass} sm:w-64`} />
          </div>
          {loading
            ? <p className="p-4 text-sm text-slate-600">Đang tải dữ liệu khách hàng…</p>
            : visibleCustomers.length
              ? <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-4 py-3">Khách hàng</th><th className="px-4 py-3">Liên hệ</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Cập nhật</th></tr>
                  </thead>
                  <tbody>
                    {visibleCustomers.map((customer) => (
                      <tr
                        key={customer.id}
                        onClick={() => void selectCustomer(customer)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
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
                        <td className="px-4 py-3 text-slate-600">{date(customer.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              : <div className="p-8 text-center text-sm text-slate-600">
                Không tìm thấy khách hàng phù hợp. {search && <button className="ml-1 font-semibold text-teal-700 underline" onClick={() => setSearch('')}>Xóa tìm kiếm</button>}
              </div>}
        </section>

        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="customer-detail-heading">
          {selected
            ? <>
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-[0.12em] text-teal-700">HỒ SƠ KHÁCH HÀNG</p>
                  <h2 id="customer-detail-heading" className="mt-1 break-words text-xl font-semibold text-slate-950">{selected.fullName}</h2>
                  <p className="mt-1 break-words text-sm text-slate-600">{selected.phone} · {selected.email ?? 'Chưa có email'}</p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{label(selected.status)}</span>
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
