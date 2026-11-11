'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Building2,
  ChartNoAxesColumn,
  CheckSquare,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type AccessSection = 'customers' | 'users' | 'branches' | 'roles' | 'plans' | null;
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
  canAccessPlans: boolean;
  busy: boolean;
  contractCompletionOtp?: CapabilityNotice;
  onNavigate: (section: AccessSection) => void;
  onLogout: () => void;
};

type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  section?: AccessSection;
  disabled?: boolean;
};

const SIDEBAR_STORAGE_KEY = 'finance-crm.sidebar-expanded';

function initials(displayName: string) {
  return displayName.trim().slice(0, 1).toLocaleUpperCase('vi-VN') || 'N';
}

export function AppShell({
  children,
  activeSection,
  displayName,
  username,
  canReadUsers,
  canReadBranches,
  canReadRoles,
  canReadCustomers,
  canAccessPlans,
  busy,
  onNavigate,
  onLogout,
}: ShellProps) {
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored !== null) setExpanded(stored === 'true');
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  function navigate(section: AccessSection) {
    onNavigate(section);
    setMobileOpen(false);
  }

  const groups: { label: string; items: NavItem[] }[] = [
    { label: 'Tổng quan', items: [{ key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, disabled: true }] },
    {
      label: 'Khách hàng & tư vấn',
      items: [
        ...(canReadCustomers ? [{ key: 'customers', label: 'Khách hàng', icon: UsersRound, section: 'customers' as const }] : []),
        { key: 'chat', label: 'Hội thoại', icon: MessageSquare, disabled: true },
      ],
    },
    {
      label: 'Công việc & KPI',
      items: [
        { key: 'tasks', label: 'Công việc', icon: CheckSquare, disabled: true },
        ...(canAccessPlans ? [{ key: 'plans', label: 'Kế hoạch', icon: ChartNoAxesColumn, section: 'plans' as const }] : []),
      ],
    },
    {
      label: 'Quản trị hệ thống',
      items: [
        ...(canReadUsers ? [{ key: 'users', label: 'Nhân viên', icon: UsersRound, section: 'users' as const }] : []),
        ...(canReadBranches ? [{ key: 'branches', label: 'Chi nhánh', icon: Building2, section: 'branches' as const }] : []),
        ...(canReadRoles ? [{ key: 'roles', label: 'Vai trò & quyền', icon: ShieldCheck, section: 'roles' as const }] : []),
      ],
    },
    { label: 'Tài khoản', items: [{ key: 'profile', label: 'Hồ sơ của tôi', icon: UserRound, section: null }] },
  ];

  const currentLabel = activeSection === 'customers'
    ? 'Khách hàng'
    : activeSection === 'users'
      ? 'Nhân viên'
      : activeSection === 'branches'
        ? 'Chi nhánh'
        : activeSection === 'roles'
          ? 'Vai trò & quyền'
          : activeSection === 'plans'
            ? 'Kế hoạch'
          : 'Tài khoản của tôi';

  function renderSidebar(mobile = false) {
    return (
      <aside
        className={cn('crm-sidebar', expanded && 'is-expanded', mobile && 'is-mobile')}
        aria-label="Điều hướng chính"
      >
        <div className="crm-sidebar-brand">
          <span className="crm-brand-mark" aria-hidden="true">F</span>
          <span className="crm-brand-name">Finance CRM</span>
          {!mobile && (
            <Button
              className="crm-sidebar-toggle"
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={expanded ? 'Thu gọn thanh điều hướng' : 'Mở rộng thanh điều hướng'}
              aria-pressed={expanded}
              onClick={toggleExpanded}
            >
              {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
          )}
          {mobile && (
            <Button
              className="crm-sidebar-toggle"
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label="Đóng menu điều hướng"
              onClick={() => setMobileOpen(false)}
            >
              <X />
            </Button>
          )}
        </div>
        <nav className="crm-nav">
          {groups.map((group) => group.items.length > 0 && (
            <div className="crm-nav-group" key={group.label}>
              <p className="crm-nav-heading">{group.label}</p>
              {group.items.map((item) => {
                const isActive = item.section === null
                  ? activeSection === null
                  : item.section !== undefined
                    ? activeSection === item.section
                    : false;
                const itemClass = cn(
                  'crm-nav-item',
                  isActive && 'is-active',
                  item.disabled && 'is-unavailable',
                );
                const Icon = item.icon;
                if (item.disabled) {
                  return (
                    <div className={itemClass} key={item.key} title={`${item.label} · Chưa triển khai`} aria-disabled="true">
                      <Icon aria-hidden="true" />
                      <span className="crm-nav-label">{item.label}</span>
                      <span className="crm-coming-soon">Sau</span>
                    </div>
                  );
                }
                return (
                  <Button
                    className={itemClass}
                    key={item.key}
                    variant="ghost"
                    type="button"
                    title={item.label}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => navigate(item.section ?? null)}
                  >
                    <Icon aria-hidden="true" />
                    <span className="crm-nav-label">{item.label}</span>
                  </Button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="crm-sidebar-user">
          <span className="crm-avatar" aria-hidden="true">{initials(displayName)}</span>
          <span className="crm-user-copy">
            <strong>{displayName}</strong>
            <small>@{username}</small>
          </span>
        </div>
      </aside>
    );
  }

  return (
    <div className={cn('crm-workspace', expanded && 'is-expanded')}>
      <div className="crm-desktop-sidebar">{renderSidebar()}</div>
      {mobileOpen && (
        <>
          <button
            className="crm-drawer-backdrop"
            type="button"
            aria-label="Đóng menu điều hướng"
            onClick={() => setMobileOpen(false)}
          />
          <div className="crm-mobile-sidebar">{renderSidebar(true)}</div>
        </>
      )}
      <div className="crm-workspace-main">
        <header className="crm-topbar">
          <Button
            className="crm-menu-toggle"
            variant="ghost"
            size="icon"
            type="button"
            aria-label={mobileOpen ? 'Đóng điều hướng' : expanded ? 'Thu gọn thanh điều hướng' : 'Mở rộng thanh điều hướng'}
            aria-expanded={mobileOpen || expanded}
            onClick={() => {
              if (window.matchMedia('(max-width: 760px)').matches) setMobileOpen(true);
              else toggleExpanded();
            }}
          >
            <Menu aria-hidden="true" />
          </Button>
          <div className="crm-breadcrumb" aria-label="Vị trí hiện tại">
            <span>Finance CRM</span>
            <ChevronRight aria-hidden="true" />
            <strong>{currentLabel}</strong>
          </div>
          <div className="crm-topbar-actions">
            <span className="crm-topbar-user">
              <span className="crm-avatar small" aria-hidden="true">{initials(displayName)}</span>
              <span>{displayName}</span>
            </span>
            <Button className="crm-logout" variant="outline" type="button" onClick={onLogout} disabled={busy}>
              <LogOut aria-hidden="true" />
              <span>Đăng xuất</span>
            </Button>
          </div>
        </header>
        <main className="crm-page-content">{children}</main>
      </div>
    </div>
  );
}
