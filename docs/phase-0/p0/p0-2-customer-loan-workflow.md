# P0-2 — Khách hàng, yêu cầu vay, hợp đồng và phân công

**Trạng thái cập nhật 2026-11-16:** Baseline P0-2 vẫn hoạt động. Phần mở rộng hiện có API và UI staff cho phân công hàng loạt, catalog/formula sản phẩm, yêu cầu vay theo sản phẩm, tạo hợp đồng với tính toán server-side và snapshot, cùng maker-checker MANAGE theo chi nhánh. Prisma generate, typecheck, build, 66 unit tests và integration PostgreSQL trên project/volume validation riêng đều đạt. Migration đã chạy trên development và test; production không thay đổi. P0-2 chưa nghiệm thu: chưa probe UI staff trên browser/375px, chưa kiểm tra migration nâng cấp trên DB legacy có dữ liệu, chưa có quy tắc tài chính thực được Compliance phê duyệt; CUSTOMER PWA, OTP provider thật và upload thumbnail an toàn tiếp tục hoãn.

## Tiến độ mở rộng mới nhất

### Quyết định đã thống nhất

- Phân công: chọn nhiều khách hàng bằng checkbox → chọn một nhân viên ADVISING trong combobox → bấm **Phân công**; một lần gửi áp dụng cùng nhân viên cho tất cả khách được chọn.
- Phạm vi quyền: MANAGE quản lý sản phẩm và phân công trong chi nhánh được gán; ADMIN/OPERATOR có phạm vi toàn hệ thống. ADMIN/OPERATOR thiết lập phiên bản công thức; nhân viên chỉ gửi đầu vào để tính và không nhận công thức để tự sửa.
- Công thức: DSL số học an toàn `+ - * /`, ngoặc, `min`, `max`, `round(value, digits)`; cấm `eval`. Biến cơ sở `principal`, `annualRatePercent`, `termMonths`; biến bổ sung có nhãn/min/max/default. Chỉ tính khi người dùng bấm **Tính lãi**; lưu phiên bản công thức, đầu vào và kết quả cùng hợp đồng. Không tự điền lãi suất hay dữ liệu tài chính giả.
- UI staff theo wireframe đã chọn: phân công A (bảng và thanh gán hàng loạt), sản phẩm B (danh sách và chi tiết/công thức), hợp đồng B (bảng và panel chi tiết). CUSTOMER PWA và nhà cung cấp OTP vẫn hoãn.

### Đã triển khai trong code

- Đã thêm model/field trong `apps/api/prisma/schema.prisma` và migration `20261116000000_p0_2_loan_products_formula_snapshots` cho sản phẩm vay, phiên bản công thức bất biến, dữ liệu yêu cầu vay và snapshot tài chính trên hợp đồng. Migration đã chạy trên PostgreSQL test và development; chưa chạy production.
- Đã thêm các quyền `loan-products.read/manage/publish/formula.manage` vào catalog và cập nhật quyền mặc định MANAGE/ADVISING trong seed.
- Đã thêm bộ phân tích/đánh giá công thức an toàn trong `apps/api/src/customers/loan-formula.ts`; unit test xác nhận số học, giới hạn biến và từ chối cú pháp không an toàn.
- Bulk assignment có route `POST /api/v1/customers/assignments/bulk`, dùng `customers.assign`, kiểm tra toàn bộ customer và adviser trước khi ghi, lưu assignment history/audit trong transaction; batch ngoài phạm vi bị từ chối toàn bộ.
- Trang khách hàng có checkbox từng dòng/chọn cả trang, giữ lựa chọn khi phân trang, chọn một ADVISING đang hoạt động đủ phạm vi cho mọi khách đã chọn, nhập lý do và submit; giới hạn 100 khách/request đồng bộ với DTO.
- API catalog/formula có kiểm soát scope, version công thức bất biến, trạng thái sản phẩm và endpoint metadata đầu vào không tiết lộ biểu thức. Request theo sản phẩm kiểm tra amount/term; contract tính lại ở server, lưu snapshot product/formula và chờ MANAGE duyệt; CUSTOMER không thể tạo contract, người tạo không thể tự duyệt.
- Staff UI có route `/loan-products`, product-aware request/contract forms trên `/customers` và màn hàng đợi riêng `/loan-contracts` theo bố cục bảng + panel chi tiết. Trang hợp đồng lọc trạng thái, phân trang và chỉ hiện duyệt/từ chối theo quyền; thumbnail chỉ là URL metadata, chưa có upload binary.

