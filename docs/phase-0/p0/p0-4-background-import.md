# P0-4 — Import khách hàng nền theo batch atomic

**Trạng thái:** Đã chuẩn bị kế hoạch; chưa triển khai code, migration hay bật upload.
**Phụ thuộc:** P0-0 (PostgreSQL/Redis/BullMQ), P0-1 (auth/RBAC/audit), P0-2 (customer/normalization/duplicate review) và private file storage/scanner đã được thiết kế trong MVP scope.

## Mục tiêu

Cho nhân viên có quyền tải CSV/XLSX, ánh xạ và xem trước dữ liệu, xử lý lỗi/trùng theo từng dòng, rồi chủ động xác nhận để tạo khách hàng. Parse và dò trùng chạy nền. Batch không được tạo một phần: hoặc toàn bộ dòng đủ điều kiện được xử lý trong một lần promote atomic, hoặc không có khách hàng nào từ batch được tạo.

## Phạm vi và hợp đồng đã có

- Chỉ nhận CSV và XLSX, tối đa **20 MB**; từ chối XLS/XLSM. File phải được lưu private, trong quarantine và scanner chấp thuận trước khi parse.
- Trường nhập theo schema Customer hiện tại: họ tên và số điện thoại bắt buộc; email và ngày sinh tùy chọn. Chi nhánh là lựa chọn bắt buộc ở cấp batch. Không nhập thêm PII ngoài schema đã duyệt.
- Dùng chuẩn hóa số điện thoại Việt Nam hiện có (`normalizeVietnamesePhone`), chuẩn hóa tên/email và quy tắc dò trùng của P0-2; không tạo một cách chuẩn hóa riêng cho import.
- Đề xuất customer tạo từ import có trạng thái `NEW`, verification `UNVERIFIED`, `createdById` là người xác nhận và `provenance` do hệ thống gán là `IMPORT`. Không tự phân công tư vấn viên.
- Dò trùng theo phone/email đã chuẩn hóa và họ tên + ngày sinh khi có đủ dữ liệu. Không tự gộp hồ sơ.
- Người dùng phải xác nhận rõ ràng sau khi xem kết quả; retry cùng batch không được tạo customer trùng.
- Tệp thật không được chấp nhận nếu scanner chưa cấu hình. Trước khi có scanner, chỉ kiểm thử bằng fixture tổng hợp trong dev/test; không có đường tắt parse trực tiếp.

## Khảo sát codebase làm căn cứ

- Đã có `CustomersService`, DTO tạo customer, `normalizeVietnamesePhone` và `syncDuplicateCandidates`; customer hiện bắt buộc `branchId` và `provenance`.
- Đã có `DuplicateCandidate` với trạng thái `OPEN`, `CONFIRMED_DUPLICATE`, `NOT_DUPLICATE`, quyền `customers.duplicates.review` và xử lý hai chiều. Không có import batch hoặc staging model.
- Đã có `BackgroundQueueService` và BullMQ; worker hiện chỉ xử lý `system.healthcheck`, chưa đăng ký processor nghiệp vụ.
- `FileAsset` hiện chỉ có metadata/scanning state; chưa có private storage provider, scanner adapter, upload route hoặc import relation. Không được coi metadata hiện có là khả năng lưu/scan file đã hoàn chỉnh.
- API hiện chưa có permission riêng cho import; chưa có thư viện parser CSV/XLSX trong manifest.

## Thiết kế đề xuất

### Mô hình dữ liệu

Migration dự kiến thêm:

