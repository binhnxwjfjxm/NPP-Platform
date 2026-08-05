# Phase 6E.6 — Optional proof of delivery decisions

> Status: ACTIVE IMPLEMENTATION DECISION  
> Source baseline: `main@5c6cf4c02552eeb7aeaf93006dfbd90b68f9eca1`  
> Issue: #260  
> Production deploy/migration: not authorized

## 1. Phần này giúp gì cho người dùng

Sau khi tài xế đã ghi kết quả giao, tài xế có thể đính kèm thêm bằng chứng vào đúng lần giao đó. Bằng chứng có thể là ảnh, tên người nhận, tham chiếu chữ ký, tham chiếu OTP hoặc ghi chú xác nhận. Điều phối viên có thể xem lại bằng chứng từ NPP Operations.

## 2. Quyết định chủ dự án đã khóa

POD là **tùy chọn**.

- Không có ảnh, chữ ký hoặc OTP vẫn ghi được kết quả giao.
- POD không phải điều kiện để giao đủ, giao một phần, không giao được hoặc hẹn lại.
- Ảnh không bắt buộc vì giao sỉ không vận hành giống giao lẻ của sàn thương mại điện tử.
- Công ty tự quy định bằng quy trình bên ngoài trường hợp nào cần chụp hoặc lấy xác nhận.
- Slice này không tạo policy engine theo khách hàng, kênh bán hoặc loại đơn.
- Sau này chỉ thêm policy bắt buộc khi chủ dự án yêu cầu rõ và có migration/configuration path riêng.

## 3. Nguồn sự thật và ownership

- Delivery attempt là kết quả giao bất biến và đã tồn tại trước POD.
- Logistics sở hữu POD metadata và lineage.
- Core object-storage boundary sở hữu upload/download file.
- R2 credential chỉ ở Core backend; browser và Delivery frontend không nhận credential.
- POD không sửa delivery attempt, Inventory movement, reconciliation, Sales Order, COD hoặc accounting.

## 4. Lineage bắt buộc

Mỗi POD gắn bất biến với:

- installation;
- delivery attempt;
- trip;
- trip stop;
- assignment;
- Delivery Order;
- driver profile;
- actor/request/source app.

Driver chỉ attach/read POD của attempt thuộc chuyến được giao đúng cho mình. Dispatcher/NPP Operations chỉ đọc trong warehouse scope hiện tại. Cross-driver và cross-installation fail closed.

## 5. Loại POD foundation

```text
photo
signature
otp
manual_confirm
```

- `photo`: có object key, filename, MIME type, byte size và SHA-256 do server xác nhận.
- `signature`: lưu tên người nhận hoặc reference do quy trình ngoài cung cấp; slice này không xây canvas chữ ký.
- `otp`: lưu reference đã xác nhận; slice này không phát hoặc kiểm OTP.
- `manual_confirm`: lưu tên người nhận hoặc ghi chú xác nhận.

Các reference trên là bằng chứng nghiệp vụ bổ sung, không tự trở thành chữ ký điện tử hoặc xác thực pháp lý.

## 6. File và R2

- Chỉ Core backend upload file qua R2 adapter.
- Object key do server tạo và installation-scoped.
- Cho phép ảnh JPEG, PNG, WebP, HEIC và HEIF.
- Kích thước phải nhỏ hơn giới hạn R2 runtime; request body có giới hạn riêng.
- Download dùng URL ký ngắn hạn; public bucket URL không phải nguồn authorization.
- Storage upload phải thành công trước khi DB metadata được commit.
- Nếu DB transaction fail sau upload, backend phải thử xóa object orphan và ghi log đã làm sạch nếu cleanup không thành công.
- Khi R2 chưa được cấu hình, POD dạng ảnh bị từ chối rõ; POD text/manual vẫn dùng được.

## 7. Idempotency và bất biến

- POST attach POD bắt buộc `Idempotency-Key`.
- Cùng key + cùng payload trả replay, không upload hoặc ghi trùng.
- Cùng key + payload khác trả conflict.
- Hai request cạnh tranh được serialize bằng advisory lock và DB uniqueness.
- POD đã ghi không sửa/xóa trực tiếp.
- Muốn correction sau này phải có capability append-only riêng; không thuộc slice này.

## 8. Audit/outbox

Mutation thành công ghi cùng transaction:

- immutable POD metadata;
- trip event `POD_ATTACHED`;
- audit action `logistics.delivery_attempt.pod_attach`;
- outbox event `core.delivery_attempt.pod_attached`.

Replay chỉ đọc, không tạo thêm event/audit/outbox.

## 9. Quyền

```text
core.pod.read
core.pod.attach
```

- Driver nhận hai quyền trên trong Delivery principal, nhưng identity và warehouse scope vẫn được kiểm server-side.
- Bootstrap nhận quyền để NPP Operations đọc và kiểm thử installation hiện tại.
- Quyền không làm rộng customer/order administration hoặc dispatch mutation.

## 10. API foundation

Driver:

```text
GET  /api/logistics/driver/trips/:tripId/assignments/:assignmentId/attempts/:attemptId/pod
POST /api/logistics/driver/trips/:tripId/assignments/:assignmentId/attempts/:attemptId/pod
```

NPP Operations:

```text
GET /api/logistics/trips/:tripId/attempts/:attemptId/pod
```

## 11. UI

- Khi chưa có attempt, UI không hiển thị attach POD.
- Khi attempt đã ghi, UI hiển thị khu vực “Bằng chứng giao hàng (không bắt buộc)”.
- Người dùng có thể bỏ qua hoàn toàn.
- Ảnh và xác nhận text được thêm sau attempt, không gộp POD thành điều kiện submit attempt.
- NPP Operations hiển thị danh sách bằng chứng và link ký ngắn hạn khi có file.

## 12. Ngoài scope

- bắt buộc ảnh/chữ ký/OTP;
- policy engine;
- phát/verify OTP;
- chữ ký canvas;
- live GPS/geofence/tracking;
- COD/payment/accounting;
- sửa delivery attempt;
- Admin/MCP/Website mutation;
- production deploy/migration/provider/DNS/secret changes.

## 13. Gate

- Attempt hiện tại vẫn hoạt động khi không có POD.
- Migration apply/rerun/rehearsal.
- Driver A không attach/read POD của driver B.
- Dispatcher ngoài warehouse scope bị từ chối.
- Idempotent replay và concurrency không tạo trùng.
- Upload type/size/checksum/object key được kiểm server-side.
- Storage failure không ghi DB; DB failure sau upload kích hoạt orphan cleanup.
- POD bất biến, audit/outbox/trip event cùng transaction.
- Delivery và NPP build/E2E; full Core regression; exact-head CI xanh.
