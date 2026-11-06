# P0-3 — Kế hoạch, task, xác minh và KPI

**Trạng thái:** Chưa triển khai.

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