- `CustomerImportBatch`: `id`, `branchId`, `createdById`, `confirmedById`, `fileAssetId`, idempotency key, file hash, mapping cấu hình đã chọn, trạng thái, progress counters, timestamps, lỗi tổng quát an toàn và thời điểm hết hạn.
- `CustomerImportRow`: `batchId`, số dòng/sheet, các trường customer đã parse, giá trị đã chuẩn hóa cần dùng lại khi commit, trạng thái dòng, validation errors dạng mã + tên cột, duplicate candidates, quyết định review, `customerId` sau commit và timestamps.
- Unique constraints cho idempotency key trong phạm vi người tạo; unique `(batchId, rowNumber)` hoặc `(batchId, sheetName, rowNumber)`; index cho batch/status và candidate lookup.
- Bản ghi staging chỉ giữ các trường đã được phép nhập; không lưu nguyên workbook, log PII, công thức hoặc nội dung nhạy cảm không thuộc schema. Áp dụng retention/xóa batch và tệp theo chính sách được duyệt.

Batch states đề xuất:

`QUARANTINED → SCANNING → QUEUED → PROCESSING → NEEDS_REVIEW | READY_TO_CONFIRM → COMMITTING → COMPLETED`

Kết thúc ngoại lệ: `FAILED`, `CANCELLED`, `EXPIRED`. Mọi chuyển trạng thái phải là conditional update để chống worker chạy trùng hoặc request đồng thời. Chỉ cho hủy trước `COMMITTING`; retry chỉ áp dụng lỗi kỹ thuật có thể thử lại, không bỏ qua lỗi dữ liệu.

Row states đề xuất:

`VALIDATING → INVALID | DUPLICATE_REVIEW | READY → IMPORTED | SKIPPED_DUPLICATE`

- `CONFIRMED_DUPLICATE`: không tạo customer cho dòng đó; lưu quyết định và liên kết hồ sơ hiện hữu để audit.
- `NOT_DUPLICATE`: cho phép tiếp tục tạo customer, nhưng vẫn tạo `DuplicateCandidate` để hàng đợi rà soát P0-2 giữ được lịch sử.
- Dòng lỗi validation phải sửa/tải lại trong batch mới; không tự sửa giá trị người dùng gửi. Không đưa dữ liệu một phần vào Customer.

### Quyền

Đề xuất thêm permission catalog `customers.import` để quản trị có thể cấp quyền import độc lập với quyền sửa hồ sơ:

- `ADMIN`/`OPERATOR`: `ALL`; `MANAGE`: `BRANCH`; `ADVISING` không được cấp mặc định.
- Upload, xem kết quả, review candidate, xác nhận, retry và hủy đều kiểm tra actor + permission + branch scope ở backend; không tin `branchId` hoặc `createdById` do client tự quyết ngoài DTO và session hợp lệ.
- Duyệt trùng tiếp tục đòi `customers.duplicates.review`; permission import không tự cấp quyền review hoặc quyền quản lý customer.
- Chỉ người tạo batch và vai trò có quyền đọc/quản lý batch trong scope được xem PII staging. Candidate customer phải được kiểm tra quyền đọc ở cả hai phía.

### API đề xuất

Prefix `/api/v1`:

- `POST /customers/import-batches` — multipart upload cùng `branchId`, mapping và `Idempotency-Key`; kiểm tra authorization, kích thước/định dạng/chữ ký, lưu private quarantine và xếp scan job. Không parse đồng bộ.
- `GET /customers/import-batches/:batchId` — trạng thái, tiến độ, số dòng hợp lệ/lỗi/trùng/đã nhập/bỏ qua và lỗi an toàn.
- `GET /customers/import-batches/:batchId/rows` — preview/error theo cursor, có lọc trạng thái; không trả object key hoặc storage path.
- `POST /customers/import-batches/:batchId/rows/:rowId/duplicate-decision` — `CONFIRMED_DUPLICATE` hoặc `NOT_DUPLICATE`, bắt buộc lý do.
- `POST /customers/import-batches/:batchId/confirmation` — chỉ cho xác nhận khi scan đạt, mọi dòng hợp lệ và mọi candidate đã được xử lý; idempotent.
- `POST /customers/import-batches/:batchId/retry` — retry lỗi kỹ thuật cho phép.
- `POST /customers/import-batches/:batchId/cancellation` — hủy trước commit và lên lịch xóa staging/file theo policy.

