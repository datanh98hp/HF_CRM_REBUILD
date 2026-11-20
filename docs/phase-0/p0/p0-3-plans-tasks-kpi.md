# P0-3 — Kế hoạch, task, xác minh và KPI

**Trạng thái:** Backend và frontend `/tasks` hỗ trợ giao việc theo nhóm: nội dung chung, assignment/target/trạng thái/kết quả riêng từng nhân viên; nhân viên chỉ đọc task và KPI cá nhân theo scope `ASSIGNED`. Migration và seed đã chạy trên đúng hai database local `dev`/`test` sau khi xác minh URL/DB identity; kiểm tra sau seed xác nhận đủ 18 permission-scope cần thiết, catalog KPI 8 mục và mọi task result có assignment. Kiểm thử API/PostgreSQL P0-3 đã đạt qua luồng tạo/gửi duyệt/duyệt plan, giao task, nộp kết quả, xác minh và tổng hợp KPI; ADMIN/OPERATOR toàn cục có thể duyệt thủ công plan mình tạo sau khi gửi duyệt, còn MANAGE không thể tự duyệt và tài khoản quản trị khác có thể duyệt. Sau khi seed sửa quan hệ xác minh sai của fixture, trang `/tasks` trên dev đã được kiểm tra với Admin; các nút xác minh, yêu cầu bổ sung và từ chối hiển thị đúng. Không chạy trên production. Kiểm thử UI end-to-end còn mở; responsive `/plans` và `/tasks` đã được probe ở 375px/1440px (ghi nhận 2026-11-19). P0-3 chưa có intake/download binary cho evidence; storage adapter MinIO tùy chọn hiện chỉ phục vụ tài liệu hợp đồng, và upload production đang fail-closed cho đến khi có scanner/quarantine. Đã thêm script backup PostgreSQL mã hóa, ghi vào `backup/` ở repo root và chỉ restore sang database mới rỗng; chưa chạy backup/restore DB thật hoặc diễn tập phục hồi. Retention/legal-hold, lịch backup, RPO/RTO và nghiệm thu môi trường mục tiêu còn mở.

## Mục tiêu

Theo dõi mục tiêu theo kế hoạch và tổng hợp KPI từ kết quả task đã được xác minh.

## Phạm vi

- Người được cấp quyền tạo plan với hạng mục, đơn vị đo, chỉ tiêu và khoảng thời gian.
- ADMIN/OPERATOR được giao task toàn hệ thống; MANAGE được giao trong phạm vi chi nhánh. Có thể chọn tối đa 100 nhân viên trong một chi nhánh cho cùng nội dung task; mỗi người có assignment, target, trạng thái và kết quả riêng.
- Nhân viên chỉ đọc task được giao cho mình và KPI cá nhân do backend tính theo assignment của họ.
- Gửi plan để duyệt, duyệt/từ chối theo quyền và phạm vi; ADMIN/OPERATOR toàn cục có quyền `plans.approve` được duyệt thủ công plan mình tạo, các vai trò khác không tự duyệt; từ chối cần lý do và có thể gửi lại.
- Nhân viên tạo task và chọn plan tương ứng.
- Task result lưu số lượng thực đạt dạng số + unit, narrative riêng và evidence/file relation.
- Verification status: `PENDING_VERIFICATION`, `VERIFIED`, `NEEDS_INFO`, `REJECTED`.
- Lưu người xác minh, timestamp, lý do và lịch sử thay đổi; `NEEDS_INFO` có thể nộp lại review.
- KPI chỉ cộng revision mới nhất đã `VERIFIED`, có thể tổng hợp theo toàn plan/tháng/quý/năm.

## Tiêu chí hoàn tất

- Không cộng kết quả chưa xác minh, bị từ chối hoặc cần bổ sung vào KPI.
- Task/result phải cùng hạng mục/đơn vị/kỳ phù hợp với plan; backend từ chối unit mismatch.
- Sửa kết quả sau xác minh tạo lịch sử/điều chỉnh có audit, không ghi đè dấu vết.
- Quyền tạo plan, giao task, nộp kết quả, xác minh và xem KPI được kiểm tra theo RBAC/scope.
- Dashboard/report áp dụng cùng scope như dữ liệu nguồn; dùng UTC và hiển thị `Asia/Ho_Chi_Minh`.