### Kiểm tra mới nhất

- `npm run db:generate`, `npm run typecheck`, `npm run build` và `npm test`: đạt; build sinh route `/loan-products` và `/customers`.
- Unit tests: 10 suites/66 tests đạt.
- API/PostgreSQL P0-2 integration đạt trên Compose project validation riêng, không publish host ports. Ngoài baseline, test xác nhận sản phẩm INACTIVE bị ẩn với CUSTOMER và không dùng được để nhập request, tính toán hoặc tạo contract; tạo công thức mới và nhiều request công thức đồng thời vẫn giữ version liên tiếp; snapshot contract hiện hữu không đổi sau cập nhật công thức/ngừng bán. Bulk assignment thành công cho 2 khách và batch ngoài scope bị từ chối không ghi một phần.
- Test project riêng đã dừng bằng `down` không `-v`; volume validation được giữ. Development stack không bị recreate trong lượt validation cuối; không có migration production.
- `git diff --check` đạt; Git chỉ cảnh báo chuẩn hóa LF/CRLF cho hai file TypeScript trên Windows.
- Chưa có kiểm tra trực quan bằng phiên staff/browser hoặc probe 375px cho các màn P0-2 mới.

### Còn lại

1. Probe UI `/customers` và `/loan-products` bằng phiên staff trên desktop và 375px; xử lý lỗi tương tác/responsive nếu phát hiện.
2. Kiểm tra migration upgrade trên test DB có customer/contract legacy; hiện integration chạy trên DB đã migrate đầy đủ, chưa chứng minh giữ nguyên dữ liệu khi nâng cấp.
3. Compliance/chủ tín dụng phê duyệt nguồn dữ liệu, rate/fee/amortization/rounding và allowlist trước khi dùng kết quả tài chính như thông tin chính thức.
4. Chốt manager/grants thật cho từng chi nhánh; giữ OTP provider thật và CUSTOMER PWA hoãn theo quyết định hiện tại.
5. Probe `/customers`, `/loan-products` và `/loan-contracts` bằng phiên staff trên desktop/375px; màn mới hiện mới được build, chưa có kiểm tra trực quan bằng tài khoản.
6. Upload thumbnail, scanner/quarantine, retention/legal hold và download an toàn vẫn chờ cổng P0-4; không bật upload bằng URL metadata hiện có.

## Mục tiêu

Triển khai CRM customer lifecycle, phân công khách hàng, danh mục sản phẩm vay và tách rõ yêu cầu vay khỏi hợp đồng phát sinh.

## Phạm vi

- Hồ sơ customer tối thiểu: họ tên và điện thoại bắt buộc; email/ngày sinh tùy chọn; provenance và verification state.
- Dò trùng chuẩn hóa theo điện thoại/email và họ tên + DOB khi đủ dữ liệu; cảnh báo/review thủ công, không auto-merge.
- Customer status: `NEW`, `CONTACTED`, `QUALIFIED`, `IN_PROGRESS`, `CONVERTED`, `CLOSED`; chuyển linh hoạt với lý do và audit.
- Danh mục sản phẩm gói vay có loại gói, nguồn, tên, mã viết tắt tùy chọn, kỳ hạn tối thiểu/tối đa, lãi suất, mô tả và liên kết nguồn. Loại gói chọn từ danh mục cố định; giới hạn số tiền tối thiểu/tối đa độc lập và không bắt buộc.
- Yêu cầu vay do CUSTOMER gửi với sản phẩm, số tiền mong muốn, kỳ hạn và ghi chú; ADVISING có thể ghi nhận thay khách. Yêu cầu chỉ phục vụ intake/tracking, không tự tạo hợp đồng hoặc hàm ý đã được duyệt.
- Nhân viên được phân quyền tạo hợp đồng từ customer/yêu cầu vay và sản phẩm; lưu số tiền vay, kỳ hạn, khoản trả hàng tháng và snapshot điều kiện sản phẩm. Hợp đồng do nhân viên tạo phải qua MANAGE duyệt theo chi nhánh.
- `LoanContract` là record riêng; `CONVERTED` chỉ được đặt khi có hợp đồng `COMPLETED`, và hợp đồng mới chỉ hoàn tất sau OTP CUSTOMER.
- Người có quyền phân công hàng loạt nhiều customer cho một ADVISING trong mỗi lần thao tác và lưu assignment history; mỗi customer vẫn chỉ có một adviser chính tại một thời điểm.
- CUSTOMER chỉ đọc dữ liệu của chính mình; chỉ xem sản phẩm được công bố và thông tin hợp đồng/yêu cầu theo allowlist và scope.
- Mỗi chi nhánh có đúng một MANAGE chịu trách nhiệm chi nhánh; được quản lý các ADVISING thuộc quyền, phân công khách hàng, duyệt/chốt và xử lý trạng thái hợp đồng.
- CUSTOMER phải xác nhận OTP khi xác nhận hoàn thành hợp đồng vay.
- Hợp đồng nhận từ nguồn ngoài phải lưu thông tin nguồn, chạy idempotent, tìm/tạo customer trước khi gán hợp đồng; danh sách phân trang tối đa 20 phần tử/trang.