Response chỉ chứa dữ liệu cần cho người có quyền xử lý; lỗi từng dòng dùng mã ổn định, field và số dòng, không chứa stack trace hay dữ liệu nhạy cảm trong log.

### Worker và atomic promotion

- Tách processor import thành provider nghiệp vụ có dependency injection với `PrismaService`, storage/scanner adapter và parser; đăng ký processor trong `WorkerModule`. Giữ healthcheck hiện tại.
- Job ID xác định từ batch + attempt; trạng thái DB là nguồn sự thật, BullMQ là cơ chế thực thi. Có retry/backoff cho lỗi tạm thời, terminal failure rõ ràng, và kiểm tra worker/job để batch không mắc kẹt khi process chết.
- Scan trước, chỉ khi scanner trả `AVAILABLE` mới parse. Worker xác minh lại hash và metadata file trước khi đọc.
- Parse/validate theo stream hoặc giới hạn tài nguyên; ghi staging và progress theo chunk, không giữ transaction DB dài trong lúc đọc/scan.
- Dò trùng cả với customer hiện hữu và giữa các dòng cùng batch. Candidate được lưu ở staging để review trước khi commit; không ghi Customer hoặc DuplicateCandidate trong bước preview.
- Sau xác nhận, một transaction duy nhất chuyển batch sang `COMMITTING`, tạo tất cả customer hợp lệ chưa được xác nhận trùng, tạo candidate relations/audit cần thiết, đánh dấu row outcome và batch `COMPLETED`. Nếu bất kỳ thao tác nào thất bại, rollback toàn transaction; lỗi kỹ thuật cho phép retry an toàn. Dùng bulk operation có giới hạn theo row cap đã duyệt, không gọi lại `CustomersService.create` tuần tự trong một transaction lớn.
- Chống hai lần xác nhận đồng thời bằng conditional state transition/locking và idempotency; lần gọi lại trả cùng batch outcome, không tạo customer mới.

### Giao diện

Tạo route staff `/customers/import` và đường vào từ trang Khách hàng:

1. Chọn chi nhánh trong scope và tệp; hiển thị rõ định dạng/giới hạn.
2. Chọn sheet/header và ánh xạ họ tên, số điện thoại, email, ngày sinh; preview một số dòng và yêu cầu trường bắt buộc.
3. Theo dõi trạng thái scan/parse/validation; xem danh sách lỗi theo dòng và candidate trùng.
4. Cho phép review duplicate chỉ với `customers.duplicates.review`; phân biệt rõ dòng sẽ tạo hồ sơ, dòng sẽ bỏ qua vì trùng và dòng cần xử lý.
5. Tóm tắt số lượng cuối cùng, nút xác nhận rõ ràng và trạng thái hoàn tất; không auto-submit/auto-confirm.
6. Trạng thái loading, lỗi scanner/worker, hết hạn, hủy và retry phải hiển thị rõ. Không cho review dữ liệu batch ngoài scope.

## Kế hoạch thực hiện theo pha

