# Finance CRM — Phạm vi MVP (Giai đoạn 0)

**Trạng thái:** Các phương án mặc định được cập nhật theo phản hồi ngày 2026-11-05; còn cấu hình nghiệp vụ/vận hành cụ thể và phê duyệt tuân thủ
**Căn cứ:** `AGENT.md`, Finance CRM baseline v1.4.0
**Ngày lập:** 2026-11-04

## 1. Mục tiêu

Tạo CRM nội bộ cho đội tư vấn và quản lý chi nhánh, tập trung vào quản lý khách hàng tiềm năng, phân công tư vấn, theo dõi chăm sóc và công việc tiếp theo. Hệ thống phải giới hạn dữ liệu theo vai trò/phạm vi ngay từ backend và lưu lịch sử các thay đổi quan trọng.

MVP chưa tự động quyết định khả năng phê duyệt khoản vay. Nếu có biểu mẫu hồ sơ vay ở giai đoạn đầu, dữ liệu đó chỉ phục vụ tiếp nhận và theo dõi, không được trình bày như quyết định tín dụng.

## 2. Người dùng và mục tiêu

| Nhóm người dùng | Mục tiêu trong MVP | Phạm vi dữ liệu đề xuất |
|---|---|---|
| OPERATOR | Quản trị nền tảng theo quyền được cấp | Chỉ quyền/quy mô được ủy quyền rõ ràng |
| ADMIN | Quản lý cấu hình nghiệp vụ và người dùng trong phạm vi được cấp | Phạm vi được cấu hình; không mặc định toàn hệ thống |
| MANAGE | Theo dõi khách hàng, phân công và hiệu quả đội trong các chi nhánh được gán theo cây chi nhánh tổng → chi nhánh con | BRANCH |
| ADVISING | Quản lý khách hàng được giao, ghi nhận chăm sóc, xử lý follow-up | ASSIGNED; OWN cho tác vụ cá nhân nếu phù hợp |
| CUSTOMER | Mobile web/PWA trước, app native sau; API giả lập chỉ dev/test; đọc hợp đồng thuộc mình và thông tin gói vay; không sửa dữ liệu nghiệp vụ | OTP provider và allowlist chi tiết trường hợp đồng/gói vay cần cấu hình |

> Các phạm vi trên là định hướng từ AGENT.md; ma trận quyền chính thức cần chủ sở hữu nghiệp vụ và bảo mật xác nhận trước khi phát hành.

## 3. Luồng nghiệp vụ tối thiểu

1. Nhân viên được cấp tài khoản và quyền phù hợp với chi nhánh/phạm vi.
2. Tạo hoặc tiếp nhận hồ sơ khách hàng tiềm năng, lưu nguồn/provenance và trạng thái xác minh.
3. Khi khách hàng yêu cầu khoản vay, CUSTOMER gửi yêu cầu hoặc ADVISING ghi nhận thay cho khách. Yêu cầu tạo hồ sơ intake/tracking; chỉ tạo/liên kết hợp đồng khi hợp đồng thực sự phát sinh, không đồng nghĩa phê duyệt.
4. Tìm kiếm khách hàng và cảnh báo bản ghi có khả năng trùng; nhân viên có thẩm quyền xem xét trước khi gộp.
5. Quản lý hoặc quy tắc được phê duyệt phân công khách hàng cho tư vấn viên; ghi lại lịch sử phân công.
6. Tư vấn viên ghi nhận lần chăm sóc, kênh, nội dung, kết quả và bước tiếp theo.
7. Khách hàng và tư vấn viên trao đổi trong hội thoại realtime được phân quyền; tin nhắn được lưu bền vững.
8. Tạo tác vụ follow-up có người phụ trách và hạn xử lý; hệ thống hiển thị danh sách đến hạn/quá hạn.
9. Quản lý xem số liệu tổng hợp trong phạm vi chi nhánh; truy cập hồ sơ chi tiết vẫn bị kiểm tra quyền ở backend.
10. Các thay đổi nhạy cảm được ghi audit với actor, đối tượng, thời điểm, request ID và diff an toàn.

## 4. Trong phạm vi MVP đề xuất

