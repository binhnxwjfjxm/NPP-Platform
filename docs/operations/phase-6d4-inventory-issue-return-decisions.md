# Phase 6D.4 — Inventory issue/reversal và nguồn gốc hàng trả

> Status: **ACTIVE SOURCE DECISION**  
> Baseline: `main@595bbfa15c43c391b2cd661c861fed57fbbe63b0`  
> Scope: Delivery Order ready state → inventory issue/reversal; explicit customer-return origin and warehouse receipt.  
> Tài liệu này không cho phép production migration, production deploy, vehicle/trip/POD/COD hoặc thay đổi provider.

## 1. Phần này làm gì cho người dùng

Phase 6D.4 nối chứng từ giao nhận với sổ kho bất biến đúng lúc hàng thực sự rời kho hoặc được bàn giao tại quầy:

```text
Delivery Order ready_to_dispatch
-> transition vật lý được phép
-> ghi Inventory OUT đúng vị trí/lô
-> giữ lineage về Sales Order, Delivery Order, allocation và reservation
```

Khi cần sửa một lần xuất kho sai, hệ thống tạo movement đảo thay vì sửa/xóa movement cũ. Khi khách trả hàng, chỉ phiếu trả đã nhận và kiểm tra tại kho mới ghi Inventory IN; yêu cầu trả hoặc giao thất bại không tự tăng tồn.

## 2. Boundary với Phase 6E

### DELIVERY

Core Logistics sở hữu trip, assignment và dispatch. Phase 6D.4 cung cấp transaction inventory issue dùng bởi dispatch transition; NPP Operations không có nút xuất giao thủ công để bỏ qua vehicle/driver/trip.

```text
Phase 6E trip dispatch
-> gọi service issue Delivery Order trong cùng Core backend transaction
-> Inventory OUT
-> Delivery Order dispatched
```

Cho đến khi Phase 6E tồn tại, API công khai không cho DELIVERY tự chuyển sang dispatched mà thiếu server-owned logistics dispatch source.

### PICKUP

Nhận tại quầy không cần trip. NPP Operations được xác nhận bàn giao vật lý:

```text
PICKUP ready_to_dispatch
-> xác nhận người nhận + thời điểm bàn giao
-> Inventory OUT
-> Delivery Order handed_over
```

Bàn giao tại quầy không tự ghi payment/receivable/COD.

## 3. Inventory issue

Mỗi Delivery Order chỉ có tối đa một Inventory OUT active. Movement:

```text
movement_type         = SALES_DELIVERY_ISSUE
source_domain         = SALES
source_document_type  = DELIVERY_ORDER
source_document_id    = Delivery Order id
source_document_number= Delivery Order number
```

Mỗi movement line dùng snapshot server-owned từ Delivery Order line và exact allocation/reservation:

- warehouse/location;
- base variant/SKU;
- lot/expiry;
- delivery quantity;
- Delivery Order line ID;
- Sales Order line ID;
- fulfillment allocation ID;
- inventory reservation ID.

Không nhận trusted snapshot từ request body. Request chỉ chứa transition facts; service tải toàn bộ quantity và lineage từ database.

## 4. Reservation và fulfillment projection

Khi issue thành công:

- exact Inventory reservation của allocation được chuyển/release theo quantity đã issue bằng transaction server-owned;
- allocation giữ lịch sử packed và cộng `issued_base_quantity` monotonic;
- fulfillment projection tính `partially_issued` hoặc `issued` theo tổng quantity thật;
- không sửa trực tiếp inventory balance;
- partial/backorder còn lại không bị đánh dấu hoàn tất giả.

Một allocation có thể được chia qua nhiều Delivery Orders, nhưng tổng issued không vượt packed/allocated/reserved.

## 5. Reversal

Reversal chỉ sửa một inventory issue sai trước khi có downstream delivery attempt/return/settlement fact.

```text
Inventory OUT gốc
-> Inventory REVERSAL append-only
-> Delivery Order trở lại ready_to_dispatch
-> issued quantity giảm bằng movement đảo đã xác minh
-> reservation/claim được khôi phục transactionally
```

Yêu cầu:

- permission riêng;
- reason code + reason note bắt buộc;
- một movement chỉ được đảo một lần;
- idempotency + payload mismatch;
- warehouse scope hiện tại;
- không xóa movement/event/audit cũ.

Sau khi có attempt/POD/customer return/accounting fact, reversal trực tiếp bị chặn; correction phải đi bằng return/adjustment flow.

## 6. Customer return origin

Sales sở hữu chứng từ Customer Return và immutable lineage. Foundation 6D.4 dùng lifecycle:

```text
DRAFT -> RECEIVED
DRAFT -> CANCELLED
```

Mỗi dòng phải tham chiếu:

- Sales Order line;
- Delivery Order line;
- Inventory OUT movement và movement line nguồn;
- exact warehouse/location/lot/base variant;
- delivered/issued quantity nguồn;
- requested return quantity;
- accepted return quantity khi nhận kho;
- return reason.

Một return request/draft không tăng tồn. `RECEIVED` mới ghi `SALES_CUSTOMER_RETURN` Inventory IN. Tổng accepted return trên mọi phiếu không vượt quantity đã issue trừ quantity đã return trước đó.

Foundation này chưa xử lý refund, credit note, receivable hoặc quality disposition sau nhận.

## 7. Lifecycle Delivery Order

Mở rộng status:

```text
draft
ready_to_dispatch
dispatched
handed_over
issue_reversed
cancelled
```

Transition 6D.4:

```text
ready_to_dispatch + DELIVERY + logistics dispatch source -> dispatched
ready_to_dispatch + PICKUP + physical handover facts     -> handed_over
dispatched/handed_over + eligible correction             -> issue_reversed
issue_reversed                                             -> ready_to_dispatch (reissue bằng transition mới)
```

`issue_reversed` là event/history; projection hiện hành trở lại `ready_to_dispatch` sau reversal transaction. Không cho cancel ready/issued document trong slice này.

Sales Order delivery projection:

- DELIVERY có issue active → `dispatched`;
- DELIVERY issue đã reversed → `ready_to_dispatch`;
- PICKUP tiếp tục `not_required`; pickup status nằm trên Delivery Order;
- delivery acceptance vẫn thuộc Phase 6E, không coi `dispatched` là `delivered`.

## 8. Authorization

```text
core.delivery-order.issue-inventory
core.delivery-order.pickup-handover
core.delivery-order.reverse-inventory-issue
core.customer-return.read
core.customer-return.create
core.customer-return.receive
core.customer-return.cancel
```

- deny by default;
- installation + warehouse scoped;
- replay vẫn kiểm quyền/scope hiện tại;
- delivery dispatch service phải có server-owned logistics source;
- NPP Operations chỉ thao tác pickup handover và customer return warehouse receipt theo quyền;
- Admin không xử lý nghiệp vụ hằng ngày;
- MCP chỉ đọc projection được cấp.

## 9. Idempotency, concurrency, audit/outbox

Mọi mutation retryable yêu cầu idempotency key. Business row, inventory movement, reservation state, Delivery Order/Customer Return status, audit và outbox cùng transaction.

Outbox tối thiểu:

```text
core.sales.delivery_order.inventory_issued
core.sales.delivery_order.inventory_issue_reversed
core.sales.delivery_order.pickup_handed_over
core.sales.customer_return.created
core.sales.customer_return.received
core.sales.customer_return.cancelled
```

Replay read-only; cùng key payload khác trả conflict. DB uniqueness/trigger bảo vệ double issue, over-return và lineage, không chỉ kiểm ở frontend.

## 10. UI

NPP Operations:

- `Bàn giao giao nhận`: PICKUP ready có nút xác nhận bàn giao, nhập người nhận và ghi chú; DELIVERY chỉ hiện “Chờ lập/chạy chuyến giao”, không có nút bypass dispatch.
- `Hàng khách trả`: tạo draft từ Delivery Order đã issue, nhập reason/quantity, nhận kho explicit, hoặc hủy draft.
- Hiển thị movement nguồn, vị trí/lô, quantity đã issue/đã trả/còn có thể trả.
- Proxy/gateway thật, stable idempotency key, stale response guard và accessibility status/error.

## 11. Không thuộc Phase 6D.4

- vehicle, driver, route, trip, stop, assignment;
- delivery attempt, POD, GPS;
- failed-delivery workflow hoặc in-transit reconciliation UI;
- COD/payment/receivable/refund/credit note/accounting;
- return quality inspection/disposition beyond accepted warehouse receipt;
- MCP cutover;
- production migration/deploy;
- provider/DNS/secret changes;
- Phase 6E implementation.

## 12. Gate

- migration apply + rerun no-op + rehearsal;
- PostgreSQL integration: pickup issue, logistics-source gate, concurrent double issue, exact lot/location OUT;
- reversal idempotency/mismatch, one reversal, reservation/issued projection restore;
- customer return draft/receive/cancel, over-return concurrency, exact source movement lineage;
- permissions + warehouse scope + replay authorization;
- audit/outbox rollback with inventory mutation;
- Core API full tests and build;
- NPP web build and Browser E2E;
- no DELIVERY manual-dispatch button;
- exact-head CI green before merge.
