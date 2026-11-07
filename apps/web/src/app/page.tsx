'use client';

import { Fragment, type FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';

type Session = { accessToken: string; passwordChangeRequired: boolean };
type Staff = {
  id: string;
  username: string;
  displayName: string;
  status: string;
  type: string;
  mustChangePassword: boolean;
  roles: { key: string; name: string; scope: { branch?: { id: string; code: string; name: string }; global?: boolean } }[];
  permissions: { key: string; scopes: string[] }[];
};
type ManagedUser = { id: string; username: string; displayName: string; status: string; createdAt: string; roleGrants: { id: string; role: { key: string; name: string }; branch: { id: string; code: string; name: string } | null }[] };
type RolePermission = { permissionKey: string; scope: string };
type RoleOption = { key: string; name: string; description?: string | null; isSystem: boolean; permissions: RolePermission[] };
type BranchOption = { id: string; code: string; name: string; parentId: string | null; status: string; createdAt: string };
type PermissionOption = { key: string; groupKey: string; description: string };

const ACCESS_CATALOG_PERMISSIONS = new Set([
  'permissions.read',
  'permissions.delegate',
  'roles.read',
  'roles.manage',
]);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

function apiBaseUrl() {
  const configured = new URL(API_BASE_URL);
  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(configured.hostname) && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    configured.hostname = window.location.hostname;
  }
  return configured.origin + configured.pathname.replace(/\/$/, '');
}

