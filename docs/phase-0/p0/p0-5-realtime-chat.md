# P0-5 — Chat realtime

**Trạng thái:** Chưa triển khai.

## Mục tiêu

Cho phép ADVISING và CUSTOMER trao đổi realtime trong conversation được phép, với lịch sử bền vững và authorization ở backend.

## Phạm vi

- Conversation liên kết với customer, adviser và scope được cấp.
- Mỗi message là record append-only trong PostgreSQL; metadata là cột riêng, payload là compact JSON string đã validate.
- Socket.IO authorize connection, room join, send, read và thao tác supervisor.
- Cursor pagination, idempotency, reconnect/offline sync; message được lưu trước khi ACK.
- Không truyền binary qua socket; file chỉ qua HTTP có authorization.

## Tiêu chí hoàn tất

- CUSTOMER không thể đọc/gửi vào conversation của customer khác.
- ADVISING chỉ truy cập conversation/customer được gán; MANAGE/ADMIN theo quyền và scope được cấp.
- Client retry không sinh message duplicate; reconnect lấy bù lịch sử bằng cursor.
- API/socket event contract có versioning/OpenAPI hoặc tài liệu sự kiện tương ứng.

## Phụ thuộc

Auth/actor context, conversation/customer relationship, persistence, permission/scope và idempotency từ P0-0—P0-2.