- Đăng nhập nhân viên và quản lý phiên theo thiết kế bảo mật trong AGENT.md.
- Người dùng, cây chi nhánh tổng → chi nhánh con, permission catalog, role tùy chỉnh giới hạn trong quyền có thể ủy quyền và cấu hình scope.
- Khách hàng: tạo, xem, tìm kiếm, cập nhật, trạng thái vòng đời, dữ liệu liên hệ/định danh cần thiết, nguồn dữ liệu và trạng thái xác minh.
- Yêu cầu vay: CUSTOMER tự gửi hoặc ADVISING ghi nhận theo yêu cầu của khách; yêu cầu dùng cho intake/tracking. Bản ghi hợp đồng được tạo/liên kết riêng khi hợp đồng thực sự phát sinh.
- Cảnh báo trùng lặp có quy trình rà soát; không tự động gộp dữ liệu.
- Phân công khách hàng và lịch sử thay đổi người phụ trách.
- Lịch sử chăm sóc và tác vụ follow-up với hạn, trạng thái, người phụ trách.
- Chat realtime giữa ADVISING và CUSTOMER; chỉ cho phép tham gia hội thoại được liên kết với khách hàng/tư vấn viên đó. Lưu tin nhắn bền vững trong PostgreSQL, phân trang cursor và kiểm tra quyền cho kết nối, tham gia phòng, gửi/đọc tin nhắn.
- CUSTOMER dùng mobile web/PWA trước, native app sau. OTP số điện thoại là mặc định production; API giả lập chỉ dùng dev/test và không bật ở production.
- CUSTOMER có quyền read-only với hồ sơ cá nhân và hợp đồng thuộc mình, gồm thông tin chi tiết như lịch trả nợ/dư nợ nếu nguồn hỗ trợ, cùng thông tin gói vay; không đọc hồ sơ khách hàng khác và không sửa dữ liệu nghiệp vụ. Read-only không áp dụng cho gửi tin nhắn trong hội thoại được phép.
- Các yêu cầu tra cứu từ chat phải dùng customer ID lấy từ phiên đã xác thực và lọc trạng thái gói vay public ở backend; không tin customer ID do client hoặc nội dung chat tự cung cấp.
- Lưu tệp theo nhóm nghiệp vụ, tối thiểu gồm tệp nộp cho task và tệp import dữ liệu khách hàng; kiểm tra hợp lệ trước khi lưu.
- Import khách hàng chạy bằng tác vụ nền: preview/mapping, kiểm tra từng dòng và phát hiện trùng đều xử lý bất đồng bộ; người dùng theo dõi trạng thái/kết quả và lỗi theo dòng. Batch chỉ được ghi sau khi mọi dòng hợp lệ, các dòng nghi trùng đã được rà soát/xác nhận thủ công và người dùng xác nhận batch; không nhập một phần file.
- Cấu hình thời hạn lưu và dọn tệp hết hạn/không còn cần thiết theo chính sách được duyệt.
- Người dùng được phân quyền tạo kế hoạch với hạng mục, đơn vị đo, chỉ tiêu và thời gian. Khi tạo task, nhân viên chọn kế hoạch phù hợp; số thực đạt đã xác minh từ task liên kết được cộng và so với chỉ tiêu. Báo cáo/số liệu có trạng thái xác minh riêng: `PENDING_VERIFICATION`, `VERIFIED`, `NEEDS_INFO`, `REJECTED`; quản trị viên xác minh thủ công dựa trên tài liệu trước khi số liệu được tính KPI. Lưu người xác minh, thời điểm và lý do; lý do cần có khi yêu cầu bổ sung hoặc từ chối.
- Dashboard biểu đồ thống kê theo ngày/tháng và nhân viên, có lọc theo hạng mục tương ứng; cần đặc tả hạng mục, công thức, kỳ thống kê và cách chỉ tính số liệu đã xác minh vào KPI.
- Audit cho thay đổi quyền, phân công và thay đổi dữ liệu nghiệp vụ nhạy cảm.
- API `/api/v1`, OpenAPI, phân trang, validation, correlation ID và xử lý lỗi nhất quán.
- Kiểm thử backend cho ma trận quyền/phạm vi và IDOR trên các API được đưa vào MVP.
- Kiểm thử quyền CUSTOMER: chỉ đọc hồ sơ/hợp đồng của chính mình, chỉ đọc gói vay public, không truy cập hồ sơ người khác; chat chỉ trong conversation được liên kết.

