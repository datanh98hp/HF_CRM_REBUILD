# P0-2 — Khách hàng, yêu cầu vay, hợp đồng và phân công

**Trạng thái cập nhật 2026-11-16:** Baseline P0-2 hiện tại đã triển khai và có kiểm thử như ghi ở phần lịch sử bên dưới. Phần mở rộng đang được triển khai dở và tạm dừng theo yêu cầu: đã sửa schema/migration, permission catalog/seed và bắt đầu bộ máy công thức cùng service nghiệp vụ; chưa nối controller, chưa hoàn tất các service/helper, chưa có UI mới, chưa generate/validate Prisma, chưa chạy test/build và chưa áp dụng migration lên database. Worktree hiện tại chưa được xác nhận build được; không triển khai tiếp cho tới khi được yêu cầu. CUSTOMER PWA, xác nhận OTP thật và upload thumbnail an toàn vẫn nằm ngoài lượt này.

## Tiến độ mở rộng mới nhất — tạm dừng

### Quyết định đã thống nhất

- Phân công: chọn nhiều khách hàng bằng checkbox → chọn một nhân viên ADVISING trong combobox → bấm **Phân công**; một lần gửi áp dụng cùng nhân viên cho tất cả khách được chọn.
- Phạm vi quyền: MANAGE quản lý sản phẩm và phân công trong chi nhánh được gán; ADMIN/OPERATOR có phạm vi toàn hệ thống. ADMIN/OPERATOR thiết lập phiên bản công thức; nhân viên chỉ gửi đầu vào để tính và không nhận công thức để tự sửa.
- Công thức: DSL số học an toàn `+ - * /`, ngoặc, `min`, `max`, `round(value, digits)`; cấm `eval`. Biến cơ sở `principal`, `annualRatePercent`, `termMonths`; biến bổ sung có nhãn/min/max/default. Chỉ tính khi người dùng bấm **Tính lãi**; lưu phiên bản công thức, đầu vào và kết quả cùng hợp đồng. Không tự điền lãi suất hay dữ liệu tài chính giả.
- UI staff theo wireframe đã chọn: phân công A (bảng và thanh gán hàng loạt), sản phẩm B (danh sách và chi tiết/công thức), hợp đồng B (bảng và panel chi tiết). CUSTOMER PWA và nhà cung cấp OTP vẫn hoãn.

### Đã bắt đầu trong code

- Đã thêm model/field trong `apps/api/prisma/schema.prisma` và migration `20261116000000_p0_2_loan_products_formula_snapshots` cho sản phẩm vay, phiên bản công thức bất biến, dữ liệu yêu cầu vay và snapshot tài chính trên hợp đồng. Migration mới chỉ là file, chưa được áp dụng.
- Đã thêm các quyền `loan-products.read/manage/publish/formula.manage` vào catalog và cập nhật quyền mặc định MANAGE/ADVISING trong seed.
- Đã thêm bộ phân tích/đánh giá công thức an toàn và test unit dự kiến trong `apps/api/src/customers/loan-formula.ts` cùng `.spec.ts`.
- Đã bắt đầu DTO và các method service cho phân công hàng loạt, catalog sản phẩm, phiên bản công thức và tính thử; đây chưa phải API sử dụng được vì controller, các helper phụ thuộc, tích hợp request/contract và kiểm thử chưa hoàn thành.

### Còn lại khi tiếp tục

1. Hoàn tất service/helper và controller; nối request vay với sản phẩm, tiền, kỳ hạn; tạo hợp đồng bằng cách tính lại phía server và lưu snapshot; chặn người tạo tự duyệt hợp đồng.
2. Bổ sung kiểm thử unit/integration cho rollback toàn bộ phân công, branch scope, điều kiện sản phẩm, snapshot/version, customer không thể tạo hợp đồng và maker-checker.
3. Generate/validate Prisma, rà soát migration trên database test có dữ liệu cũ; không chạy trên production.
4. Dựng/nối ba màn staff theo A/B/B đã chọn; cập nhật role navigation và xử lý đủ trạng thái tải/rỗng/lỗi/responsive.
5. Cập nhật hướng dẫn sử dụng, seed dữ liệu test an toàn, chạy API/web typecheck, unit/integration tests, build và probe UI 375px/desktop trước nghiệm thu.

