# P0-0 — Nền dữ liệu và worker

**Trạng thái:** Đã triển khai nền mã nguồn; chờ xác nhận tích hợp runtime với Docker/PostgreSQL/Redis.

## Mục tiêu

Thiết lập nền persistence và xử lý nền để các module P0 dùng chung, phù hợp modular monolith NestJS, PostgreSQL và Prisma theo `AGENT.md`.

## Phạm vi

- Thêm Prisma schema/client generation và lệnh quản lý migration; PostgreSQL tiếp tục là nguồn dữ liệu nghiệp vụ. Chưa có migration nghiệp vụ vì chưa chốt model miền.
- Bổ sung Redis dùng riêng cho queue/cache và worker process/lifecycle. Redis không là nguồn dữ liệu nghiệp vụ.
- Cấu hình environment validation và graceful shutdown cho API/worker.
- Thiết lập nguyên tắc migration/seed; seed chỉ permission catalog và dữ liệu tổng hợp cần cho dev.

## Tiêu chí hoàn tất

- Prisma schema/client và lệnh migration đã cấu hình; việc chạy migration trên DB sạch cần Docker/runtime và schema nghiệp vụ đầu tiên.
- Prisma là đường truy cập dữ liệu nghiệp vụ; health/readiness không lộ thông tin kết nối.
- Worker có retry/backoff mặc định, concurrency cấu hình được và dừng an toàn. Idempotency được áp dụng ở từng loại job khi module nghiệp vụ khai báo khóa/job ID.
- Job nền lưu trạng thái nghiệp vụ cần thiết ở PostgreSQL; Redis chỉ vận chuyển/điều phối job.
- Không có secret hoặc dữ liệu khách hàng thật trong seed/fixture.

## Phụ thuộc và cổng

P0-0 mở đầu cho mọi module. Cần môi trường Docker Compose/Redis/PostgreSQL hoạt động để xác nhận tích hợp; runtime chưa được kiểm tra trong lượt triển khai này. Chưa nạp schema nghiệp vụ lớn cho tới khi các module sau xác định quan hệ/constraints.
