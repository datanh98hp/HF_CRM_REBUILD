# P0-6 — Web nội bộ và mobile web/PWA

**Trạng thái:** Đang triển khai; đã có giao diện quản trị truy cập và lát cắt staff customer/loan. CUSTOMER PWA, chat và các luồng P0-6 khác chưa hoàn tất.

## Mục tiêu

Đưa các luồng API đã có vào giao diện web nội bộ và mobile web/PWA cho CUSTOMER; native app để giai đoạn sau.

## Phạm vi

- Staff web: customer list/detail, tìm kiếm, phân công, loan request, plan/task, xác minh, import progress, dashboard theo scope.
- CUSTOMER mobile web/PWA: OTP auth khi provider được cấu hình, chat, đọc hồ sơ/hợp đồng của mình và gói vay public.
- UI role-aware lấy effective permissions từ API; mọi endpoint vẫn kiểm tra quyền độc lập.
- Responsive layout, keyboard access, trạng thái loading/error/403 và progress background jobs.

Lát cắt customer/loan staff hiện dùng bố cục danh sách cạnh chi tiết: tạo hồ sơ với chi nhánh trong phạm vi, đổi trạng thái có lý do, phân công ADVISING và xem lịch sử, rà soát ứng viên trùng không tự gộp, theo dõi yêu cầu vay và duyệt/từ chối hợp đồng. OTP hoàn tất hợp đồng vẫn phụ thuộc cấu hình; đây chưa phải nghiệm thu toàn bộ P0-6.

Giao diện quản trị truy cập hiện có các route riêng cho nhân viên, chi nhánh và vai trò/quyền; form tạo tài khoản/chi nhánh/vai trò mở trong modal. Trang nhân viên hiển thị chi tiết role và chi nhánh; cấp `MANAGE` từ danh sách nhân viên được chuyển qua luồng phân công quản lý chi nhánh, không dùng cấp grant thông thường. Ma trận role `ADMIN` hỗ trợ chọn/bỏ chọn toàn bộ quyền theo nhóm; `OPERATOR` được khóa. Trạng thái quy tắc quản lý chi nhánh được mô tả tại [P0-1](p0-1-access-control.md); hướng dẫn thao tác ở [Hướng dẫn sử dụng CRM](../user-guide.md).

## Tiêu chí hoàn tất

- Không hiển thị customer/contract từ API nếu user không có scope; kiểm thử trực tiếp endpoint khi bỏ qua UI.
- Import UI hiển thị trạng thái job, preview, lỗi theo dòng, duplicate review và explicit confirm.
- KPI chỉ hiển thị kết quả verified; filter và aggregates cùng scope với record gốc.
- API mock CUSTOMER chỉ hoạt động dev/test; production yêu cầu session OTP thật.
- Trang khởi tạo phản ánh đúng phạm vi: chat thuộc MVP, CRM ngoài để sau.

## Hướng dẫn triển khai Next.js

Trước khi sửa giao diện, đọc hướng dẫn Next.js hiện hành trong `node_modules/next/dist/docs/` như yêu cầu `apps/web/AGENTS.md`.
