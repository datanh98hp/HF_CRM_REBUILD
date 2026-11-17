    # Finance CRM — Báo cáo triển khai nền tảng đầu tiên

> **Cập nhật trạng thái 2026-11-17:** Trạng thái nghiệp vụ và tiến độ hiện tại; các phần chi tiết bên dưới là báo cáo nền lịch sử, không thay thế nội dung cập nhật này.
>
> - **P0-0/P0-1:** Nền dữ liệu, auth, RBAC/audit và API quản trị đã có. Quyền thao tác vẫn phụ thuộc vào grants/scope được cấu hình và xác thực tại backend.
> - **Quản lý chi nhánh:** Chi nhánh được tạo chưa có quản lý nhưng phải ở trạng thái INACTIVE. Chỉ kích hoạt khi đã có quản lý đang hoạt động và cha (nếu có) ACTIVE. Cấp `MANAGE` chỉ qua luồng phân công quản lý; role grant thông thường không cấp được quyền này. Khi quản lý bị gỡ hoặc tài khoản quản lý bị vô hiệu hóa, chi nhánh cùng các hậu duệ ACTIVE tự chuyển INACTIVE, có audit.
> - **P0-2:** Baseline customer/assignment/duplicate review/loan request/contract còn hoạt động. Phần mở rộng có bulk assignment, catalog/formula sản phẩm, product-backed request/contract có snapshot và duyệt toàn cục cho ADMIN/OPERATOR (kể cả hợp đồng do mình tạo); MANAGE vẫn theo branch và không tự duyệt. `/loan-contracts` có tìm mã, page size 5–100 (mặc định 20), tên chi nhánh, tài liệu DOCX/PDF/PNG/JPG và lịch sử trạng thái/tài liệu. Prisma generate, API/web typecheck/build và 4 suite unit tập trung P0-2/37 tests đạt. API/PostgreSQL integration đã đạt trước thay đổi quyền duyệt hiện tại; script đã cập nhật theo chính sách mới nhưng chưa chạy lại. Browser `/loan-contracts` đã kiểm tra ở desktop và 375px trước lần chỉnh bố cục bộ lọc/page size này; cần probe lại giao diện mới. Full API unit suite có 1 test auth ngoài phạm vi P0-2 fail do spec kỳ vọng mật khẩu mới tối thiểu 12 ký tự trong khi DTO cho phép 8 ký tự. Tài liệu hiện lưu local tạm, chưa sẵn sàng production; chưa có endpoint sửa điều khoản tài chính. Còn mở: probe `/customers` và `/loan-products`, migration upgrade trên DB legacy, pagination catalog, grants thật theo chi nhánh, policy tài chính/allowlist và storage an toàn. CUSTOMER PWA, OTP provider thật và thumbnail upload vẫn hoãn. Chi tiết tại [tiến độ P0-2](p0/p0-2-customer-loan-workflow.md).
> - **P0-3:** API kế hoạch/task/kết quả theo phiên bản/xác minh có audit/KPI, danh mục KPI, duyệt/từ chối plan và bộ lọc kỳ KPI đã có. Giao việc theo nhóm lưu nội dung task dùng chung và assignment, target, trạng thái, kết quả riêng từng nhân viên; UI `/tasks` chọn nhân viên theo chi nhánh. Migration/seed đã áp dụng trên đúng database local dev/test; kiểm tra role grants xác nhận ADMIN/OPERATOR `ALL`, MANAGE `BRANCH`, ADVISING `ASSIGNED` cho task/KPI theo ma trận đã định. Đã xác minh KPI catalog 8 mục và mọi task result có assignment. Kiểm thử API/PostgreSQL P0-3 đạt 19 assertion: plan tạo mới ở `DRAFT`, chỉ chuyển `PENDING_APPROVAL` sau thao tác gửi; Admin được duyệt thủ công plan mình tạo, còn MANAGE không thể tự duyệt và Admin khác có thể duyệt. Toàn luồng tiếp tục qua giao task, nộp kết quả, xác minh và KPI; API typecheck và unit tests plans/tasks đạt. Seed dev được chạy lại để gỡ verification relation `PENDING_VERIFICATION` sai trên fixture; DB xác nhận kết quả đang chờ không có relation, kết quả hoàn tất vẫn `VERIFIED`. Probe `/tasks` với Admin xác nhận các nút xác minh, yêu cầu bổ sung và từ chối hiển thị đúng. Production không thay đổi. Probe 375px, kiểm thử UI end-to-end, upload/download binary và nghiệm thu môi trường production còn mở.
> - **P0-4:** Chưa triển khai code. Đã chuẩn bị kế hoạch theo khảo sát module customer, duplicate review, BullMQ worker và FileAsset; còn cổng quyết định về quyền import, giới hạn parser, scanner và retention/legal trước khi mở upload thật. Xem [kế hoạch P0-4](p0/p0-4-background-import.md).
> - **P0-6:** Có các màn staff theo route riêng, gồm khách hàng, tài khoản nhân viên, chi nhánh, vai trò/quyền và các màn xác thực/hồ sơ. Luồng customer/loan staff là lát cắt đang có; CUSTOMER PWA, chat realtime UI và các luồng P0-6 còn lại chưa hoàn tất. Xem [P0-6](p0/p0-6-web-pwa.md) và [hướng dẫn sử dụng](user-guide.md).
> - **Kiểm tra gần nhất:** Trong lượt tiếp tục P0-2 ngày 2026-11-17, schema validation, root typecheck, API/web production build, 3 suite unit tập trung P0-2/31 tests và API/PostgreSQL integration đều đạt. Full API unit suite có một test auth ngoài phạm vi P0-2 fail do spec/DTO bất nhất về mật khẩu tối thiểu. Integration bao gồm contract RBAC theo branch/toàn cục, tìm kiếm/page size, tài liệu/lịch sử, formula snapshot và bulk assignment. Browser `/loan-contracts` được kiểm tra ở 1440px và 375px; không tràn ngang, các thao tác tìm kiếm/page size và quản lý tài liệu hoạt động. Migration production không thay đổi; migration upgrade trên DB legacy và browser `/customers`, `/loan-products` còn mở.
> - **Còn mở:** nghiệm thu toàn bộ P0-6, xác nhận quyền/grants và cây chi nhánh thật trên môi trường mục tiêu, probe `/customers`, `/loan-products`, `/plans` và `/tasks` ở viewport 375px, migration upgrade trên dữ liệu legacy, cấu hình OTP/provider CUSTOMER và các cổng production trong P0-1/P0-2.

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

