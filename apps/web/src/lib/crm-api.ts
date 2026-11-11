const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

const API_ERROR_MESSAGES: Record<string, string> = {
  MANAGE_ASSIGNMENT_REQUIRES_BRANCH_MANAGER_ENDPOINT: 'Vai trò Quản lý phải được cấp bằng chức năng phân công quản lý tại Chi nhánh.',
  MANAGE_ROLE_REVOCATION_REQUIRES_GLOBAL_ADMIN: 'Chỉ quản trị viên toàn hệ thống mới có thể thu hồi vai trò Quản lý.',
  INELIGIBLE_BRANCH_MANAGER: 'Không thể gán tài khoản khách hàng hoặc vận hành hệ thống làm quản lý chi nhánh.',
  ACTIVE_BRANCH_REQUIRES_ACTIVE_MANAGER: 'Cần gán người quản lý đang hoạt động trước khi kích hoạt chi nhánh.',
  INVALID_PLAN_PERIOD: 'Ngày kết thúc phải sau ngày bắt đầu.',
  DUPLICATE_PLAN_METRIC: 'Tên chỉ tiêu không được trùng lặp.',
  PLAN_BRANCH_INACTIVE: 'Chi nhánh đã ngừng hoạt động; hãy chọn chi nhánh khác.',
  BRANCH_NOT_FOUND: 'Không tìm thấy chi nhánh.',
  PLAN_REFERENCE_NOT_FOUND: 'Chi nhánh không còn khả dụng.',
};

function apiBaseUrl() {
  const configured = new URL(API_BASE_URL);
  if (
    typeof window !== 'undefined'
    && ['localhost', '127.0.0.1'].includes(configured.hostname)
    && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    configured.hostname = window.location.hostname;
  }
  return configured.origin + configured.pathname.replace(/\/$/, '');
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const send = (token?: string) => {
    const headers = new Headers(options.headers);
    if (options.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${apiBaseUrl()}/api/v1${path}`, {
      ...options,
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
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

  const payload = await response.json().catch(() => null) as { code?: string; message?: string | string[] } | null;
  if (!response.ok) {
    const codeMessage = payload?.code ? API_ERROR_MESSAGES[payload.code] : undefined;
    const message = Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message;
    throw new Error(codeMessage || message || (
      response.status === 401
        ? 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
        : 'Không thể xử lý yêu cầu. Vui lòng thử lại.'
    ));
  }
  return payload as T;
}
