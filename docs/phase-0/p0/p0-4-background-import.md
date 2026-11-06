# P0-4 — Import khách hàng nền theo batch atomic

**Trạng thái:** Chưa triển khai.

## Mục tiêu

Import CSV/XLSX với preview/validation/duplicate scan bất đồng bộ, không ghi dở dữ liệu khi một dòng lỗi.

## Quy trình

1. Upload tệp vào private quarantine; validate loại/kích thước/chữ ký và quét trước khi parse.
2. Tạo batch ID, lưu metadata và staging rows; đưa parse/preview vào worker queue.
3. Kiểm tra/mapping các cột họ tên, ngày sinh, số điện thoại; trả lỗi có số dòng.
4. Dò trùng nền; candidate cần được người có quyền review/xác nhận.
5. Hiển thị preview, lỗi và trạng thái cho người tạo; chỉ nhận xác nhận khi toàn bộ batch hợp lệ.
6. Promote toàn batch theo semantics atomic; nếu lỗi thì không nhập một phần.

## Tiêu chí hoàn tất

- Hỗ trợ CSV/XLSX theo giới hạn đã chốt; không hỗ trợ XLS/XLSM.
- Job có trạng thái, progress/kết quả, retry/idempotency; cùng batch không tạo customer trùng khi client retry.
- Mỗi dòng có trạng thái/error riêng; duplicate review tách biệt khỏi customer lifecycle.
- Batch chỉ commit sau explicit confirmation và toàn bộ dòng hợp lệ/duplicate được xử lý.
- Parse chỉ sau scanner approval; nếu scanner chưa sẵn sàng, chỉ dùng fixture trong dev/test và không mở file thật.

## Cấu hình còn cần

Phone country/normalization, XLSX resource caps, scanner provider, retention và cách khôi phục/hủy batch.
