# P0-4 — Import khách hàng nền theo giao dịch atomic

**Trạng thái:** Pipeline cơ sở upload → ClamAV → worker → import PostgreSQL → xóa tệp đã được nghiệm thu trên stack test riêng. Bản mở rộng partial-row đã qua API suite, typecheck và build; migration mới cùng integration mixed-row chưa được áp dụng/chạy trên DB test riêng, nên chưa coi phần mở rộng runtime đã nghiệm thu.
**Phụ thuộc:** P0-0 (PostgreSQL/Redis/BullMQ), P0-1 (auth/RBAC/audit), P0-2 (customer/normalization/duplicate review), thư mục tạm cục bộ dùng chung giữa API/worker và ClamAV nội bộ.

## Mục tiêu

Cho nhân viên có quyền tải CSV/XLSX và chọn chi nhánh. Hệ thống quét bằng ClamAV, chuyển kết quả cho worker, tự nhập các dòng hợp lệ vào PostgreSQL rồi xóa tệp. Không có bước preview/xác nhận thủ công. Dòng lỗi dữ liệu được bỏ qua và báo số dòng; dòng trùng được bỏ qua và đếm riêng. Các dòng hợp lệ được ghi trong một giao dịch; nếu giao dịch thất bại thì rollback toàn bộ phần ghi hợp lệ đó. Lỗi tệp hoặc scanner làm dừng toàn batch.

## Phạm vi và hợp đồng đã có

- Chỉ nhận CSV và XLSX, tối đa **20 MB**; từ chối XLS/XLSM. Tệp được lưu tạm tại `apps/api/import-customer-files` trong API container, scan bằng ClamAV trước khi parse và xóa sau khi import hoặc khi xử lý lỗi. Docker Compose dùng volume local riêng, chỉ mount vào API/worker; nếu DB commit xong nhưng xóa tệp lỗi, batch ở `COMMITTING` và retry chỉ dọn tệp/hoàn tất, không import lần hai.
- Không dùng S3/Object Storage cho import. API và worker phải mount cùng volume cục bộ; triển khai nhiều host cần shared filesystem hoặc phải giữ import bị khóa.
- Không preview hoặc lưu dữ liệu staging từng dòng. Parser giới hạn tài nguyên và xử lý tối đa 10.000 dòng. Dòng không hợp lệ bị bỏ qua; chỉ lưu số dòng và mã lỗi đã được whitelist tối đa 30 ngày, không lưu giá trị ô hoặc PII. Sau đó xóa chi tiết, chỉ giữ trạng thái và số lượng tổng hợp: thành công, trùng, dòng lỗi dữ liệu và insert thất bại.
- Trường nhập theo schema Customer hiện tại: họ tên và số điện thoại bắt buộc; email và ngày sinh tùy chọn. Chi nhánh là lựa chọn bắt buộc ở cấp batch. Không nhập thêm PII ngoài schema đã duyệt.
- Dùng chuẩn hóa số điện thoại Việt Nam hiện có (`normalizeVietnamesePhone`), chuẩn hóa tên/email và quy tắc dò trùng của P0-2; không tạo một cách chuẩn hóa riêng cho import.
- Customer tạo từ import có `createdById` là người tải lên và `provenance` do hệ thống gán là `IMPORT`. Không tự phân công tư vấn viên.
- Dò trùng theo phone/email đã chuẩn hóa và họ tên + ngày sinh khi có đủ dữ liệu. Không tự gộp hồ sơ.
- Dòng trùng được bỏ qua tự động; không gộp và không tạo candidate mới. Retry cùng batch không được tạo customer trùng.
- Tệp thật không được chấp nhận nếu scanner chưa cấu hình. Trước khi có scanner, chỉ kiểm thử bằng fixture tổng hợp trong dev/test; không có đường tắt parse trực tiếp.

## Khảo sát codebase làm căn cứ