## Mục tiêu

Triển khai CRM customer lifecycle, phân công khách hàng, danh mục sản phẩm vay và tách rõ yêu cầu vay khỏi hợp đồng phát sinh.

## Phạm vi

- Hồ sơ customer tối thiểu: họ tên và điện thoại bắt buộc; email/ngày sinh tùy chọn; provenance và verification state.
- Dò trùng chuẩn hóa theo điện thoại/email và họ tên + DOB khi đủ dữ liệu; cảnh báo/review thủ công, không auto-merge.
- Customer status: `NEW`, `CONTACTED`, `QUALIFIED`, `IN_PROGRESS`, `CONVERTED`, `CLOSED`; chuyển linh hoạt với lý do và audit.
- Danh mục sản phẩm gói vay có loại gói, nguồn, tên, mã viết tắt, kỳ hạn tối thiểu/tối đa, lãi suất, mô tả và liên kết nguồn; điều kiện số tiền vay tối thiểu/tối đa được quản lý theo từng sản phẩm.
- Yêu cầu vay do CUSTOMER gửi với sản phẩm, số tiền mong muốn, kỳ hạn và ghi chú; ADVISING có thể ghi nhận thay khách. Yêu cầu chỉ phục vụ intake/tracking, không tự tạo hợp đồng hoặc hàm ý đã được duyệt.
- Nhân viên được phân quyền tạo hợp đồng từ customer/yêu cầu vay và sản phẩm; lưu số tiền vay, kỳ hạn, khoản trả hàng tháng và snapshot điều kiện sản phẩm. Hợp đồng do nhân viên tạo phải qua MANAGE duyệt theo chi nhánh.
- `LoanContract` là record riêng; `CONVERTED` chỉ được đặt khi có hợp đồng `COMPLETED`, và hợp đồng mới chỉ hoàn tất sau OTP CUSTOMER.
- Người có quyền phân công hàng loạt nhiều customer cho một ADVISING trong mỗi lần thao tác và lưu assignment history; mỗi customer vẫn chỉ có một adviser chính tại một thời điểm.
- CUSTOMER chỉ đọc dữ liệu của chính mình; chỉ xem sản phẩm được công bố và thông tin hợp đồng/yêu cầu theo allowlist và scope.
- Mỗi chi nhánh có đúng một MANAGE chịu trách nhiệm chi nhánh; được quản lý các ADVISING thuộc quyền, phân công khách hàng, duyệt/chốt và xử lý trạng thái hợp đồng.
- CUSTOMER phải xác nhận OTP khi xác nhận hoàn thành hợp đồng vay.
- Hợp đồng nhận từ nguồn ngoài phải lưu thông tin nguồn, chạy idempotent, tìm/tạo customer trước khi gán hợp đồng; danh sách phân trang tối đa 20 phần tử/trang.

## Kế hoạch mở rộng

> Đây là kế hoạch mở rộng cho baseline P0-2. Schema/migration và service mới đã bắt đầu nhưng chưa hoàn chỉnh; chưa có API route hay UI mới và migration chưa áp dụng lên database.

### Giai đoạn 0 — Chốt quy tắc trước khi code

- Đã chốt phân công hàng loạt: nhiều customer → một ADVISING mỗi lần; không hỗ trợ ánh xạ nhiều nhân viên trong cùng thao tác.
- Đã chốt phạm vi quyền: MANAGE theo chi nhánh được gán; ADMIN/OPERATOR toàn hệ thống; chỉ ADMIN/OPERATOR cấu hình phiên bản công thức.
- Đã chốt DSL công thức an toàn, biến đầu vào có giới hạn và việc lưu formula version/input/output snapshot. Từng sản phẩm chỉ được công bố sau khi có công thức; không tự seed lãi suất hoặc kết quả tài chính giả.
- CUSTOMER PWA và xác nhận OTP thật tiếp tục hoãn. Sản phẩm chỉ hiện cho customer khi ACTIVE theo allowlist; thumbnail upload chờ cơ chế file an toàn của P0-4.
- Quy tắc pháp lý/tài chính thực tế, dữ liệu nguồn có thẩm quyền và nội dung công khai cuối cùng vẫn cần chủ tín dụng/Compliance duyệt trước khi bật dùng thật.

