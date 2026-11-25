'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useCrmSession } from '@/components/crm-session';

type Section = 'customers' | 'customer-import' | 'products' | 'contracts' | 'users' | 'branches' | 'roles' | 'plans' | 'catalog' | 'tasks' | 'report-customers' | 'report-plans' | 'report-summary' | 'report-loans' | null;
const sectionPaths: Record<Exclude<Section, null>, string> = {
  customers: '/customers',
  'customer-import': '/customers/import',
  products: '/loan-products',
  contracts: '/loan-contracts',
  users: '/staff',
  branches: '/branches',
  roles: '/roles',
  plans: '/plans',
  catalog: '/plans/catalog',
  tasks: '/tasks',
  'report-customers': '/reports/customers',
  'report-plans': '/reports/plans',
  'report-summary': '/reports/summary',
  'report-loans': '/reports/loans',
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
      canImportCustomers={can('customers.import')}
      canAccessPlans={can('plans.read') || can('plans.manage')}
      canReadPlanCatalog={can('plans.read')}
      canReadTasks={can('tasks.read')}
      canAccessProducts={can('loan-products.read') || can('loan-products.manage')}
      canAccessContracts={can('loan-contracts.read')}
      canReadReports={can('reports.read')}
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