## Kế hoạch mở rộng

> Đây là kế hoạch mở rộng cho baseline P0-2. Schema, API lõi, giao diện staff và test đã được triển khai một phần đáng kể; các mục còn lại trong phần tiến độ là điều kiện nghiệm thu, không phải mô tả rằng chưa có code.

### Giai đoạn 0 — Chốt quy tắc trước khi code

- Đã chốt phân công hàng loạt: nhiều customer → một ADVISING mỗi lần; không hỗ trợ ánh xạ nhiều nhân viên trong cùng thao tác.
- Đã chốt phạm vi quyền: MANAGE theo chi nhánh được gán; ADMIN/OPERATOR toàn hệ thống; chỉ ADMIN/OPERATOR cấu hình phiên bản công thức.
- Đã chốt DSL công thức an toàn, biến đầu vào có giới hạn và việc lưu formula version/input/output snapshot. Từng sản phẩm chỉ được công bố sau khi có công thức; không tự seed lãi suất hoặc kết quả tài chính giả.
- Loại gói chỉ nhận một trong năm lựa chọn nghiệp vụ; bỏ trống viết tắt để hệ thống tự sinh mã. Mỗi giới hạn số tiền có thể bỏ trống độc lập; chỉ giới hạn đã nhập mới được kiểm tra khi nhận yêu cầu hoặc lập hợp đồng.
- CUSTOMER PWA và xác nhận OTP thật tiếp tục hoãn. Sản phẩm chỉ hiện cho customer khi ACTIVE theo allowlist; thumbnail upload chờ cơ chế file an toàn của P0-4.
- Quy tắc pháp lý/tài chính thực tế, dữ liệu nguồn có thẩm quyền và nội dung công khai cuối cùng vẫn cần chủ tín dụng/Compliance duyệt trước khi bật dùng thật.

**Cổng:** Không đưa sản phẩm có lãi suất/khoản trả ước tính ra CUSTOMER và không bật tính khoản trả thực tế trước khi quy tắc tài chính, dữ liệu nguồn và allowlist được duyệt.

### Giai đoạn 1 — Mở rộng schema và migration

- Thêm `LoanProduct` cùng vòng đời `DRAFT`, `ACTIVE`, `INACTIVE`; lưu loại theo danh mục cố định, nguồn, tên, mã viết tắt tự sinh nếu bỏ trống, mô tả, URL nguồn, thumbnail reference, lãi suất và điều kiện min/max số tiền tùy chọn, min/max kỳ hạn. Dùng kiểu số chính xác cho tiền/lãi suất, chỉ so sánh min/max khi cả hai được nhập và giữ giá trị điều kiện sản phẩm đã dùng trong snapshot hợp đồng.
- Mở rộng `LoanRequest` để lưu sản phẩm, số tiền khách mong muốn, kỳ hạn và ghi chú; giữ nguyên ý nghĩa intake, trạng thái và quyền hiện có.
- Mở rộng `LoanContract` với liên kết customer/sản phẩm/yêu cầu vay, số tiền gốc, kỳ hạn, khoản trả hàng tháng (nullable tới khi có công thức đã duyệt) và snapshot/version sản phẩm. Giữ snapshot cũ cho hợp đồng hiện hữu và hợp đồng nhập từ nguồn ngoài; không suy đoán sản phẩm/điều khoản để backfill lịch sử.
- Bảo đảm ràng buộc: số tiền và kỳ hạn nằm trong min/max sản phẩm tại thời điểm tạo hợp đồng; thay đổi hay ngừng bán sản phẩm không sửa hợp đồng đã tạo.
- Bổ sung lịch sử/audit cho thay đổi sản phẩm, tạo hợp đồng, duyệt/từ chối và phiên bản nội dung được duyệt.