**Cổng:** Không đưa sản phẩm có lãi suất/khoản trả ước tính ra CUSTOMER và không bật tính khoản trả thực tế trước khi quy tắc tài chính, dữ liệu nguồn và allowlist được duyệt.

### Giai đoạn 1 — Mở rộng schema và migration

- Thêm `LoanProduct` cùng vòng đời `DRAFT`, `ACTIVE`, `INACTIVE`; lưu loại, nguồn, tên, mã viết tắt, mô tả, URL nguồn, thumbnail reference, lãi suất và điều kiện min/max số tiền, min/max kỳ hạn. Dùng kiểu số chính xác cho tiền/lãi suất, kiểm tra min không vượt max và giữ điều kiện sản phẩm đã dùng trong snapshot hợp đồng.
- Mở rộng `LoanRequest` để lưu sản phẩm, số tiền khách mong muốn, kỳ hạn và ghi chú; giữ nguyên ý nghĩa intake, trạng thái và quyền hiện có.
- Mở rộng `LoanContract` với liên kết customer/sản phẩm/yêu cầu vay, số tiền gốc, kỳ hạn, khoản trả hàng tháng (nullable tới khi có công thức đã duyệt) và snapshot/version sản phẩm. Giữ snapshot cũ cho hợp đồng hiện hữu và hợp đồng nhập từ nguồn ngoài; không suy đoán sản phẩm/điều khoản để backfill lịch sử.
- Bảo đảm ràng buộc: số tiền và kỳ hạn nằm trong min/max sản phẩm tại thời điểm tạo hợp đồng; thay đổi hay ngừng bán sản phẩm không sửa hợp đồng đã tạo.
- Bổ sung lịch sử/audit cho thay đổi sản phẩm, tạo hợp đồng, duyệt/từ chối và phiên bản nội dung được duyệt.

### Giai đoạn 2 — API nghiệp vụ và quyền

- API nhân viên quản lý danh mục theo quyền được chốt; API đọc sản phẩm `ACTIVE` theo allowlist cho CUSTOMER, có phân trang và lọc an toàn.
- API CUSTOMER tạo yêu cầu vay của chính mình với `productId`, `requestedAmount`, `requestedTermMonths`, `notes`; không có API CUSTOMER tạo/sửa `LoanContract`.
- API nhân viên tạo hợp đồng từ yêu cầu hoặc trực tiếp theo quyền; validate lại sản phẩm/điều kiện ở backend trong transaction, lưu snapshot và chuyển sang `PENDING_REVIEW`.
- MANAGE chỉ duyệt/từ chối hợp đồng trong nhánh được gán. Tách người tạo và người duyệt (maker-checker); không cho nhân viên tự duyệt hợp đồng mình tạo. Sau khi duyệt, luồng xác nhận OTP CUSTOMER hiện có tiếp tục được giữ nguyên.
- Bổ sung API phân công hàng loạt theo quy tắc ánh xạ đã chốt; phương án cơ sở là chọn nhiều customer và một ADVISING đang hoạt động trong cùng phạm vi chi nhánh. Kiểm tra toàn bộ đối tượng trước khi ghi, cập nhật assignment hiện tại, lưu lịch sử từng customer và audit tác nhân/lý do. Nếu có customer/nhân viên ngoài scope hoặc không hợp lệ, từ chối toàn bộ request thay vì phân công một phần.
- Giữ nguyên API tiếp nhận hợp đồng ngoài và idempotency; sản phẩm liên kết là tùy chọn nếu nguồn ngoài chưa có catalog match, snapshot nguồn vẫn là căn cứ lịch sử.

### Giai đoạn 3 — Giao diện thuộc P0-6

