'use client';

import { useRouter } from 'next/navigation';
import { useCrmSession } from '@/components/crm-session';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { branchScopes, displayRoleName, hasGlobalDataScope } from '@/lib/crm-access';

export function ProfilePage() {
  const router = useRouter();
  const { staff, can, error, busy, logout } = useCrmSession();
  if (!staff) return <main className="loading-screen"><span className="spinner" aria-hidden="true" /><p>Đang tải hồ sơ…</p></main>;
  const globalScope = hasGlobalDataScope(staff);
  const branches = branchScopes(staff);
  const canReadUsers = can('users.read') || can('users.manage');

  return (
    <WorkspaceLayout activeSection={null}>
      <main className="account-layout">
        <header className="account-topbar">
          <div className="brand"><span className="brand-mark">F</span> Finance<span>CRM</span></div>
          <button className="logout-button" type="button" onClick={() => { void logout(); }} disabled={busy}>Đăng xuất</button>
        </header>
        <section className="account-content">
          <p className="eyebrow">TÀI KHOẢN NHÂN VIÊN</p>
          <h1>Thông tin tài khoản</h1>
          <p className="form-intro">Hồ sơ và phạm vi quyền đang áp dụng cho phiên làm việc này.</p>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="profile-card">
            <div className="profile-heading">
              <div className="avatar" aria-hidden="true">{(staff.displayName || staff.username || 'N').slice(0, 1).toUpperCase()}</div>
              <div>
                <span className="status-pill"><span /> Tài khoản hoạt động</span>
                <h2>{staff.displayName}</h2>
                <p>@{staff.username}</p>
              </div>
            </div>
            <div className="profile-details">
              <div>
                <span className="detail-label">Vai trò</span>
                <div className="chip-row">
                  {staff.roles.map((role, index) => (
                    <span className="role-chip" key={`${role.key}-${index}`}>{displayRoleName(role)}</span>
                  ))}
                </div>
              </div>
              <div>
                <span className="detail-label">Chi nhánh được cấp quyền</span>
                <div className="chip-row">
                  {globalScope
                    ? <span className="branch-chip">Toàn hệ thống</span>
                    : branches.length
                      ? branches.map(([id, name]) => <span className="branch-chip" key={id}>{name}</span>)
                      : <span className="muted-value">Chưa có phạm vi chi nhánh</span>}
                </div>
              </div>
            </div>
          </div>
          <details className="permissions-card">
            <summary>
              <span><strong>Quyền truy cập</strong><small>{staff.permissions.length} quyền hiệu lực trong phiên</small></span>
              <span className="chevron" aria-hidden="true">⌄</span>
            </summary>
            {staff.permissions.length
              ? <ul className="permission-list">{staff.permissions.map((permission) => (
                <li key={permission.key}>
                  <span className="permission-check">✓</span>
                  <span>{permission.key} <small className="permission-scope">{permission.scopes.join(', ')}</small></span>
                </li>
              ))}</ul>
              : <p className="muted-value">Chưa có quyền nào được cấp.</p>}
          </details>
          <section className="security-card">
            <div><span className="security-icon">⌑</span><div><strong>Bảo mật tài khoản</strong><p>Đổi mật khẩu định kỳ để bảo vệ tài khoản của bạn.</p></div></div>
            <button className="secondary-button" onClick={() => router.push('/change-password')}>Đổi mật khẩu</button>
          </section>
          {canReadUsers && (
            <section className="security-card">
              <div><span className="security-icon">♙</span><div><strong>Người dùng</strong><p>Tạo tài khoản, phân vai trò và kiểm soát trạng thái theo phạm vi được cấp.</p></div></div>
              <button className="secondary-button" onClick={() => router.push('/staff')}>Mở danh sách</button>
            </section>
          )}
          {can('branches.read') && (
            <section className="security-card">
              <div><span className="security-icon">⌂</span><div><strong>Chi nhánh</strong><p>Xem cấu trúc chi nhánh tổng và chi nhánh con.</p></div></div>
              <button className="secondary-button" onClick={() => router.push('/branches')}>Mở chi nhánh</button>
            </section>
          )}
          {can('roles.read') && (
            <section className="security-card">
              <div><span className="security-icon">▦</span><div><strong>Vai trò & phân quyền</strong><p>Quản lý nhóm quyền chức năng và phạm vi dữ liệu RBAC.</p></div></div>
              <button className="secondary-button" onClick={() => router.push('/roles')}>Mở ma trận</button>
            </section>
          )}
          <p className="account-caption">Đăng nhập được bảo vệ bằng phiên có thời hạn. Khi hết hạn, hệ thống sẽ yêu cầu xác thực lại.</p>
        </section>
        <footer className="account-footer">Finance CRM <span>•</span> Khu vực làm việc nội bộ</footer>
      </main>
    </WorkspaceLayout>
  );
}
