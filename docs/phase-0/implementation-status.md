# Finance CRM — Báo cáo triển khai nền tảng đầu tiên

> **Cập nhật trạng thái 2026-11-21 (đối chiếu mã nguồn và kiểm tra trên host):** Báo cáo này là nguồn trạng thái duy nhất; các file kế hoạch P0 mô tả đặc tả, không thay thế báo cáo này.
>
> - **P0-0/P0-1:** Nền dữ liệu, auth, RBAC/audit và API quản trị đã có. Quyền thao tác vẫn phụ thuộc vào grants/scope được cấu hình và xác thực tại backend.
> - **Quản lý chi nhánh:** Chi nhánh được tạo chưa có quản lý nhưng phải ở trạng thái INACTIVE. Chỉ kích hoạt khi đã có quản lý đang hoạt động và cha (nếu có) ACTIVE. Cấp `MANAGE` chỉ qua luồng phân công quản lý; role grant thông thường không cấp được quyền này. Khi quản lý bị gỡ hoặc tài khoản quản lý bị vô hiệu hóa, chi nhánh cùng các hậu duệ ACTIVE tự chuyển INACTIVE, có audit.
> - **P0-2:** Baseline và phần mở rộng customer/loan đang hoạt động (catalog sản phẩm, công thức version bất biến, snapshot hợp đồng, bulk assignment, maker-checker, tài liệu hợp đồng, MinIO tuỳ chọn). Đã bổ sung các trường hồ sơ nullable CCCD, địa chỉ, quê quán, giới tính, nơi cấp; UI hiển thị ngày sinh `dd/MM/yyyy`, API giữ ISO. Migration `20261121170000_customer_optional_profile_fields` đã tạo nhưng **chưa áp dụng/kiểm chứng trên DB**. Các fixture/grants nhánh demo chỉ cho demo; branch IDs và role grants đó **không** phải cấu hình production đã phê duyệt. Chính sách tài chính thực tế vẫn hoãn đến khi nhận tài liệu nguồn có thẩm quyền. Upload production fail-closed khi chưa có scanner. Có script backup/restore PostgreSQL mã hóa; chỉ kiểm tra crypto bằng dữ liệu tổng hợp, chưa tạo backup thật hoặc restore DB.
> - **P0-3:** API kế hoạch/task/kết quả theo phiên bản/xác minh có audit/KPI, danh mục KPI, duyệt/từ chối plan và bộ lọc kỳ KPI đã có; UI `/plans`, `/plans/catalog`, `/tasks`. Migration/seed đã áp dụng trên đúng database local dev/test; kiểm thử API/PostgreSQL P0-3 đạt 19 assertion. P0-3 **chưa có** API intake/download binary cho evidence (bảng `FileAsset`/`TaskResultEvidence` đã có và API chỉ liên kết metadata file `AVAILABLE`; không có endpoint nào tạo `FileAsset` trong code). UI end-to-end và dashboard KPI trực quan còn mở.
> - **P0-4:** Pipeline import đã có code đầy đủ: schema `CustomerImportBatch`/`CustomerImportRow`, RBAC `customers.import`, local temp storage trong `apps/api/import-customer-files`, ClamAV `INSTREAM` nội bộ, parser CSV/XLSX có resource cap, worker BullMQ, import atomic kèm dò trùng, audit chỉ giữ counts, UI `/customers/import`. Parser nhận thêm các trường hồ sơ tùy chọn. Readiness fail-closed và yêu cầu cột `failureDetailsExpiresAt` trong DB. Hai migration partial-row (`20261120121200`, `20261120161000`) và migration trường hồ sơ khách hàng (`20261121170000`) **chưa được áp dụng/kiểm chứng trên DB test**; chưa chạy integration mixed-row sau các thay đổi này. Chi tiết tại [P0-4](p0/p0-4-background-import.md).
> - **P0-5:** Chưa triển khai. Không có `@WebSocketGateway`/socket.io server, không có route hay component chat trong web, không có model conversation/message trong `schema.prisma`. Chỉ có đặc tả tại [P0-5](p0/p0-5-realtime-chat.md).
> - **P0-6:** Chỉ có staff web. Danh sách route thực tế trong `apps/web/src/app`: `/login`, `/change-password`, `/profile`, `/customers`, `/customers/import`, `/loan-products`, `/loan-contracts`, `/plans`, `/plans/catalog`, `/tasks`, `/staff`, `/branches`, `/roles`. Không có dashboard tổng quan, không có chat UI, không có manifest/service worker (chưa phải PWA). Xem [P0-6](p0/p0-6-web-pwa.md).
> - **Quy mô code đã đối chiếu:** 23 migration Prisma; 33 model và 19 enum trong `schema.prisma`; 39 permission trong `permission-catalog.json`; 8 controller (auth, access, customers, customer-imports, plans, tasks, capabilities, health); 17 file `*.spec.ts` ở API; 13 route web.
> - **Kiểm tra chạy 2026-11-21 (host):** `npm run db:validate`, `npm run db:generate`, `npm run typecheck` (API + web) đạt; 4 API suite tập trung đạt 37 test. Full API suite và integration DB cho migration mới **chưa chạy**; không migration nào được áp dụng trong lượt này.
> - **Worktree:** thay đổi code và tài liệu của lượt này chưa commit.
> - **Còn mở:** nghiệm thu toàn bộ P0-6 (dashboard, UI end-to-end); P0-5 chat; áp dụng + kiểm chứng các migration partial-row P0-4 và hồ sơ khách hàng trên DB cô lập; integration mixed-row; grants/cây chi nhánh production; tài liệu chính sách tài chính; scanner/quarantine, retention/legal hold, RPO/RTO và restore verification; cấu hình OTP/provider CUSTOMER và các cổng production.

