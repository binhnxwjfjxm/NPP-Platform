# Phase 6D.1 — Reservation demand and fulfillment projection

> Status: **ACTIVE SOURCE DECISION**  
> Baseline: `main@2cfb48710ebd048bafc6e0014eefc2fc5bedef89`  
> Issue: `#230`  
> Scope: confirmed Sales Order → warehouse-level reservation demand.  
> Production migration, backend deployment and provider mutation are not authorized by this document.

## 1. Phần này làm gì cho người dùng

Khi đơn bán hàng được xác nhận, hệ thống không còn để đơn ở trạng thái chung chung `unallocated`.

```text
đơn được xác nhận
-> quy đổi từng dòng về SKU tồn kho gốc
-> kiểm tra tồn khả dụng của kho
-> giữ phần có thể đáp ứng
-> ghi rõ phần còn thiếu
-> trả projection đủ/thiếu hàng trên chi tiết đơn
```

Nhân viên bán hàng nhìn thấy đơn đã giữ đủ, giữ một phần hay đang chờ hàng. Kho có một nguồn nhu cầu chính thức để Phase 6D.2 chọn vị trí và lô.

## 2. Ranh giới reservation và allocation

Phase 6D.1 giữ hàng tại phạm vi:

```text
installation + warehouse + inventory-base variant
```

Nó chưa chọn:

```text
location
lot
expiry
pick quantity
pack quantity
```

Các phạm vi chính xác này thuộc Phase 6D.2. Không ép reservation P4.3 vốn yêu cầu location/lot cụ thể làm nhiệm vụ warehouse demand.

## 3. Nguồn số lượng

Nguồn nhu cầu là `base_quantity` bất biến trên dòng phiên bản Sales Order đã xác nhận.

Mỗi Sales SKU phải phân giải được đúng một variant đang hoạt động có `is_inventory_base=true` trong cùng product. Thiếu hoặc có nhiều inventory-base variant thì xác nhận thất bại và toàn bộ transaction rollback.

Không tính lại conversion từ master hiện tại sau khi đơn đã lưu snapshot.

## 4. Tồn khả dụng và chống oversell

Tại từng warehouse + base variant:

```text
available for new demand
= sum(on_hand_quantity)
- sum(exact inventory reserved_quantity)
- sum(active sales reserved_quantity - allocated_quantity)
```

Sales demand, exact inventory reservation và Inventory OUT dùng chung advisory lock:

```text
sales-fulfillment-scope:{installation}:{warehouse}:{baseVariant}
```

Database có hai backstop:

1. exact reservation không được lấy phần đã giữ cho Sales Order;
2. Inventory OUT không được làm tồn kho thấp hơn exact reservation cộng Sales demand chưa allocation.

## 5. Backorder

`shared.sales_order_settings.allow_backorder` là chính sách cấp installation.

- Giá trị mặc định là `true` để rollout không phá hành vi xác nhận đơn hiện có.
- Khi `true`, xác nhận được phép giữ 0, một phần hoặc toàn bộ; phần thiếu được ghi `backordered_base_quantity`.
- Khi `false`, bất kỳ scope nào không đủ toàn bộ nhu cầu làm xác nhận thất bại với `SALES_ORDER_INSUFFICIENT_STOCK` và không ghi dở dang.

Quyền thay đổi chính sách sau này là:

```text
core.fulfillment.configure-backorder
```

Phase 6D.1 chưa thêm màn cấu hình; không hardcode policy ở frontend.

## 6. Trạng thái projection

```text
reserved            toàn bộ nhu cầu đã giữ
partially_reserved  giữ được một phần, còn thiếu một phần
backordered         chưa giữ được phần nào
cancelled           đơn bị hủy
```

Các trạng thái allocation/pick/pack/issue hiện có vẫn được giữ để Phase 6D.2–6D.4 nối tiếp, không dùng reservation status thay cho execution status.

## 7. Amendment và cancellation

Khi xác nhận amendment:

1. lock Sales Order theo flow hiện có;
2. lock các warehouse/base-variant scope theo thứ tự ổn định;
3. supersede demand của phiên bản cũ;
4. tính và ghi demand của phiên bản mới;
5. nếu bất kỳ bước nào thất bại, confirmation và toàn bộ demand rollback cùng transaction.

Khi hủy đơn chưa có execution facts, active demand chuyển thành `CANCELLED` trong cùng transaction và phần giữ được giải phóng cho đơn khác.

## 8. Idempotency, audit và outbox

Route confirm/cancel tiếp tục dùng idempotency và `withAuditOutboxTransaction` hiện có.

Demand được tạo hoặc thay thế trước khi response snapshot được ghi vào audit/outbox. Replay cùng key không tạo thêm demand; payload mismatch tiếp tục bị từ chối bởi contract chung.

## 9. Không thuộc Phase 6D.1

- chọn lô FEFO/FIFO;
- manual lot override;
- pick/pack;
- Delivery Order;
- Inventory OUT/reversal;
- customer return;
- vehicle, driver, trip, stop, attempt hoặc POD;
- frontend Admin approval;
- production migration hoặc deployment.

## 10. Gate

Source chỉ đạt khi chứng minh:

- migration 042 apply và rerun;
- confirm tạo đúng một active demand cho mỗi confirmed version line;
- concurrent Sales confirmations không oversell;
- exact Inventory reservation và Inventory OUT tôn trọng Sales demand;
- backorder on/off cho kết quả đúng;
- amendment supersede demand cũ, không nhân đôi;
- cancellation giải phóng demand;
- cross-installation và warehouse scope fail closed;
- audit/outbox failure rollback confirmation và demand;
- regressions Sales Order, Inventory reservations, migration rehearsal và Browser E2E vẫn xanh.
