# P0-2 — Khách hàng, yêu cầu vay, hợp đồng và phân công

**Trạng thái:** Backend P0-2 đã triển khai; migration, seed, unit test, build và kiểm thử HTTP/PostgreSQL tích hợp trên Docker test đều đạt. Giao diện customer/loan theo lát cắt P0-6.

## Mục tiêu

Triển khai CRM customer lifecycle và tách rõ yêu cầu vay khỏi hợp đồng phát sinh.

## Phạm vi

- Hồ sơ customer tối thiểu: họ tên và điện thoại bắt buộc; email/ngày sinh tùy chọn; provenance và verification state.
- Dò trùng chuẩn hóa theo điện thoại/email và họ tên + DOB khi đủ dữ liệu; cảnh báo/review thủ công, không auto-merge.
- Customer status: `NEW`, `CONTACTED`, `QUALIFIED`, `IN_PROGRESS`, `CONVERTED`, `CLOSED`; chuyển linh hoạt với lý do và audit.
- Yêu cầu vay do CUSTOMER gửi hoặc ADVISING ghi nhận theo yêu cầu khách; dùng cho intake/tracking, không hàm ý approval.
- `LoanContract` là record/link riêng; `CONVERTED` chỉ được đặt khi có hợp đồng `COMPLETED`, và hợp đồng mới chỉ hoàn tất sau OTP CUSTOMER.
- Người có quyền chọn customer, gán ADVISING cụ thể, lưu assignment history; một adviser chính tại một thời điểm.
- CUSTOMER chỉ đọc dữ liệu của chính mình; thông tin hợp đồng/gói vay theo allowlist và scope.
- Mỗi chi nhánh có đúng một MANAGE chịu trách nhiệm chi nhánh; được quản lý các ADVISING thuộc quyền, phân công khách hàng, duyệt/chốt và xử lý trạng thái hợp đồng.
- CUSTOMER phải xác nhận OTP khi xác nhận hoàn thành hợp đồng vay.
- Hợp đồng nhận từ nguồn ngoài phải lưu thông tin nguồn, chạy idempotent, tìm/tạo customer trước khi gán hợp đồng; danh sách phân trang tối đa 20 phần tử/trang.

## Tiêu chí hoàn tất

- Backend kiểm tra quyền/scope cho list, search, detail, update, assignment và contract lookup.
- Mọi chuyển customer state có actor, from/to, timestamp, reason; không cho `CONVERTED` thiếu contract relation.
- Loan request không tự tạo hợp đồng hoặc quyết định eligibility/approval.
- Cập nhật assignment giữ lịch sử và chịu kiểm tra branch scope.
- Duplicate candidate không tự gộp; thao tác xác nhận/giải quyết được audit.

## Kết quả đã triển khai

- Prisma model và migration cho customer, lịch sử trạng thái, phân công, hàng đợi rà trùng, yêu cầu vay và hợp đồng vay.
- API `/api/v1/customers`, `/api/v1/loan-requests`, `/api/v1/loan-contracts`; role permissions được thêm vào permission catalog và bootstrap OPERATOR.
- Customer bắt buộc có số điện thoại Việt Nam dạng chuẩn 10 chữ số: bắt đầu `0`, chữ số thứ hai `1–9`; bỏ dấu phân cách, quy đổi `+84`/`0084`/`84` thành dạng nội địa. Email/ngày sinh tùy chọn. Chuẩn hóa tên bỏ dấu, email lowercase; dò trùng theo phone/email và tên + ngày sinh.
- Nhân viên xem dữ liệu theo grant và phạm vi `OWN`, `ASSIGNED`, `BRANCH` (bao gồm nhánh con), `ALL`. Danh sách quét tuần tự các trang dữ liệu để không cắt cụt kết quả do lọc scope sau truy vấn.
- Một quyết định rà trùng được hiển thị từ cả hai hồ sơ; cập nhật thông tin không xóa người/thời điểm/lý do đã xác minh. Candidate không còn khớp bị ẩn khỏi hàng đợi hiện tại nhưng vẫn lưu làm lịch sử. Không tự gộp hồ sơ.
- Mỗi đổi trạng thái có lịch sử và audit; `CONVERTED` chỉ hợp lệ khi đã liên kết hợp đồng. Phân công ghi lịch sử và PostgreSQL chặn nhiều tư vấn viên chính còn hiệu lực trên cùng khách hàng.
- CUSTOMER chỉ được đọc hồ sơ của mình, gửi yêu cầu vay cho chính mình và xem contract allowlist. JSON customer không chứa nguồn nhập, trạng thái xác minh nội bộ, mã chi nhánh hay người phụ trách; endpoint lịch sử phân công chỉ dành cho nhân viên.
- Quản lý chi nhánh được gán qua endpoint riêng; role `MANAGE` không thể cấp qua grant thường. Chi nhánh mới ở `INACTIVE`, chỉ kích hoạt khi có quản lý; PostgreSQL chặn nhánh `ACTIVE` không có quản lý. Quản lý được đọc cây con nhưng quyền ghi, phân công, cấp nhân viên, import và duyệt chỉ áp dụng tại nhánh được gán.
- Hợp đồng đi qua `PENDING_REVIEW -> APPROVED -> AWAITING_CUSTOMER_CONFIRMATION -> COMPLETED` (hoặc `REJECTED/CANCELLED`). OTP ràng buộc với hợp đồng, phiên bản và nội dung, hết hạn sau 5 phút, tối đa 5 lần thử, cooldown 60 giây và tối đa 3 challenge/giờ. Challenge lưu HMAC hash và chỉ dùng một lần; xác nhận thành công cũng đánh dấu số điện thoại đã được xác minh.
- `POST /loan-contracts/external` yêu cầu `Idempotency-Key`, lưu metadata/hash nguồn nhưng không lưu payload thô. Tự liên kết customer chỉ khi phone/tên/ngày sinh khớp duy nhất; trường hợp mới hoặc mơ hồ tạo hồ sơ `UNVERIFIED` để rà trùng. Lặp cùng payload trả bản ghi cũ, thay payload trả 409.
- Contract API dùng cursor, tối đa 20 item/trang. Customer chỉ nhận allowlist: mã hợp đồng, trạng thái, thông tin gói/loại/kỳ hạn, mốc duyệt/hoàn tất.