**Điều kiện phát hành phần file:** lưu file là yêu cầu trong MVP. Provider ban đầu là thư mục local riêng tư trên server; chưa bật với dữ liệu thật cho tới khi chốt quyền upload/download/xóa, quét/quarantine, retention và vận hành dọn file.

**Giới hạn file đã chọn:** task submission nhận PDF/JPG/JPEG/PNG tối đa 10 MB mỗi file; customer import nhận CSV/XLSX tối đa 20 MB. Không nhận XLS/XLSM. MVP lưu dưới một thư mục gốc local riêng tư, cấu hình được, nằm ngoài webroot; có thư mục riêng cho task submissions và customer imports, khóa bằng ID tài nguyên/ID file do hệ thống tạo. `ObjectStorageService` giữ khả năng thêm S3 adapter sau này. Retention và quét/quarantine cụ thể vẫn là điều kiện trước khi lưu dữ liệu thật.

**Định dạng chat đã chốt:** mỗi message là một record riêng, append-only. Lưu `conversationId`, `messageId`, sender, timestamp, idempotency key và cursor/index metadata ở các cột riêng; payload là compact JSON string trong cột text, được validate theo schema trước khi ghi. Toàn bộ hội thoại được dựng lại theo cursor; không lưu một blob transcript tăng không giới hạn.

## 5. Ngoài phạm vi MVP đề xuất

- Cổng khách hàng/self-service tổng quát; ứng dụng điện thoại cho CUSTOMER vẫn nằm trong phạm vi giới hạn gồm chat và các màn tra cứu read-only đã nêu.
- Máy tính khoản vay có lịch trả nợ chính thức hoặc quyết định eligibility tự động.
- Tự động phê duyệt/từ chối hồ sơ vay.
- Tích hợp CRM bên ngoài, webhook công khai và đồng bộ hai chiều.
- Báo cáo tùy biến, data warehouse, phân tích dự báo.
- HA/multi-region và cam kết RPO/RTO chưa được chủ sở hữu phê duyệt.

## 6. Trạng thái và dữ liệu đề xuất

### Khách hàng

Các trạng thái: `NEW`, `CONTACTED`, `QUALIFIED`, `IN_PROGRESS`, `CONVERTED`, `CLOSED`. Cho phép chuyển linh hoạt giữa trạng thái với lý do bắt buộc và audit. `CONVERTED` chỉ hợp lệ khi có hợp đồng vay được tạo/liên kết trong CRM. Cờ/hàng đợi rà soát trùng lặp tách riêng khỏi trạng thái vòng đời.

### Chăm sóc và tác vụ

Đã đồng ý trạng thái tác vụ: `OPEN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`; loại tác vụ ban đầu: gọi, nhắn tin, bổ sung hồ sơ và khác. Quá hạn được tính từ due date, không lưu thành trạng thái riêng. SLA/nhắc tự động và múi giờ nghiệp vụ chi tiết để chốt sau.

### Trường khách hàng và trùng lặp

- Số điện thoại là bắt buộc; email là tùy chọn.
- Ngày sinh là tùy chọn. Họ tên + ngày sinh dùng kiểm tra ứng viên trùng khi cả hai trường có dữ liệu.
- Phương án tối thiểu được duyệt không bổ sung PII khác. Có thể bổ sung sau khi chốt trường, mục đích, tính bắt buộc và quyền xem.
- Cảnh báo rà soát thủ công khi trùng số điện thoại/email đã chuẩn hóa hoặc trùng họ tên + ngày sinh; không tự động gộp.

### File và lưu giữ

- File được tổ chức theo nhóm nghiệp vụ/liên kết tài nguyên, tối thiểu `TASK_SUBMISSION` và `CUSTOMER_IMPORT`; trên local storage có thư mục chuyên biệt cho từng nhóm nhưng không dùng đường dẫn/tên file do người dùng nhập để tạo path.
- Validate nội dung/loại file trước khi lưu; yêu cầu kỹ thuật cần theo baseline `AGENT.md` về size, extension, MIME, signature, scan/quarantine và authorization upload/download.
- Với XLSX, giới hạn thêm số sheet/row, kích thước sau giải nén và số entry; loại workbook có macro, mã hóa hoặc external links theo chính sách parser.
- Cho phép cấu hình retention và dọn file; quyền cấu hình, thời hạn mặc định, legal hold và hành vi xóa cuối cùng còn cần chốt.

