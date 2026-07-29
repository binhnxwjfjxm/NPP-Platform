# Phase 5.1 — Purchase Order decisions

Trạng thái: **LOCKED FOR IMPLEMENTATION**  
Phạm vi: NPP Core Purchasing — Purchase Order foundation  
Không bao gồm: goods receipt, inventory posting, payable, supplier payment

## 1. Nguồn sự thật

- Purchase Order là nguồn sự thật cho nội dung NPP đặt mua từ nhà cung cấp.
- Purchase Order không phải chứng từ thực nhận hàng.
- Purchase Order không ghi inventory ledger, payable ledger hoặc payment allocation.
- Goods Receipt ở P5.2 mới là nguồn thực tế nhận hàng và là chứng từ gọi internal inventory posting service.

## 2. Vòng đời trạng thái

```text
draft
  -> pending_approval
  -> approved

Draft, pending_approval hoặc approved
  -> cancelled
```

Các trạng thái `partially_received`, `fully_received` và `closed` được dành cho P5.2 trở đi. P5.1 chỉ đọc được các trạng thái này nếu dữ liệu tương lai xuất hiện; P5.1 không tự chuyển vào các trạng thái nhận hàng.

### Draft

- Có thể tạo và cập nhật header/dòng hàng.
- Phải có ít nhất một dòng SKU trước khi gửi duyệt.
- Chưa có số PO chính thức.
- Không tạo tồn kho hoặc công nợ.

### Pending approval

- Không sửa trực tiếp header hoặc dòng hàng.
- Có thể duyệt hoặc hủy theo quyền.
- Nếu cần thay đổi nội dung, P5.1 dùng hủy và tạo PO mới; amendment/version là quyết định của phase sau.

### Approved

- Được cấp số chứng từ chính thức bằng document-numbering service.
- Header và dòng hàng bất biến.
- Có thể hủy khi chưa phát sinh goods receipt. P5.2 phải siết thêm điều kiện này bằng quan hệ receipt thực tế.
- Không tự ghi tồn kho hoặc công nợ.

### Cancelled

- Bất biến và chỉ đọc.
- Bắt buộc lưu lý do hủy, actor và thời điểm.
- Không xóa lịch sử.

## 3. Số chứng từ

- Series chuẩn: `PURCHASE_ORDER`.
- Prefix mặc định: `PO-`.
- Template: `{PREFIX}{YYYY}{MM}-{SEQ}`.
- Reset theo tháng, timezone `Asia/Ho_Chi_Minh`.
- Số chỉ được cấp trong transaction duyệt PO.
- Allocation dùng cùng idempotency key của yêu cầu duyệt.
- Approval thất bại phải rollback cả allocation và thay đổi trạng thái.

## 4. Phân quyền

Danh mục quyền chuẩn:

- `core.purchase-order.read`
- `core.purchase-order.create`
- `core.purchase-order.update`
- `core.purchase-order.submit`
- `core.purchase-order.approve`
- `core.purchase-order.cancel`

Backend kiểm quyền độc lập cho từng action. Frontend chỉ hỗ trợ UX và luôn fail-closed khi không nhận được permission context.

## 5. Warehouse scope

- Mọi list/get/mutation đều installation-scoped.
- Kho nhận phải thuộc warehouse scope của actor.
- Scope rỗng không được frontend tự mở rộng.
- Bootstrap service principal hiện được backend mở rộng sang toàn bộ kho của installation để tương thích runtime một installation; user principal thực tế vẫn phải có scope cụ thể.
- Không tin warehouse scope hoặc installation ID do browser gửi tự do.

## 6. Dòng hàng và snapshot

Mỗi dòng PO lưu snapshot:

- variant/SKU ID;
- mã SKU;
- tên hàng;
- unit ID và mã đơn vị;
- conversion-to-base;
- ordered quantity;
- base quantity;
- unit price;
- discount amount;
- tax amount;
- line total.

Thay đổi master SKU/unit/conversion sau đó không được làm thay đổi lịch sử PO.

Trong P5.1, một variant/SKU chỉ xuất hiện một lần trong một PO. Khi nghiệp vụ cần nhiều lịch giao hoặc điều kiện giá cho cùng SKU, phase sau phải mở line identity rõ ràng thay vì bỏ unique một cách chắp vá.

## 7. Decimal và tiền

- Quantity và money đi qua API dưới dạng decimal string.
- Backend dùng BigInt scaled 6 chữ số thập phân để tính.
- PostgreSQL lưu `numeric(20,6)`.
- Frontend chỉ preview bằng BigInt; backend là nguồn tính tổng cuối cùng.
- Không dùng JavaScript float làm nguồn nghiệp vụ.
- Currency mặc định P5.1 là `VND`; schema vẫn lưu ISO currency code để mở rộng có kiểm soát.

## 8. Idempotency và concurrency

- Tất cả mutation bắt buộc `Idempotency-Key`.
- Cùng key + cùng payload trả response cũ.
- Cùng key + payload khác trả conflict.
- Browser giữ key ổn định khi retry cùng logical attempt và tạo key mới khi payload thay đổi.
- Update, submit, approve và cancel bắt buộc `expectedRevision`.
- Stale revision trả conflict, không ghi một phần.

## 9. Audit và outbox

Mỗi mutation thành công ghi trong cùng transaction:

- audit record với actor, request ID, source app, before/after và metadata;
- một outbox event tương ứng:
  - `purchasing.purchase_order.created`
  - `purchasing.purchase_order.updated`
  - `purchasing.purchase_order.submitted`
  - `purchasing.purchase_order.approved`
  - `purchasing.purchase_order.cancelled`

Nếu audit/outbox thất bại, mutation phải rollback.

## 10. Ranh giới P5.2

P5.2 được phép dùng PO đã approved để tạo nhiều Goods Receipts. P5.2 phải bổ sung:

- ordered/previously received/received now/remaining;
- accepted/rejected/shortage/excess;
- warehouse location, lot, manufacture/expiry;
- internal inventory posting và reversal;
- điều kiện không cho hủy PO khi đã có posted receipt.

P5.1 không tạo placeholder mutation hoặc generic inventory posting route để giả lập các nghiệp vụ này.
