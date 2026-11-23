# P0-5 — Chat realtime

**Trạng thái (bỏ qua 2026-11-23):** Giai đoạn P0-5 bị loại khỏi kế hoạch triển khai hiện tại và không xuất hiện trong mục lục P0 hoạt động. Tài liệu dưới đây chỉ giữ làm hồ sơ tương lai, không có migration, gateway, module, route hay UI chat; không lập task implementation cho P0-5 trong chu kỳ hiện tại.

## Mục tiêu

Cho phép ADVISING và CUSTOMER trao đổi realtime trong conversation được phép, lưu lịch sử trong PostgreSQL và thực thi authorization ở backend cho mọi connection, room và thao tác.

## Quyết định nền

- Stack realtime: Socket.IO qua NestJS gateway, không truyền file/binary.
- PostgreSQL là source of truth cho conversation và message.
- Redis chỉ dùng transport scale-out cho Socket.IO và không thay PostgreSQL.
- Message được ghi vào PostgreSQL trước khi gửi ACK hoặc phát `message:new`.
- MVP gửi văn bản; payload dạng compact JSON string đã validate.
- Cursor pagination dùng `(createdAt, id)` thay vì offset.
- Idempotency theo `(senderId, idempotencyKey)` để retry không tạo message trùng.
- Production CUSTOMER authentication, OTP/provider và PWA vẫn phụ thuộc cổng P0-1/P0-6; dev/test có thể dùng mock CUSTOMER hiện có nhưng phải fail-closed theo environment.

## Phạm vi MVP

### Conversation

- Mỗi conversation gắn với đúng một customer và chi nhánh.
- Advising conversation gắn adviser chính hoặc giữ lịch sử assignment.
- Trạng thái: `OPEN`, `RESOLVED`, `CLOSED`.
- Chỉ tạo conversation theo customer/adviser hợp lệ trong cùng scope.
- `RESOLVED/CLOSED` không tiếp tục nhận message mới; reopening/reassignment phải là thao tác riêng có audit.
- Assignment/reassignment không sửa lịch sử message.

### Message

- Mỗi message là record append-only trong PostgreSQL.
- Metadata cột riêng: id, conversationId, senderId, senderType, type, createdAt, idempotencyKey.
- Payload compact JSON: tối thiểu `{"text":"..."}`; giới hạn 4.000 ký tự.
- Chỉ hỗ trợ text trong MVP. File, link preview, reaction và edit/delete không thuộc P0-5.
- Không chỉnh sửa/xóa message đã gửi.
- Lưu trạng thái delivery/read tối thiểu: `SENT`, `DELIVERED`, `READ`; có thể cắt khỏi MVP nếu làm scope phức tạp nhưng không được tính là realtime cơ bản.

### RBAC và scope

- CUSTOMER chỉ truy cập conversation của chính customer được ánh xạ từ session.
- ADVISING chỉ truy cập conversation/customer được phân công và có `advising.message.send/read`.
- MANAGE chỉ truy cập theo branch scope được cấp; có quyền read, không cấp send trừ khi được phân công hoặc permission riêng cho phép.
- ADMIN/OPERATOR chỉ truy cập khi có scope/permission tương ứng, không tự suy rộng quyền.
- Backend kiểm tra permission và resource scope cho REST, socket handshake, join, send và read.
- Sidebar/UI không phải ranh giới authorization.

### Quan sát

- Lưu audit cho tạo conversation, resolve/close, reassignment và thay đổi trạng thái.
- Audit message chỉ giữ metadata/counter safe; không lưu payload PII hoặc nội dung trong audit mặc định.
- Correlation/request ID được truyền qua REST và log worker/socket.

## Mô hình dữ liệu đề xuất

Migration P0-5 cần cân nhắc các model sau:

- `Conversation`: id, customerId, branchId, primaryAdviserId, status, createdAt, updatedAt, resolvedAt, resolvedById.
- `ConversationParticipant`: conversationId, actorId, actorType, role, joinedAt, leftAt.
- `ConversationMessage`: id, conversationId, senderId, senderType, type, payloadJson, idempotencyKey, createdAt.
- `ConversationReadState`: conversationId, actorId, actorType, lastReadMessageId, lastReadAt.
- Unique `(conversationId, customerId?)` chỉ ở mức luật nghiệp vụ nếu một customer/adviser chỉ có một conversation active; không khóa unique toàn cầu nếu lịch sử nhiều thread được phép.
- Unique `(senderId, senderType, idempotencyKey)`.
- Index: conversation/status/updatedAt, message/conversation/createdAt/id, read-state/conversation/actor.

Tên và quan hệ cuối cùng phải được validate trong Prisma; không implement migration cho tới khi chốt concurrency và lifecycle.

## Hợp đồng REST đề xuất

Prefix `/api/v1`:

- `GET /conversations` — danh sách theo permission/scope, cursor.
- `POST /conversations` — tạo/open conversation trong phạm vi; idempotency key.
- `GET /conversations/:conversationId/messages?cursor=...&limit=...` — lịch sử bằng cursor.
- `POST /conversations/:conversationId/messages` — send fallback không realtime; idempotency key.
- `POST /conversations/:conversationId/read` — đánh dấu tin đã đọc.
- `PATCH /conversations/:conversationId/status` — resolve/close/reopen theo permission.
- `POST /conversations/:conversationId/reassign` — chuyển adviser chính trong branch/scope.

