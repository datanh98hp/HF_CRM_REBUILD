# Kế hoạch triển khai P0

Các file dưới đây chia kế hoạch P0 thành từng giai đoạn triển khai độc lập. Thứ tự phụ thuộc: nền dữ liệu/worker → identity/RBAC → nghiệp vụ khách hàng → KPI → import → chat → UI.

| Giai đoạn | Tên | Phụ thuộc chính | Tài liệu |
|---|---|---|---|
| P0-0 | Nền dữ liệu và worker | — | [Nền dữ liệu và worker](p0-0-data-foundation.md) |
| P0-1 | Tổ chức, auth, RBAC và audit | P0-0 | [Tổ chức, auth, RBAC và audit](p0-1-access-control.md) |
| P0-2 | Khách hàng, yêu cầu vay, hợp đồng và phân công | P0-0, P0-1 | [Khách hàng và nghiệp vụ vay](p0-2-customer-loan-workflow.md) |
| P0-3 | Kế hoạch, task, xác minh và KPI | P0-0, P0-1, P0-2 | [Kế hoạch, task và KPI](p0-3-plans-tasks-kpi.md) |
| P0-4 | Import khách hàng toàn batch | P0-0, P0-1, P0-2 | [Import nền](p0-4-background-import.md) |
| P0-5 | Chat realtime | P0-0, P0-1, P0-2 | [Chat realtime](p0-5-realtime-chat.md) |
| P0-6 | Web nội bộ và mobile web/PWA | API/nghiệp vụ P0 cần thiết; PWA CUSTOMER cần xác thực đã cấu hình | [Web và PWA](p0-6-web-pwa.md) |

P0-0/P0-1 đã có nền mã nguồn. Backend P0-2 đã hoàn thành code và đạt migration/seed/test trên PostgreSQL Docker test. P0-3 đã bắt đầu với API/schema tạo và đọc kế hoạch/chỉ tiêu; task, xác minh và KPI còn lại. P0-6 tiếp tục triển khai từng lát cắt. CI pipeline được loại khỏi phạm vi theo yêu cầu hiện tại. Xem [kế hoạch tổng](../p0-implementation-plan.md), [phạm vi MVP](../mvp-scope.md), [sổ quyết định](../decision-log.md) và [trạng thái code](../implementation-status.md).