### Giai đoạn 2 — API nghiệp vụ và quyền

- API nhân viên quản lý catalog theo quyền, API đọc sản phẩm `ACTIVE` và CUSTOMER allowlist đã có; pagination catalog và policy approval cho môi trường thật cần tiếp tục xác minh.
- API CUSTOMER tạo yêu cầu của chính mình theo product/amount/term/notes; request không tạo contract. CUSTOMER không thể tạo `LoanContract`.
- API nhân viên tạo contract theo product/request, validate điều kiện và tính ở backend, lưu snapshot rồi chuyển `PENDING_REVIEW` đã có; cần tăng coverage race/version và dữ liệu legacy.
- MANAGE duyệt theo branch, maker-checker và giữ luồng OTP completion đã có; SMS provider thật/CUSTOMER auth vẫn deferred.
- Bổ sung API phân công hàng loạt theo quy tắc ánh xạ đã chốt; phương án cơ sở là chọn nhiều customer và một ADVISING đang hoạt động trong cùng phạm vi chi nhánh. Kiểm tra toàn bộ đối tượng trước khi ghi, cập nhật assignment hiện tại, lưu lịch sử từng customer và audit tác nhân/lý do. Nếu có customer/nhân viên ngoài scope hoặc không hợp lệ, từ chối toàn bộ request thay vì phân công một phần.
- Giữ nguyên API tiếp nhận hợp đồng ngoài và idempotency; sản phẩm liên kết là tùy chọn nếu nguồn ngoài chưa có catalog match, snapshot nguồn vẫn là căn cứ lịch sử.

### Giai đoạn 3 — Giao diện thuộc P0-6

- Màn danh sách khách hàng đã có multi-checkbox, chọn một ADVISING, lý do và submit batch; cần browser probe trên desktop/mobile và kiểm tra history sau khi lưu.
- Màn `/loan-products` staff đã có catalog/formula; cần hoàn tất probe các state loading/empty/error/responsive và xác nhận phân quyền bằng role thực tế.
- Màn `/loan-contracts` staff đã có bảng + panel chi tiết, status filter, cursor pagination và duyệt/từ chối; cần probe UI và xác nhận permission gating bằng role thật.
- CUSTOMER product/request screen và CUSTOMER PWA chưa triển khai; customer API scope đã có nhưng UI vẫn deferred.
- Màn staff `/customers` đã có product-backed request/contract preview, tính lại khi bấm nút và đưa hợp đồng vào queue duyệt; cần browser probe để nghiệm thu hành vi.

### Giai đoạn 4 — Kiểm thử và phát hành

- Unit tests cho min/max tiền/kỳ hạn, sản phẩm không hoạt động, phiên bản/snapshot, không tính khoản trả khi chưa cấu hình, CUSTOMER không thể tạo hợp đồng và maker-checker.
- Integration PostgreSQL đã xác nhận bulk assignment all-or-nothing, branch scope, product bounds, request không tự sinh contract, snapshot, maker-checker và contract OTP baseline.
- Chưa kiểm tra migration upgrade trên DB legacy có customer/contract hiện hữu; integration hiện chạy trên fresh validation database.
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
- Hoàn tất nghiệm thu mở rộng: browser/responsive probe, migration upgrade trên dữ liệu legacy, quyền thật theo cây chi nhánh và phê duyệt policy tài chính/allowlist.
- SMS gateway và CUSTOMER mobile auth được hoãn theo yêu cầu; capability API/frontend báo trạng thái. Việc cấu hình và xác nhận hợp đồng bằng OTP được bỏ qua khi rà soát luồng hiện tại; OTP mock chỉ phục vụ integration test. Sẽ tích hợp sau khi các chức năng CRM khác hoàn thiện.
- Chủ tín dụng/Compliance quyết định có thêm số tiền/lãi suất/dư nợ/lịch trả vào allowlist hay giữ trường hiện tại.
- Staff UI `/customers` và `/loan-products` đã có; CUSTOMER PWA/request flow và OTP thật vẫn deferred.

## Cấu hình còn cần

Manager thật cho từng chi nhánh và quyết định cuối về trường tài chính chi tiết. SMS provider và xác thực CUSTOMER mobile vẫn được giữ slot, chờ cấu hình sau.
