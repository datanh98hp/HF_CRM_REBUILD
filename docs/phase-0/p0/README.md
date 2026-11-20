# Kế hoạch triển khai P0

Các file dưới đây chia kế hoạch P0 thành từng giai đoạn triển khai độc lập. Thứ tự phụ thuộc: nền dữ liệu/worker → identity/RBAC → nghiệp vụ khách hàng → KPI → import → chat → UI.

| Giai đoạn | Tên | Phụ thuộc chính | Tài liệu |
|---|---|---|---|
| P0-0 | Nền dữ liệu và worker | — | [Nền dữ liệu và worker](p0-0-data-foundation.md) |
| P0-1 | Tổ chức, auth, RBAC và audit | P0-0 | [Tổ chức, auth, RBAC và audit](p0-1-access-control.md) |
| P0-2 | Khách hàng, yêu cầu vay, hợp đồng và phân công | P0-0, P0-1 | [Khách hàng và nghiệp vụ vay](p0-2-customer-loan-workflow.md) |
| P0-3 | Kế hoạch, task, xác minh và KPI | P0-0, P0-1, P0-2 | [Kế hoạch, task và KPI](p0-3-plans-tasks-kpi.md) |
| P0-4 | Import khách hàng chạy nền (atomic theo lô dòng hợp lệ) | P0-0, P0-1, P0-2 | [Import nền](p0-4-background-import.md) |
| P0-5 | Chat realtime | P0-0, P0-1, P0-2 | [Chat realtime](p0-5-realtime-chat.md) |
| P0-6 | Web nội bộ và mobile web/PWA | API/nghiệp vụ P0 cần thiết; PWA CUSTOMER cần xác thực đã cấu hình | [Web và PWA](p0-6-web-pwa.md) |

P0-0/P0-1 đã có nền mã nguồn và đã chạy trong stack Compose dev/test. Backend P0-2 đã hoàn thành code và đạt migration/seed/test trên PostgreSQL Docker test. P0-3 có API kế hoạch/task/kết quả/xác minh/KPI, UI `/plans`, `/plans/catalog`, `/tasks` và quan hệ metadata evidence; các migration P0-3 đã áp dụng trên PostgreSQL dev/test. Luồng API/PostgreSQL đạt 19 assertion; responsive `/plans` và `/tasks` đã được probe ở 375px/1440px. Còn mở: kiểm thử UI end-to-end và upload/download binary cho evidence (chưa có endpoint nào tạo `FileAsset`). P0-6 đang triển khai từng lát cắt (13 route staff). P0-5 chưa có code. CI pipeline được loại khỏi phạm vi theo yêu cầu hiện tại. Trạng thái chuẩn: [trạng thái code](../implementation-status.md); bối cảnh: [kế hoạch tổng](../p0-implementation-plan.md), [phạm vi MVP](../mvp-scope.md), [sổ quyết định](../decision-log.md).

P0-4 đã có đủ code: schema/RBAC, local temp storage, ClamAV nội bộ, upload/history/readiness API, parser CSV/XLSX, worker `customer-import.process`, import atomic kèm dò trùng và UI `/customers/import`; pipeline đã được nghiệm thu trên stack test cô lập. Bản mở rộng partial-row có 2 migration (`20261120121200`, `20261120161000`) nhưng chưa được áp dụng/kiểm chứng trên DB test, nên readiness vẫn fail-closed khi schema đích thiếu cột `failureDetailsExpiresAt`; xem [trạng thái import nền](p0-4-background-import.md).
