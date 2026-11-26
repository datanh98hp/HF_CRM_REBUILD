'use client';

import Link from 'next/link';
import { FileSpreadsheet } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { CustomerWorkspace } from '@/components/customer-workspace';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { request } from '@/lib/crm-api';
import { useCrmSession } from '@/components/crm-session';

export function CustomersPage() {
  const { session, staff, can, capabilities } = useCrmSession();
  if (!session) return <main className="loading-screen"><span className="spinner" aria-hidden="true" /><p>Đang tải dữ liệu khách hàng…</p></main>;

  return (
    <WorkspaceLayout activeSection="customers" requiredPermission="customers.read">
      {can('customers.import') && (
        <div className="mb-4 flex justify-end">
          <Link
            href="/customers/import"
            className={buttonVariants({ variant: 'outline', className: 'h-10 min-h-10 w-full rounded-xl px-4 sm:w-auto' })}
          >
            <FileSpreadsheet aria-hidden="true" />
            Nhập khách hàng
          </Link>
        </div>
      )}
      <CustomerWorkspace
        accessToken={session.accessToken}
        request={request}
        canManageCustomers={can('customers.manage')}
        canChangeCustomerBranch={Boolean(staff?.permissions.some((item) => item.key === 'customers.manage' && item.scopes.includes('ALL')))}
        canAssignCustomers={can('customers.assign')}
        canReviewDuplicates={can('customers.duplicates.review')}
        canReadUsers={can('users.read')}
        canReadBranches={can('branches.read')}
        canManageRequests={can('loan-requests.manage')}
        canManageContracts={can('loan-contracts.manage')}
        canReviewContracts={can('loan-contracts.review')}
        canReadLoanProducts={can('loan-products.read') || can('loan-products.manage')}
        contractCompletionOtp={capabilities?.contractCompletionOtp}
      />
    </WorkspaceLayout>
  );
}