- Màn danh sách khách hàng: multi-checkbox theo quy tắc ánh xạ đã chốt (mặc định chọn nhiều customer rồi chọn một ADVISING), xem trước số customer/phạm vi, lý do phân công và kết quả; hiển thị assignment history sau khi lưu.
- Màn danh mục sản phẩm: tạo/sửa/xem trước/công bố/ngừng bán, kiểm tra điều kiện min/max và hiển thị rõ sản phẩm chưa đủ dữ liệu để công bố.
- Màn CUSTOMER: chỉ xem sản phẩm được công bố và gửi yêu cầu vay với sản phẩm, số tiền, kỳ hạn, ghi chú; không hiển thị nút tạo hợp đồng.
- Màn nhân viên/manager: tạo bản nháp hợp đồng từ yêu cầu, xem validation và snapshot điều khoản, rồi đưa vào hàng đợi duyệt; MANAGE duyệt/từ chối với lý do.
- Phần giao diện này thuộc lát cắt P0-6 như ranh giới hiện tại; API và nghiệp vụ được nghiệm thu ở P0-2 trước khi nối UI.

### Giai đoạn 4 — Kiểm thử và phát hành

- Unit tests cho min/max tiền/kỳ hạn, sản phẩm không hoạt động, phiên bản/snapshot, không tính khoản trả khi chưa cấu hình, CUSTOMER không thể tạo hợp đồng và maker-checker.
- Integration tests PostgreSQL cho transaction phân công hàng loạt, lịch sử từng customer, branch scope, validate điều kiện sản phẩm, yêu cầu không tự sinh hợp đồng, hợp đồng chờ duyệt và tiếp tục OTP sau duyệt.
- Kiểm tra migration trên DB test có customer/contract hiện hữu; xác nhận không mất snapshot và không gán nhầm product cho dữ liệu cũ.
- Kiểm tra API allowlist, quyền CUSTOMER chỉ đọc sản phẩm công khai/hồ sơ của mình, audit đầy đủ, pagination, seed dev/test và idempotency của seed.
- Chỉ bật tính toán khoản trả và hiển thị số tiền tài chính sau khi cổng Giai đoạn 0 được thông qua; trước đó trường trả hàng tháng để trống/không khả dụng, không dùng giá trị giả trong dữ liệu nghiệp vụ.

## Tiêu chí hoàn tất

- Backend kiểm tra quyền/scope cho list, search, detail, update, assignment và contract lookup.
- Mọi chuyển customer/contract state ghi tác nhân, from/to, timestamp và reason; trạng thái `CONVERTED` chỉ sau khi contract đã `COMPLETED`.
- Loan request không tự tạo hợp đồng hoặc quyết định eligibility/approval.
- Cập nhật assignment giữ lịch sử và chịu kiểm tra branch scope.
- Duplicate candidate không tự gộp; thao tác xác nhận/giải quyết được audit.
- Phân công nhiều customer trong một request không tạo assignment ngoài branch scope, không ghi thiếu một phần và có lịch sử/audit riêng cho từng customer.
- CUSTOMER chỉ gửi yêu cầu với sản phẩm đang công bố; chỉ nhân viên có quyền tạo hợp đồng và hợp đồng đó phải chờ MANAGE duyệt trước khi khách xác nhận.
- Điều kiện sản phẩm được kiểm tra ở backend bằng dữ liệu chính xác; snapshot hợp đồng không đổi khi danh mục sản phẩm được cập nhật.
- Không hiển thị khoản trả hàng tháng như một con số chính thức khi công thức và quy tắc tài chính chưa được phê duyệt.

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
- Lịch sử trạng thái lưu riêng ID của nhân viên hoặc CUSTOMER thực hiện hành động; migration `20261109000000_customer_actor_status_history` bổ sung attribution, `20261109010000_customer_phone_verified_at` tách xác minh điện thoại khỏi trạng thái xác minh hồ sơ.
- `POST /loan-contracts/external` yêu cầu `Idempotency-Key`, lưu metadata/hash nguồn nhưng không lưu payload thô. Tự liên kết customer chỉ khi phone/tên/ngày sinh khớp duy nhất; trường hợp mới hoặc mơ hồ tạo hồ sơ `UNVERIFIED` để rà trùng. Lặp cùng payload trả bản ghi cũ, thay payload trả 409.
- Contract API dùng cursor, tối đa 20 item/trang. Customer chỉ nhận allowlist: mã hợp đồng, trạng thái, thông tin gói/loại/kỳ hạn, mốc duyệt/hoàn tất.
- `GET /api/v1/capabilities` cung cấp trạng thái an toàn, không chứa secret cho `customerMobileAuthentication`, `smsOtpGateway`, `contractCompletionOtp`; frontend hiển thị banner chờ cấu hình. OTP endpoint không tạo challenge/không hoàn tất hợp đồng ngoài mock của integration test.

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

