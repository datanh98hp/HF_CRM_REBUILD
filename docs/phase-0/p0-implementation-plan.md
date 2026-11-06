# Finance CRM — Kế hoạch triển khai P0

**Trạng thái:** P0-0 có code nền; P0-1 đang triển khai; module nghiệp vụ P0-2 trở đi chưa bắt đầu.
**Ngày:** 2026-11-05
**Phạm vi căn cứ:** `AGENT.md`, `mvp-scope.md`, `decision-log.md` và scaffold hiện tại.

**Kế hoạch theo từng file:** [Mục lục các giai đoạn P0](p0/README.md).

## 1. Đánh giá mức sẵn sàng

Phạm vi nghiệp vụ chính đã đủ rõ để bắt đầu P0 theo từng lát cắt: tổ chức chi nhánh cha-con và RBAC; vòng đời khách hàng/yêu cầu vay/hợp đồng; kế hoạch-task-KPI; import Excel nền theo batch atomic. P0 phải giữ các quyết định đã chốt và không mở rộng sang tính eligibility, phê duyệt khoản vay, tích hợp CRM ngoài hoặc app native.

Repository ban đầu có scaffold NestJS/Next.js và PostgreSQL health probe. P0-0 hiện đã bổ sung Prisma/configuration, Redis/BullMQ và worker code; chưa có migration nghiệp vụ, auth/session, RBAC/audit hay module CRM. Cần xác nhận runtime DB/Redis trước khi đóng P0-0.

Trang khởi tạo web hiện còn câu “Chat realtime và tích hợp CRM ngoài để giai đoạn sau”, không còn đúng vì chat thuộc MVP còn CRM ngoài mới để sau; cần sửa nội dung shell khi bắt đầu lát cắt UI.

## 2. Phạm vi P0 đề xuất

### Bao gồm

- Prisma làm lớp truy cập nghiệp vụ cho PostgreSQL; migration, cấu hình môi trường và seed chỉ gồm permission catalog/roles cần thiết, không có dữ liệu khách hàng thật.
- Cây tổ chức `BRANCH` tổng → chi nhánh con, người dùng, role tùy chỉnh từ permission catalog và phạm vi `OWN`, `ASSIGNED`, `BRANCH`, `ALL`.
- Auth/session nhân viên, quyền backend, kiểm tra actor + action + resource scope; API giả lập CUSTOMER chỉ có ở dev/test và bị khóa mặc định ở production.
- Customer, duplicate review, assignment history, loan request do CUSTOMER gửi hoặc ADVISING ghi nhận, và bản ghi/liên kết hợp đồng riêng khi hợp đồng thực sự phát sinh.
- Kế hoạch có hạng mục, đơn vị, chỉ tiêu, thời gian; task chọn một kế hoạch phù hợp; kết quả thực đạt, chứng từ và luồng xác minh/audit; KPI chỉ tổng hợp số liệu `VERIFIED` và so với chỉ tiêu kế hoạch.
- Import CSV/XLSX tối đa đã chốt, chạy nền qua queue/worker: preview/mapping, validation từng dòng, duplicate checks, kết quả có thể tra cứu, xác nhận và commit toàn batch hoặc không commit dòng nào.
- Chat realtime ADVISING ↔ CUSTOMER; mỗi message là record riêng trong PostgreSQL với metadata cột riêng và compact JSON payload; authorize kết nối, join, send, read.
- API và giao diện nội bộ tối thiểu để thực hiện luồng trên; API nghiệp vụ theo `/api/v1`, OpenAPI, phân trang và lỗi nhất quán.

### Không thuộc lát cắt P0 đầu tiên

- Tính eligibility, lịch trả nợ chính thức, tự động approve/reject.
- Tích hợp CRM ngoài, báo cáo tùy biến/data warehouse và app native. CUSTOMER bắt đầu với mobile web/PWA.
- Upload file thật trước khi scanner, retention, quyền xóa và legal hold được cấu hình/duyệt. Có thể chuẩn bị metadata/interface, nhưng không bật xử lý file nghiệp vụ ở production.
- Dashboard KPI đầy đủ trước khi chủ nghiệp vụ cung cấp danh mục hạng mục, đơn vị đo và các chỉ tiêu/kỳ cụ thể.

## 3. Thứ tự triển khai và tiêu chí nghiệm thu

| Bước | Hạng mục | Kết quả cần có để đóng bước |
|---|---|---|
| P0-0 | Nền tảng DB và worker | [Chi tiết](p0/p0-0-data-foundation.md) |
| P0-1 | Tổ chức, auth, RBAC, audit | [Chi tiết](p0/p0-1-access-control.md) |
| P0-2 | Customer, yêu cầu vay, hợp đồng, phân công | [Chi tiết](p0/p0-2-customer-loan-workflow.md) |
| P0-3 | Kế hoạch, task, kết quả và KPI | [Chi tiết](p0/p0-3-plans-tasks-kpi.md) |
| P0-4 | Import nền toàn batch | [Chi tiết](p0/p0-4-background-import.md) |
| P0-5 | Chat realtime | [Chi tiết](p0/p0-5-realtime-chat.md) |
| P0-6 | UI staff và mobile web/PWA | [Chi tiết](p0/p0-6-web-pwa.md) |

