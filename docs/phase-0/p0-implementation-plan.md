# Finance CRM — Kế hoạch triển khai P0

**Trạng thái (cập nhật 2026-11-21, đối chiếu code):** P0-0/P0-1 có nền code và đã chạy trong Compose dev/test. Backend P0-2 đã triển khai trên dev; phần mở rộng hồ sơ thêm CCCD, địa chỉ, quê quán, giới tính, nơi cấp (nullable) và định dạng DOB `dd/MM/yyyy` đã qua validate/generate/typecheck/focused tests, nhưng migration chưa áp dụng trên DB. P0-3 có API kế hoạch/task/kết quả/xác minh/KPI, UI `/plans`, `/plans/catalog`, `/tasks`; responsive đã probe 375px/1440px. P0-4 có pipeline import hoàn chỉnh đã nghiệm thu trên stack test cô lập, còn partial-row và schema mới chưa qua integration DB. P0-5 chưa có code. P0-6 mới có 13 route staff. Trạng thái chi tiết: [implementation-status.md](implementation-status.md).
**Cập nhật:** 2026-11-21
**Phạm vi căn cứ:** `AGENT.md`, `mvp-scope.md`, `decision-log.md` và scaffold hiện tại.

**Kế hoạch theo từng file:** [Mục lục các giai đoạn P0](p0/README.md).

## 1. Đánh giá mức sẵn sàng

Phạm vi nghiệp vụ chính đã đủ rõ để bắt đầu P0 theo từng lát cắt: tổ chức chi nhánh cha-con và RBAC; vòng đời khách hàng/yêu cầu vay/hợp đồng; kế hoạch-task-KPI; import Excel nền theo batch atomic. P0 phải giữ các quyết định đã chốt và không mở rộng sang tính eligibility, phê duyệt khoản vay, tích hợp CRM ngoài hoặc app native.

Backend đã có nền PostgreSQL/Redis, auth/RBAC/audit và P0-2 customer/loan. Phần mở rộng P0-2 hiện có bulk assignment, catalog/formula sản phẩm, product-backed request/contract, snapshot bất biến, quyền duyệt toàn cục cho ADMIN/OPERATOR (kể cả hợp đồng do mình tạo) và maker-checker MANAGE theo branch; Prisma generate, typecheck/build, unit tests và PostgreSQL integration đạt trên DB test riêng. Migration đã chạy ở dev/test, không production. P0-2 chưa đóng: còn xác nhận grants thật theo chi nhánh, duyệt policy tài chính/allowlist, scanner/retention và diễn tập restore. CUSTOMER PWA và OTP provider thật vẫn deferred.

P0-3 có API nền cho kế hoạch, task, phiên bản kết quả, xác minh, KPI và quan hệ metadata evidence; migration task/result/KPI cùng evidence đã áp dụng trên PostgreSQL test riêng. Kiểm thử API/PostgreSQL P0-3 đạt 19 assertion: plan mới ở DRAFT, chỉ chuyển chờ duyệt sau khi gửi; Admin được duyệt thủ công plan do mình tạo, còn MANAGE không thể tự duyệt và Admin khác có thể duyệt. Luồng tiếp tục tới task, kết quả và KPI sau xác minh. API typecheck và unit tests của hai suite plans/tasks đạt. UI `/plans`, `/plans/catalog` và `/tasks` đã dựng; responsive đã probe ở 375px/1440px. Migration evidence cùng các FK/CHECK constraints đã xác nhận. Còn mở: kiểm thử UI end-to-end và upload/download binary cho evidence (không có endpoint nào tạo `FileAsset` trong code). Theo yêu cầu hiện tại, CI pipeline nằm ngoài phạm vi tiếp tục triển khai.

P0-4 đã có code đầy đủ cho import nền: schema batch/row, RBAC `customers.import`, local temp storage, ClamAV `INSTREAM`, API readiness/upload/history/detail, parser CSV/XLSX có resource cap, worker `customer-import.process`, import atomic kèm dò trùng, audit counts-only và UI `/customers/import`; pipeline đã được nghiệm thu trên stack test cô lập. Bản mở rộng partial-row (chi tiết lỗi theo dòng, retention 30 ngày, finalization) có 2 migration chưa áp dụng/kiểm chứng trên DB test, nên readiness vẫn fail-closed ở môi trường chưa migrate. P0-5 chat realtime chưa có mã nguồn.

## 2. Phạm vi P0 đề xuất

### Bao gồm