- Xác nhận/cấu hình ma trận role permission trên PostgreSQL production; môi trường production chưa được seed hoặc migrate trong lượt này.
- P0-2 mở rộng đã có bulk assignment API/UI, catalog/formula product, request/contract theo product với kiểm tra điều kiện, tính toán server-side, snapshot; ADMIN/OPERATOR có quyền duyệt toàn cục kể cả hợp đồng do mình tạo, MANAGE theo branch và không tự duyệt. `/loan-contracts` có tìm kiếm, page size bên dưới danh sách, tên chi nhánh, tài liệu và lịch sử. Khi duyệt hợp đồng, API ghi lịch sử/audit và tự chuyển khách sang `CONVERTED`; chi tiết hợp đồng staff hiển thị product snapshot. API/web typecheck, build và 4 suite unit tập trung P0-2/37 tests đạt; integration PostgreSQL đã đạt trước thay đổi quyền duyệt, script hiện tại chưa chạy lại. Browser `/loan-contracts` trên desktop/375px cần chạy lại sau chỉnh layout. Full API suite lần gần nhất có một test auth ngoài phạm vi P0-2 fail do spec kỳ vọng mật khẩu tối thiểu 12 ký tự nhưng DTO cho phép 8. Migration production không thay đổi. Còn mở: probe `/customers` và `/loan-products`, migration upgrade trên DB legacy, grants thật theo chi nhánh và phê duyệt policy tài chính/allowlist.
- Schema/migration của các module nghiệp vụ CRM và kiểm thử tích hợp với PostgreSQL/Redis thật.
- Các giá trị cấu hình còn cần thiết lập được liệt kê trong [decision log](decision-log.md), gồm danh mục trường hợp đồng/gói vay, KPI/dashboard catalog, retention file/audit, vận hành production và thông số pháp lý. Nguồn yêu cầu vay từ CUSTOMER hoặc ADVISING đã xác định; private blob storage, scanner/quarantine, download có scope/RBAC, xóa/legal hold và dashboard trực quan chưa triển khai. Lược đồ per-message compact JSON đã được chốt ở Giai đoạn 0 nhưng chưa triển khai trong code.
- Vulnerability/container scan và migration/backup/restore checks; CI pipeline được bỏ qua theo yêu cầu.

## Kết luận trạng thái

P0-0 và P0-1 có nền; P0-3 có API/migration/UI theo trạng thái trên. P0-2 baseline và phần mở rộng đã qua typecheck, production build, focused unit tests, PostgreSQL integration và browser probe `/loan-contracts` trên desktop/375px trong lượt 2026-11-17. Migration/seed production chưa thực hiện. Migration upgrade trên dữ liệu legacy, probe `/customers` và `/loan-products`, binary evidence P0-3 và nghiệm thu production còn mở. Chưa xem nền tảng là production-ready.
