'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
import { BranchOption, displayRoleName, ManagedUser, RoleOption } from '@/lib/crm-access';
import { request } from '@/lib/crm-api';

export function StaffPage() {
  const router = useRouter();
  const { session, can, busy, setBusy, error, setError, notice, setNotice } = useCrmSession();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [newRole, setNewRole] = useState('ADVISING');
  const [newBranch, setNewBranch] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const canReadRoles = can('roles.read');
  const canReadBranches = can('branches.read');
  const canManageUsers = can('users.manage');
  const canManageRoles = can('roles.manage');

  const loadUsers = useCallback(async (token: string) => {
    setUsers(await request<ManagedUser[]>('/access/users', {}, token));
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    void Promise.all([
      request<ManagedUser[]>('/access/users', {}, session.accessToken),
      canReadRoles ? request<RoleOption[]>('/access/roles', {}, session.accessToken) : Promise.resolve([]),
      canReadBranches ? request<BranchOption[]>('/access/branches', {}, session.accessToken) : Promise.resolve([]),
    ]).then(([nextUsers, nextRoles, nextBranches]) => {
      if (!active) return;
      setUsers(nextUsers);
      setRoles(nextRoles.filter((role) => role.key !== 'OPERATOR'));
      setBranches(nextBranches);
      if (nextRoles.some((role) => role.key === 'ADVISING')) setNewRole('ADVISING');
      else {
        const initialRole = nextRoles.find((role) => role.key !== 'MANAGE');
        if (initialRole) setNewRole(initialRole.key);
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách nhân viên.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [canReadBranches, canReadRoles, session, setError]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    if (newRole === 'MANAGE') {
      setError('Hãy tạo tài khoản trước, sau đó phân công người quản lý trong trang Chi nhánh.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/access/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          displayName: newDisplayName,
          temporaryPassword,
          roleKey: newRole,
          ...(newBranch ? { branchId: newBranch } : {}),
        }),
      }, session.accessToken);
      setNewUsername('');
      setNewDisplayName('');
      setTemporaryPassword('');
      setNewBranch('');
      await loadUsers(session.accessToken);
      setNotice('Đã tạo tài khoản. Nhân viên sẽ được yêu cầu đổi mật khẩu khi đăng nhập lần đầu.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo tài khoản.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleUser(user: ManagedUser) {
    if (!session) return;
    const action = user.status === 'ACTIVE' ? 'disable' : 'enable';
    const reason = window.prompt(user.status === 'ACTIVE' ? 'Lý do vô hiệu hóa tài khoản:' : 'Lý do kích hoạt lại tài khoản:');
    if (!reason?.trim()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/access/users/${user.id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: reason.trim() }),
      }, session.accessToken);
      await loadUsers(session.accessToken);
      setNotice(user.status === 'ACTIVE' ? 'Đã vô hiệu hóa tài khoản.' : 'Đã kích hoạt tài khoản.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật trạng thái tài khoản.');
    } finally {
      setBusy(false);
    }
  }

  async function assignRole(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    if (!session) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const roleKey = String(form.get('roleKey') ?? '');
    const branchId = String(form.get('branchId') ?? '');
    if (roleKey === 'MANAGE' && !branchId) {
      setError('Hãy chọn chi nhánh để phân công người quản lý.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (roleKey === 'MANAGE') {
        await request(`/access/branches/${branchId}/manager`, {
          method: 'PUT',
          body: JSON.stringify({ managerUserId: userId }),
        }, session.accessToken);
      } else {
        await request('/access/role-grants', {
          method: 'POST',
          body: JSON.stringify({ userId, roleKey, ...(branchId ? { branchId } : {}) }),
        }, session.accessToken);
      }
      await loadUsers(session.accessToken);
      setNotice('Đã cấp vai trò cho nhân viên.');
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cấp vai trò.');
    } finally {
      setBusy(false);
    }
  }

  async function revokeRole(grantId: string) {
    if (!session) return;
    const reason = window.prompt('Lý do thu hồi vai trò:');
    if (!reason?.trim()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/access/role-grants/${grantId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: reason.trim() }),
      }, session.accessToken);
      await loadUsers(session.accessToken);
      setNotice('Đã thu hồi vai trò.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể thu hồi vai trò.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceLayout activeSection="users" requiredPermission="users.read">
      <main className="account-layout">
        <section className="account-content access-content">
          <p className="eyebrow">QUẢN TRỊ TRUY CẬP</p>
          <h1>Tài khoản nhân viên</h1>
          <p className="form-intro">Tạo tài khoản, xem vai trò và quản lý trạng thái trong phạm vi được phân quyền.</p>
          <nav className="access-tabs" aria-label="Quản trị truy cập">
            <Button type="button" variant="ghost" className="is-current" aria-current="page">Người dùng</Button>
            {canReadBranches && <Button type="button" variant="ghost" onClick={() => router.push('/branches')}>Chi nhánh</Button>}
            {canReadRoles && <Button type="button" variant="ghost" onClick={() => router.push('/roles')}>Vai trò & quyền</Button>}
          </nav>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {notice && <div className="alert alert-success" role="status">{notice}</div>}
              <Card className="users-table-card">
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <CardTitle>Danh sách nhân viên <span className="muted-value">{loading ? 'Đang tải…' : `${users.length} tài khoản`}</span></CardTitle>
                  {canManageUsers && canManageRoles && (
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
                          <DialogTitle>Tạo tài khoản nhân viên</DialogTitle>
                          <DialogDescription>Tạo tài khoản và cấp vai trò ban đầu cho nhân viên.</DialogDescription>
                        </DialogHeader>
                        {error && <div className="alert alert-error" role="alert">{error}</div>}
                        {notice && <div className="alert alert-success" role="status">{notice}</div>}
                        <form className="user-create-form dialog-create-form" onSubmit={createUser}>
                          <div>
                            <label htmlFor="new-display-name">Họ tên hiển thị</label>
                            <Input id="new-display-name" className="h-11 md:h-10" value={newDisplayName} onChange={(event) => setNewDisplayName(event.target.value)} minLength={2} maxLength={160} required />
                          </div>
                          <div>
                            <label htmlFor="new-username">Tên đăng nhập</label>
                            <Input id="new-username" className="h-11 md:h-10" value={newUsername} onChange={(event) => setNewUsername(event.target.value)} pattern="[A-Za-z0-9._-]{3,120}" required />
                          </div>
                          <div>
                            <label htmlFor="temporary-password">Mật khẩu tạm thời</label>
                            <Input id="temporary-password" className="h-11 md:h-10" type="password" autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} minLength={12} maxLength={256} required />
                          </div>
                          <div>
                            <label htmlFor="new-role">Vai trò</label>
                            <select id="new-role" className="h-11 md:h-10" value={newRole} onChange={(event) => setNewRole(event.target.value)} required>
                              {roles.map((role) => <option value={role.key} key={role.key} disabled={role.key === 'MANAGE'}>{displayRoleName(role)} ({role.key}){role.key === 'MANAGE' ? ' — phân công tại Chi nhánh' : ''}</option>)}
                            </select>
                          </div>
                          <div className="dialog-form-wide">
                            <label htmlFor="new-branch">Chi nhánh</label>
                            <select id="new-branch" className="h-11 md:h-10" value={newBranch} onChange={(event) => setNewBranch(event.target.value)}>
                              <option value="">Toàn hệ thống (nếu được phân quyền)</option>
                              {branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name} · {branch.code}</option>)}
                            </select>
                          </div>
                          <div className="dialog-form-actions">
                            <Button className="h-11 md:h-10" type="submit" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo tài khoản'}</Button>
                          </div>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )}
                </CardHeader>
            <CardContent>
              {users.length ? (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Nhân viên</th><th>Vai trò · Chi nhánh</th><th>Trạng thái</th>{canManageUsers && <th>Thao tác</th>}</tr></thead>
                    <tbody>{users.map((user) => (
                      <tr key={user.id}>
                        <td><strong>{user.displayName}</strong><small>@{user.username}</small></td>
                        <td>
                          {user.roleGrants.map((grant) => (
                            <span className="grant-entry" key={grant.id}>
                              <span className="grant-details">
                                <span className="grant-role">
                                  <span className="table-chip">{displayRoleName(grant.role)}</span>
                                  <small>{grant.role.key}</small>
                                </span>
                                <small className="grant-branch">
                                  {grant.branch ? `${grant.branch.name} · ${grant.branch.code}` : 'Toàn hệ thống'}
                                </small>
                              </span>
                              {canManageRoles && <button className="grant-revoke" type="button" title={`Thu hồi vai trò ${displayRoleName(grant.role)}`} disabled={busy} onClick={() => void revokeRole(grant.id)}>×</button>}
                            </span>
                          ))}
                          {!user.roleGrants.length && '—'}
                          {canManageUsers && canManageRoles && (
                            <details className="inline-role">
                              <summary>Cấp thêm vai trò</summary>
                              <form onSubmit={(event) => void assignRole(event, user.id)}>
                                <select name="roleKey" required defaultValue=""><option value="" disabled>Chọn vai trò</option>{roles.map((role) => <option value={role.key} key={role.key}>{displayRoleName(role)}</option>)}</select>
                                <select name="branchId" defaultValue=""><option value="">Toàn hệ thống</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select>
                                <Button type="submit" size="sm" disabled={busy}>Cấp</Button>
                              </form>
                            </details>
                          )}
                        </td>
                        <td><span className={`user-status ${user.status === 'ACTIVE' ? 'is-active' : 'is-disabled'}`}>{user.status === 'ACTIVE' ? 'Hoạt động' : 'Vô hiệu hóa'}</span></td>
                        {canManageUsers && <td><Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void toggleUser(user)}>{user.status === 'ACTIVE' ? 'Vô hiệu hóa' : 'Kích hoạt'}</Button></td>}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="empty-state">{loading ? 'Đang tải danh sách…' : 'Không tìm thấy tài khoản trong phạm vi quyền được cấp.'}</p>}
            </CardContent>
          </Card>
          <p className="account-caption">Mọi thao tác tạo, kích hoạt hoặc vô hiệu hóa tài khoản đều được ghi nhận audit ở backend.</p>
        </section>
      </main>
    </WorkspaceLayout>
  );
}
