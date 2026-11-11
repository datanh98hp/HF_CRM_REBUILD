# P0-3 — Kế hoạch, task, xác minh và KPI

**Trạng thái:** Đã triển khai API nền và giao diện liệt kê/tạo kế hoạch nháp theo chi nhánh; task, kết quả, xác minh và tổng hợp KPI còn chờ triển khai.

## Mục tiêu

Theo dõi mục tiêu theo kế hoạch và tổng hợp KPI từ kết quả task đã được xác minh.

## Phạm vi

- Người được cấp quyền tạo plan với hạng mục, đơn vị đo, chỉ tiêu và khoảng thời gian.
- Nhân viên tạo task và chọn plan tương ứng.
- Task result lưu số lượng thực đạt dạng số + unit, narrative riêng và evidence/file relation.
- Verification status: `PENDING_VERIFICATION`, `VERIFIED`, `NEEDS_INFO`, `REJECTED`.
- Lưu người xác minh, timestamp, lý do và lịch sử thay đổi; `NEEDS_INFO` có thể nộp lại review.
- KPI = tổng số thực đạt đã `VERIFIED` từ task thuộc plan, so sánh với chỉ tiêu của plan.

## Tiêu chí hoàn tất

- Không cộng kết quả chưa xác minh, bị từ chối hoặc cần bổ sung vào KPI.
- Task/result phải cùng hạng mục/đơn vị/kỳ phù hợp với plan; backend từ chối unit mismatch.
- Sửa kết quả sau xác minh tạo lịch sử/điều chỉnh có audit, không ghi đè dấu vết.
- Quyền tạo plan, giao task, nộp kết quả, xác minh và xem KPI được kiểm tra theo RBAC/scope.
- Dashboard/report áp dụng cùng scope như dữ liệu nguồn; dùng UTC và hiển thị `Asia/Ho_Chi_Minh`.

## Cấu hình còn cần

Danh mục hạng mục/đơn vị, role được tạo/duyệt plan, kỳ KPI và quy trình sửa/điều chỉnh kết quả sau xác minh.

## Phần đã triển khai

- Prisma model `Plan`/`PlanMetric` và migration `20261111000000_p0_3_plan_foundation`.
- `GET /api/v1/plans` trả kế hoạch theo phạm vi quyền `plans.read` và hỗ trợ branch filter/cursor.
- `POST /api/v1/plans` tạo kế hoạch `DRAFT` cho chi nhánh đang hoạt động, có kỳ UTC và 1–100 chỉ tiêu do người dùng cấu hình trên kế hoạch. Mỗi chỉ tiêu gồm tên, đơn vị và target không âm, độ chính xác tối đa 3 chữ số thập phân.
- Kiểm tra scope `plans.manage`, kỳ bắt đầu-kết thúc, tên chỉ tiêu trùng; tạo kế hoạch/chỉ tiêu và audit trong cùng transaction.
- Permission `plans.read`/`plans.manage` đã thêm vào catalog. Quản trị viên cần cấp các quyền này theo role/scope trước khi endpoint dùng được.
- Unit tests của plans service: 5/5 đạt; Prisma validate/generate, API typecheck/build và web typecheck đạt. Migration chưa được chạy trên PostgreSQL trong lượt này.
- Web có route `/plans` riêng: danh sách theo phạm vi API, panel chi tiết kế hoạch/chỉ tiêu và form tạo kế hoạch nháp; quyền `plans.read`/`plans.manage` được dùng để hiển thị luồng tương ứng. Chưa có thao tác sửa/kích hoạt, task, tiến độ hoặc KPI.

Chưa triển khai trong lát cắt này: chỉnh trạng thái/kế hoạch, gán task, nhập kết quả, luồng yêu cầu bổ sung/xác minh, lịch sử sửa kết quả, file chứng minh và truy vấn KPI. Chỉ tiêu metric hiện được khai báo riêng trên từng kế hoạch; catalog dùng chung vẫn cần chủ nghiệp vụ cung cấp.
