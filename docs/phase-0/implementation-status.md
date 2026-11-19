    # Finance CRM — Báo cáo triển khai nền tảng đầu tiên

> **Cập nhật trạng thái 2026-11-19:** Trạng thái nghiệp vụ và tiến độ hiện tại; các phần chi tiết bên dưới là báo cáo nền lịch sử, không thay thế nội dung cập nhật này.
>
> - **P0-0/P0-1:** Nền dữ liệu, auth, RBAC/audit và API quản trị đã có. Quyền thao tác vẫn phụ thuộc vào grants/scope được cấu hình và xác thực tại backend.
> - **Quản lý chi nhánh:** Chi nhánh được tạo chưa có quản lý nhưng phải ở trạng thái INACTIVE. Chỉ kích hoạt khi đã có quản lý đang hoạt động và cha (nếu có) ACTIVE. Cấp `MANAGE` chỉ qua luồng phân công quản lý; role grant thông thường không cấp được quyền này. Khi quản lý bị gỡ hoặc tài khoản quản lý bị vô hiệu hóa, chi nhánh cùng các hậu duệ ACTIVE tự chuyển INACTIVE, có audit.
> - **P0-2:** Baseline và phần mở rộng customer/loan đang hoạt động. Các fixture/grants nhánh demo được người dùng duyệt chỉ cho demo; branch IDs và role grants đó **không** phải cấu hình production đã phê duyệt. API CUSTOMER giới hạn thông tin sản phẩm/hợp đồng theo allowlist: khi chưa duyệt chỉ tên/lãi suất/kỳ hạn; sau duyệt mới thêm nguồn/mô tả. Chính sách tài chính thực tế vẫn hoãn đến khi nhận tài liệu nguồn có thẩm quyền. MinIO/S3 tương thích đã cấu hình tùy chọn bằng biến môi trường; dev/test tiếp tục dùng local storage khi chưa cấu hình đủ endpoint/credentials/bucket. Upload ở production fail-closed cho đến khi có scanner. Có script backup/restore PostgreSQL mã hóa, ghi vào `<repoRoot>/backup/`; chỉ kiểm tra crypto bằng dữ liệu tổng hợp, chưa tạo backup thật hoặc restore DB. Còn thiếu scanner/quarantine, retention/legal hold, RPO/RTO và xác minh restore; không coi là production-ready. Chi tiết tại [tiến độ P0-2](p0/p0-2-customer-loan-workflow.md).
> - **P0-3:** API kế hoạch/task/kết quả theo phiên bản/xác minh có audit/KPI, danh mục KPI, duyệt/từ chối plan và bộ lọc kỳ KPI đã có. Giao việc theo nhóm lưu nội dung task dùng chung và assignment, target, trạng thái, kết quả riêng từng nhân viên; UI `/tasks` chọn nhân viên theo chi nhánh. Migration/seed đã áp dụng trên đúng database local dev/test; kiểm tra role grants xác nhận ADMIN/OPERATOR `ALL`, MANAGE `BRANCH`, ADVISING `ASSIGNED` cho task/KPI theo ma trận đã định. Đã xác minh KPI catalog 8 mục và mọi task result có assignment. Kiểm thử API/PostgreSQL P0-3 đạt 19 assertion: plan tạo mới ở `DRAFT`, chỉ chuyển `PENDING_APPROVAL` sau thao tác gửi; Admin được duyệt thủ công plan mình tạo, còn MANAGE không thể tự duyệt và Admin khác có thể duyệt. Toàn luồng tiếp tục qua giao task, nộp kết quả, xác minh và KPI; API typecheck và unit tests plans/tasks đạt. Seed dev được chạy lại để gỡ verification relation `PENDING_VERIFICATION` sai trên fixture; DB xác nhận kết quả đang chờ không có relation, kết quả hoàn tất vẫn `VERIFIED`. Probe `/tasks` với Admin xác nhận các nút xác minh, yêu cầu bổ sung và từ chối hiển thị đúng. Production không thay đổi. Probe 375px, kiểm thử UI end-to-end, upload/download binary và nghiệm thu môi trường production còn mở.
> - **P0-4:** Đã có schema/RBAC/UI, local temp storage trong `apps/api/import-customer-files`, ClamAV nội bộ và readiness fail-closed. Không dùng S3 cho import; file/staging được thiết kế để xóa sau xử lý, audit chỉ giữ số đếm. Upload vẫn khóa vì API batch, parser, worker processing, review và atomic confirm chưa hoàn tất. Xem [kế hoạch P0-4](p0/p0-4-background-import.md).
> - **P0-6:** Có các màn staff theo route riêng, gồm khách hàng, tài khoản nhân viên, chi nhánh, vai trò/quyền và các màn xác thực/hồ sơ. Luồng customer/loan staff là lát cắt đang có; CUSTOMER PWA, chat realtime UI và các luồng P0-6 còn lại chưa hoàn tất. Xem [P0-6](p0/p0-6-web-pwa.md) và [hướng dẫn sử dụng](user-guide.md).
> - **Kiểm tra gần nhất:** API typecheck/build đạt; full API unit suite 15 suites/98 tests đạt, gồm test local temp cleanup và ClamAV protocol; Prisma validate/generate và Docker Compose config đạt. Chưa chạy PostgreSQL migration cho P0-4 hoặc ClamAV container integration. Lượt này không thay đổi production/dữ liệu khách hàng.
> - **Còn mở:** nghiệm thu toàn bộ P0-6; grants/cây chi nhánh production; tài liệu chính sách tài chính; scanner/quarantine, retention/legal hold, RPO/RTO và restore verification; cấu hình OTP/provider CUSTOMER và các cổng production.