- Đã có `CustomersService`, DTO tạo customer, `normalizeVietnamesePhone` và `syncDuplicateCandidates`; customer hiện bắt buộc `branchId` và `provenance`.
- Đã có `DuplicateCandidate` với trạng thái `OPEN`, `CONFIRMED_DUPLICATE`, `NOT_DUPLICATE`, quyền `customers.duplicates.review` và xử lý hai chiều. Import không tạo candidate mới.
- Đã có `BackgroundQueueService` và BullMQ; `WorkerRuntimeService` xử lý `customer-import.process` cùng healthcheck.
- `FileAsset` dành cho chứng từ tác vụ, có giới hạn size/MIME riêng; không dùng lại cho CSV/XLSX import. Import lưu khóa tệp tạm opaque trong batch và không tạo FileAsset.
- API dùng permission `customers.import`; parser dùng ExcelJS cho XLSX và kiểm tra ZIP streaming để giới hạn byte giải nén thực tế.

## Thiết kế đề xuất

### Mô hình dữ liệu

Migration dự kiến thêm:

- `CustomerImportBatch`: `id`, `branchId`, `createdById`, khóa tệp tạm opaque, idempotency key, file hash trong lúc xử lý, trạng thái, số liệu tổng hợp, timestamps và mã lỗi tổng quát an toàn.
- `CustomerImportRow` chỉ giữ chi tiết lỗi đã làm sạch (số dòng + mã lỗi); không lưu giá trị ô hoặc dữ liệu khách hàng. Worker tự xóa các bản ghi này sau 30 ngày.
- Unique constraints cho idempotency key trong phạm vi người tạo; unique `(batchId, rowNumber)` hoặc `(batchId, sheetName, rowNumber)`; index cho batch/status và candidate lookup.
- Batch terminal xóa file key/hash, mapping/sheet name và dữ liệu row nếu có; chỉ giữ counts cần cho audit.
- `invalidRows` đếm dòng lỗi validation; `failedInsertRows` đếm số dòng hợp lệ bị rollback khi transaction ghi thất bại. Chi tiết chỉ chứa số dòng và mã lỗi, được xóa sau 30 ngày. Audit chỉ ghi counts tổng hợp, không ghi từng dòng.

Batch states dùng trong pipeline:

`QUEUED → SCANNING → PROCESSING → COMMITTING → COMPLETED`

Kết thúc ngoại lệ: `FAILED`, `CANCELLED`, `EXPIRED`. `COMMITTING` giữ file key/hash cho tới khi xóa tệp thành công; retry ở trạng thái này chỉ hoàn tất cleanup, không ghi customer lần nữa.

Row state `INVALID` chỉ đánh dấu chi tiết lỗi validation hoặc dòng bị rollback; không dùng để lưu staging hay review.

Counts batch-level được lưu; chi tiết lỗi không chứa dữ liệu dòng hoặc PII. Mã lỗi an toàn và số dòng chỉ lưu 30 ngày; không đưa chi tiết dòng vào audit.

### Quyền

Đề xuất thêm permission catalog `customers.import` để quản trị có thể cấp quyền import độc lập với quyền sửa hồ sơ:

- `ADMIN`/`OPERATOR`: `ALL`; `MANAGE`: `BRANCH`; `ADVISING` không được cấp mặc định.
- Upload và xem history/status đều kiểm tra actor + permission + branch scope ở backend; không tin `branchId` hoặc `createdById` do client tự quyết ngoài DTO và session hợp lệ.
- Import không cấp quyền review duplicate hoặc quyền quản lý customer.
- History chỉ chứa trạng thái, mã lỗi và counts; không trả file key, storage path, tên file hoặc PII.

### API đề xuất

Prefix `/api/v1`:

- `GET /customers/import-batches/readiness` — readiness của DB/schema (bao gồm migration giữ chi tiết lỗi), local storage, ClamAV, queue và worker; upload chỉ nhận khi `READY`.
- `POST /customers/import-batches` — multipart upload cùng `branchId` và `Idempotency-Key`; kiểm tra quyền, giới hạn/định dạng, lưu file cục bộ và enqueue worker. Không parse đồng bộ.
- `GET /customers/import-batches` — lịch sử của người tạo, chỉ có trạng thái, mã lỗi và counts.
- `GET /customers/import-batches/:batchId` — trạng thái, counts, timestamps, mã lỗi an toàn và (trong 30 ngày) số dòng lỗi cùng mã lỗi validation đã whitelist.

Response không chứa object key, storage path, tên file, nội dung tệp, giá trị ô hoặc PII.

### Worker và atomic promotion

- Tách processor import thành provider nghiệp vụ có dependency injection với `PrismaService`, storage/scanner adapter và parser; đăng ký processor trong `WorkerModule`. Giữ healthcheck hiện tại.
- Job ID xác định từ batch; trạng thái DB là nguồn sự thật, BullMQ là cơ chế thực thi. Readiness kiểm tra queue và worker.
- Scan trước, chỉ khi ClamAV trả CLEAN mới parse. Worker xác minh SHA-256 trước khi đọc; parser giới hạn kích thước, dòng/cột/ô, số sheet, số ZIP entries và số byte thực tế sau giải nén.
- Parse/validate tối đa 10.000 dòng trong bộ nhớ; không lưu staging. Dòng lỗi validation được giữ lại dưới dạng số dòng + mã lỗi, không lưu giá trị gốc. Dò trùng customer hiện hữu và giữa các dòng cùng batch; bỏ qua dòng trùng, không merge.
- Một transaction Serializable tạo các customer hợp lệ chưa trùng và chuyển batch sang `COMMITTING`. Nếu transaction lỗi, rollback toàn bộ customer trong phần ghi và ghi nhận số dòng bị rollback. Chỉ sau transaction thành công worker xóa tệp; rồi đánh dấu `COMPLETED`, xóa file key/hash/mapping và ghi audit counts-only.
- Tệp tạm luôn được dọn sau xử lý. Chi tiết số dòng/mã lỗi hết hạn sau 30 ngày; worker xóa chi tiết theo lịch, giữ lại counts batch-level.
- Nếu xóa file hoặc finalization lỗi sau commit, retry xử lý batch `COMMITTING` bằng cleanup/finalization, không chạy lại insert. Nếu insert thất bại thì transaction rollback, file được dọn và batch ghi `FAILED`.

### Giao diện

Tạo route staff `/customers/import` và đường vào từ trang Khách hàng:

1. Chọn chi nhánh trong scope và CSV/XLSX; hiển thị định dạng và giới hạn.
2. Tải lên để tự động quét và nhập; không có bước preview hay xác nhận.
3. Theo dõi trạng thái và counts thành công/trùng/lỗi; xem số dòng và lý do lỗi đã whitelist trong 30 ngày.
4. Giải thích tệp được xóa sau xử lý, dòng trùng bị bỏ qua, dòng lỗi validation không ngăn nhập các dòng hợp lệ, còn lỗi scanner/tệp dừng toàn batch.
5. Trạng thái blocked/loading, lỗi scanner/worker, cleanup đang retry và hoàn tất phải hiển thị rõ.

## Kế hoạch thực hiện theo pha

| Pha | Công việc và kết quả | Phụ thuộc / cổng |
|---|---|---|
| 0. Chốt hợp đồng | Permission, parser limits, local temp directory, ClamAV nội bộ, auto-import, xóa tệp sau xử lý và audit chỉ giữ counts. | Đã chốt. Không dùng S3 cho import. |
| 1. Schema/RBAC | Thêm batch/row states, relations, indexes/unique constraints; cập nhật permission catalog, role defaults, seed và migration. | Pha 0; validate migration trên PostgreSQL test. |
| 2–6. Pipeline | Local temp storage, ClamAV `INSTREAM`, upload API, parser, worker, atomic import, history/readiness và UI auto-import. | Đã nối; phải giữ fail-closed khi scanner/worker/queue chưa sẵn sàng. |
| 7. Nghiệm thu | Unit/full API tests, HTTP/PostgreSQL integration, permission/scope, parser resource-limit, restart/retry/idempotency, cleanup và audit counts. | Còn thiếu integration thật và full suite sau pipeline. |

