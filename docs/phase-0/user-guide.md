# Hướng dẫn sử dụng CRM

Tài liệu này mô tả các luồng hiện có trong ứng dụng nội bộ. Quyền thao tác thực tế phụ thuộc vào quyền và phạm vi chi nhánh của tài khoản; việc ẩn nút trên giao diện không thay thế kiểm tra quyền ở API.

## Tài khoản nhân viên và vai trò

1. Mở **Người dùng** để xem tài khoản, vai trò, chi nhánh áp dụng và trạng thái.
2. Chọn **Tạo mới** để tạo tài khoản nhân viên. Tài khoản mới cần đổi mật khẩu khi đăng nhập lần đầu.
3. Dùng **Cấp thêm vai trò** trên dòng nhân viên để thêm vai trò trong phạm vi được ủy quyền. Chọn **Toàn hệ thống** chỉ khi tài khoản hiện tại có quyền cấp phạm vi đó.
4. Thu hồi vai trò bằng nút `×` cạnh vai trò. Một số vai trò có ràng buộc quản trị riêng; API có thể từ chối thao tác nếu tài khoản hiện tại không đủ quyền.
5. Dùng nút trạng thái để vô hiệu hóa hoặc kích hoạt tài khoản; thao tác yêu cầu lý do. Vô hiệu hóa sẽ thu hồi các phiên đăng nhập đang hoạt động.

### Cấp vai trò Quản lý chi nhánh

Vai trò `MANAGE` không được cấp như một role grant thông thường và không thể chọn làm vai trò ban đầu khi tạo tài khoản. Để phân công:

1. Tạo tài khoản nhân viên trước và bảo đảm tài khoản đang hoạt động.
2. Mở **Chi nhánh**, tìm chi nhánh cần quản lý và chọn **Gán quản lý** hoặc **Đổi quản lý**.
3. Chọn tài khoản đủ điều kiện. Tài khoản khách hàng, tài khoản vận hành hệ thống, tài khoản không hoạt động hoặc tài khoản tư vấn ở chi nhánh khác không được phân công.
4. Việc phân công tạo grant `MANAGE` cho đúng chi nhánh và kích hoạt chi nhánh. Với chi nhánh con, chi nhánh cha phải đang hoạt động.

Muốn thu hồi vai trò Quản lý, dùng nút `×` cạnh vai trò `MANAGE` trong danh sách nhân viên. Thao tác này chỉ dành cho quản trị viên toàn hệ thống. Khi quản lý bị gỡ hoặc tài khoản quản lý bị vô hiệu hóa, chi nhánh đó chuyển sang **Ngừng hoạt động**; các chi nhánh con đang hoạt động cũng chuyển sang ngừng hoạt động. Các thay đổi được ghi audit.

## Chi nhánh

- Chi nhánh có thể được tạo khi chưa có người quản lý, nhưng chưa thể hoạt động.
- Chỉ kích hoạt được chi nhánh khi đã có người quản lý đang hoạt động và chi nhánh cha (nếu có) cũng đang hoạt động.
- Không thể tự ngừng hoạt động một chi nhánh khi còn chi nhánh con đang hoạt động. Khi người quản lý bị gỡ, hệ thống tự ngừng hoạt động cả nhánh con đang hoạt động để giữ cây tổ chức nhất quán.
- Người có quyền toàn hệ thống có thể phân công hoặc đổi người quản lý. Người được chọn cần là tài khoản nhân viên đang hoạt động và không có vai trò không đủ điều kiện.

## Vai trò và quyền

Trang **Vai trò & quyền** dùng để xem hoặc cấu hình role tùy chỉnh và các permission/scope trong phạm vi được cấp. Với role `ADMIN`, có thể chọn/bỏ chọn toàn bộ quyền theo từng nhóm chức năng. `OPERATOR` là role hệ thống được bảo vệ, không chỉnh sửa ma trận tại trang này. Chỉ cấp quyền mà người thao tác có thẩm quyền ủy quyền; thay đổi role và grant được kiểm tra tại backend và ghi nhận audit.

## Khách hàng và hồ sơ

Trang **Khách hàng** cung cấp các thao tác trong phạm vi được cấp quyền, bao gồm tìm kiếm và quản lý hồ sơ. Tài khoản CRM chỉ xem hoặc cập nhật dữ liệu khi API cho phép theo quyền và phạm vi; Customer chỉ được truy cập hồ sơ/nghiệp vụ của chính mình.

### Trường hồ sơ và ngày sinh

