    # Finance CRM — Báo cáo triển khai nền tảng đầu tiên

> **Cập nhật trạng thái 2026-11-12:** Trạng thái nghiệp vụ và tiến độ hiện tại; các phần chi tiết bên dưới là báo cáo nền lịch sử, không thay thế nội dung cập nhật này.
>
> - **P0-0/P0-1:** Nền dữ liệu, auth, RBAC/audit và API quản trị đã có. Quyền thao tác vẫn phụ thuộc vào grants/scope được cấu hình và xác thực tại backend.
> - **Quản lý chi nhánh:** Chi nhánh được tạo chưa có quản lý nhưng phải ở trạng thái INACTIVE. Chỉ kích hoạt khi đã có quản lý đang hoạt động và cha (nếu có) ACTIVE. Cấp `MANAGE` chỉ qua luồng phân công quản lý; role grant thông thường không cấp được quyền này. Khi quản lý bị gỡ hoặc tài khoản quản lý bị vô hiệu hóa, chi nhánh cùng các hậu duệ ACTIVE tự chuyển INACTIVE, có audit.
> - **P0-2:** Backend customer/assignment/duplicate review/loan request/contract cùng các luồng đã mô tả tại [P0-2](p0/p0-2-customer-loan-workflow.md); migration và kiểm thử trên PostgreSQL Docker test đã được ghi nhận trong báo cáo trước.
> - **P0-3:** API kế hoạch/task/kết quả theo phiên bản/xác minh có audit/KPI và giao diện `/tasks` theo wireframe B đã có; permission task/KPI đã thêm vào catalog. Quan hệ metadata `FileAsset` ↔ `TaskResultEvidence` đã triển khai; hai migration P0-3 đã áp dụng trên PostgreSQL test riêng. Typecheck, 48 unit tests và production Docker builds API/web đạt. Upload/download binary, probe trực quan 375px và nghiệm thu môi trường mục tiêu còn mở.
> - **P0-6:** Có các màn staff theo route riêng, gồm khách hàng, tài khoản nhân viên, chi nhánh, vai trò/quyền và các màn xác thực/hồ sơ. Luồng customer/loan staff là lát cắt đang có; CUSTOMER PWA, chat realtime UI và các luồng P0-6 còn lại chưa hoàn tất. Xem [P0-6](p0/p0-6-web-pwa.md) và [hướng dẫn sử dụng](user-guide.md).
> - **Kiểm tra gần nhất:** Prisma validate/generate, typecheck API/web và 7 suites/48 unit tests đạt. Migration evidence áp dụng với exit code 0; các FK/CHECK constraints đã xác nhận. Production Docker builds của API và web đạt, route `/tasks` có trong build output. Build web qua dev toolbox thất bại do `NODE_ENV=development`; production Docker build thành công. Test PostgreSQL chạy dưới Compose project riêng, sau đó containers được dọn mà không xóa volume; database development không bị đổi.
> - **Còn mở:** nghiệm thu toàn bộ P0-6, xác nhận quyền/grants và cây chi nhánh thật trên môi trường mục tiêu, cấu hình OTP/provider CUSTOMER và các cổng production trong P0-1/P0-2.

**Ngày:** 2026-11-05

**Phạm vi:** Khung API/web, nền P0-0 và code P0-1 cho identity/RBAC/audit theo yêu cầu Giai đoạn 0 đã xác nhận.

**Chuẩn bị P0:** Xem [kế hoạch triển khai tổng](p0-implementation-plan.md) và [mục lục các giai đoạn P0](p0/README.md) để biết thứ tự module, tiêu chí nghiệm thu và cổng dữ liệu thật.

