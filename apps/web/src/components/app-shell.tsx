'use client';

import { useEffect, useState, type ReactNode } from 'react';

type AccessSection = 'customers' | 'users' | 'branches' | 'roles' | null;
type CapabilityNotice = { status: string; ready: boolean; messageVi: string };
type ShellProps = {
  children: ReactNode;
  activeSection: AccessSection;
  displayName: string;
  username: string;
  canReadUsers: boolean;
  canReadBranches: boolean;
  canReadRoles: boolean;
  canReadCustomers: boolean;
  busy: boolean;
  contractCompletionOtp?: CapabilityNotice;
  onNavigate: (section: AccessSection) => void;
  onLogout: () => void;
};

type IconName = 'grid' | 'users' | 'chat' | 'check' | 'chart' | 'branch' | 'shield' | 'user' | 'menu' | 'chevron' | 'logout';
const SIDEBAR_STORAGE_KEY = 'finance-crm.sidebar-expanded';

function Icon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    chat: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></>,
    check: <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/></>,
    branch: <><rect x="3" y="3" width="8" height="6" rx="1"/><rect x="13" y="15" width="8" height="6" rx="1"/><rect x="3" y="15" width="8" height="6" rx="1"/><path d="M7 9v3h10v3"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/></>,
    user: <><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

export function AppShell({ children, activeSection, displayName, username, canReadUsers, canReadBranches, canReadRoles, canReadCustomers, busy, onNavigate, onLogout }: ShellProps) {
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored !== null) setExpanded(stored === 'true');
  }, []);

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  useEffect(() => {
    if (!mobileOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  function navigate(section: AccessSection) {
    onNavigate(section);
    setMobileOpen(false);
  }

  const groups = [
    { label: 'Tổng quan', items: [{ key: 'dashboard', label: 'Dashboard', icon: 'grid' as const, disabled: true }] },
    { label: 'Khách hàng & tư vấn', items: [...(canReadCustomers ? [{ key: 'customers', label: 'Khách hàng', icon: 'users' as const, section: 'customers' as const }] : []), { key: 'chat', label: 'Hội thoại', icon: 'chat' as const, disabled: true }] },
    { label: 'Công việc & KPI', items: [{ key: 'tasks', label: 'Công việc', icon: 'check' as const, disabled: true }, { key: 'reports', label: 'Kế hoạch & KPI', icon: 'chart' as const, disabled: true }] },
    { label: 'Quản trị hệ thống', items: [
      ...(canReadUsers ? [{ key: 'users', label: 'Nhân viên', icon: 'users' as const, section: 'users' as const }] : []),
      ...(canReadBranches ? [{ key: 'branches', label: 'Chi nhánh', icon: 'branch' as const, section: 'branches' as const }] : []),
      ...(canReadRoles ? [{ key: 'roles', label: 'Vai trò & quyền', icon: 'shield' as const, section: 'roles' as const }] : []),
    ] },
    { label: 'Tài khoản', items: [{ key: 'profile', label: 'Hồ sơ của tôi', icon: 'user' as const, section: null }] },
  ];

  const sidebar = (mobile = false) => <aside className={`crm-sidebar${mobile ? ' is-mobile' : ''}${expanded ? ' is-expanded' : ''}`} aria-label="Điều hướng chính">
    <div className="crm-sidebar-brand"><span className="crm-brand-mark">F</span><span className="crm-brand-name">Finance CRM</span><button className="crm-sidebar-toggle" type="button" aria-label={expanded ? 'Thu gọn thanh điều hướng' : 'Mở rộng thanh điều hướng'} aria-pressed={expanded} onClick={toggleExpanded}><Icon name="menu"/></button></div>
    <nav className="crm-nav">
      {groups.map((group) => group.items.length > 0 && <div className="crm-nav-group" key={group.label}>
        <p className="crm-nav-heading">{group.label}</p>
        {group.items.map((item) => {
          const isActive = item.key === 'profile' ? activeSection === null : item.key === 'customers' ? activeSection === 'customers' : item.key === 'users' ? activeSection === 'users' : item.key === 'branches' ? activeSection === 'branches' : item.key === 'roles' ? activeSection === 'roles' : false;
          const itemClass = `crm-nav-item${isActive ? ' is-active' : ''}${'disabled' in item && item.disabled ? ' is-unavailable' : ''}`;
          if ('section' in item && item.section !== undefined) return <button className={itemClass} key={item.key} type="button" title={item.label} aria-current={isActive ? 'page' : undefined} onClick={() => navigate(item.section)}><Icon name={item.icon}/><span className="crm-nav-label">{item.label}</span></button>;
          return <div className={itemClass} key={item.key} title={`${item.label} · Chưa triển khai`} aria-disabled="true"><Icon name={item.icon}/><span className="crm-nav-label">{item.label}</span><span className="crm-coming-soon">Sau</span></div>;
        })}
      </div>)}
    </nav>
    <div className="crm-sidebar-user"><span className="crm-avatar">{displayName.slice(0, 1).toUpperCase()}</span><span className="crm-user-copy"><strong>{displayName}</strong><small>@{username}</small></span></div>
  </aside>;

  const currentLabel = activeSection === 'customers' ? 'Khách hàng' : activeSection === 'users' ? 'Nhân viên' : activeSection === 'branches' ? 'Chi nhánh' : activeSection === 'roles' ? 'Vai trò & quyền' : 'Tài khoản của tôi';

  return <div className="crm-workspace">
    <div className="crm-desktop-sidebar">{sidebar()}</div>
    {mobileOpen && <><button className="crm-drawer-backdrop" aria-label="Đóng menu điều hướng" onClick={() => setMobileOpen(false)} /><div className="crm-mobile-sidebar">{sidebar(true)}</div></>}
    <div className="crm-workspace-main">
      <header className="crm-topbar"><button className="crm-menu-toggle" type="button" aria-label={mobileOpen ? 'Đóng điều hướng' : expanded ? 'Thu gọn thanh điều hướng' : 'Mở rộng thanh điều hướng'} aria-expanded={mobileOpen || expanded} onClick={() => { if (window.matchMedia('(max-width: 760px)').matches) setMobileOpen(true); else toggleExpanded(); }}><Icon name="menu"/></button><div className="crm-breadcrumb"><span>Finance CRM</span><Icon name="chevron"/><strong>{currentLabel}</strong></div><div className="crm-topbar-actions"><span className="crm-topbar-user"><span className="crm-avatar small">{displayName.slice(0, 1).toUpperCase()}</span><span>{displayName}</span></span><button className="crm-logout" type="button" onClick={onLogout} disabled={busy}><Icon name="logout"/><span>Đăng xuất</span></button></div></header>
      <div className="crm-page-content">{children}</div>
    </div>
  </div>;
}