Hồ sơ có các trường bắt buộc họ tên/số điện thoại; email và ngày sinh tùy chọn; CCCD, địa chỉ, quê quán, giới tính và nơi cấp cũng tùy chọn. Ngày sinh hiển thị `dd/MM/yyyy`; API tiếp tục dùng ISO. Khi import, các cột hồ sơ tùy chọn có thể để trống.

### Phân công hàng loạt

Chọn nhiều khách hàng bằng checkbox (giữ lựa chọn khi chuyển trang), chọn một tư vấn viên `ADVISING` đang hoạt động trong phạm vi, nhập lý do rồi gửi. Mỗi request áp dụng cùng một tư vấn viên cho tất cả khách đã chọn (tối đa 100); nếu có khách hoặc nhân viên ngoài phạm vi, toàn bộ request bị từ chối.

### Nhập khách hàng từ tệp

1. Mở **Nhập khách hàng** (`/customers/import`) từ trang Khách hàng.
2. Chọn chi nhánh trong phạm vi và tệp CSV/XLSX tối đa 20 MB, rồi tải lên.
3. Hệ thống tự quét bằng ClamAV và nhập nền; **không có bước preview hay xác nhận**. Dòng hợp lệ được ghi trong một giao dịch, dòng trùng và dòng lỗi bị bỏ qua và đếm riêng.
4. Theo dõi trạng thái batch và số liệu nhập/trùng/lỗi; chi tiết lỗi chỉ gồm số dòng và mã lỗi và chỉ còn trong 30 ngày.
5. Tệp tạm bị xóa sau khi xử lý. Nếu thiếu scanner, worker, queue hoặc schema chưa migrate, màn hình báo chặn và nút tải lên bị khóa (readiness `BLOCKED`).

## Sản phẩm vay và hợp đồng

- **Sản phẩm vay** (`/loan-products`): xem catalog và chi tiết gói vay. ADMIN/OPERATOR cấu hình sản phẩm và phiên bản công thức bất biến (DSL số học an toàn, không dùng `eval`); nhân viên chỉ nhập đầu vào để tính, không nhận công thức để sửa. Sản phẩm chỉ hiện cho CUSTOMER khi đang hoạt động.
- **Hợp đồng** (`/loan-contracts`): tạo hợp đồng từ khách hàng/yêu cầu vay và sản phẩm; server kiểm tra điều kiện số tiền/kỳ hạn và tính lại kết quả khi bấm **Tính**, lưu snapshot sản phẩm/công thức cùng hợp đồng.
- Duyệt/từ chối: `ADMIN`/`OPERATOR` toàn hệ thống duyệt được cả hợp đồng do mình tạo; `MANAGE` chỉ duyệt trong chi nhánh được gán và không tự duyệt hợp đồng của mình. Hợp đồng hoàn tất cần CUSTOMER xác nhận OTP; ở dev/test OTP chỉ ở chế độ mock và capability API báo trạng thái chưa cấu hình.
- Tài liệu hợp đồng: DOCX/PDF/PNG/JPG tối đa 25 MB, có tải xuống cần xác thực, thay thế giữ phiên bản cũ, xóa mềm và ghi lịch sử. Production chưa bật upload cho tới khi có scanner/quarantine.

## Kế hoạch và chỉ tiêu

1. Mở **Kế hoạch** để xem các kế hoạch trong phạm vi được cấp quyền.
2. Chọn một kế hoạch để xem chi nhánh, thời gian và các chỉ tiêu mục tiêu.
3. Người có quyền `plans.manage` có thể chọn **Tạo kế hoạch**, chọn chi nhánh đang hoạt động, khoảng thời gian và khai báo một hoặc nhiều chỉ tiêu với đơn vị/mục tiêu lấy từ danh mục KPI.
4. Người có quyền `plans.manage` có thể sửa ngày bắt đầu/kết thúc và chi nhánh áp dụng khi kế hoạch còn ở bản nháp hoặc bị từ chối; kế hoạch đang chờ duyệt không sửa được. Trạng thái kế hoạch không đổi trực tiếp mà đi qua luồng gửi duyệt/phê duyệt, riêng lưu trữ chỉ áp dụng cho kế hoạch đang thực hiện.
5. Tài khoản có role `ADMIN` hoặc `OPERATOR` toàn hệ thống mới được xóa kế hoạch. Hệ thống yêu cầu xác nhận; thao tác xóa là xóa mềm, ẩn kế hoạch khỏi danh sách nhưng giữ dữ liệu trong cơ sở dữ liệu.
6. Kế hoạch mới được lưu ở trạng thái **Bản nháp**. Bấm **Gửi duyệt** để chuyển sang **Chờ duyệt**, sau đó người có `plans.approve` duyệt thành **Đang thực hiện** hoặc từ chối kèm lý do (có thể sửa và gửi lại). Người tạo không tự duyệt được, trừ khi có grant `ADMIN`/`OPERATOR` toàn hệ thống; quản lý chi nhánh khác có thể duyệt. Chỉ kế hoạch **Đang thực hiện** mới tạo được task.

