# Mô tả toàn dự án — Finance CRM

## 1. Tổng quan

Finance CRM là monorepo quản lý khách hàng, tư vấn tài chính, yêu cầu vay, hợp đồng, kế hoạch công việc và KPI cho hệ thống HFinance/VietP2P. Tên mã nguồn và sản phẩm là `finance-crm`, tập trung vào quy trình nội bộ dành cho nhân viên, quản lý chi nhánh và quản trị viên; khách hàng là persona tương lai/đang được mở dần với mobile web/PWA và API mock có giới hạn môi trường.

> **Trạng thái tài liệu:** nội dung mô tả kiến trúc/luồng đã đối chiếu với mã nguồn ngày 2026-11-21. Trạng thái triển khai theo giai đoạn, bằng chứng kiểm thử và các cổng còn chặn nằm ở [implementation-status.md](docs/phase-0/implementation-status.md) — tài liệu đó là nguồn sự thật khi có khác biệt.

Dự án được xây theo kiến trúc modular monolith, không chia thành các dịch vụ backend độc lập trong MVP:

- API và logic nghiệp vụ: NestJS 11.
- Giao diện nhân viên: Next.js 16 và React 19.
- Cơ sở dữ liệu nghiệp vụ: PostgreSQL 17 qua Prisma 7.
- Hàng đợi nền: Redis 7 và BullMQ.
- Worker: tiến trình NestJS riêng khỏi API HTTP.
- Triển khai: Docker Compose cho phát triển, test và production ban đầu.

Mã nguồn nằm trong npm workspaces:

- `apps/api`: REST API, worker, Prisma schema, migration, seed và script vận hành.
- `apps/web`: ứng dụng web staff, màn hình đăng nhập, hồ sơ, khách hàng, hợp đồng, kế hoạch và công việc.
- `docs`: phạm vi MVP, quyết định, kế hoạch P0, hướng dẫn sử dụng và trạng thái triển khai.
- `scripts`: wrapper quản lý Docker Compose và chạy công cụ trong toolbox container.

## 2. Mục tiêu nghiệp vụ

MVP hướng đến các luồng:

1. Tài khoản nhân viên đăng nhập và chỉ truy cập dữ liệu trong chi nhánh/phạm vi được cấp.
2. Tạo và quản lý khách hàng tiềm năng, nguồn dữ liệu, trạng thái xác minh và vòng đời.
3. Phát hiện ứng viên trùng lặp để nhân viên rà soát thủ công; không tự động gộp hồ sơ.
4. Ghi nhận yêu cầu vay do khách hàng gửi hoặc tư vấn viên ghi thay cho khách.
5. Phân công tư vấn viên chính cho khách hàng và giữ lịch sử phân công.
6. Ghi nhận chăm sóc và công việc follow-up.
7. Tạo kế hoạch theo hạng mục, đơn vị đo và chỉ tiêu.
8. Giao task, nộp kết quả, đính kèm bằng chứng và yêu cầu xác minh thủ công.
9. Chỉ tổng hợp KPI từ kết quả đã được xác minh.
10. Tạo hoặc tiếp nhận hợp đồng vay riêng với yêu cầu vay; không suy ra quyết định vay từ request.
11. Giữ audit trail cho thay đổi dữ liệu nhạy cảm, phân công, quyền và trạng thái nghiệp vụ.

MVP không phải hệ thống phê duyệt khoản vay tự động. Nó không thay thế quyết định tín dụng, không tính eligibility chính thức và không tự động đưa ra lãi suất, lịch trả nợ chính thức hay quyết định approve/reject.

## 3. Kiến trúc hệ thống

### 3.1. API NestJS

API nằm trong một NestJS modular monolith. Tất cả endpoint nghiệp vụ sử dụng tiền tố `/api/v1`; `GET /health` và `GET /ready` là endpoint probe; OpenAPI phục vụ tại `/api/docs` trong môi trường không phải production.

Các module chính:

- `auth`: đăng nhập, refresh, logout, đổi mật khẩu và thông tin actor hiện tại.
- `access-control`: chi nhánh, người dùng, role, permission grant và audit truy cập.
- `audit`: ghi và truy vấn sự kiện thay đổi nhạy cảm.
- `customers`: khách hàng, phân công, trùng lặp, yêu cầu vay, gói vay và hợp đồng.
- `customer-imports`: readiness, upload, lịch sử và trạng thái import khách hàng bằng CSV/XLSX.
- `plans`: kế hoạch, danh mục hạng mục, task, kết quả, xác minh và KPI.
- `background-queue`: tạo và quản lý job BullMQ.
- `worker`: worker xử lý job nền riêng.
- `health`: probe liveness/readiness.
- `runtime-config`: đọc và kiểm tra cấu hình môi trường.
- `database`: Prisma/PostgreSQL service.
- `capabilities`: cung cấp capability của runtime cho frontend.

API sử dụng DTO validation toàn cục, whitelist fields và từ chối field không khai báo. CORS, correlation ID, health/readiness, validation lỗi và serialization phải được kiểm tra ở biên API.

### 3.2. PostgreSQL và Prisma

PostgreSQL là nguồn dữ liệu nghiệp vụ duy nhất. Prisma schema (33 model) quản lý:

- tổ chức chi nhánh cha/con, người dùng, session, role, permission và grant;
- khách hàng, phân công, lịch sử trạng thái và candidate trùng lặp;
- yêu cầu vay, gói vay, phiên bản công thức immutable, hợp đồng vay, lịch sử trạng thái hợp đồng, tài liệu hợp đồng, lịch sử thay đổi hợp đồng và OTP xác nhận;
- kế hoạch, phê duyệt plan, chi nhánh áp dụng, danh mục hạng mục, mục tiêu plan, task, assignment, kết quả, xác minh, evidence và file asset;
- batch/row import khách hàng;
- audit event.

Các enum chính (19) gồm `BranchStatus`, `UserStatus`, `AccessScope`, `CustomerStatus`, `CustomerVerificationStatus`, `DuplicateReviewStatus`, `LoanRequestSource`, `LoanRequestStatus`, `LoanProductStatus`, `LoanContractStatus`, `PlanStatus`, `PlanApprovalDecision`, `TaskStatus`, `TaskVerificationStatus`, `FileScanStatus`, `CustomerImportBatchStatus`, `CustomerImportRowStatus`, `CustomerImportDuplicateDecision` và `ContractOtpChallengeStatus`.

Schema và migration được lưu trong `apps/api/prisma`. Dữ liệu seed chỉ phù hợp cho phát triển/test và không được coi là dữ liệu cấu hình production.

### 3.3. Redis và worker

Redis cung cấp transport cho BullMQ, không thay thế PostgreSQL làm source of truth. API có thể enqueue job; worker riêng chạy xử lý nền.

Worker hiện xử lý hai loại job: `system.healthcheck` và `customer-import.process` (pipeline import P0-4: quét ClamAV, parse, dò trùng, ghi atomic và dọn tệp). Chat realtime (P0-5) không có processor/socket trong code ở thời điểm này.

### 3.4. Web Next.js

Giao diện staff dùng Next.js App Router và bộ component shadcn-style/Base UI/Tailwind. Các route hiện có (13 thư mục route trong `apps/web/src/app`) gồm:

- `/login` và `/change-password`;
- `/profile`;
- `/customers` và `/customers/import`;
- `/loan-products`;
- `/loan-contracts`;
- `/plans`;
- `/plans/catalog`;
- `/tasks`;
- `/staff`;
- `/branches`;
- `/roles`.

Điều hướng sidebar được hiển thị theo effective permissions từ backend. Đây là UX, không thay thế authorization tại API.

Chưa có route dashboard tổng quan, route chat hay PWA shell cho CUSTOMER; web hiện không có manifest/service worker nên chưa phải PWA.

## 4. Bảo mật và phân quyền

Vai trò nhân viên:

- `OPERATOR`: quản trị nền tảng trong quyền được cấp.
- `ADMIN`: cấu hình và quản lý người dùng trong scope được cấu hình.
- `MANAGE`: quản lý và báo cáo trong phạm vi chi nhánh.
- `ADVISING`: khách hàng được giao, chăm sóc, task và hội thoại được cấp.
- `CUSTOMER`: khách hàng truy cập dữ liệu của chính mình; mock chỉ phục vụ dev/test.

Các scope dữ liệu:

- `OWN`: tài nguyên thuộc người dùng hiện tại.
- `ASSIGNED`: tài nguyên được phân công cho người dùng.
- `BRANCH`: tài nguyên trong chi nhánh được cấp.
- `ALL`: chỉ được cấp rõ ràng.

Quyền được lưu bằng stable permission key trong `apps/api/prisma/permission-catalog.json`. Các nhóm chính gồm organization, identity, access-control, audit, customers, loans, plans, advising và reports.

Auth staff sử dụng:

- scrypt password hashing;
- access token ngắn hạn;
- refresh token opaque được hash và lưu trong HttpOnly cookie;
- refresh rotation/reuse detection;
- lockout theo số lần đăng nhập sai;
- yêu cầu đổi mật khẩu lần đầu;
- revoke session khi vô hiệu hóa tài nguyên;
- protected endpoint fail-closed nếu thiếu permission metadata.

Backend phải kiểm tra đồng thời action permission và resource scope. Các giao dịch thay đổi role/permission cần kiểm tra delegation, scope và ghi audit atomically.

## 5. Nghiệp vụ khách hàng và vay

### 5.1. Khách hàng

Hồ sơ khách hàng lưu họ tên, số điện thoại chuẩn hóa, email tùy chọn, ngày sinh tùy chọn, provenance và trạng thái xác minh. Số điện thoại là trường bắt buộc; dạng số Việt Nam production dự kiến là `0[1-9]XXXXXXXX`.

Trạng thái vòng đời gồm:

- `NEW`;
- `CONTACTED`;
- `QUALIFIED`;
- `IN_PROGRESS`;
- `CONVERTED`;
- `CLOSED`.

Chuyển trạng thái phải có lý do và audit. `CONVERTED` chỉ hợp lệ khi khách hàng có hợp đồng vay được tạo/liên kết trong CRM.

Một khách hàng có một tư vấn viên chính tại một thời điểm. Lịch sử phân công được giữ riêng và có thông tin người thực hiện phân công.

### 5.2. Trùng lặp

Cảnh báo trùng được tạo khi trùng số điện thoại, email chuẩn hóa hoặc họ tên kèm ngày sinh. Candidate trùng có trạng thái:

- `OPEN`;
- `CONFIRMED_DUPLICATE`;
- `NOT_DUPLICATE`.

Người dùng có quyền rà soát xác nhận kết quả thủ công. Hệ thống không tự động merge customer records.

### 5.3. Yêu cầu vay

`LoanRequest` là record intake/tracking với nguồn `CUSTOMER` hoặc `ADVISING`. Request lưu khách hàng, chi nhánh, gói vay tùy chọn, số tiền/kỳ hạn mong muốn, chủ đề và ghi chú.

Hợp đồng vay là record riêng. Contract lưu số hợp đồng, gói vay, công thức và snapshot dữ liệu, trạng thái, version, tài liệu và lịch sử thay đổi.

Không coi yêu cầu vay là quyết định phê duyệt. `LoanContractStatus` xử lý trạng thái nghiệp vụ riêng của hợp đồng.

### 5.4. Gói vay và công thức

Gói vay lưu mã, tên, loại, nguồn, mô tả, term min/max, amount min/max, lãi suất và trạng thái. Formula version là record bất biến liên kết với gói vay.

Quy tắc tài chính thực tế, lãi suất, phí, kỳ trả nợ, day-count và amortization chưa được chốt trong tài liệu nguồn. Do đó code/scaffold không được dùng làm bằng chứng cho chính sách tài chính hoặc quyết định tín dụng.