## Yêu cầu mới đã chốt — 2026-11-07

- Một MANAGE phụ trách mỗi chi nhánh; quản lý nhân viên ADVISING thuộc quyền, phân công khách hàng và chịu trách nhiệm duyệt/chốt, xử lý trạng thái hợp đồng. RBAC backend phải buộc grant vào branch node, không cho MANAGE tự cấp quyền vượt phạm vi.
- Khi chuyển hợp đồng sang hoàn thành, CUSTOMER xác nhận qua OTP. OTP này là xác nhận cho đúng một giao dịch/hợp đồng, khác với việc đơn thuần đăng nhập.
- Nguồn hợp đồng ngoài phải được ghi; customer được tìm hoặc tạo trước khi gắn contract; tiếp nhận có idempotency; danh sách API hiển thị 20 phần tử/trang.

## Thiết kế đã chốt và triển khai

### Ma trận quyền

| Vai trò | Phạm vi/việc chính |
|---|---|
| `OPERATOR` | Quản trị nền tảng và cấp quyền hệ thống; không mặc định dùng cho chăm sóc khách hàng thường ngày. |
| `ADMIN` | Quản trị nghiệp vụ toàn hệ thống theo các permission được cấp, có audit. |
| `MANAGE` | Một quản lý gán trực tiếp cho mỗi chi nhánh; đọc được nhánh con, thao tác ghi chỉ tại nhánh được gán. Quản lý ADVISING, phân công, duyệt và xử lý trạng thái hợp đồng. |
| `ADVISING` | Truy cập khách hàng được phân công; tiếp nhận yêu cầu vay, chuẩn bị dữ liệu/hồ sơ và xem trạng thái cần thiết; không tự duyệt/chốt hợp đồng. |
| `CUSTOMER` | Đọc dữ liệu allowlist của chính mình, gửi yêu cầu vay và xác nhận hoàn thành hợp đồng bằng OTP; không sửa nội dung hợp đồng. |

Ranh giới trên đã được chốt và kiểm thử: quản lý cha không thể sửa customer, cấp vai trò, import hoặc duyệt hợp đồng thuộc nhánh con.

### Luồng hợp đồng từ nguồn ngoài (đã triển khai)

1. Nhận và validate schema nguồn, chuẩn hóa phone, lưu metadata/hash; không giữ payload thô.
2. Chỉ link customer khi phone và tên khớp duy nhất, ngày sinh không mâu thuẫn; nếu mới/mơ hồ, tạo customer `UNVERIFIED` để rà trùng trước khi duyệt.
3. Unique `(sourceSystem, externalContractId)` và hash `Idempotency-Key`; lặp cùng payload trả bản ghi cũ, payload khác trả 409. Resolve customer, tạo contract, history và audit trong transaction.
4. Hợp đồng theo `PENDING_REVIEW -> APPROVED -> AWAITING_CUSTOMER_CONFIRMATION -> COMPLETED` hoặc `REJECTED/CANCELLED`; ghi trạng thái và audit.
5. Cursor pagination, page size tối đa 20, theo thứ tự createdAt/ID ổn định.