## Công việc, kết quả và KPI

1. Mở **Công việc**. Trang cần `tasks.read` và `plans.read`; KPI tải thành công khi tài khoản có `kpi.read` trên toàn bộ chi nhánh của kế hoạch. Nếu thiếu phạm vi, trang báo lỗi KPI.
2. Chọn kế hoạch đang thực hiện. Hàng đợi mặc định chỉ hiển thị công việc chưa hoàn tất; có thể chuyển sang **Tất cả** hoặc lọc theo chi nhánh. Chọn task để xem người nhận, hạn chót và lịch sử revision.
3. Người có `tasks.manage` có thể chọn **Tạo task**, chỉ tiêu, chi nhánh và hạn chót. Nếu có `users.read` thì có thể chọn người nhận; nếu không, task được giao cho người tạo.
4. Người có `tasks.submit` nộp số thực đạt, ngày thực hiện và giải trình. Đơn vị được cố định theo chỉ tiêu. Mỗi lần nộp tạo revision mới và chờ xác minh; không thể nộp tiếp khi revision mới nhất đang chờ duyệt.
5. Người có `tasks.verify` có thể xác minh revision mới nhất, yêu cầu bổ sung hoặc từ chối. Hai quyết định sau bắt buộc có lý do; người nộp không thể tự xác minh. Khi cần bổ sung hoặc bị từ chối, người được phép nộp có thể tạo revision tiếp theo.
6. KPI chỉ cộng revision mới nhất đã xác minh. Revision đã xác minh vẫn có thể được nộp bản điều chỉnh mới; KPI cập nhật theo revision mới sau khi revision đó được xác minh.

Task result đã có quan hệ metadata tới file evidence, nhưng chưa có luồng upload/private storage hoặc download nên nhân viên chưa thể đính kèm file từ giao diện. API chỉ cho liên kết file đã quét, còn hạn và cùng chi nhánh; upload chỉ được bật sau khi cấu hình/duyệt scanner, retention, quyền xóa và legal hold. Không gửi thông tin nhạy cảm trong phần giải trình.

## Dữ liệu mẫu trong development/test

- Khi khởi động Docker Compose với `.env.dev` hoặc `.env.test`, migration chạy trước, sau đó seed chạy trước API/worker. Seed tạo dữ liệu mẫu tổng hợp cho các bảng nghiệp vụ phù hợp khi bảng đó chưa có dữ liệu; bảng đã có dữ liệu được giữ nguyên. Chạy lại seed không nhân đôi các fixture mẫu.
- Dữ liệu mẫu bao phủ khách hàng, phân công, lịch sử trạng thái, hồ sơ vay, kế hoạch, task, kết quả và xác minh. Nếu không có chi nhánh đang hoạt động hoặc kế hoạch mẫu hợp lệ, seed ghi rõ phần nào bị bỏ qua thay vì tạo liên kết nghiệp vụ không hợp lệ.
- Không tạo session/OTP giả lập, audit nghiệp vụ giả lập hoặc file evidence. Upload/download evidence vẫn bị khóa cho tới khi cấu hình đầy đủ chính sách bảo mật.
- Tên, số điện thoại, email, số liệu KPI và nội dung hợp đồng trong fixture đều là dữ liệu giả; không dùng như dữ liệu khách hàng hoặc điều khoản tài chính thực.
- Sample seed chỉ chạy với `NODE_ENV=development` hoặc `NODE_ENV=test`. Production không tự tạo dữ liệu mẫu.

## Lưu ý

- Nếu thao tác bị từ chối, đọc thông báo lỗi trên trang và kiểm tra quyền/phạm vi tài khoản; không thử cấp `MANAGE` qua endpoint cấp role thông thường.
- Các thay đổi vai trò, phân công quản lý, trạng thái chi nhánh và trạng thái tài khoản có thể được kiểm tra trong audit theo quyền `audit.read`.
- Hướng dẫn chỉ bao quát luồng đã có trong phiên bản hiện tại; các tính năng chưa triển khai không được mô tả là khả dụng.