## 6. Kế hoạch, task và KPI

Tầng kế hoạch hỗ trợ:

- plan theo tên, mô tả, kỳ và chi nhánh;
- trạng thái `DRAFT`, `PENDING_APPROVAL`, `ACTIVE`, `REJECTED`, `ARCHIVED`;
- duyệt/reject plan với reviewer, version và lý do;
- danh mục hạng mục KPI dùng chung;
- mục tiêu plan theo tên, đơn vị và giá trị target;
- task theo plan/metric/chi nhánh;
- assignment cho từng nhân viên;
- target riêng theo assignment;
- nhiều revision kết quả của một task;
- evidence liên kết với file metadata;
- trạng thái xác minh `PENDING_VERIFICATION`, `VERIFIED`, `NEEDS_INFO`, `REJECTED`.

Luồng task:

1. Người có quyền tạo task trong kế hoạch phù hợp.
2. Giao task cho một hoặc nhiều nhân viên.
3. Nhân viên nộp số thực đạt và mô tả/nội dung.
4. Quản trị viên hoặc người có quyền xác minh xem evidence.
5. Kết quả được xác minh, yêu cầu bổ sung hoặc từ chối với lý do.
6. KPI chỉ cộng các revision đã `VERIFIED`.

Giao diện `/tasks`, `/plans` và `/plans/catalog` đã có lát cắt staff cho luồng này.

## 7. File, import và tích hợp tương lai

### 7.1. File

Model `FileAsset`/`TaskResultEvidence` giữ metadata, link tài nguyên, uploader và trạng thái scan. Storage contract có abstraction `ObjectStorageService`, hỗ trợ local storage cho dev/test và MinIO/S3-compatible khi biến môi trường được cấu hình đầy đủ.

Giới hạn dự kiến:

- task submission: PDF/JPG/JPEG/PNG, tối đa 10 MB/file;
- customer import: CSV/XLSX, tối đa 20 MB;
- tài liệu hợp đồng: DOCX/PDF/PNG/JPG, tối đa 25 MB/file, lưu qua `ContractDocumentStorageService` (local dev/test hoặc MinIO/S3 khi env đầy đủ), không dùng `FileAsset`.

Production upload không được coi là triển khai an toàn cho tới khi có scanner/quarantine, giới hạn MIME/signature, retention, legal hold và quyền xóa được chốt.

### 7.2. Import

P0-4 đã có code đầy đủ (API, parser, worker, UI, scanner) và đã nghiệm thu pipeline trên stack test cô lập; bản mở rộng partial-row còn chờ áp dụng migration và kiểm chứng. Thiết kế đã chốt là **auto-import, không có bước preview/xác nhận thủ công**:

- chỉ nhận CSV/XLSX ≤20 MB; từ chối XLS/XLSM, MIME/chữ ký không khớp, workbook mã hoá hoặc vượt resource cap;
- quét ClamAV `INSTREAM` trước khi parse; thiếu scanner/queue/worker thì readiness trả `BLOCKED` và upload bị từ chối;
- parser giới hạn 10.000 dòng, 10 sheet, 100 MB sau giải nén, 1.000 ZIP entry, 100 cột và 4.096 ký tự/ô;
- dòng hợp lệ được ghi trong một transaction Serializable; dòng trùng và dòng lỗi bị bỏ qua và đếm riêng, không merge;
- chi tiết lỗi chỉ giữ số dòng + mã lỗi đã whitelist trong 30 ngày; batch terminal xoá tệp tạm, mapping, sheet và các count tổng (`totalRows`/`validRows`/`skippedRows`), audit chỉ ghi counts;
- retry ở trạng thái `COMMITTING` chỉ hoàn tất cleanup/finalization, không import lại.

Scanner/quarantine, retention/legal hold, quyền xoá và cấu hình volume dùng chung vẫn là release gate; readiness giữ `BLOCKED` cho tới khi migration partial-row được áp dụng trên môi trường đích.

### 7.3. Chat