Thứ tự này cho phép chốt hợp đồng API/schema theo từng module, nhưng không bỏ qua backend permission/scope trước khi mở endpoint nghiệp vụ.

## 4. Quy tắc dữ liệu cần phản ánh trong schema

- Tách `LoanRequest` khỏi `LoanContract`; request do CUSTOMER tạo hoặc ADVISING ghi nhận, contract được tạo/liên kết riêng khi thực sự phát sinh. Không suy diễn phê duyệt từ request.
- Lịch sử trạng thái customer phải append-only hoặc lưu transition records với actor, from/to, reason và timestamp. Chuyển linh hoạt theo quyền; trạng thái `CONVERTED` luôn cần contract relation.
- Role assignment cần có node tổ chức/scope; role custom tham chiếu permission catalog, không nhận permission tự do từ client. Grant operation xác thực delegation boundary.
- Kết quả task lưu `reportedValue` + unit, narrative và evidence relation riêng. Verification history phải giữ người xác minh, thời điểm, kết luận/lý do; không ghi đè bằng chứng/kết quả đã xác minh.
- Plan target và task result phải kiểm tra unit/hạng mục/thời gian tương thích trước khi tổng hợp KPI.
- Import dùng `ImportBatch` + staging rows để parse/validate trước commit; trạng thái duplicate review tách khỏi customer lifecycle. Toàn batch chỉ promote sau confirmation và validation sạch.

## 5. Việc cần cung cấp/cấu hình song song

Các việc này không ngăn tạo abstraction/schema cốt lõi, nhưng phải có trước khi mở chức năng tương ứng:

- Cây chi nhánh thực tế, người dùng đầu tiên và grantable permission set.
- Quốc gia mặc định cho chuẩn hóa số điện thoại; quy tắc match tên khi khác dấu/thiếu DOB.
- OTP provider, nguồn dữ liệu chi tiết hợp đồng và allowlist trường CUSTOMER được đọc.
- Danh mục hạng mục/đơn vị đo; quyền tạo/duyệt kế hoạch; kỳ/chỉ tiêu cho dashboard/KPI.
- Queue provider settings, retry/dead-letter retention và cách vận hành worker.
- Scanner, limits cho XLSX sau giải nén, retention, legal hold, quyền xóa, audit retention và chính sách pháp lý/production.

## 6. Rủi ro và biện pháp

- **Import atomic với batch lớn:** không giữ một DB transaction dài trong lúc parse. Parse/validate vào staging; confirmation thực hiện promotion theo thiết kế có tính atomic, giới hạn số dòng và idempotency key.
- **Role tùy chỉnh:** nguy cơ privilege escalation. Chỉ cấp subset của grantable set, chặn role system, kiểm tra scope actor/target, audit mutation cùng transaction và có kiểm thử IDOR.
- **`CONVERTED` và contract:** không để nhân viên đặt trạng thái này nếu không có hợp đồng liên kết; cập nhật status và contract relation trong cùng transaction hoặc tính trạng thái theo quy tắc domain rõ ràng.
- **PWA CUSTOMER:** không xem API mock là auth. Mock phải fail-closed theo environment; production yêu cầu OTP/session xác thực và mọi query lấy customer ID từ server-side identity.
- **File/PII:** chỉ dùng fixture tổng hợp; không đưa dữ liệu thật vào dev/test. Không bật file thật hoặc production trước khi policy scanner/retention/legal được duyệt.
- **Phụ thuộc hiện tại:** báo cáo scaffold ghi còn production audit advisories và chưa xác nhận PostgreSQL/restore thực. Rà soát dependency hiện hành trước upload, dữ liệu thật hoặc release; không coi kết quả cũ là trạng thái hiện thời.

## 7. Cổng bắt đầu code P0

Trước khi tạo migration nghiệp vụ đầu tiên, chốt trong tài liệu/API design:

1. Các bảng lõi và quan hệ `Branch`, `User`, `Role`, `Permission`, `Customer`, `Assignment`, `LoanRequest`, `LoanContract`, `Plan`, `Task`, `TaskResult`, `Verification`, `ImportBatch`/staging rows, `AuditEvent`.
2. Scope semantics cho branch parent-child và permission delegation.
3. Worker queue/provider và import batch promotion/retry semantics.
4. `CONVERTED` invariant và customer status transition audit.
5. Plan/task/result unit compatibility và quy tắc điều chỉnh sau verification.

Khi các mục trên được ghi rõ ở schema/API design, có thể triển khai P0-0 → P0-1 mà không chờ scanner, OTP vendor hay KPI dashboard catalog. Các chức năng tương ứng vẫn giữ feature gate cho tới khi các cấu hình đó được chốt.