**Ngày báo cáo gốc:** 2026-11-05 (phần "Đã triển khai" bên dưới giữ nguyên nội dung lịch sử của lượt đó).

**Phạm vi báo cáo gốc:** Khung API/web, nền P0-0 và code P0-1 cho identity/RBAC/audit theo yêu cầu Giai đoạn 0 đã xác nhận.

**Chuẩn bị P0:** Xem [kế hoạch triển khai tổng](p0-implementation-plan.md) và [mục lục các giai đoạn P0](p0/README.md) để biết thứ tự module, tiêu chí nghiệm thu và cổng dữ liệu thật.

**Yêu cầu được bổ sung sau scaffold:** Giai đoạn 0 bổ sung chat realtime ADVISING ↔ CUSTOMER, CUSTOMER read-only tra cứu dữ liệu của mình/gói vay, import chạy nền có kiểm tra từng dòng/rà trùng, quy trình kế hoạch-task-KPI với phê duyệt plan, xác minh thủ công và upload file vào MVP. Trạng thái 2026-11-21: P0-2 và P0-3 đã có API/UI lát cắt; hồ sơ customer đã mở rộng thêm trường nullable và format ngày sinh; P0-4 có pipeline import nhưng đang chờ nghiệm thu migration partial-row/hồ sơ mới; upload/download binary cho task evidence, chat realtime và CUSTOMER PWA vẫn còn mở.

## Đã triển khai (báo cáo gốc 2026-11-05)

- Monorepo npm workspaces với API NestJS và web Next.js TypeScript.
- API REST có prefix `/api/v1` dành cho API nghiệp vụ, validation DTO toàn cục, OpenAPI tại `/api/docs` ngoài môi trường production.
- Prisma Client qua PostgreSQL driver adapter, Prisma schema/config và lệnh generate/validate/migrate; P0-1 có migration identity/access, P0-2 có migration nghiệp vụ đã kiểm tra trên PostgreSQL Docker test, P0-3 có migration plan foundation và migration đa chi nhánh/xóa mềm đã áp dụng trên PostgreSQL development.
- Redis/BullMQ queue và worker riêng; retry/backoff, concurrency cấu hình được, healthcheck job mẫu, dừng an toàn.
- Runtime config kiểm tra NODE_ENV, API_PORT, DATABASE_URL, REDIS_URL và WORKER_CONCURRENCY; secrets không được đưa vào log khởi động.
- P0-1 thêm schema Branch/User/Role/Permission/RolePermission/UserRoleGrant/AuthSession/AuditEvent và migration PostgreSQL khởi tạo.
- Auth staff có password hash scrypt, lockout tài khoản, access token ngắn hạn, refresh token opaque hashed/rotation/reuse detection trong HttpOnly cookie, đổi mật khẩu bắt buộc với tài khoản provision mới và revoke session khi disable user.
- Guard xác thực session PostgreSQL trên mỗi request; protected route thiếu permission metadata bị fail-closed. Role catalog cố định, role/grant thay đổi có kiểm tra delegation và audit cùng transaction.
- API quản trị chi nhánh, user, role/grant và audit; nhánh kế thừa quyền xuống descendants; CUSTOMER token mock chỉ dev/test và không có quyền nghiệp vụ.
- Probe `GET /health` cho liveness và `GET /ready` kiểm tra PostgreSQL lẫn Redis; readiness trả thông báo lỗi an toàn.
- Giao diện khởi tạo bằng tiếng Việt nêu phạm vi CRM lõi đã được xác nhận, không hiển thị dữ liệu khách hàng giả.
- PostgreSQL và Redis local qua Docker Compose, chỉ bind cổng vào loopback; `.env.example` chứa placeholder và được gitignore khi sao chép.
- Ba unit test cho liveness/readiness đã chạy thành công sau khi chuyển readiness sang Prisma và Redis.
- Role ngoài OPERATOR được seed không quyền mặc định để chủ quản trị cấu hình; cây chi nhánh thật, OTP provider, grants/scope trên môi trường mục tiêu, scanner/retention vẫn cần thiết lập trước khi bật chức năng tương ứng.