P0-5 hiện chỉ có đặc tả kiến trúc: chat realtime ADVISING ↔ CUSTOMER qua Socket.IO hoặc cơ chế tương đương, message lưu trong PostgreSQL, cursor pagination và authorization cho join/send/read. Chưa có socket gateway, model conversation/message, route hay component chat trong code; chat UI/server event chưa được coi là đã hoàn tất và P0-6 customer PWA cũng chưa đóng.

## 8. Docker và cấu hình môi trường

Dự án có ba overlay Docker Compose:

- `docker-compose.dev.yml`;
- `docker-compose.test.yml`;
- `docker-compose.prod.yml`.

Base Compose chạy PostgreSQL 17, Redis 7, migration job, seed profile, API, worker, web và toolbox. PostgreSQL/Redis bind về loopback trong local; production không có seeding dữ liệu mẫu tự động.

Cấu hình môi trường được phân theo:

- `.env.dev`;
- `.env.test`;
- `.env.prod`;
- `.env.example` là mẫu chung.

Các biến quan trọng gồm:

- `DATABASE_URL`;
- `REDIS_URL`;
- `NODE_ENV`;
- `API_PORT`;
- `WEB_PORT`;
- `NEXT_PUBLIC_API_BASE_URL`;
- `WEB_ORIGINS`;
- `AUTH_ACCESS_TOKEN_SECRET`;
- `AUTH_ACCESS_TOKEN_TTL_SECONDS`;
- `AUTH_REFRESH_TOKEN_TTL_DAYS`;
- `WORKER_CONCURRENCY`;
- `CONTRACT_DOCUMENT_DIRECTORY`;
- `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`;
- bootstrap admin credentials;
- backup encryption key.

Secret không được commit hoặc log. Production nên đặt secret trong secret manager và không expose PostgreSQL/Redis ra public.

## 9. Quy trình phát triển và vận hành

Lệnh npm ở root:

- `npm run dev:api`: chạy API NestJS watch mode.
- `npm run dev:worker`: chạy worker watch mode.
- `npm run dev:web`: chạy Next.js.
- `npm run db:generate`: sinh Prisma Client.
- `npm run db:validate`: validate schema.
- `npm run db:migrate:dev`: tạo/ap dụng migration dev.
- `npm run db:migrate:deploy`: deploy migration.
- `npm run db:seed`: seed/access bootstrap.
- `npm run typecheck`: typecheck API và web.
- `npm run test`: chạy Jest API.
- `npm run build`: build API và web.
- `npm run backup:db` / `restore:db`: script backup/restore PostgreSQL.
- `npm run test:backup-crypto`: kiểm tra mã hóa backup.

Các script `docker:*` quản lý stack development, test hoặc production. Wrapper Bash `scripts/docker-compose.sh` cũng hỗ trợ chạy npm script trong toolbox container hoặc quản lý lifecycle Compose.

Docker production được thiết kế theo mô hình migration one-shot trước API/worker, seed có profile ops riêng và healthcheck cho API/web.

## 10. Kiểm thử và bằng chứng hiện tại

Mức hiện tại cần được đọc theo source/tree và kết quả kiểm tra đã ghi trong tài liệu repository, không phải global production readiness:

- API, web và Prisma foundation đã có cấu trúc build/typecheck.
- P0-1 có schema auth/RBAC/audit, auth session và API quản trị.
- P0-2 có customer/loan/contract code, migration và tests trong môi trường cô lập; hồ sơ khách hàng có thêm các trường tùy chọn CCCD, địa chỉ, quê quán, giới tính và nơi cấp. Migration mới có trong code nhưng chưa được áp dụng/kiểm chứng trên DB.
- P0-3 có plan/task/result/verification/KPI API, migration và UI `/plans`, `/plans/catalog`, `/tasks`.
- P0-4 có API import (readiness/upload/history/detail), parser CSV/XLSX, ClamAV `INSTREAM`, worker `customer-import.process`, import atomic, migration batch/row và UI `/customers/import`.
- Có script integration P0-2/P0-3 sử dụng PostgreSQL Docker cô lập.
- Có unit test backup crypto với synthetic payload.
- Có các route staff đã được probe theo kích thước desktop và 375px trong các lượt kiểm tra ghi nhận.

