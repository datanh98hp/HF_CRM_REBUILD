'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
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
import { WorkspaceLayout } from '@/components/workspace-layout';
import { useCrmSession } from '@/components/crm-session';
import type { BranchOption } from '@/lib/crm-access';
import { request } from '@/lib/crm-api';

type ManagerCandidate = {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roleGrants: { branch: { id: string } | null; role: { key: string } }[];
};

export function BranchesPage() {
  const router = useRouter();
  const { session, staff, can, busy, setBusy, error, setError, notice, setNotice } = useCrmSession();
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [managerCandidates, setManagerCandidates] = useState<ManagerCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [branchCode, setBranchCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchParent, setBranchParent] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const canReadUsers = can('users.read');
  const canReadRoles = can('roles.read');
  const canManageBranches = can('branches.manage');
  const canManageBranchManagers = Boolean(
    canReadUsers && staff?.permissions.some(
      (permission) => permission.key === 'branches.manage' && permission.scopes.includes('ALL'),
    ),
  );

  useEffect(() => {
    if (!session) return;
    let active = true;
    const managerQuery = canManageBranchManagers
      ? request<ManagerCandidate[]>('/access/users', {}, session.accessToken)
      : Promise.resolve([]);
    void Promise.all([
      request<BranchOption[]>('/access/branches', {}, session.accessToken),
      managerQuery,
    ]).then(([nextBranches, users]) => {
      if (!active) return;
      setBranches(nextBranches);
      setManagerCandidates(users.filter((user) =>
        user.status === 'ACTIVE' && !user.roleGrants.some(
          (grant) => grant.role.key === 'OPERATOR' || grant.role.key === 'CUSTOMER',
        ),
      ));
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách chi nhánh.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [canManageBranchManagers, session, setError]);

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/access/branches', {
        method: 'POST',
        body: JSON.stringify({
          code: branchCode,
          name: branchName,
          ...(branchParent ? { parentId: branchParent } : {}),
        }),
      }, session.accessToken);
      setBranchCode('');
      setBranchName('');
      setBranchParent('');
      setBranches(await request<BranchOption[]>('/access/branches', {}, session.accessToken));
      setNotice('Đã tạo chi nhánh.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo chi nhánh.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleBranchStatus(branch: BranchOption) {
    if (!session) return;
    const activating = branch.status !== 'ACTIVE';
    const reason = window.prompt(activating ? 'Lý do kích hoạt chi nhánh:' : 'Lý do ngừng hoạt động chi nhánh:');
    if (reason === null) return;
    if (reason.trim().length < 2) {
      setError('Lý do cần có ít nhất 2 ký tự.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await request<BranchOption>(`/access/branches/${branch.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: activating ? 'ACTIVE' : 'INACTIVE', reason: reason.trim() }),
      }, session.accessToken);
      setBranches((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      setNotice(activating ? 'Đã kích hoạt chi nhánh.' : 'Đã ngừng hoạt động chi nhánh.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật trạng thái chi nhánh.');
    } finally {
      setBusy(false);
    }
  }

  async function assignManager(branch: BranchOption, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const managerUserId = String(new FormData(event.currentTarget).get('managerUserId') ?? '');
    if (!managerUserId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request<BranchOption>(`/access/branches/${branch.id}/manager`, {
        method: 'PUT',
        body: JSON.stringify({ managerUserId }),
      }, session.accessToken);
      const [nextBranches, users] = await Promise.all([
        request<BranchOption[]>('/access/branches', {}, session.accessToken),
        request<ManagerCandidate[]>('/access/users', {}, session.accessToken),
      ]);
      setBranches(nextBranches);
      setManagerCandidates(users.filter((user) =>
        user.status === 'ACTIVE' && !user.roleGrants.some(
          (grant) => grant.role.key === 'OPERATOR' || grant.role.key === 'CUSTOMER',
        ),
      ));
      setNotice(branch.managerUserId
        ? 'Đã đổi quản lý chi nhánh.'
        : 'Đã gán quản lý; chi nhánh đã được kích hoạt.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể gán quản lý chi nhánh.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceLayout activeSection="branches" requiredPermission="branches.read">
      <main className="account-layout">
        <section className="account-content access-content">
          <p className="eyebrow">TỔ CHỨC · CẤU TRÚC CHI NHÁNH</p>
          <h1>Chi nhánh</h1>
          <p className="form-intro">Theo dõi cây chi nhánh. Chi nhánh con kế thừa phạm vi quản lý từ chi nhánh cha theo quyền backend.</p>
          <nav className="access-tabs" aria-label="Quản trị truy cập">
            {canReadUsers && <Button variant="ghost" type="button" onClick={() => router.push('/staff')}>Người dùng</Button>}
            <Button variant="ghost" type="button" className="is-current" aria-current="page">Chi nhánh</Button>
            {canReadRoles && <Button variant="ghost" type="button" onClick={() => router.push('/roles')}>Vai trò & quyền</Button>}
          </nav>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {notice && <div className="alert alert-success" role="status">{notice}</div>}
              <Card className="users-table-card">
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <CardTitle>Cây chi nhánh <span className="muted-value">{loading ? 'Đang tải…' : `${branches.length} chi nhánh trong phạm vi`}</span></CardTitle>
                  {canManageBranches && (
                    <Dialog
                      open={createDialogOpen}
                      disablePointerDismissal
                      onOpenChange={(open, details) => {
                        if (open || details.reason === 'close-press') {
                          setCreateDialogOpen(open);
                          if (open) {
                            setError('');
                            setNotice('');
                          }
                        }
                      }}
                    >
                      <DialogTrigger render={<Button type="button" variant="outline"><Plus data-icon="inline-start" />Tạo mới</Button>} />
                      <DialogContent className="create-dialog" closeLabel="Đóng">
                        <DialogHeader className="pr-10">
                          <DialogTitle>Tạo chi nhánh</DialogTitle>
                          <DialogDescription>Thêm chi nhánh mới vào cấu trúc tổ chức.</DialogDescription>
                        </DialogHeader>
                        {error && <div className="alert alert-error" role="alert">{error}</div>}
                        {notice && <div className="alert alert-success" role="status">{notice}</div>}
                        <form className="user-create-form dialog-create-form" onSubmit={createBranch}>
                          <div>
                            <label htmlFor="branch-code">Mã chi nhánh</label>
                            <Input id="branch-code" className="h-11 md:h-10" value={branchCode} onChange={(event) => setBranchCode(event.target.value)} pattern="[A-Za-z0-9_-]{2,64}" maxLength={64} required />
                          </div>
                          <div>
                            <label htmlFor="branch-name">Tên chi nhánh</label>
                            <Input id="branch-name" className="h-11 md:h-10" value={branchName} onChange={(event) => setBranchName(event.target.value)} minLength={2} maxLength={160} required />
                          </div>
                          <div className="dialog-form-wide">
                            <label htmlFor="branch-parent">Chi nhánh cha</label>
                            <select id="branch-parent" className="h-11 md:h-10" value={branchParent} onChange={(event) => setBranchParent(event.target.value)}>
                              <option value="">Chi nhánh tổng</option>
                              {branches.filter((branch) => branch.status === 'ACTIVE').map((branch) => <option value={branch.id} key={branch.id}>{branch.name} · {branch.code}</option>)}
                            </select>
                          </div>
                          <div className="dialog-form-actions">
                            <Button className="h-11 md:h-10" type="submit" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo chi nhánh'}</Button>
                          </div>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )}
                </CardHeader>
            <CardContent>
              {branches.length ? (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Mã</th><th>Tên</th><th>Chi nhánh cha</th><th>Trạng thái</th>{canManageBranches && <th>Thao tác</th>}</tr></thead>
                    <tbody>{branches.map((branch) => {
                      const parent = branches.find((candidate) => candidate.id === branch.parentId);
                      const hasActiveChildren = branches.some((candidate) => candidate.parentId === branch.id && candidate.status === 'ACTIVE');
                      const cannotActivateReason = branch.status === 'ACTIVE'
                        ? ''
                        : !branch.managerUserId || branch.manager?.status !== 'ACTIVE'
                          ? 'Cần gán người quản lý đang hoạt động trước khi kích hoạt.'
                          : parent && parent.status !== 'ACTIVE'
                            ? 'Cần kích hoạt chi nhánh cha trước.'
                            : '';
                      const cannotDeactivateReason = branch.status === 'ACTIVE' && hasActiveChildren
                        ? 'Không thể ngừng hoạt động khi còn chi nhánh con đang hoạt động.'
                        : '';
                      const disabledReason = cannotActivateReason || cannotDeactivateReason;
                      const eligibleManagers = managerCandidates.filter((manager) =>
                        manager.id !== branch.managerUserId &&
                        !manager.roleGrants.some((grant) =>
                          grant.role.key === 'ADVISING' && grant.branch?.id !== branch.id,
                        ),
                      );
                      return (
                        <tr key={branch.id}>
                          <td><span className="table-chip">{branch.code}</span></td>
                          <td><strong>{branch.name}</strong><small>{branch.manager?.displayName ?? 'Chưa gán quản lý'}</small></td>
                          <td>{parent ? `${parent.name} · ${parent.code}` : 'Gốc'}</td>
                          <td><span className={`user-status ${branch.status === 'ACTIVE' ? 'is-active' : 'is-disabled'}`}>{branch.status === 'ACTIVE' ? 'Hoạt động' : 'Ngừng hoạt động'}</span></td>
                          {canManageBranches && (
                            <td>
                              <Button variant="outline" size="sm" type="button" disabled={busy || Boolean(disabledReason)} title={disabledReason || undefined} onClick={() => void toggleBranchStatus(branch)}>
                                {branch.status === 'ACTIVE' ? 'Ngừng hoạt động' : 'Kích hoạt'}
                              </Button>
                              {disabledReason && <small>{disabledReason}</small>}
                              {canManageBranchManagers && (
                                parent && parent.status !== 'ACTIVE'
                                  ? <small>Cần kích hoạt chi nhánh cha trước.</small>
                                  : <details>
                                    <summary className="table-action">{branch.managerUserId && branch.manager?.status === 'ACTIVE' ? 'Đổi quản lý' : 'Gán quản lý'}</summary>
                                    <form className="inline-role" onSubmit={(event) => void assignManager(branch, event)}>
                                      <select name="managerUserId" required defaultValue="">
                                        <option value="" disabled>Chọn quản lý mới</option>
                                        {eligibleManagers.map((manager) => <option value={manager.id} key={manager.id}>{manager.displayName} · @{manager.username}</option>)}
                                      </select>
                                      <Button type="submit" size="sm" disabled={busy || eligibleManagers.length === 0}>
                                        {branch.managerUserId && branch.manager?.status === 'ACTIVE' ? 'Đổi quản lý' : 'Gán và kích hoạt'}
                                      </Button>
                                      {!eligibleManagers.length && <small>Chưa có tài khoản phù hợp đang hoạt động để phân công.</small>}
                                    </form>
                                  </details>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              ) : <p className="empty-state">{loading ? 'Đang tải danh sách…' : 'Chưa có chi nhánh trong phạm vi quyền được cấp.'}</p>}
            </CardContent>
          </Card>
        </section>
      </main>
    </WorkspaceLayout>
  );
}
