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

## Kế hoạch và chỉ tiêu

1. Mở **Kế hoạch** để xem các kế hoạch trong phạm vi được cấp quyền.
2. Chọn một kế hoạch để xem chi nhánh, thời gian và các chỉ tiêu mục tiêu.
3. Người có quyền `plans.manage` có thể chọn **Tạo kế hoạch**, chọn chi nhánh đang hoạt động, khoảng thời gian và khai báo một hoặc nhiều chỉ tiêu với đơn vị/mục tiêu.
4. Người có quyền `plans.manage` có thể chỉnh sửa ngày bắt đầu/kết thúc, trạng thái và thêm hoặc gỡ các chi nhánh áp dụng. Chi nhánh được thêm phải đang hoạt động và nằm trong phạm vi được cấp.
5. Tài khoản có role `ADMIN` hoặc `OPERATOR` toàn hệ thống mới được xóa kế hoạch. Hệ thống yêu cầu xác nhận; thao tác xóa là xóa mềm, ẩn kế hoạch khỏi danh sách nhưng giữ dữ liệu trong cơ sở dữ liệu.
6. Kế hoạch mới được lưu ở trạng thái **Bản nháp**. Giao task, cập nhật tiến độ và xem KPI chưa triển khai.

## Lưu ý

- Nếu thao tác bị từ chối, đọc thông báo lỗi trên trang và kiểm tra quyền/phạm vi tài khoản; không thử cấp `MANAGE` qua endpoint cấp role thông thường.
- Các thay đổi vai trò, phân công quản lý, trạng thái chi nhánh và trạng thái tài khoản có thể được kiểm tra trong audit theo quyền `audit.read`.
- Hướng dẫn chỉ bao quát luồng đã có trong phiên bản hiện tại; các tính năng chưa triển khai không được mô tả là khả dụng.
