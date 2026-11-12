'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useCrmSession } from '@/components/crm-session';

type Section = 'customers' | 'users' | 'branches' | 'roles' | 'plans' | 'tasks' | null;
const sectionPaths: Record<Exclude<Section, null>, string> = {
  customers: '/customers',
  users: '/staff',
  branches: '/branches',
  roles: '/roles',
  plans: '/plans',
  tasks: '/tasks',
};

export function WorkspaceLayout({
  activeSection,
  requiredPermission,
  children,
}: {
  activeSection: Section;
  requiredPermission?: string | string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const { session, staff, loading, busy, can, logout, setError, setNotice } = useCrmSession();
  const allowed = !requiredPermission || (
    Array.isArray(requiredPermission)
      ? requiredPermission.some((permission) => can(permission))
      : can(requiredPermission)
  );

  useEffect(() => {
    if (loading || !session || !staff || allowed) return;
    router.replace('/profile');
  }, [allowed, loading, router, session, staff]);

  if (loading || !session || !staff || !allowed) {
    return (
      <main className="loading-screen">
        <span className="spinner" aria-hidden="true" />
        <p>{loading ? 'Đang khôi phục phiên làm việc…' : 'Đang kiểm tra quyền truy cập…'}</p>
      </main>
    );
  }

  return (
    <AppShell
      activeSection={activeSection}
      displayName={staff.displayName}
      username={staff.username}
      canReadUsers={can('users.read') || can('users.manage')}
      canReadBranches={can('branches.read')}
      canReadRoles={can('roles.read')}
      canReadCustomers={can('customers.read')}
      canAccessPlans={can('plans.read') || can('plans.manage')}
      canReadTasks={can('tasks.read')}
      busy={busy}
      onNavigate={(section) => {
        setError('');
        setNotice('');
        router.push(section ? sectionPaths[section] : '/profile');
      }}
      onLogout={() => { void logout(); }}
    >
      {children}
    </AppShell>
  );
}