## Giới hạn parser đề xuất để chủ nghiệp vụ/security duyệt

Các giới hạn đã được duyệt cho MVP:

- CSV UTF-8 (có hoặc không BOM), delimiter dấu phẩy và quoting chuẩn; không tự suy diễn delimiter.
- XLSX chỉ workbook không mã hóa, không macro, không external links; worker đọc sheet đầu tiên đang hiển thị; formula cell bị từ chối, không đánh giá công thức.
- Giới hạn tối đa: 10.000 dòng dữ liệu, 10 sheet/workbook, 100 MB sau giải nén và 1.000 ZIP entries; kiểm tra trước khi cấp phát tài nguyên lớn.

## Tiêu chí nghiệm thu

- Chỉ CSV/XLSX hợp lệ ≤20 MB; XLS/XLSM, MIME/chữ ký không khớp, file hỏng, mã hóa và workbook vượt resource caps bị từ chối/quarantine theo policy.
- Không parse trước khi ClamAV trả CLEAN; scanner lỗi/không cấu hình thì fail-closed.
- Dòng sai trong CSV/XLSX không được nhập, nhưng các dòng hợp lệ khác vẫn được nhập; giao dịch ghi tập hợp hợp lệ vẫn atomic. Số điện thoại dùng helper P0-2.
- Kết quả trả số lượng nhập thành công, trùng, lỗi validation và lỗi ghi; chi tiết chỉ gồm số dòng + mã lỗi whitelist, không gồm giá trị ô, và bị xóa sau 30 ngày.
- Phát hiện trùng với customer đang có và giữa các dòng cùng batch; bỏ qua và đếm trùng; không tự merge.
- Fault injection giữa promote chứng minh không tồn tại customer/duplicate row được ghi một phần; đồng thời rollback trạng thái commit đúng.
- Retry sau commit hoặc lỗi xóa tệp không tạo customer trùng; batch `COMMITTING` chỉ được cleanup/finalize.
- Kiểm tra ADMIN/OPERATOR `ALL`, MANAGE theo branch, ADVISING mặc định bị từ chối; scope lệch trả 403/404 theo pattern API, không lộ PII.
- Audit import chỉ giữ số lượng thành công, trùng và insert thất bại; không lưu PII từng dòng, nội dung file, tên file, hash hoặc storage key sau khi xử lý xong.
- File tạm được xóa sau import thành công, infected, scanner error và parser error; batch không báo hoàn tất trước cleanup.
- Trang import có probe desktop/375px và UI integration cho loading, blocked, lỗi, cleanup retry và hoàn tất.

## Ca kiểm thử tối thiểu

1. CSV hợp lệ có BOM/quotes; XLSX hợp lệ đọc sheet đầu tiên đang hiển thị; header hỗ trợ alias Việt/Anh.
2. Thiếu tên/điện thoại, phone sai theo P0-2, email sai, DOB tương lai/không hợp lệ, dòng trống và Unicode/tên dài.
3. Duplicate phone, email, name+DOB; cùng một phone lặp trong file; xác nhận counts và không tạo customer trùng.
4. Sai extension/MIME/signature, XLS/XLSM, encrypted/broken workbook, zip bomb/entry vượt cap, file >20 MB, scanner reject/timeout.
5. Batch trống, vượt số dòng, retry parse, worker dừng giữa chừng, retry ở `COMMITTING`, lỗi xóa tệp và batch hết hạn.
6. User thiếu `customers.import`, branch grant sai, batch của user khác.
7. Fault tại từng bước DB promotion; kiểm tra customer count, duplicate pair, audit và batch state sau rollback.

## Rủi ro và giảm thiểu