- Prisma làm lớp truy cập nghiệp vụ cho PostgreSQL; migration, cấu hình môi trường và seed chỉ gồm permission catalog/roles cần thiết, không có dữ liệu khách hàng thật.
- Cây tổ chức `BRANCH` tổng → chi nhánh con, người dùng, role tùy chỉnh từ permission catalog và phạm vi `OWN`, `ASSIGNED`, `BRANCH`, `ALL`.
- Auth/session nhân viên, quyền backend, kiểm tra actor + action + resource scope; API giả lập CUSTOMER chỉ có ở dev/test và bị khóa mặc định ở production.
- Customer, duplicate review, assignment history, loan request do CUSTOMER gửi hoặc ADVISING ghi nhận, và bản ghi/liên kết hợp đồng riêng khi hợp đồng thực sự phát sinh.
- Kế hoạch có hạng mục, đơn vị, chỉ tiêu, thời gian; task chọn một kế hoạch phù hợp; kết quả thực đạt, chứng từ và luồng xác minh/audit; KPI chỉ tổng hợp số liệu `VERIFIED` và so với chỉ tiêu kế hoạch.
- Import CSV/XLSX tối đa đã chốt, chạy nền qua queue/worker: kiểm tra tệp và quét ClamAV, validation từng dòng, duplicate checks và import atomic; kết quả có thể tra cứu theo batch, lỗi theo dòng chỉ giữ số dòng + mã lỗi. Không có preview/xác nhận thủ công (xem [P0-4](p0/p0-4-background-import.md)).
- Chat realtime ADVISING ↔ CUSTOMER; mỗi message là record riêng trong PostgreSQL với metadata cột riêng và compact JSON payload; authorize kết nối, join, send, read.
- API và giao diện nội bộ tối thiểu để thực hiện luồng trên; API nghiệp vụ theo `/api/v1`, OpenAPI, phân trang và lỗi nhất quán.

### Không thuộc lát cắt P0 đầu tiên

- Tính eligibility, lịch trả nợ chính thức, tự động approve/reject.
- Tích hợp CRM ngoài, báo cáo tùy biến/data warehouse và app native. CUSTOMER bắt đầu với mobile web/PWA.
- P0-4 import không dùng S3: file chỉ nằm tạm trong `apps/api/import-customer-files`, được quét bằng ClamAV nội bộ và xóa sau khi xử lý. Audit chỉ giữ số lượng tổng hợp đã được duyệt. Upload mở khi readiness trả `READY` (dev/test đã chạy); production vẫn fail-closed cho tới khi có scanner/quarantine, retention/legal hold và volume dùng chung được cấu hình.
- Dashboard KPI đầy đủ trước khi chủ nghiệp vụ cung cấp danh mục hạng mục, đơn vị đo và các chỉ tiêu/kỳ cụ thể.

## 3. Thứ tự triển khai và tiêu chí nghiệm thu

| Bước | Hạng mục | Kết quả cần có để đóng bước |
|---|---|---|
| P0-0 | Nền tảng DB và worker | [Chi tiết](p0/p0-0-data-foundation.md) |
| P0-1 | Tổ chức, auth, RBAC, audit | [Chi tiết](p0/p0-1-access-control.md) |
| P0-2 | Customer, yêu cầu vay, hợp đồng, phân công | [Chi tiết](p0/p0-2-customer-loan-workflow.md) |
| P0-3 | Kế hoạch, task, kết quả và KPI | [Chi tiết](p0/p0-3-plans-tasks-kpi.md) |
| P0-4 | Import nền (atomic theo lô dòng hợp lệ) | [Chi tiết](p0/p0-4-background-import.md) |
| P0-5 | Chat realtime | [Chi tiết](p0/p0-5-realtime-chat.md) |
| P0-6 | UI staff và mobile web/PWA | [Chi tiết](p0/p0-6-web-pwa.md) |

Thứ tự này cho phép chốt hợp đồng API/schema theo từng module, nhưng không bỏ qua backend permission/scope trước khi mở endpoint nghiệp vụ.

## 4. Quy tắc dữ liệu cần phản ánh trong schema

- Tách `LoanRequest` khỏi `LoanContract`; request do CUSTOMER tạo hoặc ADVISING ghi nhận, contract được tạo/liên kết riêng khi thực sự phát sinh. Không suy diễn phê duyệt từ request.
- Lịch sử trạng thái customer phải append-only hoặc lưu transition records với actor, from/to, reason và timestamp. Duyệt ít nhất một contract tự chuyển customer sang `CONVERTED`; việc hoàn tất contract vẫn cần OTP CUSTOMER.
- Role assignment cần có node tổ chức/scope; role custom tham chiếu permission catalog, không nhận permission tự do từ client. Grant operation xác thực delegation boundary.
- Kết quả task lưu `reportedValue` + unit, narrative và evidence relation riêng. Verification history phải giữ người xác minh, thời điểm, kết luận/lý do; không ghi đè bằng chứng/kết quả đã xác minh.
- Plan target và task result phải kiểm tra unit/hạng mục/thời gian tương thích trước khi tổng hợp KPI.
- Import dùng `CustomerImportBatch` + `CustomerImportRow` (chỉ số dòng và mã lỗi đã whitelist, không lưu staging PII); trạng thái duplicate review tách khỏi customer lifecycle. Các dòng hợp lệ được ghi trong một transaction Serializable; dòng trùng/lỗi bị bỏ qua và đếm, không có bước xác nhận toàn batch.

