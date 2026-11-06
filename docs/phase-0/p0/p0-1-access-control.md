# P0-1 — Tổ chức, auth, RBAC và audit

**Trạng thái:** Đã triển khai code/schema/migration; chờ chạy migration, seed và kiểm thử tích hợp trên PostgreSQL.

## Mục tiêu

Tạo identity và quyền backend trước khi mở bất kỳ API nghiệp vụ nào có dữ liệu khách hàng.

## Phạm vi

- Cây `BRANCH` tổng → chi nhánh con và người dùng thuộc đơn vị.
- Role chuẩn `OPERATOR`, `ADMIN`, `MANAGE`, `ADVISING`; role tùy chỉnh chỉ ghép permission từ catalog và grantable set.
- Permission theo nhóm chức năng × scope `OWN`, `ASSIGNED`, `BRANCH`, `ALL` × node tổ chức.
- Quyền `permissions.delegate` tách riêng tập quyền được ủy quyền: global delegate có thể cấu hình catalog; branch delegate chỉ cấp scope tối đa trong node/descendants được giao, không cấp `ALL`.
- Đăng nhập/session nhân viên theo baseline auth trong `AGENT.md`.
- Actor context, API `/api/v1/auth/me`, backend policy guards, permission delegation và audit.
- CUSTOMER mock chỉ dev/test; production mặc định tắt/fail-closed.
- Login nhân viên bằng username/password; password hash scrypt, lockout sau 5 lần sai, access token ngắn hạn, refresh token opaque được hash/lưu DB, xoay vòng và phát hiện reuse; refresh token chỉ gửi qua HttpOnly cookie.
- Provisioning operator lần đầu qua seed command; catalogue quyền cố định trong repository, không nhận định nghĩa quyền từ client.
- API quản trị có scope cho branch, user, role/grant và audit; mọi mutation ghi audit event cùng transaction.

## Tiêu chí hoàn tất

- Mỗi endpoint được bảo vệ kiểm tra permission và resource scope ở backend.
- Không thể tự nâng quyền hoặc cấp quyền ngoài tập được ủy quyền; role system được bảo vệ.
- Ghi thay đổi permission/role và audit trong cùng transaction; thu hồi quyền có hiệu lực theo consistency policy đã chọn.
- Có kiểm tra chéo scope chi nhánh, tài nguyên người khác, admin bị giới hạn, role escalation và IDOR.
- Giao diện ẩn chức năng không được xem là kiểm soát bảo mật.
- Chưa đạt tiêu chí nghiệm thu cho đến khi unit/integration/E2E security tests và migration được chạy trên PostgreSQL.

## Cấu hình còn cần

Nạp cây chi nhánh thật, role grants và danh sách permission có thể ủy quyền. Không dùng cấu hình giả định làm quyền production.

## API code đã thêm

- `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/password`, `GET /api/v1/auth/me`.
- `POST /api/v1/auth/dev/customer-token` chỉ phát token giả lập trong `development`/`test`; mock actor chỉ được truy cập các route đánh dấu authenticated-only, không cấp permission nghiệp vụ.
- `/api/v1/access/permissions`, `/roles`, `/branches`, `/users`, `/role-grants`, `/audit-events` và các thao tác ghi tương ứng. Route không có permission metadata bị từ chối mặc định.
- Scope `BRANCH` kế thừa xuống hậu duệ bằng quan hệ parent-child. Các module nghiệp vụ phải gọi `assertResourceAccess` với owner/assignee/branch đã đọc từ DB; không dùng ID do request gửi lên làm bằng chứng quyền.

## Cấu hình/setup còn lại

- Đặt `AUTH_ACCESS_TOKEN_SECRET` riêng từng môi trường, tối thiểu 32 ký tự ngẫu nhiên; không dùng giá trị mẫu.
- Đặt `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_DISPLAY_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` (tối thiểu 16 ký tự) chỉ trong secret store/.env cục bộ.
- Sau migration, chạy `npm run db:seed` để nạp permission catalog/system roles và bootstrap operator. Các role nghiệp vụ ngoài operator không được cấp quyền mặc định; operator cần cấu hình role permission theo ma trận đã duyệt trước khi mời người dùng.
- Login nhân viên hiện dùng username/password như mặc định kỹ thuật; OTP provider CUSTOMER chưa cấu hình và không được giả lập thành auth production.
- Login limiter hiện là bộ đếm theo IP trong từng process cộng lockout theo tài khoản; trước production nhiều replica cần cấu hình rate limit tại reverse proxy/gateway và trust-proxy theo topology thực tế.
- JWT HS256 ký/xác minh bằng `node:crypto` với algorithm cố định, issuer/audience/expiry; cần unit/security review riêng trước production. Cài `@nestjs/jwt` bị registry từ chối trong môi trường này nên không thêm dependency ngoài.
- Docker Compose chạy migration một lần trước API/worker. Seed operator không chạy tự động: sau khi cấu hình các giá trị bootstrap trong `.env`, chạy `docker compose --profile ops run --rm seed`. Thông tin bootstrap chỉ được truyền vào container seed một lần.