## Bổ sung sau 2026-11-05 (đối chiếu code 2026-11-21)

- **Migration:** 23 migration, từ `20261105000000_p0_1_access_control` đến `20261121170000_customer_optional_profile_fields`. Migration P0-2/P0-3 nền đã áp dụng trên dev/test; hai migration partial-row P0-4 và migration trường hồ sơ mới **chưa** được áp dụng/kiểm chứng trên DB.
- **Schema:** 33 model, gồm customer/assignment/status history/duplicate, loan product + formula version, loan request/contract + status history + document + change history + OTP challenge, plan/approval/branch/metric catalog/metric, task/assignment/result/verification, `FileAsset`/`TaskResultEvidence`, `CustomerImportBatch`/`CustomerImportRow`, `AuditEvent`.
- **Enum:** 19 enum, gồm `CustomerVerificationStatus`, `DuplicateReviewStatus`, `LoanProductStatus`, `PlanApprovalDecision`, `FileScanStatus`, `CustomerImportBatchStatus`, `CustomerImportRowStatus`, `CustomerImportDuplicateDecision`, `ContractOtpChallengeStatus`.
- **Permission:** 39 mục trong `apps/api/prisma/permission-catalog.json` (nhóm organization, identity, access-control, audit, customers, loans, loan-products, plans, tasks, kpi, reports).
- **API:** 8 controller — auth, access, customers (customer/loan-product/loan-request/loan-contract), customer-imports, plans, tasks, capabilities, health. Không có controller chat.
- **Web:** 13 route staff như liệt kê ở phần cập nhật đầu báo cáo; đăng nhập/đổi mật khẩu/hồ sơ, khách hàng, import, sản phẩm vay, hợp đồng, kế hoạch, catalog KPI, công việc, nhân viên, chi nhánh, vai trò.
- **Chưa có trong code:** socket gateway/chat; PWA (manifest/service worker); dashboard tổng quan; endpoint upload/download evidence cho task result; endpoint báo cáo/xuất dữ liệu.

## Kiểm tra đã chạy

| Lệnh/kiểm tra | Kết quả |
|---|---|
| `npm install` (lượt nền trước) | Thành công; khi đó npm báo 26 advisory (5 low, 19 moderate, 2 high) |
| `npm run db:generate` | Thành công với Prisma Client 7.10.1 (lượt nền trước) |
| `npm run db:validate` | Thành công với schema P0-1; sau đó tiếp tục đạt qua các lượt P0-2/P0-3/P0-4 |
| `npm run typecheck` | Thành công cho API và web (các lượt P0-2/P0-3/P0-4 đã ghi nhận) |
| `npm run build` | Thành công cho NestJS API và Next.js web (các lượt đã ghi nhận) |
| P0-1 tests | 8 suite/49 test đạt (lượt P0-1) |
| P0-2 focused tests | 4 suite/37 test (2026-11-21); 10/10 customer/storage test (2026-11-19) |
| P0-3 integration | 19 assertion qua API/PostgreSQL trên DB test riêng |
| P0-4 API suite | 17 suite/108 test đạt trên stack test cô lập (lượt 2026-11-20) |
| `npm test --workspace @finance-crm/api` (host, lượt rà soát 2026-11-20) | 11/17 suite nạp được, 72 test đạt; 6 suite không nạp được do thiếu dependency trên host và Prisma Client cũ (xem ghi chú đầu báo cáo) |
| Kiểm tra cập nhật 2026-11-21 | `db:validate`, `db:generate`, typecheck API + web, 4 API suite/37 test đạt; full suite và integration migration chưa chạy |
| `git diff --check` | Exit 0 sau cập nhật tài liệu 2026-11-21 |

## Audit phụ thuộc và giới hạn

