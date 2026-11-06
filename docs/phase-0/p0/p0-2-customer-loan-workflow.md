# P0-2 — Khách hàng, yêu cầu vay, hợp đồng và phân công

**Trạng thái:** Chưa triển khai.

## Mục tiêu

Triển khai CRM customer lifecycle và tách rõ yêu cầu vay khỏi hợp đồng phát sinh.

## Phạm vi

- Hồ sơ customer tối thiểu: họ tên và điện thoại bắt buộc; email/ngày sinh tùy chọn; provenance và verification state.
- Dò trùng chuẩn hóa theo điện thoại/email và họ tên + DOB khi đủ dữ liệu; cảnh báo/review thủ công, không auto-merge.
- Customer status: `NEW`, `CONTACTED`, `QUALIFIED`, `IN_PROGRESS`, `CONVERTED`, `CLOSED`; chuyển linh hoạt với lý do và audit.
- Yêu cầu vay do CUSTOMER gửi hoặc ADVISING ghi nhận theo yêu cầu khách; dùng cho intake/tracking, không hàm ý approval.
- `LoanContract` là record/link riêng, chỉ khi hợp đồng thực sự phát sinh; `CONVERTED` bắt buộc có hợp đồng liên kết.
- Người có quyền chọn customer, gán ADVISING cụ thể, lưu assignment history; một adviser chính tại một thời điểm.
- CUSTOMER chỉ đọc dữ liệu của chính mình; thông tin hợp đồng/gói vay theo allowlist và scope.

## Tiêu chí hoàn tất

- Backend kiểm tra quyền/scope cho list, search, detail, update, assignment và contract lookup.
- Mọi chuyển customer state có actor, from/to, timestamp, reason; không cho `CONVERTED` thiếu contract relation.
- Loan request không tự tạo hợp đồng hoặc quyết định eligibility/approval.
- Cập nhật assignment giữ lịch sử và chịu kiểm tra branch scope.
- Duplicate candidate không tự gộp; thao tác xác nhận/giải quyết được audit.

## Cấu hình còn cần

Quốc gia/định dạng số điện thoại, nguồn và trường hợp đồng/gói vay hiển thị, cấu hình chi nhánh và role grants.