async function request<T>(path: string, options: RequestInit = {}, accessToken?: string): Promise<T> {
  const send = (token?: string) => {
    const headers = new Headers(options.headers);
    if (options.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${apiBaseUrl()}/api/v1${path}`, { ...options, headers, credentials: 'include', cache: 'no-store' });
  };
  let response = await send(accessToken);
  if (response.status === 401 && accessToken && path !== '/auth/logout') {
    try {
      const refreshed = await request<{ accessToken: string }>('/auth/refresh', { method: 'POST' });
      response = await send(refreshed.accessToken);
    } catch {
      throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }
  }
  const payload = await response.json().catch(() => null) as { message?: string | string[]; code?: string } | null;
  if (!response.ok) {
    const message = Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message;
    throw new Error(message || (response.status === 401 ? 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' : 'Không thể xử lý yêu cầu. Vui lòng thử lại.'));
  }
  return payload as T;
}

function roleLabel(role: string) {
  const labels: Record<string, string> = { OPERATOR: 'Vận hành hệ thống', ADMIN: 'Quản trị viên', MANAGE: 'Quản lý', ADVISING: 'Tư vấn viên', CUSTOMER: 'Khách hàng' };
  return labels[role] ?? role;
}

function displayRoleName(role: { key: string; name: string }) {
  return roleLabel(role.key) === role.key ? role.name : roleLabel(role.key);
}

const permissionGroupLabels: Record<string, string> = {
  'access-control': 'Quản trị truy cập',
  advising: 'Tư vấn',
  audit: 'Nhật ký hoạt động',
  customers: 'Khách hàng',
  identity: 'Tài khoản & danh tính',
  loans: 'Khoản vay',
  organization: 'Tổ chức',
  reports: 'Báo cáo',
};

const permissionDescriptionsVi: Record<string, string> = {
  'advising.message.send': 'Gửi tin nhắn tư vấn trong phạm vi được cấp.',
  'audit.read': 'Xem nhật ký hoạt động trong phạm vi được cấp.',
  'auth.me': 'Xem thông tin tài khoản đang đăng nhập.',
  'branches.manage': 'Tạo và quản lý chi nhánh trong phạm vi được cấp.',
  'branches.read': 'Xem chi nhánh trong phạm vi được cấp.',
  'customers.assign': 'Phân công khách hàng trong phạm vi được cấp.',
  'customers.read': 'Xem dữ liệu khách hàng trong phạm vi được cấp.',
  'loan-applications.assign': 'Phân công hồ sơ vay trong phạm vi được cấp.',
  'loan-applications.read': 'Xem hồ sơ vay trong phạm vi được cấp.',
  'permissions.delegate': 'Ủy quyền quyền chức năng và phạm vi trong giới hạn thẩm quyền được giao.',
  'permissions.read': 'Xem danh mục quyền chức năng của hệ thống.',
  'reports.read': 'Xem báo cáo trong phạm vi được cấp.',
  'roles.manage': 'Tạo vai trò tùy chỉnh và cấp vai trò trong giới hạn được ủy quyền.',
  'roles.read': 'Xem vai trò và danh mục quyền.',
  'users.manage': 'Tạo, vô hiệu hóa và quản lý người dùng trong phạm vi được cấp.',
  'users.read': 'Xem người dùng trong phạm vi được cấp.',
};

function permissionDescriptionEnglish(permission: PermissionOption) {
  return permission.description.split(' | ', 1)[0];
}

function permissionDescriptionVietnamese(permission: PermissionOption) {
  return permission.description.split(' | ')[1] ?? permissionDescriptionsVi[permission.key] ?? 'Chưa có mô tả tiếng Việt cho quyền này.';
}

const permissionScopes = [
  { key: 'OWN', label: 'Của tôi' },
  { key: 'ASSIGNED', label: 'Được giao' },
  { key: 'BRANCH', label: 'Chi nhánh' },
  { key: 'ALL', label: 'Toàn hệ thống' },
];

function scopeLabel(scope: string) {
  return permissionScopes.find((item) => item.key === scope)?.label ?? scope;
}

function hasGlobalDataScope(staff: Staff | null) {
  return Boolean(staff?.permissions.some((permission) =>
    permission.scopes.includes('ALL') && !ACCESS_CATALOG_PERMISSIONS.has(permission.key),
  ));
}

function branchScopes(staff: Staff | null) {
  const branches = new Map<string, string>();
  for (const role of staff?.roles ?? []) {
    if (role.scope.branch) branches.set(role.scope.branch.id, role.scope.branch.name);
  }
  return [...branches.entries()];
}

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [accessSection, setAccessSection] = useState<'users' | 'branches' | 'roles' | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionOption[]>([]);
  const [selectedRoleKey, setSelectedRoleKey] = useState('');
  const [rolePermissionDraft, setRolePermissionDraft] = useState<RolePermission[]>([]);
  const [newRoleKey, setNewRoleKey] = useState('CUSTOM_');
  const [newRoleName, setNewRoleName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchParent, setBranchParent] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [newRole, setNewRole] = useState('ADVISING');
  const [newBranch, setNewBranch] = useState('');

  const loadStaff = useCallback(async (token: string) => {
    const profile = await request<Staff>('/auth/me', {}, token);
    setStaff(profile);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void request<Omit<Session, 'accessToken'> & { accessToken: string }>('/auth/refresh', { method: 'POST' })
      .then(async (nextSession) => {
        if (!active) return;
        setSession(nextSession);
        if (!nextSession.passwordChangeRequired) await loadStaff(nextSession.accessToken);
        else setLoading(false);
      })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadStaff]);

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await request<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      setSession(result); setPassword('');
      if (!result.passwordChangeRequired) await loadStaff(result.accessToken);
      else setLoading(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Đăng nhập thất bại.'); }
    finally { setBusy(false); }
  }

  async function onChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (!session) return;
    if (newPassword.length < 12) { setError('Mật khẩu mới cần có ít nhất 12 ký tự.'); return; }
    if (newPassword !== confirmPassword) { setError('Mật khẩu xác nhận chưa khớp.'); return; }
    setBusy(true);
    try {
      const updated = await request<Session>('/auth/password', {
        method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
      }, session.accessToken);
      setSession(updated); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setNotice('Mật khẩu đã được cập nhật.');
      await loadStaff(updated.accessToken);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đổi mật khẩu.'); }
    finally { setBusy(false); }
  }

  async function onLogout() {
    setBusy(true); setError('');
    try { if (session) await request('/auth/logout', { method: 'POST' }, session.accessToken); }
    catch { /* Clear local state even if the server session has already expired. */ }
    finally { setSession(null); setStaff(null); setBusy(false); setNotice('Bạn đã đăng xuất.'); }
  }

  async function openAccessSection(section: 'users' | 'branches' | 'roles') {
    if (!session) return;
    setError(''); setBusy(true);
    try {
      if (section === 'users') {
        const [usersResult, rolesResult, branchesResult] = await Promise.all([
          request<ManagedUser[]>('/access/users', {}, session.accessToken),
          canReadRoles ? request<RoleOption[]>('/access/roles', {}, session.accessToken) : Promise.resolve([]),
          canReadBranches ? request<BranchOption[]>('/access/branches', {}, session.accessToken) : Promise.resolve([]),
        ]);
        setManagedUsers(usersResult); setRoles(rolesResult.filter((role) => role.key !== 'OPERATOR'));
        setBranches(branchesResult); setAccessSection('users');
        if (rolesResult.some((role) => role.key === 'ADVISING')) setNewRole('ADVISING');
        else if (rolesResult[0]) setNewRole(rolesResult[0].key);
      } else if (section === 'branches') {
        setBranches(await request<BranchOption[]>('/access/branches', {}, session.accessToken));
        setAccessSection('branches');
      } else {
        const [roleResult, permissionResult] = await Promise.all([
          request<RoleOption[]>('/access/roles', {}, session.accessToken),
          canReadPermissions ? request<PermissionOption[]>('/access/permissions', {}, session.accessToken) : Promise.resolve([]),
        ]);
        setRoles(roleResult); setPermissionCatalog(permissionResult); setAccessSection('roles');
        const firstRole = roleResult.find((role) => role.key !== 'OPERATOR') ?? roleResult[0];
        if (firstRole) { setSelectedRoleKey(firstRole.key); setRolePermissionDraft(firstRole.permissions); }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách nhân viên.'); }
    finally { setBusy(false); }
  }

  async function onCreateBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/access/branches', { method: 'POST', body: JSON.stringify({ code: branchCode, name: branchName, ...(branchParent ? { parentId: branchParent } : {}) }) }, session.accessToken);
      setBranchCode(''); setBranchName(''); setBranchParent('');
      setBranches(await request<BranchOption[]>('/access/branches', {}, session.accessToken));
      setNotice('Đã tạo chi nhánh.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tạo chi nhánh.'); }
    finally { setBusy(false); }
  }

  function selectRole(roleKey: string) {
    setSelectedRoleKey(roleKey);
    setRolePermissionDraft(roles.find((role) => role.key === roleKey)?.permissions ?? []);
  }

  function setRoleScope(permissionKey: string, scope: string, enabled: boolean) {
    setRolePermissionDraft((current) => {
      const withoutSelection = current.filter((item) => !(item.permissionKey === permissionKey && item.scope === scope));
      return enabled ? [...withoutSelection, { permissionKey, scope }] : withoutSelection;
    });
  }

  async function onCreateRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await request<RoleOption>('/access/roles', { method: 'POST', body: JSON.stringify({ key: newRoleKey, name: newRoleName, permissions: [] }) }, session.accessToken);
      const nextRoles = await request<RoleOption[]>('/access/roles', {}, session.accessToken);
      setRoles(nextRoles); setSelectedRoleKey(created.key); setRolePermissionDraft([]);
      setNewRoleKey('CUSTOM_'); setNewRoleName(''); setNotice(`Đã tạo vai trò ${displayRoleName(created)}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tạo vai trò.'); }
    finally { setBusy(false); }
  }

  async function onSaveRolePermissions() {
    if (!session || !selectedRoleKey) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await request<RoleOption>(`/access/roles/${encodeURIComponent(selectedRoleKey)}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions: rolePermissionDraft }) }, session.accessToken);
      setRoles((current) => current.map((role) => role.key === updated.key ? updated : role));
      setRolePermissionDraft(updated.permissions); setNotice(`Đã lưu ma trận quyền cho ${displayRoleName(updated)}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu ma trận quyền.'); }
    finally { setBusy(false); }
  }

  async function onCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!session) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/access/users', { method: 'POST', body: JSON.stringify({ username: newUsername, displayName: newDisplayName, temporaryPassword, roleKey: newRole, ...(newBranch ? { branchId: newBranch } : {}) }) }, session.accessToken);
      setNewUsername(''); setNewDisplayName(''); setTemporaryPassword(''); setNewBranch('');
      setNotice('Đã tạo tài khoản. Nhân viên sẽ được yêu cầu đổi mật khẩu khi đăng nhập lần đầu.');
      const users = await request<ManagedUser[]>('/access/users', {}, session.accessToken); setManagedUsers(users);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tạo tài khoản.'); }
    finally { setBusy(false); }
  }

  async function toggleUser(user: ManagedUser) {
    if (!session) return;
    const action = user.status === 'ACTIVE' ? 'disable' : 'enable';
    const reason = window.prompt(user.status === 'ACTIVE' ? 'Lý do vô hiệu hóa tài khoản:' : 'Lý do kích hoạt lại tài khoản:');
    if (!reason?.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/access/users/${user.id}/${action}`, { method: 'PATCH', body: JSON.stringify({ reason: reason.trim() }) }, session.accessToken);
      setManagedUsers(await request<ManagedUser[]>('/access/users', {}, session.accessToken));
      setNotice(user.status === 'ACTIVE' ? 'Đã vô hiệu hóa tài khoản.' : 'Đã kích hoạt tài khoản.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể cập nhật trạng thái tài khoản.'); }
    finally { setBusy(false); }
  }

  async function onAssignRole(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault(); if (!session) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const roleKey = String(form.get('roleKey') ?? '');
    const branchId = String(form.get('branchId') ?? '');
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/access/role-grants', { method: 'POST', body: JSON.stringify({ userId, roleKey, ...(branchId ? { branchId } : {}) }) }, session.accessToken);
      setManagedUsers(await request<ManagedUser[]>('/access/users', {}, session.accessToken));
      setNotice('Đã cấp vai trò cho nhân viên.');
      formElement.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể cấp vai trò.'); }
    finally { setBusy(false); }
  }

  async function revokeRole(grantId: string) {
    if (!session) return;
    const reason = window.prompt('Lý do thu hồi vai trò:');
    if (!reason?.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/access/role-grants/${grantId}`, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim() }) }, session.accessToken);
      setManagedUsers(await request<ManagedUser[]>('/access/users', {}, session.accessToken));
      setNotice('Đã thu hồi vai trò.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể thu hồi vai trò.'); }
    finally { setBusy(false); }
  }

  const mustChangePassword = session?.passwordChangeRequired || staff?.mustChangePassword;
  const canReadUsers = staff?.permissions?.some((permission) => permission.key === 'users.read');
  const canManageUsers = staff?.permissions?.some((permission) => permission.key === 'users.manage');
  const canReadRoles = staff?.permissions?.some((permission) => permission.key === 'roles.read');
  const canManageRoles = staff?.permissions?.some((permission) => permission.key === 'roles.manage');
  const canReadBranches = staff?.permissions?.some((permission) => permission.key === 'branches.read');
  const canManageBranches = staff?.permissions?.some((permission) => permission.key === 'branches.manage');
  const canReadPermissions = staff?.permissions?.some((permission) => permission.key === 'permissions.read');
  const selectedRole = roles.find((role) => role.key === selectedRoleKey);
  const shellProps = {
    activeSection: accessSection,
    displayName: staff?.displayName ?? 'Nhân viên',
    username: staff?.username ?? '—',
    canReadUsers: Boolean(canReadUsers || canManageUsers),
    canReadBranches: Boolean(canReadBranches),
    canReadRoles: Boolean(canReadRoles),
    busy,
    onNavigate: (section: 'users' | 'branches' | 'roles' | null) => { setError(''); setNotice(''); if (section) void openAccessSection(section); else setAccessSection(null); },
    onLogout,
  };

  if (loading) return <main className="loading-screen"><span className="spinner" aria-hidden="true" /><p>Đang khôi phục phiên làm việc…</p></main>;

  if (!session) return (
    <main className="login-layout">
      <section className="login-story">
        <a className="brand" href="/" aria-label="Finance CRM trang chủ"><span className="brand-mark">F</span> Finance<span>CRM</span></a>
        <div className="story-copy">
          <p className="eyebrow">WORKSPACE · CRM</p>
          <h1>Chăm sóc khách hàng, rõ ràng từ lần liên hệ đầu tiên.</h1>
          <p>Một không gian làm việc an toàn cho đội ngũ tư vấn và quản lý.</p>
        </div>
        <div className="story-foot"><span className="pulse" /> Cổng nội bộ · Finance CRM</div>
        <div className="decor decor-one" /><div className="decor decor-two" />
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <div className="mobile-brand"><span className="brand-mark">F</span> Finance<span>CRM</span></div>
          <p className="eyebrow">CHÀO MỪNG TRỞ LẠI</p>
          <h2 id="login-title">Đăng nhập</h2>
          <p className="form-intro">Nhập thông tin tài khoản nhân viên của bạn.</p>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {notice && <div className="alert alert-success" role="status">{notice}</div>}
          <form onSubmit={onLogin} className="form-stack">
            <label htmlFor="username">Tên đăng nhập</label>
            <input id="username" name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            <label htmlFor="password">Mật khẩu</label>
            <div className="password-wrap">
              <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button className="reveal-button" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? 'Ẩn' : 'Hiện'}</button>
            </div>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Đang xác thực…' : 'Đăng nhập'}<span aria-hidden="true">→</span></button>
          </form>
          <p className="secure-note"><span aria-hidden="true">▣</span> Kết nối an toàn · Phiên làm việc được bảo vệ</p>
        </div>
        <footer className="panel-footer">Finance CRM <span>•</span> Hỗ trợ tài khoản: liên hệ quản trị viên</footer>
      </section>
    </main>
  );

  if (mustChangePassword) return (
    <main className="account-layout">
      <header className="account-topbar"><a className="brand" href="/"><span className="brand-mark">F</span> Finance<span>CRM</span></a><span className="session-label">Bảo mật tài khoản</span></header>
      <section className="change-card">
        <div className="change-icon">⌑</div><p className="eyebrow">THIẾT LẬP BẢO MẬT</p>
        <h1>Đổi mật khẩu để tiếp tục</h1>
        <p className="form-intro">{session.passwordChangeRequired ? 'Tài khoản đang dùng mật khẩu tạm. Hãy chọn mật khẩu mới để bảo vệ phiên làm việc.' : 'Nhập mật khẩu hiện tại và chọn mật khẩu mới cho tài khoản của bạn.'}</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {notice && <div className="alert alert-success" role="status">{notice}</div>}
        <form onSubmit={onChangePassword} className="form-stack">
          <label htmlFor="current-password">Mật khẩu hiện tại</label><input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          <label htmlFor="new-password">Mật khẩu mới</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /><small>Tối thiểu 12 ký tự.</small>
          <label htmlFor="confirm-password">Xác nhận mật khẩu mới</label><input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}<span aria-hidden="true">→</span></button>
        </form>
        <button className="text-button" type="button" onClick={onLogout} disabled={busy}>Đăng xuất</button>
      </section>
    </main>
  );

  if (accessSection === 'branches' && canReadBranches) return (
    <AppShell {...shellProps}>
    <main className="account-layout">
      <header className="account-topbar"><a className="brand" href="/"><span className="brand-mark">F</span> Finance<span>CRM</span></a><button className="logout-button" type="button" onClick={() => setAccessSection(null)}>← Hồ sơ của tôi</button></header>
      <section className="account-content access-content">
        <p className="eyebrow">TỔ CHỨC · CẤU TRÚC CHI NHÁNH</p><h1>Chi nhánh</h1><p className="form-intro">Theo dõi cây chi nhánh. Chi nhánh con kế thừa phạm vi quản lý từ chi nhánh cha theo quyền backend.</p>
        <nav className="access-tabs" aria-label="Quản trị truy cập">
          {canReadUsers && <button type="button" onClick={() => void openAccessSection('users')}>Người dùng</button>}
          {canReadBranches && <button type="button" className="is-current" aria-current="page">Chi nhánh</button>}
          {canReadRoles && <button type="button" onClick={() => void openAccessSection('roles')}>Vai trò & quyền</button>}
        </nav>
        {error && <div className="alert alert-error" role="alert">{error}</div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}
        {canManageBranches && <details className="create-user-card"><summary><strong>＋ Tạo chi nhánh</strong><span className="muted-value">Có thể chọn chi nhánh cha</span></summary>
          <form className="user-create-form" onSubmit={onCreateBranch}>
            <label htmlFor="branch-code">Mã chi nhánh</label><input id="branch-code" value={branchCode} onChange={(event) => setBranchCode(event.target.value)} pattern="[A-Za-z0-9_-]{2,64}" maxLength={64} required />
            <label htmlFor="branch-name">Tên chi nhánh</label><input id="branch-name" value={branchName} onChange={(event) => setBranchName(event.target.value)} minLength={2} maxLength={160} required />
            <label htmlFor="branch-parent">Chi nhánh cha</label><select id="branch-parent" value={branchParent} onChange={(event) => setBranchParent(event.target.value)}><option value="">Chi nhánh tổng</option>{branches.filter((branch) => branch.status === 'ACTIVE').map((branch) => <option value={branch.id} key={branch.id}>{branch.name} · {branch.code}</option>)}</select>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo chi nhánh'}<span aria-hidden="true">→</span></button>
          </form>
        </details>}
        <section className="users-table-card"><div className="users-table-heading"><strong>Cây chi nhánh</strong><span>{branches.length} chi nhánh trong phạm vi</span></div>
          {branches.length ? <div className="table-scroll"><table><thead><tr><th>Mã</th><th>Tên</th><th>Chi nhánh cha</th><th>Trạng thái</th></tr></thead><tbody>{branches.map((branch) => { const parent = branches.find((candidate) => candidate.id === branch.parentId); return <tr key={branch.id}><td><span className="table-chip">{branch.code}</span></td><td><strong>{branch.name}</strong></td><td>{parent ? `${parent.name} · ${parent.code}` : 'Gốc'}</td><td><span className={`user-status ${branch.status === 'ACTIVE' ? 'is-active' : 'is-disabled'}`}>{branch.status === 'ACTIVE' ? 'Hoạt động' : 'Ngừng hoạt động'}</span></td></tr>; })}</tbody></table></div> : <p className="empty-state">Chưa có chi nhánh trong phạm vi quyền được cấp.</p>}
        </section>
      </section><footer className="account-footer">Finance CRM <span>•</span> Quản trị chi nhánh</footer>
    </main>
    </AppShell>
  );

  if (accessSection === 'roles' && canReadRoles) return (
    <AppShell {...shellProps}>
    <main className="account-layout">
      <header className="account-topbar"><a className="brand" href="/"><span className="brand-mark">F</span> Finance<span>CRM</span></a><button className="logout-button" type="button" onClick={() => setAccessSection(null)}>← Hồ sơ của tôi</button></header>
      <section className="account-content access-content">
        <p className="eyebrow">RBAC · VAI TRÒ VÀ PHẠM VI</p><h1>Vai trò & phân quyền</h1><p className="form-intro">Nhóm quyền theo chức năng và phạm vi dữ liệu. Backend xác thực từng thao tác và giới hạn quyền được ủy quyền.</p>
        <nav className="access-tabs" aria-label="Quản trị truy cập">
          {canReadUsers && <button type="button" onClick={() => void openAccessSection('users')}>Người dùng</button>}
          {canReadBranches && <button type="button" onClick={() => void openAccessSection('branches')}>Chi nhánh</button>}
          {canReadRoles && <button type="button" className="is-current" aria-current="page">Vai trò & quyền</button>}
        </nav>
        {error && <div className="alert alert-error" role="alert">{error}</div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}
        {canManageRoles && <details className="create-user-card"><summary><strong>＋ Tạo vai trò tùy chỉnh</strong><span className="muted-value">Mã bắt đầu bằng CUSTOM_</span></summary>
          <form className="user-create-form" onSubmit={onCreateRole}>
            <label htmlFor="role-key">Mã vai trò</label><input id="role-key" value={newRoleKey} onChange={(event) => setNewRoleKey(event.target.value.toUpperCase())} pattern="CUSTOM_[A-Z0-9_]{2,70}" maxLength={77} required />
            <label htmlFor="role-name">Tên vai trò</label><input id="role-name" value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} minLength={2} maxLength={120} required />
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo vai trò'}<span aria-hidden="true">→</span></button>
          </form>
        </details>}
        <section className="role-editor-card">
          <div className="role-editor-heading"><div><label htmlFor="role-select">Chọn vai trò</label><select id="role-select" value={selectedRoleKey} onChange={(event) => selectRole(event.target.value)}>{roles.map((role) => <option value={role.key} key={role.key}>{displayRoleName(role)} · {role.key}{role.isSystem ? ' · Hệ thống' : ''}</option>)}</select></div><span className="role-count">{selectedRole?.permissions.length ?? 0} mục quyền đã cấp</span></div>
          {selectedRole?.key === 'OPERATOR' && <p className="system-lock">Vai trò OPERATOR được bảo vệ, không chỉnh sửa quyền tại đây.</p>}
          {canReadPermissions && permissionCatalog.length > 0 ? <div className="table-scroll permission-matrix-wrap"><table className="permission-matrix"><thead><tr><th>Chức năng</th>{permissionScopes.map((scope) => <th key={scope.key}>{scope.label}</th>)}</tr></thead><tbody>{[...new Set(permissionCatalog.map((permission) => permission.groupKey))].map((group) => <Fragment key={group}><tr className="permission-group-row"><th colSpan={permissionScopes.length + 1}>{permissionGroupLabels[group] ?? 'Nhóm chức năng khác'}</th></tr>{permissionCatalog.filter((permission) => permission.groupKey === group).map((permission) => <tr key={permission.key}><td><strong>{permission.key}</strong><small className="permission-description-en">{permissionDescriptionEnglish(permission)}</small><small className="permission-description-vi">{permissionDescriptionVietnamese(permission)}</small></td>{permissionScopes.map((scope) => <td key={scope.key}><label className="scope-checkbox" aria-label={`${permission.key}: ${permissionDescriptionVietnamese(permission)}; ${scope.label}`}><input type="checkbox" checked={rolePermissionDraft.some((grant) => grant.permissionKey === permission.key && grant.scope === scope.key)} disabled={!canManageRoles || selectedRole?.key === 'OPERATOR'} onChange={(event) => setRoleScope(permission.key, scope.key, event.target.checked)} /><span /></label></td>)}</tr>)}</Fragment>)}</tbody></table></div> : <p className="empty-state">Bạn cần quyền permissions.read để xem ma trận quyền.</p>}
          {selectedRole && canManageRoles && selectedRole.key !== 'OPERATOR' && <div className="role-save-row"><p>Quyền phạm vi chi nhánh yêu cầu gán vai trò cho một chi nhánh cụ thể.</p><button className="primary-button" type="button" onClick={() => void onSaveRolePermissions()} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu ma trận quyền'}<span aria-hidden="true">→</span></button></div>}
        </section>
      </section><footer className="account-footer">Finance CRM <span>•</span> Quản lý RBAC</footer>
    </main>
    </AppShell>
  );

  if (accessSection === 'users' && canReadUsers) return (
    <AppShell {...shellProps}>
    <main className="account-layout">
      <header className="account-topbar"><a className="brand" href="/"><span className="brand-mark">F</span> Finance<span>CRM</span></a><button className="logout-button" type="button" onClick={() => setAccessSection(null)}>← Hồ sơ của tôi</button></header>
      <section className="account-content">
        <p className="eyebrow">QUẢN TRỊ TRUY CẬP</p><h1>Tài khoản nhân viên</h1><p className="form-intro">Tạo tài khoản, xem vai trò và quản lý trạng thái trong phạm vi được phân quyền.</p>
        <nav className="access-tabs" aria-label="Quản trị truy cập">
          {canReadUsers && <button type="button" className="is-current" aria-current="page">Người dùng</button>}
          {canReadBranches && <button type="button" onClick={() => void openAccessSection('branches')}>Chi nhánh</button>}
          {canReadRoles && <button type="button" onClick={() => void openAccessSection('roles')}>Vai trò & quyền</button>}
        </nav>
        {error && <div className="alert alert-error" role="alert">{error}</div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}
        {canManageUsers && canManageRoles && <details className="create-user-card"><summary><strong>＋ Tạo tài khoản nhân viên</strong><span className="muted-value">Mật khẩu tạm tối thiểu 12 ký tự</span></summary>
          <form className="user-create-form" onSubmit={onCreateUser}>
            <label htmlFor="new-display-name">Họ tên hiển thị</label><input id="new-display-name" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} minLength={2} maxLength={160} required />
            <label htmlFor="new-username">Tên đăng nhập</label><input id="new-username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} pattern="[A-Za-z0-9._-]{3,120}" required />
            <label htmlFor="temporary-password">Mật khẩu tạm thời</label><input id="temporary-password" type="password" autoComplete="new-password" value={temporaryPassword} onChange={(e) => setTemporaryPassword(e.target.value)} minLength={12} maxLength={256} required />
            <label htmlFor="new-role">Vai trò</label><select id="new-role" value={newRole} onChange={(e) => setNewRole(e.target.value)} required>{roles.map((role) => <option value={role.key} key={role.key}>{displayRoleName(role)} ({role.key})</option>)}</select>
            <label htmlFor="new-branch">Chi nhánh</label><select id="new-branch" value={newBranch} onChange={(e) => setNewBranch(e.target.value)}><option value="">Toàn hệ thống (nếu được phân quyền)</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name} · {branch.code}</option>)}</select>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo tài khoản'}<span aria-hidden="true">→</span></button>
          </form>
        </details>}
        <section className="users-table-card" aria-label="Danh sách nhân viên">
          <div className="users-table-heading"><strong>Danh sách nhân viên</strong><span>{managedUsers.length} tài khoản</span></div>
          {managedUsers.length ? <div className="table-scroll"><table><thead><tr><th>Nhân viên</th><th>Vai trò</th><th>Chi nhánh</th><th>Trạng thái</th>{canManageUsers && <th>Thao tác</th>}</tr></thead><tbody>{managedUsers.map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><small>@{user.username}</small></td><td>{user.roleGrants.map((grant) => <span className="grant-entry" key={grant.id}><span className="table-chip">{displayRoleName(grant.role)}</span>{canManageRoles && <button className="grant-revoke" type="button" title={`Thu hồi vai trò ${displayRoleName(grant.role)}`} disabled={busy} onClick={() => void revokeRole(grant.id)}>×</button>}</span>)}{canManageUsers && canManageRoles && <details className="inline-role"><summary>Cấp thêm vai trò</summary><form onSubmit={(event) => void onAssignRole(event, user.id)}><select name="roleKey" required defaultValue=""><option value="" disabled>Chọn vai trò</option>{roles.map((role) => <option value={role.key} key={role.key}>{displayRoleName(role)}</option>)}</select><select name="branchId" defaultValue=""><option value="">Toàn hệ thống</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select><button type="submit" disabled={busy}>Cấp</button></form></details>}</td><td>{user.roleGrants.map((grant) => grant.branch?.name ?? 'Toàn hệ thống').join(', ') || '—'}</td><td><span className={`user-status ${user.status === 'ACTIVE' ? 'is-active' : 'is-disabled'}`}>{user.status === 'ACTIVE' ? 'Hoạt động' : 'Vô hiệu hóa'}</span></td>{canManageUsers && <td><button className="table-action" type="button" disabled={busy} onClick={() => void toggleUser(user)}>{user.status === 'ACTIVE' ? 'Vô hiệu hóa' : 'Kích hoạt'}</button></td>}</tr>)}</tbody></table></div> : <p className="empty-state">Không tìm thấy tài khoản trong phạm vi quyền được cấp.</p>}
        </section>
        <p className="account-caption">Mọi thao tác tạo, kích hoạt hoặc vô hiệu hóa tài khoản đều được ghi nhận audit ở backend.</p>
      </section>
      <footer className="account-footer">Finance CRM <span>•</span> Quản lý tài khoản</footer>
    </main>
    </AppShell>
  );

  return (
    <AppShell {...shellProps}>
    <main className="account-layout">
      <header className="account-topbar"><a className="brand" href="/"><span className="brand-mark">F</span> Finance<span>CRM</span></a><button className="logout-button" type="button" onClick={onLogout} disabled={busy}>Đăng xuất <span aria-hidden="true">↗</span></button></header>
      <section className="account-content">
        <p className="eyebrow">TÀI KHOẢN NHÂN VIÊN</p><h1>Thông tin tài khoản</h1><p className="form-intro">Hồ sơ và phạm vi quyền đang áp dụng cho phiên làm việc này.</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="profile-card">
          <div className="profile-heading"><div className="avatar" aria-hidden="true">{(staff?.displayName || staff?.username || 'N').slice(0, 1).toUpperCase()}</div><div><span className="status-pill"><span /> Tài khoản hoạt động</span><h2>{staff?.displayName ?? 'Nhân viên'}</h2><p>@{staff?.username ?? '—'}</p></div></div>
          <div className="profile-details"><div><span className="detail-label">Vai trò</span><div className="chip-row">{(staff?.roles ?? []).map((role, index) => <span className="role-chip" key={`${role.key}-${index}`}>{roleLabel(role.key)}</span>)}</div></div>
            <div><span className="detail-label">Chi nhánh được cấp quyền</span><div className="chip-row">{hasGlobalDataScope(staff) ? <span className="branch-chip">Toàn hệ thống</span> : branchScopes(staff).length ? branchScopes(staff).map(([id, name]) => <span className="branch-chip" key={id}>{name}</span>) : <span className="muted-value">Chưa có phạm vi chi nhánh</span>}</div></div>
          </div>
        </div>
        <details className="permissions-card"><summary><span><strong>Quyền truy cập</strong><small>{staff?.permissions?.length ?? 0} quyền hiệu lực trong phiên</small></span><span className="chevron" aria-hidden="true">⌄</span></summary>
          {staff?.permissions?.length ? <ul className="permission-list">{staff.permissions.map((permission) => <li key={permission.key}><span className="permission-check">✓</span><span>{permission.key} <small className="permission-scope">{permission.scopes.join(', ')}</small></span></li>)}</ul> : <p className="muted-value">Chưa có quyền nào được cấp.</p>}
        </details>
        <section className="security-card"><div><span className="security-icon">⌑</span><div><strong>Bảo mật tài khoản</strong><p>Đổi mật khẩu định kỳ để bảo vệ tài khoản của bạn.</p></div></div><button className="secondary-button" onClick={() => { setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setSession((current) => current ? { ...current, passwordChangeRequired: true } : current); }}>Đổi mật khẩu</button></section>
        {(canReadUsers || canManageUsers) && <section className="security-card"><div><span className="security-icon">♙</span><div><strong>Người dùng</strong><p>Tạo tài khoản, phân vai trò và kiểm soát trạng thái theo phạm vi được cấp.</p></div></div><button className="secondary-button" onClick={() => void openAccessSection('users')} disabled={busy}>Mở danh sách</button></section>}
        {canReadBranches && <section className="security-card"><div><span className="security-icon">⌂</span><div><strong>Chi nhánh</strong><p>Xem cấu trúc chi nhánh tổng và chi nhánh con.</p></div></div><button className="secondary-button" onClick={() => void openAccessSection('branches')} disabled={busy}>Mở chi nhánh</button></section>}
        {canReadRoles && <section className="security-card"><div><span className="security-icon">▦</span><div><strong>Vai trò & phân quyền</strong><p>Quản lý nhóm quyền chức năng và phạm vi dữ liệu RBAC.</p></div></div><button className="secondary-button" onClick={() => void openAccessSection('roles')} disabled={busy}>Mở ma trận</button></section>}
        <p className="account-caption">Đăng nhập được bảo vệ bằng phiên có thời hạn. Khi hết hạn, hệ thống sẽ yêu cầu xác thực lại.</p>
      </section>
      <footer className="account-footer">Finance CRM <span>•</span> Khu vực làm việc nội bộ</footer>
    </main>
    </AppShell>
  );
}
