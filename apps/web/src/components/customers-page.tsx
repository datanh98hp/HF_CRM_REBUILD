'use client';

import { CustomerWorkspace } from '@/components/customer-workspace';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { request } from '@/lib/crm-api';
import { useCrmSession } from '@/components/crm-session';

export function CustomersPage() {
  const { session, can, capabilities } = useCrmSession();
  if (!session) return <main className="loading-screen"><span className="spinner" aria-hidden="true" /><p>Đang tải dữ liệu khách hàng…</p></main>;

  return (
    <WorkspaceLayout activeSection="customers" requiredPermission="customers.read">
      <CustomerWorkspace
        accessToken={session.accessToken}
        request={request}
        canManageCustomers={can('customers.manage')}
        canAssignCustomers={can('customers.assign')}
        canReviewDuplicates={can('customers.duplicates.review')}
        canReadUsers={can('users.read')}
        canReadBranches={can('branches.read')}
        canManageRequests={can('loan-requests.manage')}
        canManageContracts={can('loan-contracts.manage')}
        canReviewContracts={can('loan-contracts.review')}
        contractCompletionOtp={capabilities?.contractCompletionOtp}
      />
    </WorkspaceLayout>
  );
}
