import type { Staff } from '@/components/crm-session';

export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  status: string;
  createdAt: string;
  roleGrants: {
    id: string;
    role: { key: string; name: string };
    branch: { id: string; code: string; name: string } | null;
  }[];
};

export type AccessScope = 'OWN' | 'ASSIGNED' | 'BRANCH' | 'ALL';
export type RolePermission = { permissionKey: string; scope: AccessScope };
export type RolePermissionRecord = RolePermission & { roleId: string };
export type RoleOption = {
  key: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  permissions: RolePermissionRecord[];
};
export type PermissionOption = { key: string; groupKey: string; description: string };
export type BranchOption = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  status: string;
  managerUserId: string | null;
  manager: { id: string; displayName: string; username: string; status: string } | null;
  createdAt: string;
};

export const permissionScopes = [
  { key: 'OWN', label: 'Của tôi' },
  { key: 'ASSIGNED', label: 'Được giao' },
  { key: 'BRANCH', label: 'Chi nhánh' },
  { key: 'ALL', label: 'Toàn hệ thống' },
] as const satisfies readonly { key: AccessScope; label: string }[];

export function toRolePermissionInput(permissions: readonly RolePermissionRecord[]): RolePermission[] {
  return permissions.map(({ permissionKey, scope }) => ({ permissionKey, scope }));
}

export const permissionGroupLabels: Record<string, string> = {
  'access-control': 'Quản trị truy cập',
  advising: 'Tư vấn',
  audit: 'Nhật ký hoạt động',
  customers: 'Khách hàng',
  identity: 'Tài khoản & danh tính',
  loans: 'Khoản vay',
  organization: 'Tổ chức',
  plans: 'Kế hoạch',
  reports: 'Báo cáo',
};

const roleLabels: Record<string, string> = {
  OPERATOR: 'Vận hành hệ thống',
  ADMIN: 'Quản trị viên',
  MANAGE: 'Quản lý',
  ADVISING: 'Tư vấn viên',
  CUSTOMER: 'Khách hàng',
};

export function displayRoleName(role: { key: string; name: string }) {
  return roleLabels[role.key] ?? role.name;
}

export function hasGlobalDataScope(staff: Staff | null) {
  const catalogPermissions = new Set(['permissions.read', 'permissions.delegate', 'roles.read', 'roles.manage']);
  return Boolean(staff?.permissions.some((permission) =>
    permission.scopes.includes('ALL') && !catalogPermissions.has(permission.key),
  ));
}

export function branchScopes(staff: Staff | null) {
  const branches = new Map<string, string>();
  for (const role of staff?.roles ?? []) {
    if (role.scope.branch) branches.set(role.scope.branch.id, role.scope.branch.name);
  }
  return [...branches.entries()];
}

const vietnamesePermissionDescriptions: Record<string, string> = {
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
  'plans.manage': 'Tạo kế hoạch và chỉ tiêu trong phạm vi được cấp.',
  'plans.read': 'Xem kế hoạch trong phạm vi được cấp.',
  'reports.read': 'Xem báo cáo trong phạm vi được cấp.',
  'roles.manage': 'Tạo vai trò tùy chỉnh và cấp vai trò trong giới hạn được ủy quyền.',
  'roles.read': 'Xem vai trò và danh mục quyền.',
  'users.manage': 'Tạo, vô hiệu hóa và quản lý người dùng trong phạm vi được cấp.',
  'users.read': 'Xem người dùng trong phạm vi được cấp.',
};

export function permissionDescriptionEnglish(permission: PermissionOption) {
  return permission.description.split(' | ', 1)[0];
}

export function permissionDescriptionVietnamese(permission: PermissionOption) {
  return permission.description.split(' | ')[1]
    ?? vietnamesePermissionDescriptions[permission.key]
    ?? 'Chưa có mô tả tiếng Việt cho quyền này.';
}