## Cấu hình còn cần

Permission và scope đã được seed, kiểm tra ở development/test. Production vẫn cần xác nhận môi trường và kế hoạch cấp quyền riêng trước khi thay đổi; không chạy seed trên database production nếu chưa được xác nhận.

## Phần đã triển khai

- Prisma model `Plan`/`PlanMetric` và migration `20261111000000_p0_3_plan_foundation`.
- `GET /api/v1/plans` trả kế hoạch theo phạm vi quyền `plans.read` và hỗ trợ branch filter/cursor.
- `GET/POST/PATCH /api/v1/plans/metric-catalog` đọc và quản lý catalog dùng chung. `plans.catalog.manage` cần phạm vi toàn hệ thống; người có quyền này đọc được cả mục đã ngừng sử dụng để kích hoạt lại. Role đọc kế hoạch chỉ thấy mục đang hoạt động.
- `POST /api/v1/plans` nhận `metrics: [{ catalogId, target }]`; tên và đơn vị được lấy từ catalog, không do frontend gửi tự do. Tạo plan `DRAFT` cho chi nhánh đang hoạt động và audit trong cùng transaction.
- `POST /api/v1/plans/:planId/submissions` gửi bản nháp/bản bị từ chối để duyệt; `POST /api/v1/plans/:planId/approvals` ghi quyết định duyệt/từ chối, lý do từ chối và lịch sử revision. ADMIN/OPERATOR toàn cục có quyền `plans.approve` được duyệt thủ công plan mình tạo; vai trò khác không thể tự duyệt. Tạo plan luôn bắt đầu ở `DRAFT`, không tự động duyệt. Trạng thái plan không được đổi trực tiếp ngoài luồng duyệt, ngoại trừ lưu trữ plan đang hoạt động.
- `PATCH /api/v1/plans/:planId` cập nhật kỳ và chi nhánh áp dụng; `DELETE` xóa mềm theo quyền ADMIN/OPERATOR toàn hệ thống.
- `GET /api/v1/plans/:planId/tasks` trả từng assignment theo quyền tài nguyên; `POST /api/v1/plans/:planId/tasks` nhận danh sách 1–100 nhân viên hợp lệ trong chi nhánh và một target áp dụng riêng cho từng người. Nội dung task dùng chung; trạng thái và kết quả tách theo assignment.
- `POST /api/v1/tasks/:taskId/results` lưu phiên bản mới trên assignment của nhân viên, kiểm tra unit và thời điểm nằm trong kỳ plan; không ghi đè các lần nộp trước. Giữ khả năng tra assignment cũ bằng task ID cho client tương thích.
- Task result có quan hệ `TaskResultEvidence` tới metadata `FileAsset`. API chỉ liên kết file `AVAILABLE`, chưa xóa, chưa hết hạn và cùng chi nhánh với task; ID trùng, file chưa quét/bị từ chối hoặc ngoài phạm vi bị từ chối. Response chỉ trả metadata an toàn, không trả khóa lưu trữ.
- `GET /api/v1/plans/:planId/tasks` trả metadata evidence theo từng revision. UI thông báo upload đang khóa; hiện chưa có API intake/storage hoặc download binary.
- `POST /api/v1/task-results/:resultId/verifications` thêm quyết định `VERIFIED`, `NEEDS_INFO` hoặc `REJECTED` trên assignment tương ứng; chặn tự xác minh, yêu cầu lý do với NEEDS_INFO/REJECTED và chỉ review phiên bản mới nhất của assignment. Trạng thái assignment khác không bị thay đổi.
- `GET /api/v1/plans/:planId/kpi?periodType=PLAN|MONTH|QUARTER|YEAR&date=YYYY-MM-DD` cộng revision mới nhất đã xác minh theo assignment trong kỳ được chọn. KPI `ASSIGNED` chỉ tính target và kết quả của nhân viên hiện tại; target/total dùng Decimal.
- Permission `tasks.read`, `tasks.manage`, `tasks.submit`, `tasks.verify` và `kpi.read` đã thêm vào catalog. Seed defaults: ADMIN/OPERATOR ở `ALL`, MANAGE ở `BRANCH`, ADVISING có task read/submit và KPI ở `ASSIGNED`; service kiểm tra lại resource scope. Đã áp dụng và đọc lại đủ 18 permission-scope cần thiết ở development/test; production chưa thay đổi.
- Migration `20261113120000_p0_3_group_task_assignments` cùng các migration P0-3 còn thiếu đã áp dụng trên database development và test sau khi đối chiếu database name/port riêng biệt. Seed role/catalog/sample đã chạy ở cả hai môi trường. Kiểm tra xác nhận 8 KPI catalog mỗi DB, 3 task/3 assignment có target riêng và 2 task result/DB liên kết assignment hợp lệ; không chạy trên production.
- Web có các route riêng `/plans`, `/plans/catalog` và `/tasks` theo bố cục B. Tạo plan chọn hạng mục/unit từ catalog; UI nối gửi duyệt, duyệt/từ chối có lý do, gửi lại, lịch sử và lưu trữ. Trang `/tasks` truyền bộ lọc kỳ KPI đúng query API; số liệu vẫn do backend tính từ revision đã xác minh. Thông tin nhân viên chỉ tải khi có `users.read`; không có quyền thì task mặc định giao cho người tạo. UI không bật upload binary khi scanner, retention, quyền xóa và legal hold chưa được cấu hình/duyệt ([wireframe](../../../apps/web/p0-3-wireframe.html)).
- Seed backend có 8 hạng mục KPI và kế hoạch/task mẫu trong development/test; assignment mẫu có target cá nhân. Lượt cập nhật này đã chạy lại seed trên dev để làm sạch relation xác minh sai của fixture, không chạy migration.
- Bằng chứng kiểm tra gần nhất: `npm run test:integration:p0-3 --workspace @finance-crm/api` chạy trên database test riêng, đạt 19 assertion qua API/PostgreSQL: plan mới ở `DRAFT`, chỉ chuyển `PENDING_APPROVAL` sau thao tác gửi; Admin duyệt thủ công plan do mình tạo; MANAGE không thể tự duyệt nhưng Admin khác có thể duyệt plan đó; tiếp đó giao task cho ADVISING, nộp revision pending, loại pending khỏi KPI, xác minh và cộng kết quả vào KPI. Fixture kiểm thử được dọn sau khi chạy. API typecheck và unit tests plans/tasks đạt. Seed dev chạy thành công; truy vấn DB xác nhận kết quả pending không còn `TaskVerification` relation, còn kết quả mẫu đã duyệt vẫn `VERIFIED`. Reload `/tasks` với Admin xác nhận các thao tác xác minh, yêu cầu bổ sung và từ chối hiển thị đúng; không thực hiện quyết định để giữ nguyên fixture pending. **Cập nhật 2026-11-20:** responsive `/plans` và `/tasks` đã được probe ở 375px/1440px không tràn ngang (ghi nhận trong [P0-2](p0-2-customer-loan-workflow.md)); kiểm thử end-to-end giao diện bằng tài khoản staff vẫn còn mở.

Chưa triển khai cho P0-3: upload/download binary cho task evidence qua private storage, scanner/quarantine worker, endpoint xóa có quyền/audit/legal hold, job retention và dọn file orphan. Ở thời điểm 2026-11-20, không có endpoint hay service nào tạo bản ghi `FileAsset` trong code — task result chỉ liên kết tới file `AVAILABLE` đã có sẵn, nên toàn bộ đường intake binary của evidence vẫn chưa tồn tại. Script backup mã hóa hiện không phải lịch backup được vận hành và chưa thay thế diễn tập restore. Không bật file thật cho đến khi scanner, retention, quyền xóa và legal hold được cấu hình/duyệt.