- **Atomicity và transaction dài:** đặt row cap; scan/parse ngoài transaction, giữ tối đa 10.000 records trong memory; promotion chỉ gồm DB writes, dùng bulk/chunk có giới hạn trong transaction duy nhất. Nếu benchmark cho thấy giới hạn không khả thi, dừng để thiết kế lại semantic atomicity thay vì âm thầm commit từng chunk.
- **XLSX resource exhaustion:** giới hạn archive entries, inflated bytes, worksheet count, rows, cell/text length và thời gian; reject encrypted/macro/external links; test zip bomb.
- **Duplicate semantics:** không tạo candidate mới từ import; trùng được bỏ qua và chỉ lưu số lượng tổng hợp.
- **PII tồn tại trong file:** file chỉ ở thư mục tạm cục bộ, ngoài webroot; giới hạn quyền OS, không backup thư mục này, xóa sau xử lý; không dùng production data trong test.
- **Local filesystem:** API và worker phải dùng cùng volume local. Không hỗ trợ worker trên host/volume khác nếu không có shared filesystem; không tự chuyển sang S3.
- **Scanner:** ClamAV chỉ nằm trong network riêng của Compose cùng API/worker, không publish TCP port ra host. Kết quả không hợp lệ, timeout hoặc lỗi kết nối đều fail-closed.
- **Parser dependency:** ExcelJS và unzipper đã được thêm; cần tiếp tục theo dõi security advisories và giữ regression test cho zip bomb/resource limits.
- **Schema Customer hiện bắt buộc provenance/branch:** import gán provenance `IMPORT`, branch do actor chọn và được service kiểm tra; không sửa chuẩn customer hiện có.

## Quyết định đã chốt

1. Dùng `customers.import` theo defaults `ADMIN/OPERATOR=ALL`, `MANAGE=BRANCH`, `ADVISING=none`.
2. Tệp tối đa 20 MB; CSV UTF-8/dấu phẩy; XLSX không mã hóa, không macro/external links và không đánh giá formula; áp dụng resource caps ở trên.
3. Dùng ClamAV nội bộ; tệp chỉ lưu trong `apps/api/import-customer-files`; tự động nhập khi sạch/hợp lệ và tự xóa sau xử lý.
4. Audit chỉ giữ số lượng thành công, trùng và insert thất bại.
5. Dòng trùng bị bỏ qua, không tự merge; dòng lỗi validation bị bỏ qua, còn lỗi file/scanner dừng toàn batch.

## Tiến độ implementation

- **Đã triển khai:** schema/RBAC; local temp storage; ClamAV `INSTREAM`; readiness; upload/history/status API; CSV/XLSX parser; queue worker; atomic dedupe/import; count-only audit; UI auto-import và kết quả theo dòng.
- **Đã xác minh:** API suite (17 suites/108 tests), API typecheck/build, readiness `READY`, toàn bộ 20 migrations up-to-date trên PostgreSQL test đã có dữ liệu, và P0-2 API/PostgreSQL integration.
- **Đã kiểm tra pipeline thật:** upload CLEAN tự import và bỏ qua dòng trùng; dữ liệu sai thất bại atomic; EICAR bị ClamAV chặn; audit chỉ giữ counts; terminal batch không còn file key/hash; thư mục tạm rỗng sau xử lý.
- **Bản mở rộng partial-row:** parser/worker/API/UI tests, toàn bộ API suite hiện tại, API/web typecheck và build đều đạt. Readiness giữ `BLOCKED` cho tới khi schema có cột retention của migration `20261120121200_p0_4_partial_import_failures`. Migration chưa được áp dụng; cần xác minh migration và luồng mixed-row trên stack test cô lập trước khi triển khai.
- **Giới hạn nghiệm thu:** xác minh thực hiện trên stack test cục bộ; triển khai production vẫn cần xác nhận cấu hình volume, quyền truy cập, cập nhật ClamAV và sao lưu/vận hành phù hợp môi trường thật.