### Phân loại dữ liệu

- Phân biệt dữ liệu khách hàng tự khai với dữ liệu đã được xác minh.
- Chỉ thu thập trường dữ liệu cần cho quy trình MVP; tránh lưu thông tin tài chính/định danh không cần thiết.
- Không đưa dữ liệu khách hàng thật vào fixture, log, test hoặc tài liệu.
- Quyền xem/tìm kiếm/xuất phải kiểm tra scope ở backend.

## 7. Tiêu chí nghiệm thu Giai đoạn 0

- Chủ nghiệp vụ xác nhận persona, luồng khách hàng, phân công và chăm sóc.
- Có ma trận quyền và scope được duyệt cho từng thao tác cốt lõi.
- Chốt dữ liệu khách hàng bắt buộc/tùy chọn, trạng thái, quy tắc trùng lặp và nguồn dữ liệu.
- Chốt dashboard MVP và công thức/tập thời gian/múi giờ cho từng chỉ số.
- Mỗi quyết định mở quan trọng có người chịu trách nhiệm và hạn chốt.
- Phạm vi in/out được xác nhận trước khi bắt đầu triển khai Giai đoạn 1.

## 8. Giả định làm việc tạm thời

1. CRM nghiệp vụ phục vụ nhân viên nội bộ; CUSTOMER dùng mobile web/PWA trước và native app sau. OTP số điện thoại là mặc định production; API giả lập chỉ dùng dev/test.
2. Một khách hàng có một tư vấn viên phụ trách chính tại một thời điểm; lịch sử phân công được giữ lại.
3. Cây tổ chức là chi nhánh tổng → chi nhánh con; `MANAGE` kế thừa scope xuống các chi nhánh con được gán. Người quản trị cấu hình cây và ma trận quyền theo thao tác.
4. Không tự động gộp khách hàng nghi trùng.
5. Không có xuất dữ liệu hàng loạt trong MVP cho tới khi chủ dữ liệu xác định quyền, trường dữ liệu và mục đích.
6. Quy tắc khoản vay không được suy diễn từ tài liệu kỹ thuật; tính năng tài chính phụ thuộc quyết định nghiệp vụ riêng.

Các giả định này là đề xuất để thảo luận, không phải quyết định đã được phê duyệt.

## 9. Kết quả rà soát của chủ yêu cầu

Ngày 2026-11-04 và 2026-11-05, chủ yêu cầu xác nhận/cập nhật các mục sau.

### Đã xác nhận

- CRM cho nhân viên dùng web; CUSTOMER dùng mobile web/PWA trước, native app để sau; không có cổng self-service tổng quát. API giả lập CUSTOMER chỉ dùng dev/test.
- CRM lõi ưu tiên khách hàng, phân công tư vấn, lịch sử chăm sóc và tác vụ follow-up.
- Hồ sơ vay ban đầu chỉ tiếp nhận/theo dõi; không tự động đánh giá hoặc phê duyệt.
- Chat realtime giữa ADVISING và CUSTOMER thuộc MVP; tích hợp CRM ngoài và báo cáo tùy biến để giai đoạn sau.
- CUSTOMER được tra cứu read-only thông tin cá nhân, hợp đồng thuộc mình (có thể gồm lịch trả nợ/dư nợ nếu nguồn hỗ trợ) và thông tin chi tiết gói vay; không có quyền sửa hoặc đọc hồ sơ người khác.
- Một tư vấn viên phụ trách chính tại một thời điểm; lưu lịch sử phân công.
- Trạng thái khách hàng, trạng thái task và quy tắc trùng lặp như mục 6.
- `CONVERTED` nghĩa là hợp đồng vay đã được tạo/liên kết trong CRM.
- Người quản lý/quản trị viên được phân quyền chọn khách hàng, phân công nhân viên cụ thể và gắn người phụ trách.
- Kế hoạch có hạng mục, đơn vị đo, chỉ tiêu và thời gian; KPI lấy tổng số thực đạt đã xác minh từ task liên kết. Nhân viên nhập số và báo cáo, đính kèm chứng từ; quản trị viên xác minh thủ công.
- Chuyển trạng thái khách hàng linh hoạt nhưng bắt buộc lý do và audit; `CONVERTED` cần hợp đồng liên kết.
- RBAC cho phép role tùy chỉnh chỉ từ permission catalog và trong tập quyền được ủy quyền.
- Dashboard có biểu đồ theo ngày/tháng và nhân viên, lọc theo hạng mục.
- Số điện thoại bắt buộc, email và ngày sinh tùy chọn; họ tên + ngày sinh cảnh báo trùng khi cả hai trường có dữ liệu, xác nhận thủ công.
- Vai trò nhân viên gồm `OPERATOR`, `ADMIN`, `MANAGE`, `ADVISING`; `CUSTOMER` chat và chỉ đọc dữ liệu được phép như mục 2/4.
- RBAC cấu hình quyền theo nhóm chức năng, cấp độ dữ liệu (`OWN`, `ASSIGNED`, `BRANCH`, `ALL`) và node trong cây chi nhánh tổng → chi nhánh con; cho phép role tùy chỉnh từ permission catalog trong phạm vi được ủy quyền. Backend thực thi permission + scope; không cho tự nâng quyền; thay đổi nhạy cảm được audit.
- File task: PDF/JPG/JPEG/PNG tối đa 10 MB; file import: CSV/XLSX tối đa 20 MB. Lưu local trên server qua abstraction để có thể chuyển sang S3 sau; kiểm tra trước khi sử dụng và hỗ trợ retention/dọn file.