### Schema và allowlist áp dụng

- `LoanContract` lưu version/status, snapshot gói vay, metadata nguồn, hash payload, hash idempotency, actor và timestamp duyệt/hoàn tất; có unique `(sourceSystem, externalContractId)` và `idempotencyKeyHash`.
- Allowlist CUSTOMER hiện có mã hợp đồng, trạng thái, tên/mã/version gói, loại/kỳ hạn và timestamp duyệt/hoàn tất. Trường tiền/lãi/dư nợ/lịch trả chờ chủ tín dụng và Compliance xác nhận.

### OTP xác nhận hoàn thành

- Provider SMS nhận cấu hình `SMS_GATEWAY_URL`/`SMS_GATEWAY_TOKEN`; production chỉ cho phép HTTPS. SMS/PSTN có rủi ro đổi SIM và không chống phishing; cần đánh giá trước production theo [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html).
- OTP gắn `contractId` + version/hash, dùng một lần, TTL 5 phút, giới hạn 5 lần thử, cooldown 60 giây và tối đa 3 challenge/giờ. Xác nhận OTP thành công đánh dấu số điện thoại `VERIFIED`; mock CUSTOMER auth và `debugOtp` chỉ dành dev/test. Hướng dẫn transaction-bound OTP theo [OWASP Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html).

Schema, trạng thái, allowlist, nhập ngoài và ranh giới quyền manager đã triển khai. SMS provider thật và xác thực CUSTOMER production vẫn cần cấu hình/tích hợp.

## Kiểm thử đã chạy

- `npm run typecheck --workspace @finance-crm/api`: đạt.
- `npm test --workspace @finance-crm/api -- --runInBand`: 19/19 unit tests đạt, gồm chuẩn hóa phone Việt Nam local/`+84`/`0084`/`84`, tìm kiếm, chữ số thứ hai bằng `0`, các dạng sai và RBAC scope.
- `npm run test:integration --workspace @finance-crm/api`: kịch bản HTTP/PostgreSQL kiểm tra manager read/write scope, contract approval/OTP, idempotency/customer resolution và giới hạn 20/trang; đạt trên Docker test.
- GitHub Actions workflow `.github/workflows/ci.yml` tự dựng PostgreSQL/Redis, áp migration/seed, khởi chạy API, sau đó chạy typecheck, unit tests và P0-2 integration tests trên push/PR.
- `npm run db:validate --workspace @finance-crm/api` và `db:generate`: đạt.
- Docker test: các migration customer/duplicate/contract/manager áp dụng thành công; seed chạy được trên Linux container sau khi sửa runner và đồng bộ permission.
- HTTP smoke test trên API + PostgreSQL dev: CUSTOMER đọc hồ sơ mình, bị chặn hồ sơ người khác, tạo yêu cầu vay của mình và bị chặn tạo cho người khác; contract list chỉ có dữ liệu của mình.
- HTTP smoke test nhân viên: tạo khách hàng, thấy duplicate candidate từ hai phía, giải quyết duplicate, bị chặn CONVERTED khi chưa có hợp đồng, tạo hợp đồng rồi chuyển trạng thái thành công. Fixture đã được dọn sạch.
- HTTP smoke test sau cập nhật: đổi điện thoại làm candidate không còn khớp bị ẩn khỏi hai hàng đợi; cả hai bản ghi lịch sử được giữ. PostgreSQL có unique index cho một primary assignment đang hoạt động. Fixture đã được dọn sạch.

## Còn lại trước khi nghiệm thu đầy đủ P0-2

- Chờ workflow GitHub Actions chạy trên remote sau khi push/PR; workflow và integration suite đã được thêm, integration suite đạt trên stack Docker test local.
- Chờ GitHub Actions chạy trên remote sau push/PR.
- Gán MANAGE thật cho từng chi nhánh vận hành; migration chuyển nhánh cũ về `INACTIVE` để chờ manager trước khi kích hoạt lại.
- Cấu hình/test provider SMS thực tế và hoàn tất auth CUSTOMER mobile; hiện dev/test dùng mock token và `debugOtp`.
- Chủ tín dụng/Compliance quyết định có thêm số tiền/lãi suất/dư nợ/lịch trả vào allowlist hay giữ trường hiện tại.
- Giao diện P0-2 thuộc P0-6, chưa triển khai trong lát cắt backend này.
- Giao diện nghiệp vụ P0-2 thuộc P0-6; chưa có UI customer/contract trong lát cắt này.

## Cấu hình còn cần

SMS provider, xác thực CUSTOMER mobile, manager thật cho từng chi nhánh và quyết định cuối về trường tài chính chi tiết.