**Yêu cầu được bổ sung sau scaffold:** Giai đoạn 0 bổ sung chat realtime ADVISING ↔ CUSTOMER, CUSTOMER read-only tra cứu dữ liệu của mình/gói vay, import chạy nền có preview/kiểm tra từng dòng/rà trùng, quy trình kế hoạch-task-KPI với xác minh thủ công và upload file vào MVP. Trạng thái hiện tại: P0-2 đã có một phần backend customer/loan; P0-3 có API/migration task-result-KPI, UI task/KPI tại `/tasks` theo wireframe B và quan hệ metadata evidence; upload/download binary cùng nghiệm thu môi trường mục tiêu còn mở; chat realtime và CUSTOMER PWA vẫn còn mở.

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
- Schema khách hàng/nghiệp vụ chưa có. Role ngoài OPERATOR được seed không quyền mặc định để chủ quản trị cấu hình; cây chi nhánh thật, OTP provider, quốc gia phone, metric/đơn vị KPI, scanner/retention vẫn cần thiết lập trước khi bật chức năng tương ứng.

## Kiểm tra đã chạy

| Lệnh/kiểm tra | Kết quả |
|---|---|
| `npm install` | Thành công; cập nhật lockfile, npm báo 26 advisory (5 low, 19 moderate, 2 high) |
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

- Lần `npm install` cho P0-0 báo **26 advisory** (5 low, 19 moderate, 2 high); chưa chạy audit chi tiết trong lượt này. Không chạy `npm audit fix --force` vì cần rà soát tương thích trước khi nâng major.
- `npm install @nestjs/jwt@^11.0.2 --workspace @finance-crm/api` thất bại `EACCES` khi truy cập registry; manifest/lockfile không đổi. P0-1 dùng Node crypto cho HS256 và giữ kiểm thử bảo mật token thành việc còn lại.
- Mức phơi nhiễm riêng với luồng file hiện giảm do chưa có upload/download binary hoặc dữ liệu file thật; đây không phải biện pháp khắc phục và không được xem là audit sạch. Chủ xử lý đề xuất: kỹ thuật nền tảng. Hạn xử lý: trước khi bật upload, triển khai production hoặc bắt đầu lưu dữ liệu khách hàng (mốc nào đến trước). Chưa có chấp thuận rủi ro chính thức.
- npm cảnh báo install scripts chưa được phê duyệt (gồm `@parcel/watcher`, `@scarf/scarf`, Prisma engines và tùy chọn native); Prisma client generation/typecheck/build vẫn chạy thành công trong workspace hiện tại, test P0-1 chưa chạy.
- Docker Compose hiện có; validation chạy trong toolbox. `npm run build` qua dev toolbox bị ảnh hưởng bởi `NODE_ENV=development` và Next prerender lỗi; production Docker builds API/web đạt. Backup/restore và restore drill vẫn chưa kiểm thử.

## Chưa triển khai / còn chặn

- Cấu hình ma trận role permission cụ thể trước khi provision nhân viên; migration/seed P0-1 chưa được xác nhận trên PostgreSQL production.
- Customer/assignment/care-history APIs còn mở; P0-3 đã có API/UI task/KPI và metadata evidence relation, còn upload/download binary, kiểm tra UI thật và nghiệm thu runtime trên môi trường mục tiêu.
- Schema/migration của các module nghiệp vụ CRM và kiểm thử tích hợp với PostgreSQL/Redis thật.
- Các giá trị cấu hình còn cần thiết lập được liệt kê trong [decision log](decision-log.md), gồm danh mục trường hợp đồng/gói vay, KPI/dashboard catalog, retention file/audit, vận hành production và thông số pháp lý. Nguồn yêu cầu vay từ CUSTOMER hoặc ADVISING đã xác định; private blob storage, scanner/quarantine, download có scope/RBAC, xóa/legal hold, dashboard trực quan và catalog KPI dùng chung chưa triển khai. Lược đồ per-message compact JSON đã được chốt ở Giai đoạn 0 nhưng chưa triển khai trong code.
- Vulnerability/container scan và migration/backup/restore checks; CI pipeline được bỏ qua theo yêu cầu.

## Kết luận trạng thái

P0-0 và code/schema/migration P0-1 đã được tạo; migration P0-3 cho plan/branch-scope chạy trên development, migration task/result/KPI và evidence chạy trên PostgreSQL test riêng. Prisma validate/generate, typecheck, 48 unit tests và production Docker builds API/web đạt. UI task/KPI đã có theo wireframe B nhưng chưa probe trực quan ở 375px; binary evidence và nghiệm thu môi trường mục tiêu chưa hoàn tất. Chưa xem nền tảng là production-ready.
