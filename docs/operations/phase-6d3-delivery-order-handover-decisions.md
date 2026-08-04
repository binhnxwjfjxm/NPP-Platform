# Phase 6D.3 — Delivery Order và bàn giao sau đóng gói

> Status: **ACTIVE SOURCE DECISION**  
> Baseline: `main@f08005b59d61e541a6bb3601382656f7ea32fa13`  
> Issue: `#237`  
> Scope: packed allocation → Delivery Order → ready-to-dispatch/pickup handover boundary.  
> Tài liệu này không cho phép migration production, deploy production hoặc thay đổi provider.

## 1. Phần này làm gì cho người dùng

Sau khi kho đã soạn và đóng gói, nhân viên NPP Operations tạo chứng từ giao nhận chính thức cho phần hàng thực sự sẵn sàng:

```text
packed allocation
-> chọn số lượng đủ điều kiện
-> tạo Delivery Order có nguồn gốc bất biến
-> xác nhận sẵn sàng bàn giao
-> Delivery frontend chỉ nhìn thấy việc đã ready_to_dispatch
```

`ready_to_dispatch` chưa có nghĩa hàng đã rời kho, đã lên xe, đã giao, đã có POD, đã thu COD hoặc đã ghi Inventory OUT.

## 2. Nguồn sự thật và quan hệ chứng từ

- Sales Order là thỏa thuận thương mại.
- Fulfillment allocation là nguồn số lượng đã phân bổ, soạn và đóng gói theo đúng kho/vị trí/lô.
- Delivery Order là nguồn sự thật cho nhu cầu giao hoặc nhận tại quầy của phần hàng đã đóng gói.
- Logistics trip/stop/attempt là nguồn sự thật vận tải ở Phase 6E, không thuộc slice này.

Quan hệ khóa:

```text
1 Sales Order -> nhiều Delivery Orders
1 Delivery Order -> đúng 1 Sales Order
1 Delivery Order -> đúng 1 immutable Sales Order version
1 Delivery Order -> đúng 1 warehouse
1 Delivery Order -> nhiều dòng packed allocation của cùng order/version/warehouse
```

Phase 6D.3 không gộp nhiều Sales Order vào một Delivery Order. Phase 6E có thể gom nhiều Delivery Order vào cùng trip/stop theo policy logistics.

## 3. Giao hàng và nhận tại quầy

Dùng một chứng từ Delivery Order với `handover_mode`:

```text
DELIVERY
PICKUP
```

- `DELIVERY` giữ customer address ID và snapshot địa chỉ từ Sales Order version đã xác nhận.
- `PICKUP` giữ warehouse/pickup snapshot; không cần vehicle, driver hoặc trip.
- Cả hai mode đều cần Delivery Order để giữ lineage, chống tạo trùng và làm nguồn cho inventory issue ở phase sau.
- Inventory OUT của pickup chỉ xảy ra khi bàn giao vật lý được xác nhận ở Phase 6D.4, không xảy ra khi tạo hoặc confirm Delivery Order.

## 4. Eligibility và partial handover

Một allocation chỉ đủ điều kiện khi:

- thuộc installation và warehouse được cấp;
- Sales Order còn `confirmed`;
- fulfillment demand còn `ACTIVE`;
- allocation còn hợp lệ;
- `packed_base_quantity > 0`;
- số lượng yêu cầu không vượt phần packed chưa nằm trong Delivery Order active.

Công thức:

```text
available_for_delivery_order
= packed_base_quantity
- sum(quantity của dòng Delivery Order có header DRAFT hoặc READY_TO_DISPATCH)
```

Cho phép partial packed/partial handover. Phần còn lại tiếp tục ở hàng đợi và có thể tạo Delivery Order khác. Backorder không được biến thành deliverable và không được làm Sales Order hiển thị hoàn tất giả.

## 5. Lineage bất biến

Mỗi dòng Delivery Order phải truy được về:

- installation;
- Sales Order;
- Sales Order version;
- Sales Order line;
- fulfillment demand;
- fulfillment allocation;
- exact Inventory reservation;
- warehouse;
- location;
- base variant/SKU;
- lot;
- packed quantity tại thời điểm tạo;
- quantity đưa vào Delivery Order.

Header giữ snapshot customer, địa chỉ/pickup, kho, ngày yêu cầu và collection policy từ phiên bản Sales Order đã xác nhận. Snapshot phục vụ lịch sử nhưng không thay thế foreign key nguồn.

## 6. Lifecycle

Slice này dùng lifecycle hẹp:

```text
DRAFT -> READY_TO_DISPATCH
DRAFT -> CANCELLED
```