## 5. Việc cần cung cấp/cấu hình song song

Các việc này không ngăn tạo abstraction/schema cốt lõi, nhưng phải có trước khi mở chức năng tương ứng:

- Cây chi nhánh thực tế, người dùng đầu tiên và grantable permission set.
- Xác nhận đầu mạng/đầu số với chủ nghiệp vụ hoặc OTP provider nếu cần xác minh thuê bao; số chuẩn Việt Nam 10 chữ số `0[1-9]XXXXXXXX` đã được chốt.
- OTP provider, nguồn dữ liệu chi tiết hợp đồng và allowlist trường CUSTOMER được đọc.
- Danh mục hạng mục/đơn vị đo; quyền tạo/duyệt kế hoạch; kỳ/chỉ tiêu cho dashboard/KPI.
- Queue provider settings, retry/dead-letter retention và cách vận hành worker.
- ClamAV nội bộ, mount thư mục tạm dùng chung API/worker, giới hạn XLSX sau giải nén và audit chỉ giữ số lượng tổng hợp. Không dùng S3 cho tệp import.

## 6. Rủi ro và biện pháp

- **Import atomic với batch lớn:** không giữ một DB transaction dài trong lúc parse. Parse/validate chạy ngoài transaction và chỉ giữ tối đa 10.000 bản ghi trong bộ nhớ; một transaction Serializable duy nhất ghi các dòng hợp lệ, kèm giới hạn dòng và idempotency key. Không lưu staging PII.
- **Role tùy chỉnh:** nguy cơ privilege escalation. Chỉ cấp subset của grantable set, chặn role system, kiểm tra scope actor/target, audit mutation cùng transaction và có kiểm thử IDOR.
- **`CONVERTED` và contract:** không để nhân viên đặt trạng thái này nếu không có hợp đồng liên kết; cập nhật status và contract relation trong cùng transaction hoặc tính trạng thái theo quy tắc domain rõ ràng.
- **PWA CUSTOMER:** không xem API mock là auth. Mock phải fail-closed theo environment; production yêu cầu OTP/session xác thực và mọi query lấy customer ID từ server-side identity.
- **File/PII:** P0-4 chỉ lưu file trong thư mục tạm cục bộ và xóa sau khi dùng; chi tiết lỗi theo dòng (số dòng + mã lỗi) hết hạn sau 30 ngày; audit chỉ giữ số lượng. Chỉ dùng fixture tổng hợp và không bật upload production trước khi toàn bộ pipeline/integration đạt.
- **Phụ thuộc hiện tại:** báo cáo scaffold ghi còn production audit advisories và chưa xác nhận PostgreSQL/restore thực. Rà soát dependency hiện hành trước upload, dữ liệu thật hoặc release; không coi kết quả cũ là trạng thái hiện thời.

## 7. Cổng bắt đầu code P0

Trước khi tạo migration nghiệp vụ đầu tiên, chốt trong tài liệu/API design:

1. Các bảng lõi và quan hệ `Branch`, `User`, `Role`, `Permission`, `Customer`, `CustomerAssignment`, `LoanRequest`, `LoanProduct`/`LoanProductFormulaVersion`, `LoanContract`, `Plan`/`PlanMetric`, `Task`/`TaskAssignment`, `TaskResult`, `TaskVerification`, `CustomerImportBatch`/`CustomerImportRow`, `AuditEvent`. (Tên model thực tế trong `apps/api/prisma/schema.prisma`.)
2. Scope semantics cho branch parent-child và permission delegation.
3. Worker queue/provider và import batch promotion/retry semantics (các trạng thái `QUEUED → SCANNING → PROCESSING → COMMITTING → COMPLETED`, retry ở `COMMITTING` chỉ cleanup/finalization).
4. `CONVERTED` invariant và customer status transition audit.
5. Plan/task/result unit compatibility và quy tắc điều chỉnh sau verification.

Khi các mục trên được ghi rõ ở schema/API design, có thể triển khai P0-0 → P0-1 mà không chờ scanner, OTP vendor hay KPI dashboard catalog. Các chức năng tương ứng vẫn giữ feature gate cho tới khi các cấu hình đó được chốt.
