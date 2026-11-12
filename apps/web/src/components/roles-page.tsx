'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { useCrmSession } from '@/components/crm-session';
import {
  displayRoleName,
  permissionDescriptionEnglish,
  permissionDescriptionVietnamese,
  permissionGroupLabels,
  permissionScopes,
  type PermissionOption,
  type RoleOption,
  type RolePermission,
  toRolePermissionInput,
} from '@/lib/crm-access';
import { request } from '@/lib/crm-api';

export function RolesPage() {
  const router = useRouter();
  const { session, can, busy, setBusy, error, setError, notice, setNotice } = useCrmSession();
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionOption[]>([]);
  const [selectedRoleKey, setSelectedRoleKey] = useState('');
  const [rolePermissionDraft, setRolePermissionDraft] = useState<RolePermission[]>([]);
  const [newRoleKey, setNewRoleKey] = useState('CUSTOM_');
  const [newRoleName, setNewRoleName] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const canReadUsers = can('users.read');
  const canReadBranches = can('branches.read');
  const canReadPermissions = can('permissions.read');
  const canManageRoles = can('roles.manage');
  const selectedRole = roles.find((role) => role.key === selectedRoleKey);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void Promise.all([
      request<RoleOption[]>('/access/roles', {}, session.accessToken),
      canReadPermissions
        ? request<PermissionOption[]>('/access/permissions', {}, session.accessToken)
        : Promise.resolve([]),
    ]).then(([nextRoles, nextPermissions]) => {
      if (!active) return;
      setRoles(nextRoles);
      setPermissionCatalog(nextPermissions);
      const firstRole = nextRoles.find((role) => role.key !== 'OPERATOR') ?? nextRoles[0];
      if (firstRole) {
        setSelectedRoleKey(firstRole.key);
        setRolePermissionDraft(toRolePermissionInput(firstRole.permissions));
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải vai trò và quyền.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [canReadPermissions, session, setError]);

  function selectRole(roleKey: string) {
    setSelectedRoleKey(roleKey);
    setRolePermissionDraft(toRolePermissionInput(
      roles.find((role) => role.key === roleKey)?.permissions ?? [],
    ));
  }

  function setRoleScope(permissionKey: string, scope: RolePermission['scope'], enabled: boolean) {
    setRolePermissionDraft((current) => {
      const withoutSelection = current.filter((item) =>
        !(item.permissionKey === permissionKey && item.scope === scope),
      );
      return enabled ? [...withoutSelection, { permissionKey, scope }] : withoutSelection;
    });
  }

  function isPermissionGroupFullySelected(group: string) {
    const groupPermissions = permissionCatalog.filter((permission) => permission.groupKey === group);
    return groupPermissions.length > 0 && groupPermissions.every((permission) =>
      permissionScopes.every((scope) => rolePermissionDraft.some(
        (grant) => grant.permissionKey === permission.key && grant.scope === scope.key,
      )),
    );
  }

  function setPermissionGroup(group: string, enabled: boolean) {
    const groupPermissionKeys = new Set(
      permissionCatalog
        .filter((permission) => permission.groupKey === group)
        .map((permission) => permission.key),
    );
    setRolePermissionDraft((current) => [
      ...current.filter((grant) => !groupPermissionKeys.has(grant.permissionKey)),
      ...(enabled
        ? permissionCatalog
          .filter((permission) => permission.groupKey === group)
          .flatMap((permission) => permissionScopes.map((scope) => ({
            permissionKey: permission.key,
            scope: scope.key,
          })))
        : []),
    ]);
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await request<RoleOption>('/access/roles', {
        method: 'POST',
        body: JSON.stringify({ key: newRoleKey, name: newRoleName, permissions: [] }),
      }, session.accessToken);
      const nextRoles = await request<RoleOption[]>('/access/roles', {}, session.accessToken);
      setRoles(nextRoles);
      setSelectedRoleKey(created.key);
      setRolePermissionDraft([]);
      setNewRoleKey('CUSTOM_');
      setNewRoleName('');
      setNotice(`Đã tạo vai trò ${displayRoleName(created)}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo vai trò.');
    } finally {
      setBusy(false);
    }
  }

  async function savePermissions() {
    if (!session || !selectedRoleKey) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await request<RoleOption>(
        `/access/roles/${encodeURIComponent(selectedRoleKey)}/permissions`,
        { method: 'PUT', body: JSON.stringify({ permissions: rolePermissionDraft }) },
        session.accessToken,
      );
      setRoles((current) => current.map((role) => role.key === updated.key ? updated : role));
      setRolePermissionDraft(toRolePermissionInput(updated.permissions));
      setNotice(`Đã lưu ma trận quyền cho ${displayRoleName(updated)}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu ma trận quyền.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceLayout activeSection="roles" requiredPermission="roles.read">
      <main className="account-layout">
        <section className="account-content access-content">
          <p className="eyebrow">RBAC · VAI TRÒ VÀ PHẠM VI</p>
          <h1>Vai trò & phân quyền</h1>
          <p className="form-intro">Nhóm quyền theo chức năng và phạm vi dữ liệu. Backend xác thực từng thao tác và giới hạn quyền được ủy quyền.</p>
          <nav className="access-tabs" aria-label="Quản trị truy cập">
            {canReadUsers && <Button variant="ghost" type="button" onClick={() => router.push('/staff')}>Người dùng</Button>}
            {canReadBranches && <Button variant="ghost" type="button" onClick={() => router.push('/branches')}>Chi nhánh</Button>}
            <Button variant="ghost" type="button" className="is-current" aria-current="page">Vai trò & quyền</Button>
          </nav>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {notice && <div className="alert alert-success" role="status">{notice}</div>}
          <Card className="role-editor-card">
            <CardHeader>
              <div className="role-editor-heading">
                <div>
                  <label htmlFor="role-select">Chọn vai trò</label>
                  <select id="role-select" value={selectedRoleKey} onChange={(event) => selectRole(event.target.value)}>
                    {roles.map((role) => <option value={role.key} key={role.key}>{displayRoleName(role)} · {role.key}{role.isSystem ? ' · Hệ thống' : ''}</option>)}
                  </select>
                </div>
                <span className="role-count">{rolePermissionDraft.length} mục quyền đang chọn</span>
                {canManageRoles && (
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
                        <DialogTitle>Tạo vai trò tùy chỉnh</DialogTitle>
                        <DialogDescription>Tạo vai trò mới để thiết lập quyền truy cập riêng.</DialogDescription>
                      </DialogHeader>
                      {error && <div className="alert alert-error" role="alert">{error}</div>}
                      {notice && <div className="alert alert-success" role="status">{notice}</div>}
                      <form className="user-create-form dialog-create-form" onSubmit={createRole}>
                        <div>
                          <label htmlFor="role-key">Mã vai trò</label>
                          <Input id="role-key" className="h-11 md:h-10" value={newRoleKey} onChange={(event) => setNewRoleKey(event.target.value.toUpperCase())} pattern="CUSTOM_[A-Z0-9_]{2,70}" maxLength={77} required />
                        </div>
                        <div>
                          <label htmlFor="role-name">Tên vai trò</label>
                          <Input id="role-name" className="h-11 md:h-10" value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} minLength={2} maxLength={120} required />
                        </div>
                        <div className="dialog-form-actions">
                          <Button className="h-11 md:h-10" type="submit" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo vai trò'}</Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {selectedRole?.key === 'OPERATOR' && <p className="system-lock">Vai trò OPERATOR được bảo vệ, không chỉnh sửa quyền tại đây.</p>}
              {loading
                ? <p className="empty-state">Đang tải vai trò…</p>
                : canReadPermissions && permissionCatalog.length > 0
                  ? (
                    <div className="table-scroll permission-matrix-wrap">
                      <table className="permission-matrix">
                        <thead><tr><th>Chức năng</th>{permissionScopes.map((scope) => <th key={scope.key}>{scope.label}</th>)}</tr></thead>
                        <tbody>{[...new Set(permissionCatalog.map((permission) => permission.groupKey))].map((group) => (
                          <Fragment key={group}>
                            <tr className="permission-group-row">
                              <th colSpan={permissionScopes.length + 1}>
                                <span className="permission-group-heading">
                                  <span>{permissionGroupLabels[group] ?? 'Nhóm chức năng khác'}</span>
                                  {canManageRoles && selectedRole?.key === 'ADMIN' && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="permission-group-action"
                                      onClick={() => setPermissionGroup(group, !isPermissionGroupFullySelected(group))}
                                    >
                                      {isPermissionGroupFullySelected(group) ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                                    </Button>
                                  )}
                                </span>
                              </th>
                            </tr>
                            {permissionCatalog.filter((permission) => permission.groupKey === group).map((permission) => (
                              <tr key={permission.key}>
                                <td>
                                  <strong>{permission.key}</strong>
                                  <small className="permission-description-en">{permissionDescriptionEnglish(permission)}</small>
                                  <small className="permission-description-vi">{permissionDescriptionVietnamese(permission)}</small>
                                </td>
                                {permissionScopes.map((scope) => (
                                  <td key={scope.key}>
                                    <label className="scope-checkbox" aria-label={`${permission.key}: ${permissionDescriptionVietnamese(permission)}; ${scope.label}`}>
                                      <input
                                        type="checkbox"
                                        checked={rolePermissionDraft.some((grant) => grant.permissionKey === permission.key && grant.scope === scope.key)}
                                        disabled={!canManageRoles || selectedRole?.key === 'OPERATOR'}
                                        onChange={(event) => setRoleScope(permission.key, scope.key, event.target.checked)}
                                      />
                                      <span />
                                    </label>
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </Fragment>
                        ))}</tbody>
                      </table>
                    </div>
                  )
                  : <p className="empty-state">Bạn cần quyền permissions.read để xem ma trận quyền.</p>}
              {selectedRole && canManageRoles && selectedRole.key !== 'OPERATOR' && (
                <div className="role-save-row">
                  <p>Quyền phạm vi chi nhánh yêu cầu gán vai trò cho một chi nhánh cụ thể.</p>
                  <Button type="button" onClick={() => void savePermissions()} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu ma trận quyền'}</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </WorkspaceLayout>
  );
}