Những endpoint này chỉ là hợp đồng đề xuất. Cần bổ sung vào controller OpenAPI sau migration.

## Hợp đồng Socket.IO đề xuất

Namespace `/chat`, handshake bằng access token theo cơ chế auth hiện có; không nhận token dài hạn/customerId do client tự tuyên bố.

- `conversation:join:v1` — join sau authorization.
- `conversation:leave:v1` — rời room.
- `message:send:v1` — validate/idempotent/persist/ACK.
- `message:new:v1` — server phát tới room sau khi DB commit.
- `message:read:v1` — cập nhật read state.
- `message:delivery-status:v1` — `SENT/DELIVERED/READ`.
- `conversation:status-changed:v1` — resolve/close/reopen.
- `conversation:assigned:v1` — assignment/reassignment.
- `conversation:reconnected:v1` — client gửi cursor cuối để nhận missed events.

Mỗi event có `schemaVersion: "1.0"`, `eventId`, `conversationId`, `occurredAt`, `correlationId` và payload whitelist. ACK chỉ báo thất bại/thành công sau khi DB commit. ACK không thay thế state trong PostgreSQL.

## Luồng tạo và gửi message

1. Client xác thực access token ở socket handshake.
2. Gateway resolve actor thật từ session/token.
3. Join conversation kiểm tra customer/adviser/branch permission và scope.
4. Send validate conversation open, payload JSON, length và idempotency.
5. Ghi message trong transaction cùng read/updated state nếu cần.
6. Commit PostgreSQL.
7. Gửi ACK success, phát `message:new:v1` trong room hoặc Socket.IO adapter.
8. Retry cùng idempotency key trả message cũ, không insert/emit duplicate.
9. Reconnect gửi last message id/cursor và nhận bù qua REST/socket.

## Giao diện mục tiêu

- Route staff `/chat` hoặc panel chat trong `/customers/:id` — quyết định route sau UI spike.
- Sidebar "Hội thoại" hiện disabled → chỉ mở sau có permission `advising.conversation.read`.
- Danh sách conversation theo customer/adviser/status.
- Khung tin nhắn, tin inbound/outbound, trạng thái SENT/DELIVERED/READ, reconnect banner và lịch sử cursor.
- Loading, empty, offline, forbidden, conversation closed, reconnect và send retry state.
- Mobile kiểm tra 375px; desktop kiểm tra 1440px.
- Không có CUSTOMER PWA shell trong P0-5 nếu auth CUSTOMER chưa production-ready; dev/test có thể dùng mock cho integration.

## Kế hoạch implementation

| Pha | Công việc | Hạng mục nghiệm thu |
|---|---|---|
| P5-0 | Chốt lifecycle, advisory assignment, supervisor scope, delivery/read semantics | Quyết định chưa mơ hồ; permission catalog được cập nhật |
| P5-1 | Thêm migration Prisma/model/index/unique/foreign key | Clean migration + upgrade migration trên PostgreSQL test |
| P5-2 | Thêm Conversations module/service/REST/OpenAPI | Scope CRUD/list/history/read/status/test |
| P5-3 | Thêm Socket.IO dependencies, gateway, handshake guard, join/send/ACK | Connection unauthorized/room cross-user/message persistence |
| P5-4 | Thêm cursor, reconnect sync và idempotency | Retry không tạo duplicate; reconnect không mất lịch sử |
| P5-5 | Thêm staff/chat UI và permission gating | Responsive/loading/offline/closed/forbidden |
| P5-6 | Integration/E2E/security | IDOR, scope, duplicate, reconnect, multi-instance nếu bật Redis adapter |

## Tiêu chí hoàn tất

- CUSTOMER không thể đọc/gửi conversation của customer khác.
- ADVISING chỉ truy cập conversation/customer được assigned.
- MANAGE/ADMIN theo quyền và scope; không có quyền được suy ra từ UI.
- Room join không cho actor tự nêu conversationId để vượt scope.
- Client retry không sinh message duplicate.
- Reconnect lấy bù lịch sử theo cursor; message được lưu trước ACK.
- REST và socket event contract có version/schema/error code tài liệu.
- Close/resolve/reassign có audit và kiểm tra transition.
- Unit/integration/E2E đạt; migration clean/upgrade đạt trên PostgreSQL test cô lập.
- Không gửi binary qua Socket.IO.

## Cổng còn chặn

- Customer production auth/provider và ánh xạ customerId từ session.
- Quyết định chính xác quyền supervisor đọc/gửi/resolve/reassign.
- Chấp thuận quy tắc thread/conversation active và reassignment.
- Quyết định bật Redis Socket.IO adapter cho nhiều replica.
- Xác nhận retention, export và xóa message nếu yêu cầu Compliance.

## Phụ thuộc

- P0-0: PostgreSQL/Redis/runtime config.
- P0-1: Auth, actor context, RBAC, audit.
- P0-2: Customer, branch, assignment và scope.
- P0-6: route/web shell chỉ triển khai sau API contract ổn định.

## Dependency chặn code

- API chưa có `@nestjs/websockets`, `@nestjs/platform-socket.io` và `socket.io`.
- Web chưa có `socket.io-client`.
- `package-lock.json` chưa khóa dependency thực của P0-5.
- Các dependency chỉ được cài sau khi P5-0 chốt lifecycle/supervisor và migration đã tạo trước cổng implementation.
