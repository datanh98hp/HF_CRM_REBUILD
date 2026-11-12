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
  PLAN_NOT_FOUND: 'Không tìm thấy kế hoạch.',
  PLAN_REFERENCE_NOT_FOUND: 'Chi nhánh không còn khả dụng.',
  TASK_PLAN_NOT_ACTIVE: 'Kế hoạch chưa được kích hoạt.',
  TASK_METRIC_NOT_IN_PLAN: 'Chỉ tiêu không thuộc kế hoạch đã chọn.',
  TASK_BRANCH_NOT_IN_PLAN: 'Chi nhánh không thuộc kế hoạch đã chọn.',
  TASK_BRANCH_INACTIVE: 'Chi nhánh đã ngừng hoạt động.',
  TASK_ASSIGNEE_NOT_FOUND: 'Không tìm thấy người nhận đang hoạt động.',
  TASK_NOT_FOUND: 'Không tìm thấy công việc.',
  TASK_DUE_DATE_OUTSIDE_PLAN_PERIOD: 'Hạn chót phải nằm trong kỳ của kế hoạch.',
  TASK_RESULT_OUTSIDE_PLAN_PERIOD: 'Ngày thực hiện phải nằm trong kỳ của kế hoạch.',
  TASK_RESULT_UNIT_MISMATCH: 'Đơn vị kết quả không khớp với chỉ tiêu.',
  TASK_EVIDENCE_FILE_UNAVAILABLE: 'Tệp minh chứng không sẵn sàng, đã hết hạn hoặc không thuộc phạm vi của công việc.',
  TASK_ALREADY_COMPLETED: 'Công việc đã hoàn thành và không thể nộp thêm kết quả.',
  TASK_RESULT_AWAITING_VERIFICATION: 'Kết quả đang chờ xác minh; chưa thể nộp revision tiếp theo.',
  TASK_RESULT_CONCURRENT_SUBMISSION: 'Có kết quả mới vừa được nộp. Hãy tải lại công việc trước khi tiếp tục.',
  TASK_RESULT_NOT_FOUND: 'Không tìm thấy kết quả cần xác minh.',
  TASK_VERIFICATION_DECISION_REQUIRED: 'Hãy chọn một quyết định xác minh hợp lệ.',
  TASK_VERIFICATION_REASON_REQUIRED: 'Cần nhập lý do cho quyết định này.',
  TASK_RESULT_NOT_LATEST: 'Chỉ có thể xác minh revision mới nhất.',
  TASK_RESULT_ALREADY_REVIEWED: 'Revision này đã được xác minh.',
  TASK_RESULT_SELF_VERIFICATION: 'Bạn không thể tự xác minh kết quả do mình nộp.',
  KPI_REQUIRES_FULL_PLAN_BRANCH_SCOPE: 'Cần quyền xem KPI trên toàn bộ chi nhánh của kế hoạch.',
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
