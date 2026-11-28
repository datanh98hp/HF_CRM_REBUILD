import { WorkspaceLayout } from '@/components/workspace-layout';
import { AuditPage } from '@/components/audit-page';

export default function Page() {
  return <WorkspaceLayout activeSection="audit" requiredPermission="audit.read"><AuditPage /></WorkspaceLayout>;
}