**Ngày:** 2026-11-05

**Phạm vi:** Khung API/web, nền P0-0 và code P0-1 cho identity/RBAC/audit theo yêu cầu Giai đoạn 0 đã xác nhận.

**Chuẩn bị P0:** Xem [kế hoạch triển khai tổng](p0-implementation-plan.md) và [mục lục các giai đoạn P0](p0/README.md) để biết thứ tự module, tiêu chí nghiệm thu và cổng dữ liệu thật.

**Yêu cầu được bổ sung sau scaffold:** Giai đoạn 0 bổ sung chat realtime ADVISING ↔ CUSTOMER, CUSTOMER read-only tra cứu dữ liệu của mình/gói vay, import chạy nền có preview/kiểm tra từng dòng/rà trùng, quy trình kế hoạch-task-KPI với phê duyệt plan, xác minh thủ công và upload file vào MVP. Trạng thái hiện tại: P0-2 đã có một phần backend customer/loan; P0-3 có API/migration task-result-KPI, catalog KPI, luồng duyệt plan, UI riêng `/plans`, `/plans/catalog`, `/tasks` theo bố cục B và quan hệ metadata evidence; upload/download binary, probe đã đăng nhập và nghiệm thu môi trường mục tiêu còn mở; chat realtime và CUSTOMER PWA vẫn còn mở.

## Đã triển khai

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
- Schema khách hàng/nghiệp vụ chưa có. Role ngoài OPERATOR được seed không quyền mặc định để chủ quản trị cấu hình; cây chi nhánh thật, OTP provider, quốc gia phone, grants/scope trên môi trường mục tiêu, scanner/retention vẫn cần thiết lập trước khi bật chức năng tương ứng.

## Kiểm tra đã chạy

| Lệnh/kiểm tra | Kết quả |
|---|---|
| `npm install` (lượt nền trước) | Thành công; khi đó npm báo 26 advisory (5 low, 19 moderate, 2 high) |
| `npm run db:generate` | Thành công với Prisma Client 7.10.1 |
| `npm run db:validate` | Thành công với schema P0-1 |
| `npm run typecheck` | Thành công cho API và web |
| `npm run build` | Thành công cho NestJS API và Next.js web |
| `node --check apps/api/scripts/seed-access-control.mjs` | Thành công |
| P0-1 tests | Chưa chạy trong lượt triển khai này |
| `git diff --check` | Exit 0, nhưng workspace hiện báo toàn bộ file là untracked nên Git không kiểm tra nội dung untracked |
| Docker Compose toolbox | Typecheck, build API/web và tests chạy thành công trong toolbox container |
| PostgreSQL migration evidence | Thành công trên test DB với Compose project riêng; đã xác nhận bảng, FK/CHECK constraints và dọn containers mà không xóa volume |

## Audit phụ thuộc và giới hạn