Schema, trạng thái, allowlist, nhập ngoài và ranh giới quyền manager đã triển khai. Theo chỉ đạo hiện tại, SMS gateway và xác thực CUSTOMER mobile đang `DEFERRED`; chỉ tích hợp sau khi các chức năng CRM còn lại hoàn thành.

## Kiểm thử đã chạy

- `npm run typecheck --workspace @finance-crm/api`: đạt.
- `npm test --workspace @finance-crm/api -- --runInBand`: 19/19 unit tests đạt, gồm chuẩn hóa phone Việt Nam local/`+84`/`0084`/`84`, tìm kiếm, chữ số thứ hai bằng `0`, các dạng sai và RBAC scope.
- `npm run test:integration --workspace @finance-crm/api`: kịch bản HTTP/PostgreSQL kiểm tra manager read/write scope, contract approval/OTP, idempotency/customer resolution và giới hạn 20/trang; đạt trên Docker test.
- GitHub Actions workflow `.github/workflows/ci.yml` tự dựng PostgreSQL/Redis, áp migration/seed, khởi chạy API, sau đó chạy typecheck, unit tests và P0-2 integration tests trên push/PR.
- `npm run db:validate --workspace @finance-crm/api` và `db:generate`: đạt.
- Docker test: migrations customer/duplicate/contract/manager/customer-actor áp dụng thành công; seed chạy được trên Linux container sau khi sửa runner và đồng bộ permission.
- HTTP smoke test trên API + PostgreSQL dev: CUSTOMER đọc hồ sơ mình, bị chặn hồ sơ người khác, tạo yêu cầu vay của mình và bị chặn tạo cho người khác; contract list chỉ có dữ liệu của mình.
- HTTP smoke test nhân viên: tạo khách hàng, thấy duplicate candidate từ hai phía, giải quyết duplicate, bị chặn CONVERTED khi chưa có hợp đồng, tạo hợp đồng rồi chuyển trạng thái thành công. Fixture đã được dọn sạch.
- HTTP smoke test sau cập nhật: đổi điện thoại làm candidate không còn khớp bị ẩn khỏi hai hàng đợi; cả hai bản ghi lịch sử được giữ. PostgreSQL có unique index cho một primary assignment đang hoạt động. Fixture đã được dọn sạch.

## Còn lại trước khi nghiệm thu đầy đủ P0-2

- Theo dõi GitHub Actions trên remote sau push/PR: bỏ qua trong giai đoạn phát triển hiện tại theo quyết định của chủ dự án.
- Gán MANAGE thật cho từng chi nhánh vận hành; migration chuyển nhánh cũ về `INACTIVE` để chờ manager trước khi kích hoạt lại.
- Thực hiện các giai đoạn mở rộng ở trên: chốt quy tắc tài chính/allowlist/quyền danh mục, triển khai catalog và điều kiện vay, request có product/amount/term, hợp đồng nhân viên tạo phải được quản lý duyệt, và phân công hàng loạt.
- SMS gateway và CUSTOMER mobile auth được hoãn theo yêu cầu; capability API/frontend báo trạng thái. Việc cấu hình và xác nhận hợp đồng bằng OTP được bỏ qua khi rà soát luồng hiện tại; OTP mock chỉ phục vụ integration test. Sẽ tích hợp sau khi các chức năng CRM khác hoàn thiện.
- Chủ tín dụng/Compliance quyết định có thêm số tiền/lãi suất/dư nợ/lịch trả vào allowlist hay giữ trường hiện tại.
- Giao diện nghiệp vụ P0-2 thuộc P0-6; chưa có UI customer/contract trong lát cắt này.

## Cấu hình còn cần

Manager thật cho từng chi nhánh và quyết định cuối về trường tài chính chi tiết. SMS provider và xác thực CUSTOMER mobile vẫn được giữ slot, chờ cấu hình sau.