- Kiểm tra `npm audit --omit=dev` hiện báo **4 moderate** từ `shadcn@4.23.0 → ts-morph@26 → @ts-morph/common@0.27 → minimatch@10.2.6`. Npm chỉ đề xuất `shadcn@1.0.0` qua `npm audit fix --force` (breaking downgrade); không thực hiện và không đổi shadcn. Không có bản vá minimatch 10.x trong registry; nâng transitive lên minimatch 11 là major ngoài range khai báo của `@ts-morph/common`, nên chưa áp override chưa xác minh. Audit/install lượt này không xóa devDependencies và không tạo diff package-lock; manifest/lockfile được giữ nguyên.
- `npm install @nestjs/jwt@^11.0.2 --workspace @finance-crm/api` thất bại `EACCES` khi truy cập registry; manifest/lockfile không đổi. P0-1 dùng Node crypto cho HS256 và giữ kiểm thử bảo mật token thành việc còn lại.
- Lượt kiểm tra 2026-11-20 ghi nhận `node_modules` trên host thiếu `exceljs`, `unzipper`, `@aws-sdk/client-s3` và Prisma Client cũ. Tới 2026-11-21, `npm run db:generate`, typecheck API + web và 4 suite tập trung/37 test đã đạt trên host; full API suite chưa được chạy lại trong lượt này.
- Kết quả audit dependency được ghi nhận 2026-11-20; chưa chạy lại audit trong cập nhật trạng thái 2026-11-21.
- Upload contract document đã có local storage dev/test và MinIO/S3 tương thích tuỳ chọn; production upload bị fail-closed ở storage boundary khi chưa có scanner. Đây chỉ là chặn an toàn tạm thời, không thay thế scanner/quarantine.
- npm cảnh báo install scripts chưa được phê duyệt (gồm `@parcel/watcher`, `@scarf/scarf`, Prisma engines và tùy chọn native); Prisma client generation/typecheck/build vẫn chạy thành công trong môi trường toolbox.
- PostgreSQL backup/restore scripts dùng AES-256-GCM và đường dẫn `<repoRoot>/backup/`; crypto tests chỉ dùng payload tổng hợp trong memory. Chưa tạo backup thật, chưa restore DB và chưa xác minh recovery. RPO/RTO, retention/legal hold và restore verification chưa được chốt/triển khai.

## Chưa triển khai / còn chặn

- **P0-5 chat realtime:** chưa có mã nguồn nào (không socket gateway, không model conversation/message, không UI).
- **P0-4 bản mở rộng partial-row và hồ sơ khách hàng:** đã có schema/migration/parser/worker/API/UI nhưng hai migration partial-row và migration `20261121170000_customer_optional_profile_fields` chưa được áp dụng; chưa có integration mixed-row sau thay đổi. Readiness trả `BLOCKED` với `IMPORT_SCHEMA_NOT_READY` khi cột `failureDetailsExpiresAt` chưa tồn tại.
- **P0-6:** dashboard tổng quan, chat UI, CUSTOMER PWA/PWA shell, kiểm thử UI end-to-end đầy đủ chưa có. Sidebar hiển thị theo effective permissions nhưng không phải kiểm soát bảo mật.
- **Task evidence binary:** chưa có endpoint upload/download/xoá; `FileAsset` chỉ được liên kết metadata và hiện không có chỗ nào tạo bản ghi `FileAsset` trong code.
- **Production:** xác nhận/cấu hình ma trận role permission và cây chi nhánh trên PostgreSQL production; môi trường production chưa được migrate/seed trong bất kỳ lượt nào.
- **Chính sách tài chính:** đợi tài liệu nguồn có thẩm quyền; không mở rộng CUSTOMER allowlist sang số tiền/lãi suất/dư nợ/lịch trả trước khi duyệt.
- **File/PII:** scanner/quarantine, retention/legal hold, quyền xoá, RPO/RTO và diễn tập restore chưa triển khai; chưa tạo backup thật.
- **Vận hành:** CI pipeline nằm ngoài phạm vi theo yêu cầu; vulnerability/container scan và migration/backup/restore checks chưa có.
- **Cấu hình còn thiếu:** OTP provider + CUSTOMER auth (đang deferred), dashboard KPI catalog/công thức/kỳ/quyền xuất, retention audit và điều kiện vận hành production.

## Kết luận trạng thái

P0-0, P0-1, P0-2 và P0-3 có code cùng các mức kiểm chứng đã ghi nhận; phần mở rộng hồ sơ P0-2 mới qua validate/generate/typecheck và focused tests, chưa áp migration. P0-4 có pipeline nền đã nghiệm thu trên stack test cô lập, nhưng partial-row và migration hồ sơ mới chưa được kiểm chứng trên DB; P0-5 chưa bắt đầu, P0-6 mới có staff web. Chưa triển khai scanner/quarantine, retention/legal hold, RPO/RTO hoặc restore verification; chưa có migration/seed production và chưa có diễn tập backup/restore thật. Demo fixtures/grants không được xem là phê duyệt production; financial policy đợi tài liệu nguồn. **Hệ thống chưa production-ready.**
