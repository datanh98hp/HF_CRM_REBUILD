# Finance CRM — Báo cáo triển khai nền tảng đầu tiên

**Ngày:** 2026-11-05

**Phạm vi:** Khung API/web, nền P0-0 và code P0-1 cho identity/RBAC/audit theo yêu cầu Giai đoạn 0 đã xác nhận.

**Chuẩn bị P0:** Xem [kế hoạch triển khai tổng](p0-implementation-plan.md) và [mục lục các giai đoạn P0](p0/README.md) để biết thứ tự module, tiêu chí nghiệm thu và cổng dữ liệu thật.

**Cập nhật yêu cầu sau scaffold:** Giai đoạn 0 hiện đưa chat realtime ADVISING ↔ CUSTOMER, CUSTOMER read-only tra cứu dữ liệu của mình/gói vay, import chạy nền có preview/kiểm tra từng dòng/rà trùng, quy trình kế hoạch-task-KPI với xác minh thủ công và upload file vào MVP; các module này chưa được triển khai trong mã nguồn.

## Đã triển khai

- Monorepo npm workspaces với API NestJS và web Next.js TypeScript.
- API REST có prefix `/api/v1` dành cho API nghiệp vụ, validation DTO toàn cục, OpenAPI tại `/api/docs` ngoài môi trường production.
- Prisma Client qua PostgreSQL driver adapter, Prisma schema/config và lệnh generate/validate/migrate; P0-1 đã thêm migration identity/access ban đầu, chưa có migration nghiệp vụ CRM.
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
| Docker Compose runtime | Chưa xác nhận: Docker CLI có nhưng không có lệnh `docker compose`/Compose plugin trong môi trường |
| PostgreSQL/Redis readiness, worker runtime, migration | Chưa kiểm tra do thiếu Docker Compose runtime |

## Audit phụ thuộc và giới hạn

- Lần `npm install` cho P0-0 báo **26 advisory** (5 low, 19 moderate, 2 high); chưa chạy audit chi tiết trong lượt này. Không chạy `npm audit fix --force` vì cần rà soát tương thích trước khi nâng major.
- `npm install @nestjs/jwt@^11.0.2 --workspace @finance-crm/api` thất bại `EACCES` khi truy cập registry; manifest/lockfile không đổi. P0-1 dùng Node crypto cho HS256 và giữ kiểm thử bảo mật token thành việc còn lại.
- Mức phơi nhiễm hiện tại giảm do chưa có API nghiệp vụ, file upload, dữ liệu khách hàng hoặc deployment; đây không phải biện pháp khắc phục và không được xem là audit sạch. Chủ xử lý đề xuất: kỹ thuật nền tảng. Hạn xử lý: trước khi bật upload, triển khai production hoặc bắt đầu lưu dữ liệu khách hàng (mốc nào đến trước). Chưa có chấp thuận rủi ro chính thức.
- npm cảnh báo install scripts chưa được phê duyệt (gồm `@parcel/watcher`, `@scarf/scarf`, Prisma engines và tùy chọn native); Prisma client generation/typecheck/build vẫn chạy thành công trong workspace hiện tại, test P0-1 chưa chạy.
- Docker CLI có sẵn nhưng không có Compose plugin (`docker compose` không nhận diện được). Vì vậy chưa kiểm thử readiness với PostgreSQL/Redis thật, migration, backup/restore hay restore drill.

## Chưa triển khai / còn chặn

- Chạy migration/seed trên PostgreSQL thật và cấu hình ma trận role permission cụ thể trước khi provision nhân viên.
- Customer, assignment, care history, task và dashboard APIs/data model.
- Schema/migration của các module nghiệp vụ CRM và kiểm thử tích hợp với PostgreSQL/Redis thật.
- Các giá trị cấu hình còn cần thiết lập được liệt kê trong [decision log](decision-log.md), gồm danh mục trường hợp đồng/gói vay, KPI/dashboard catalog, retention file/audit, vận hành production và thông số pháp lý. Nguồn yêu cầu vay từ CUSTOMER hoặc ADVISING đã xác định; kế hoạch, task chọn kế hoạch, kết quả thực đạt có xác minh, trạng thái/audit xác minh và phép so KPI chưa được triển khai. Lược đồ per-message compact JSON đã được chốt ở Giai đoạn 0 nhưng chưa triển khai trong code.
- CI pipeline, vulnerability/container scan, migration/backup/restore checks.

## Kết luận trạng thái

P0-0 và code/schema/migration P0-1 đã được tạo; Prisma generation/validation, typecheck và build đạt. Migration/seed chưa chạy trên PostgreSQL thật do thiếu Docker Compose; P0-1 security tests chưa chạy, nên chưa được xem là nghiệm thu hay production-ready.