- Kiểm tra `npm audit --omit=dev` hiện báo **4 moderate** từ `shadcn@4.23.0 → ts-morph@26 → @ts-morph/common@0.27 → minimatch@10.2.6`. Npm chỉ đề xuất `shadcn@1.0.0` qua `npm audit fix --force` (breaking downgrade); không thực hiện và không đổi shadcn. Không có bản vá minimatch 10.x trong registry; nâng transitive lên minimatch 11 là major ngoài range khai báo của `@ts-morph/common`, nên chưa áp override chưa xác minh. Audit/install lượt này không xóa devDependencies và không tạo diff package-lock; manifest/lockfile được giữ nguyên.
- `npm install @nestjs/jwt@^11.0.2 --workspace @finance-crm/api` thất bại `EACCES` khi truy cập registry; manifest/lockfile không đổi. P0-1 dùng Node crypto cho HS256 và giữ kiểm thử bảo mật token thành việc còn lại.
- Upload contract đã có storage local dev/test và MinIO/S3 tương thích tùy chọn; production upload bị fail-closed ở storage boundary khi chưa có scanner. Đây chỉ là chặn an toàn tạm thời, không thay thế scanner/quarantine. Hạn triển khai scanner, retention/legal hold và kiểm soát vận hành: trước khi bật upload production hoặc lưu tệp thật.
- npm cảnh báo install scripts chưa được phê duyệt (gồm `@parcel/watcher`, `@scarf/scarf`, Prisma engines và tùy chọn native); Prisma client generation/typecheck/build vẫn chạy thành công trong workspace hiện tại, test P0-1 chưa chạy.
- PostgreSQL backup/restore scripts dùng AES-256-GCM và đường dẫn `<repoRoot>/backup/`; crypto tests chỉ dùng payload tổng hợp trong memory. Chưa tạo backup thật, chưa restore DB và chưa xác minh recovery. RPO/RTO, retention/legal hold và restore verification chưa được chốt/triển khai.

## Chưa triển khai / còn chặn

- Xác nhận/cấu hình ma trận role permission trên PostgreSQL production; môi trường production chưa được seed hoặc migrate trong lượt này.
- P0-2 có bulk assignment, catalog/formula sản phẩm, product-backed request/contract snapshot, approval scope, tài liệu/lịch sử; CUSTOMER product/contract allowlist giới hạn tên/lãi suất/kỳ hạn trước duyệt và thêm nguồn/mô tả sau duyệt. API typecheck, focused customer/storage tests (10 tests), backup crypto synthetic tests (3/3) và full API suite (12 suites/89 tests) đạt; API/PostgreSQL integration và 17-migration legacy-upgrade test đã đạt trên fixture/DB cô lập, không áp dụng lên production. MinIO chỉ dùng khi env được cấu hình đầy đủ; local storage vẫn dùng trong dev/test. Production uploads chưa bật vì scanner chưa tồn tại. Các demo fixtures/grants đã được duyệt chỉ cho demo; chưa có cây/grants production. Chính sách tài chính đợi tài liệu chính thức. Còn mở: scanner/quarantine, retention/legal hold, RPO/RTO, restore verification và nghiệm thu production.
- Schema/migration của các module nghiệp vụ CRM và kiểm thử tích hợp với PostgreSQL/Redis thật.
- Các giá trị cấu hình còn cần thiết lập được liệt kê trong [decision log](decision-log.md), gồm danh mục trường hợp đồng/gói vay, KPI/dashboard catalog, retention file/audit, vận hành production và thông số pháp lý. Nguồn yêu cầu vay từ CUSTOMER hoặc ADVISING đã xác định; private blob storage, scanner/quarantine, download có scope/RBAC, xóa/legal hold và dashboard trực quan chưa triển khai. Lược đồ per-message compact JSON đã được chốt ở Giai đoạn 0 nhưng chưa triển khai trong code.
- Vulnerability/container scan và migration/backup/restore checks; CI pipeline được bỏ qua theo yêu cầu.

## Kết luận trạng thái

P0-0 và P0-1 có nền; P0-3 có API/migration/UI theo trạng thái trên. P0-2 API typecheck, focused customer/storage tests, synthetic crypto tests, PostgreSQL integration và legacy migration-upgrade evidence đạt trong môi trường cô lập. Không tạo backup thật hoặc chạy restore DB. Demo fixtures/grants không được xem là phê duyệt production; financial policy đợi tài liệu nguồn. Chưa triển khai scanner/quarantine, retention/legal hold, RPO/RTO hoặc restore verification; hệ thống chưa production-ready.
