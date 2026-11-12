# P0-3 — Kế hoạch, task, xác minh và KPI

**Trạng thái:** Backend kế hoạch/task/kết quả/xác minh/KPI, giao diện `/tasks` theo wireframe B và quan hệ metadata `FileAsset` ↔ `TaskResultEvidence` đã có. Cả hai migration P0-3 đã áp dụng thành công trên PostgreSQL test riêng; migration evidence được kiểm tra thêm các FK và CHECK constraints. Typecheck và 48 unit tests đạt. Upload/download binary, probe trực quan ở 375px và nghiệm thu môi trường mục tiêu còn mở.

## Mục tiêu

Theo dõi mục tiêu theo kế hoạch và tổng hợp KPI từ kết quả task đã được xác minh.

## Phạm vi

- Người được cấp quyền tạo plan với hạng mục, đơn vị đo, chỉ tiêu và khoảng thời gian.
- Nhân viên tạo task và chọn plan tương ứng.
- Task result lưu số lượng thực đạt dạng số + unit, narrative riêng và evidence/file relation.
- Verification status: `PENDING_VERIFICATION`, `VERIFIED`, `NEEDS_INFO`, `REJECTED`.
- Lưu người xác minh, timestamp, lý do và lịch sử thay đổi; `NEEDS_INFO` có thể nộp lại review.
- KPI = tổng số thực đạt đã `VERIFIED` từ task thuộc plan, so sánh với chỉ tiêu của plan.

## Tiêu chí hoàn tất

- Không cộng kết quả chưa xác minh, bị từ chối hoặc cần bổ sung vào KPI.
- Task/result phải cùng hạng mục/đơn vị/kỳ phù hợp với plan; backend từ chối unit mismatch.
- Sửa kết quả sau xác minh tạo lịch sử/điều chỉnh có audit, không ghi đè dấu vết.
- Quyền tạo plan, giao task, nộp kết quả, xác minh và xem KPI được kiểm tra theo RBAC/scope.
- Dashboard/report áp dụng cùng scope như dữ liệu nguồn; dùng UTC và hiển thị `Asia/Ho_Chi_Minh`.

## Cấu hình còn cần

Danh mục hạng mục/đơn vị, role được tạo/duyệt plan, kỳ KPI và quy trình sửa/điều chỉnh kết quả sau xác minh.

## Phần đã triển khai

- Prisma model `Plan`/`PlanMetric` và migration `20261111000000_p0_3_plan_foundation`.
- `GET /api/v1/plans` trả kế hoạch theo phạm vi quyền `plans.read` và hỗ trợ branch filter/cursor.
- `POST /api/v1/plans` tạo kế hoạch `DRAFT` cho chi nhánh đang hoạt động, có kỳ UTC và 1–100 chỉ tiêu do người dùng cấu hình trên kế hoạch. Mỗi chỉ tiêu gồm tên, đơn vị và target không âm, độ chính xác tối đa 3 chữ số thập phân.
- Kiểm tra scope `plans.manage`, kỳ bắt đầu-kết thúc, tên chỉ tiêu trùng; tạo kế hoạch/chỉ tiêu và audit trong cùng transaction.
- `PATCH /api/v1/plans/:planId` cập nhật kỳ, trạng thái và các chi nhánh áp dụng; `DELETE` xóa mềm theo quyền ADMIN/OPERATOR toàn hệ thống.
- `GET /api/v1/plans/:planId/tasks` và `POST /api/v1/plans/:planId/tasks` đọc/tạo task; task chọn metric của plan, chi nhánh thuộc plan đang hoạt động và người được giao đang hoạt động.
- `POST /api/v1/tasks/:taskId/results` lưu phiên bản kết quả mới, kiểm tra unit và thời điểm nằm trong kỳ plan; không ghi đè các lần nộp trước.
- Task result có quan hệ `TaskResultEvidence` tới metadata `FileAsset`. API chỉ liên kết file `AVAILABLE`, chưa xóa, chưa hết hạn và cùng chi nhánh với task; ID trùng, file chưa quét/bị từ chối hoặc ngoài phạm vi bị từ chối. Response chỉ trả metadata an toàn, không trả khóa lưu trữ.
- `GET /api/v1/plans/:planId/tasks` trả metadata evidence theo từng revision. UI thông báo upload đang khóa; hiện chưa có API intake/storage hoặc download binary.
- `POST /api/v1/task-results/:resultId/verifications` thêm quyết định `VERIFIED`, `NEEDS_INFO` hoặc `REJECTED`; chặn tự xác minh, yêu cầu lý do với NEEDS_INFO/REJECTED và chỉ review phiên bản mới nhất. NEEDS_INFO/REJECTED cho phép nộp phiên bản kế tiếp; VERIFIED hoàn tất task nhưng vẫn cho phép nộp phiên bản điều chỉnh mới.
- `GET /api/v1/plans/:planId/kpi` cộng phiên bản mới nhất của mỗi task khi trạng thái xác minh mới nhất là VERIFIED. Target/total dùng Decimal; scope KPI yêu cầu xem được mọi chi nhánh thuộc plan để không so target toàn plan với số liệu của một phần chi nhánh.
- Permission `tasks.read`, `tasks.manage`, `tasks.submit`, `tasks.verify` và `kpi.read` đã thêm vào catalog. Quản trị viên cần cấp theo role/scope trước khi endpoint dùng được; service kiểm tra lại resource scope.
- Migration `20261112020000_p0_3_tasks_results_kpi` và `20261112030000_p0_3_task_result_evidence` đã áp dụng thành công trên PostgreSQL test riêng, không áp dụng lên database development/production. Migration evidence thoát mã 0; đã xác nhận các bảng, FK và CHECK constraints.
- Web có route `/plans` riêng và `/tasks` theo wireframe B: hàng đợi/chi tiết task, KPI đã xác minh, lọc trạng thái/chi nhánh, tạo task, nộp revision, xác minh và xem metadata evidence theo revision. Thông tin nhân viên chỉ tải khi có `users.read`; không có quyền thì task mặc định giao cho người tạo. UI không bật upload binary khi scanner, retention, quyền xóa và legal hold chưa được cấu hình/duyệt ([wireframe](../../../apps/web/p0-3-wireframe.html)).
- Xác thực gần nhất trong toolbox: typecheck API/web và 7 suites/48 unit tests đạt. Chưa có bằng chứng probe trực quan ở 375px hoặc kiểm thử luồng task bằng tài khoản staff.

Chưa triển khai: upload và download binary qua private storage, scanner/quarantine worker, endpoint xóa có quyền/audit/legal hold, job retention và dọn file orphan; catalog metric dùng chung, quy trình cấu hình nghiệp vụ, tích hợp báo cáo và nghiệm thu trên môi trường mục tiêu. Không bật file thật cho đến khi scanner, retention, quyền xóa và legal hold được cấu hình/duyệt.