Quy tắc:

- Create sinh `DRAFT` và claim quantity đã packed.
- Confirm cấp số Delivery Order và chuyển `READY_TO_DISPATCH` trong cùng transaction.
- Delivery frontend chỉ được đọc `READY_TO_DISPATCH`.
- Chỉ `DRAFT` được cancel trong Phase 6D.3; lý do bắt buộc.
- Cancel draft giải phóng claim để phần packed trở lại hàng đợi, nhưng không release exact Inventory reservation và không sửa lùi pick/pack.
- `READY_TO_DISPATCH` không được cancel trong slice này vì chưa có flow inventory issue/reversal/dispatch hoàn chỉnh. Việc hủy sau ready thuộc phase kế tiếp và phải transactionally xử lý các downstream facts.
- Không xóa Delivery Order hoặc dòng lịch sử.

Trigger lifecycle của Phase 6D.2 vẫn giữ nguyên. Sales Order cancellation/amendment sau allocation/pack/Delivery Order tiếp tục fail closed cho đến khi flow reversal hoàn chỉnh được triển khai.

## 7. Projection

Sales Order `delivery_status` được cập nhật theo chứng từ active:

```text
có READY_TO_DISPATCH -> ready_to_dispatch
chỉ có DRAFT         -> pending
không còn active     -> pending
```

Không dùng Delivery Order để thay đổi `fulfillment_status`, `settlement_status` hoặc inventory balance.

## 8. Authorization và runtime boundary

Quyền:

```text
core.delivery-order.read
core.delivery-order.create
core.delivery-order.confirm
core.delivery-order.cancel
```

- Deny by default.
- Mọi đọc/ghi phải installation-scoped và warehouse-scoped.
- Replay vẫn tải lại chứng từ và kiểm quyền/scope hiện tại.
- NPP Operations là nơi kho tạo, confirm hoặc cancel draft.
- Admin không làm CRUD giao hàng hằng ngày.
- Delivery frontend không sửa Sales Order và chỉ đọc việc ready-to-dispatch qua Core API.
- Delivery frontend có cùng Core backend, không có business backend riêng.

## 9. Idempotency, concurrency, audit và outbox

- Create/confirm/cancel đều yêu cầu idempotency key.
- Cùng key + cùng canonical payload trả replay.
- Cùng key + payload khác trả conflict.
- Hai request đồng thời không được claim vượt packed quantity.
- Service khóa allocation và DB trigger kiểm tổng claim active; không dựa vào kiểm tra frontend.
- Business mutation, số chứng từ, audit và outbox cùng transaction.
- Replay read-only, không tạo thêm audit/outbox hoặc số chứng từ.
- Public API không trả raw PostgreSQL/provider error; log chẩn đoán phải được làm sạch.

Outbox tối thiểu:

```text
core.sales.delivery_order.created
core.sales.delivery_order.ready_to_dispatch
core.sales.delivery_order.cancelled
```

## 10. UI

NPP Operations có workspace `Tồn kho & lô hàng -> Bàn giao giao nhận` để:

- xem phần packed còn đủ điều kiện;
- tạo Delivery Order theo từng Sales Order/version/warehouse;
- xem lineage vị trí/lô và số lượng;
- confirm sẵn sàng bàn giao;
- cancel draft có lý do;
- thấy rõ phần còn lại/backorder.

Frontend phải gọi proxy/gateway thật, dùng idempotency key ổn định khi retry, chống stale response và giữ accessibility status/error.

Manual allocation override UI của Phase 6D.2 không được chắp vào workspace này. Backend contract hiện có vẫn giữ; dedicated UI tiếp tục là quyết định sản phẩm riêng.

## 11. Không thuộc Phase 6D.3

- Inventory OUT/reversal hoặc release reservation sau dispatch;
- vehicle, driver, delivery route, trip, stop hoặc assignment;
- delivery attempt, POD, GPS hoặc chữ ký;
- COD, receivable, payment hoặc accounting posting;
- failed delivery, customer return hoặc stock return;
- MCP cutover;
- provider/DNS/secret change;
- production migration/deploy;
- Phase 6E.

## 12. Gate

- migration 044 apply và rerun no-op;
- migration rehearsal;
- create/confirm/cancel idempotency và mismatch;
- partial packed và quantity reconciliation;
- concurrent create không over-claim;
- current permission/warehouse replay authorization;
- immutable lineage;
- audit/outbox rollback cùng mutation;
- Sales Order projection;
- Core API tests;
- NPP web build;
- Browser E2E với proxy thật;
- exact-head CI xanh trước merge.