Đối chiếu và kiểm tra 2026-11-21: `npm run db:validate`, `npm run db:generate`, typecheck API + web và 4 API suite tập trung/37 test đạt trên host. Full API suite và integration DB cho các migration mới chưa chạy; các dependency/migration còn lại cần được xác minh trong môi trường DB test cô lập.

Các chức năng/kiểm tra còn cần runtime evidence độc lập:

- UI end-to-end và browser flow đầy đủ;
- production migration/seed thật;
- backup thật và restore thật;
- RPO/RTO;
- scanner/quarantine;
- retention/legal hold;
- CUSTOMER OTP/provider thật;
- chat realtime;
- áp dụng migration partial-row và integration mixed-row cho import;
- dashboard/report đầy đủ;
- CI/CD pipeline;
- dependency/container vulnerability scan hiện hành;
- testing production-readiness security matrix.

## 11. Trạng thái P0

- P0-0: nền PostgreSQL, Prisma, Redis, BullMQ, worker và runtime config đã có.
- P0-1: auth, RBAC, organization, branch, grant và audit foundation đã có.
- P0-2: backend và UI customer/loan/contract đang triển khai ở mức lát cắt baseline; một số chính sách tài chính và grant production vẫn mở.
- P0-3: kế hoạch/task/kết quả/xác minh/KPI và UI liên quan đã có code/migration trong phạm vi code hiện tại.
- P0-4: pipeline import nền đã có code và đã nghiệm thu trên stack test cô lập; bản mở rộng partial-row chưa áp dụng/kiểm chứng migration, readiness vẫn fail-closed cho tới khi schema đích có cột retention.
- P0-5: chat realtime chưa triển khai — không có socket gateway, model conversation/message hay UI.
- P0-6: web staff một phần đã có (13 route, gồm `/customers/import`); dashboard, chat UI, CUSTOMER PWA và các route còn lại chưa hoàn tất.

Chi tiết và tiến độ chuẩn ghi trong:

- `README.md`;
- `AGENT.md`;
- `docs/phase-0/mvp-scope.md`;
- `docs/phase-0/decision-log.md`;
- `docs/phase-0/implementation-status.md`;
- `docs/phase-0/p0-implementation-plan.md`;
- `docs/phase-0/p0/`.

## 12. Quyền và quyết định còn mở

Trước khi phát hành production hoặc lưu dữ liệu thật, cần chốt ít nhất:

- cây chi nhánh và user/grant production;
- ma trận permission/scope đã duyệt;
- OTP provider và xác thực CUSTOMER;
- allowlist trường hợp đồng/gói vay CUSTOMER được đọc;
- lãi suất, phí, kỳ hạn, amortization và quy tắc tài chính chính thức;
- provider storage, data residency và retention;
- scanner/quarantine, legal hold và quyền xóa file;
- SLA/nhắc việc, múi giờ nghiệp vụ và quy tắc requeue;
- danh mục KPI, công thức, kỳ và quyền xem/xuất báo cáo;
- topology production, RPO/RTO, monitoring và incident response;
- external CRM/webhook adapter nếu cần tích hợp sau MVP.

## 13. Nguyên tắc phát triển

Các nguyên tắc bắt buộc:

- ưu tiên PostgreSQL/Prisma làm source of truth;
- không truy cập database trực tiếp từ frontend;
- giữ modular monolith;
- backend phải enforce permission và scope;
- frontend permission chỉ là điều kiện hiển thị;
- không đưa PII hoặc secret thật vào fixture/test/log;
- không tự động merge customer duplicate;
- không coi loan request là quyết định vay;
- giữ lịch sử immutable cho kết quả task, formula, contract change và audit;
- không claim production-ready nếu thiếu migration, test, backup/restore và policy evidence;
- cập nhật README, OpenAPI, schema, migration, test và tài liệu cùng thay đổi code.