| Pha | Công việc và kết quả | Phụ thuộc / cổng |
|---|---|---|
| 0. Chốt hợp đồng | Chốt permission `customers.import`, row/expanded-size/sheet caps, CSV encoding/delimiter, XLSX sheet/macro/formula policy, thời hạn staging/file và scanner/retention. Ghi default config và lỗi API. | Trước schema/parser. Dữ liệu thật vẫn khóa đến khi scanner, retention, quyền xóa/legal hold được duyệt. |
| 1. Schema/RBAC | Thêm batch/row states, relations, indexes/unique constraints; cập nhật permission catalog, role defaults, seed và migration. | Pha 0; validate migration trên PostgreSQL test. |
| 2. File pipeline | Tạo `ObjectStorageService` abstraction và local private adapter cho `CUSTOMER_IMPORT`, metadata FileAsset, upload quarantine, size/ext/MIME/signature validation và scanner contract. | Scanner provider chưa có thì chỉ dùng fake scanner cho test; API production fail-closed. |
| 3. Batch API | Tạo module/controller/DTO/service cho upload, status, row paging, decisions, confirm/retry/cancel; kiểm tra permission/scope, audit và idempotency. | Pha 1–2. |
| 4. Parse/validate worker | Thêm parser dependency đã duyệt, job processor, header mapping, phone/email/DOB normalization, row errors, duplicate scan và progress. | Pha 1–3; scan phải `AVAILABLE` trước parse. |
| 5. Atomic confirm | Tạo transaction commit, duplicate candidate relations hai chiều, audit, row outcome và retry-safe state transition. | Pha 4; test rollback bắt buộc trước khi nối UI. |
| 6. Staff UI | Route import, mapping/preview, trạng thái batch, lỗi/duplicate review, xác nhận và kết quả. | API status/rows/decision/confirm ổn định. |
| 7. Nghiệm thu | Unit, HTTP/PostgreSQL integration, permission/scope, parser security/resource-limit, restart/retry/idempotency, 375px UI và audit; chạy fixture tổng hợp. | Tất cả pha trước. Chỉ mở file thật sau phê duyệt scanner/storage/retention/legal. |

## Giới hạn parser đề xuất để chủ nghiệp vụ/security duyệt

MVP đã chốt giới hạn tệp 20 MB, nhưng chưa chốt giới hạn sau giải nén và kích thước batch. Đề xuất ban đầu để triển khai có kiểm soát:

- CSV UTF-8 (có hoặc không BOM), delimiter dấu phẩy và quoting chuẩn; không tự suy diễn delimiter.
- XLSX chỉ workbook không mã hóa, không macro, không external links; người dùng chọn sheet; bỏ qua hoặc báo lỗi với formula cell thay vì đánh giá công thức.
- Giới hạn ban đầu: tối đa 10.000 dòng dữ liệu, 10 sheet/workbook, 100 MB sau giải nén và 1.000 ZIP entries; cấu hình được và kiểm tra trước khi cấp phát tài nguyên lớn.

Các giới hạn trên là **đề xuất**, không phải quyết định đã chốt. Cần đo memory/time trong container và được Security/Operations chấp thuận; parser phải fail-closed khi vượt ngưỡng.

## Tiêu chí nghiệm thu

- Chỉ CSV/XLSX hợp lệ ≤20 MB; XLS/XLSM, MIME/chữ ký không khớp, file hỏng, mã hóa và workbook vượt resource caps bị từ chối/quarantine theo policy.
- Không parse trước scanner approval; khi scanner lỗi/không cấu hình, batch không qua `SCANNING` và không thể confirm.
- Lỗi từng dòng chỉ ra đúng số dòng/cột/mã lỗi; số điện thoại được chuẩn hóa bằng helper P0-2; email/DOB sai định dạng không làm mất dữ liệu tốt khác trong preview.
- Phát hiện trùng với customer đang có và giữa các dòng trong cùng batch; không tự merge; tất cả quyết định duplicate có actor/thời gian/lý do.
- Confirm bị chặn khi còn lỗi hoặc duplicate chưa xử lý; duplicate được xác nhận không tạo customer; dòng `NOT_DUPLICATE` tạo candidate để tiếp tục review sau import.
- Fault injection giữa promote chứng minh không tồn tại customer/duplicate row được ghi một phần; đồng thời rollback trạng thái commit đúng.
- Retry job, retry HTTP và confirm đồng thời không tạo batch/customer trùng; kết quả cuối ổn định sau restart worker.
- Kiểm tra ADMIN/OPERATOR `ALL`, MANAGE theo branch, ADVISING mặc định bị từ chối; scope lệch trả 403/404 theo pattern API, không lộ PII.
- Audit đầy đủ upload, review, confirm, retry, cancel; log không chứa tên/phone/email, nội dung file, token hoặc storage key.
- Trang import có probe desktop/375px và UI integration cho loading, lỗi, duplicate review, xác nhận, hoàn tất.