### Chi tiết còn cần làm rõ trước schema/triển khai tương ứng

- Import đã chốt cột, pipeline nền và atomic batch; cần cấu hình quốc gia/định dạng số điện thoại.
- Mô hình RBAC đã chốt; cần nạp cây chi nhánh tổng → chi nhánh con, role grants và ma trận thao tác.
- Xác thực production mặc định OTP số điện thoại; cần chọn OTP provider và allowlist trường hợp đồng/gói vay. Yêu cầu vay được CUSTOMER gửi hoặc ADVISING ghi nhận; bản ghi hợp đồng sẽ tạo/liên kết trong CRM khi hợp đồng thực sự phát sinh.
- Chính sách file đã chốt private storage/quarantine, kiểm tra chữ ký và malware scan trước khi dùng; cần chọn scanner, retention theo loại, người được quyền xóa, legal hold và lịch dọn.
- Kênh chăm sóc nào lưu nội dung chi tiết.
- Kế hoạch/task/KPI: đơn vị đo, chỉ tiêu và thời gian được thiết lập trên từng kế hoạch; cần cấu hình danh mục hạng mục, quyền tạo/duyệt, policy đính kèm và xử lý sửa số liệu sau xác minh. KPI so tổng số đã xác minh với chỉ tiêu kế hoạch và phải giữ lịch sử.
- Dashboard: danh mục chỉ số/công thức, kỳ báo cáo và quyền xem/xuất còn cần cấu hình; múi giờ mặc định `Asia/Ho_Chi_Minh`.

Baseline bảo mật bắt buộc trong `AGENT.md` vẫn áp dụng trong thời gian hoàn thiện ma trận quyền và chính sách file.

### Cách xử lý các điểm còn mở

Các phương án mặc định trong [sổ quyết định](decision-log.md) đã được chủ yêu cầu chấp thuận ngày 2026-11-05 và là hướng triển khai. Các giá trị cấu hình cụ thể (như cây tổ chức, công thức KPI, retention và thông số vận hành) vẫn phải được chủ sở hữu tương ứng cung cấp trước khi bật chức năng liên quan. Import preview, kiểm tra từng dòng và hàng đợi rà trùng chạy nền; chỉ ghi dữ liệu sau bước xem kết quả và xác nhận.

### Chưa quyết định

- Dashboard: danh mục chỉ số/công thức, kỳ báo cáo và quyền xem/xuất. Múi giờ mặc định đã chọn là `Asia/Ho_Chi_Minh`.
- Retention audit và điều kiện vận hành production.
- Quy tắc khoản vay chính thức: lãi suất, phí, kỳ hạn, phương pháp trả nợ và làm tròn.
- Nơi lưu/xử lý dữ liệu, chuẩn tuân thủ và CRM đích.