## Ca kiểm thử tối thiểu

1. CSV hợp lệ có BOM/quotes; XLSX hợp lệ có sheet được chọn; mapping header khác tên chuẩn.
2. Thiếu tên/điện thoại, phone sai theo P0-2, email sai, DOB tương lai/không hợp lệ, dòng trống và Unicode/tên dài.
3. Duplicate phone, email, name+DOB; cùng một phone lặp trong file; resolve `CONFIRMED_DUPLICATE` và `NOT_DUPLICATE`.
4. Sai extension/MIME/signature, XLS/XLSM, encrypted/broken workbook, zip bomb/entry vượt cap, file >20 MB, scanner reject/timeout.
5. Batch trống, vượt số dòng, retry parse, worker dừng giữa chừng, xác nhận đồng thời, confirm lặp, hủy trước/sau `COMMITTING`, batch hết hạn.
6. User thiếu `customers.import`, thiếu `customers.duplicates.review`, branch grant sai, batch của user khác và duplicate candidate ngoài scope.
7. Fault tại từng bước DB promotion; kiểm tra customer count, duplicate pair, audit và batch state sau rollback.

## Rủi ro và giảm thiểu

- **Atomicity và transaction dài:** đặt row cap; toàn bộ parse/scan ở staging; promotion chỉ gồm DB writes, dùng bulk/chunk có giới hạn nhưng vẫn trong transaction duy nhất. Nếu benchmark cho thấy giới hạn không khả thi, dừng để thiết kế lại semantic atomicity thay vì âm thầm commit từng chunk.
- **XLSX resource exhaustion:** giới hạn archive entries, inflated bytes, worksheet count, rows, cell/text length và thời gian; reject encrypted/macro/external links; test zip bomb.
- **Duplicate semantics:** không map candidate chưa có Customer ID sang endpoint duplicate cũ. Quyết định trong batch phải audit tại staging; khi commit mới tạo Customer/`DuplicateCandidate`.
- **PII tồn tại trong file/staging:** không log PII; private storage nằm ngoài webroot; RBAC cho cả batch và candidate; retention theo policy; không dùng production data trong test.
- **Scanner chưa chọn:** làm adapter contract và fake scanner chỉ cho test; giữ API upload file thật đóng; không dùng "scan giả" để chấp nhận tệp thật.
- **Parser dependency:** chỉ thêm sau khi duyệt thư viện CSV/XLSX và xác nhận license, khả năng bảo trì, resource behavior và security advisories.
- **Schema Customer hiện bắt buộc provenance/branch:** import gán provenance `IMPORT`, branch do actor chọn và được service kiểm tra; không sửa chuẩn customer hiện có.

## Cổng bắt đầu implementation

Trước migration/parser, xác nhận:

1. Quyền import riêng `customers.import` và defaults `ADMIN/OPERATOR=ALL`, `MANAGE=BRANCH`, `ADVISING=none`.
2. Parser CSV delimiter/encoding, XLSX formula policy và các resource caps đề xuất.
3. Scanner provider/contract, retention staging/file, quyền xóa, legal hold và hành vi file khi scan reject/timeout.
4. Quy ước xác nhận duplicate: `CONFIRMED_DUPLICATE` bỏ qua dòng; `NOT_DUPLICATE` nhập và tạo duplicate candidate theo P0-2.
5. Batch row cap có thể commit trong một PostgreSQL transaction sau benchmark.

Khi các cổng trên được chốt, có thể triển khai pha 1–5 bằng dữ liệu tổng hợp trong môi trường dev/test; pha 6 dùng API thật của môi trường dev/test. Upload dữ liệu thật vẫn là release gate riêng.
