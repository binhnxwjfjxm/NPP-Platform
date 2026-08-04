# Phase 6E.2 — Trip dispatch and Inventory OUT decisions

> Status: ACTIVE IMPLEMENTATION DECISION
> Baseline: `main@e964d692696b3da5fba993f67849553353fa3e1f`
> Scope: Core Logistics handover and dispatch only.

## Phần này làm gì cho người dùng

Kho xác nhận đã bàn giao toàn bộ hàng của một chuyến đã khóa cho tài xế, hệ thống ghi xuất kho đúng một lần cho từng Delivery Order rồi chuyển chuyến sang đã xuất phát.

```text
trip locked
-> kiểm lại xe, tài xế, điểm dừng và Delivery Order
-> xác nhận người bàn giao/nhận hàng và thời điểm xuất phát
-> ghi Inventory OUT cho từng Delivery Order trong cùng transaction
-> lưu lineage issue/movement vào trip dispatch
-> trip dispatched, Delivery Orders dispatched
```

## Checklist đủ 5 frontend

Kiến trúc installation phải luôn được kiểm theo đủ năm frontend:

1. Website + Customer Ordering — frontend công khai, repository riêng.
2. NPP Operations — đang có source; sở hữu màn điều phối và xác nhận dispatch nội bộ.
3. MCP Field — đang có source; chỉ đọc projection được cấp quyền, không dispatch.
4. Admin MCP/NPP — đang có source; chỉ tổng hợp/duyệt ngoại lệ, không thay NPP Operations.
5. Logistics/Delivery — **chưa có source/project**; phải được dựng ở slice kế tiếp để tài xế nhận chuyến và xử lý stops/attempt/POD. Phase 6E không được coi hoàn tất nếu frontend thứ năm còn thiếu.

Slice 6E.2 không tạo Vercel project/domain/DNS và không dựng một frontend rỗng. Nó hoàn thiện Core API cùng màn dispatch trong NPP Operations để tạo nền ổn định cho Logistics/Delivery frontend.

## Ownership

- `logistics`: handover checklist, dispatch transition, trip dispatch lineage và audit.
- `inventory`: immutable Inventory OUT movements.
- `sales`: Delivery Order status/projection và inventory issue source lineage.
- NPP Operations: xác nhận bàn giao và dispatch.
- Logistics/Delivery frontend: deferred sang slice kế tiếp, dùng Core API; không có backend riêng.

## Lifecycle trong 6E.2

```text
locked -> dispatched
```

- `locked`: kế hoạch bất biến, chờ kho bàn giao vật lý.
- `dispatched`: hàng đã rời kho; trip, stops và assignments tiếp tục bất biến.
- Không có `in_progress`, delivery attempt, POD, failed/partial delivery, return-to-warehouse hoặc COD trong slice này.

## Invariant

1. Chỉ trip `locked` được dispatch.
2. Trip phải có xe và tài xế chính đang active, ít nhất một active assignment và mọi Delivery Order vẫn `DELIVERY/ready_to_dispatch` cùng warehouse.
3. Dispatch là all-or-nothing: mọi Inventory OUT, Delivery Order transition, dispatch item, trip transition, audit và outbox cùng một PostgreSQL transaction.
4. Một trip chỉ có một dispatch identity đang hiệu lực; retry cùng key/payload là read-only replay, khác payload bị chặn.
5. Mỗi Delivery Order được ghi issue bằng source server-owned `DELIVERY_TRIP_DISPATCH` và chỉ xuất kho một lần.
6. Dispatch snapshot lưu assignment, Delivery Order, inventory issue và movement để đối soát.
7. Sau dispatch không sửa xe, tài xế, stops, sequence hoặc assignments.
8. Warehouse scope và permission deny-by-default.
9. Không xem xe là warehouse/location; stock rời kho được biểu diễn bằng immutable movement và dispatch lineage.
10. Không tự ghi delivery attempt, POD, receivable hoặc COD.

## Permission

- `core.delivery-trip.dispatch`
- service dispatch đồng thời cần internal capability `core.delivery-order.issue-inventory`.

Bootstrap test principal được cấp cả hai quyền. MCP Sales principal không được cấp quyền Logistics.

## API capability

```text
POST /api/logistics/trips/:tripId/dispatch
Idempotency-Key: required
```

Payload tối thiểu:

```json
{
  "dispatchedAt": "ISO-8601 timestamp",
  "handoverReceiverName": "Tên tài xế/người nhận hàng",
  "handoverNote": "Ghi chú bàn giao nullable"
}
```

Response trả trip đã `dispatched` cùng dispatch items an toàn.

## UI

NPP Operations workspace `Điều phối giao hàng`:

- trip `locked` hiển thị checklist xe, tài xế, số điểm và số phiếu;
- yêu cầu tên người nhận bàn giao và thời điểm xuất phát;
- nút `Bàn giao và cho xe xuất phát`;
- đang xử lý khóa thao tác lặp;
- trip `dispatched` read-only, hiển thị thời điểm, người nhận và số movement đã post;
- không có nút giao thành công/thất bại/POD.

## Out of scope

- Logistics/Delivery frontend source/project/domain/DNS;
- tài xế nhận chuyến trên mobile;
- delivery attempt, actual delivered quantity;
- POD/photo/signature/GPS;
- failed/partial/rescheduled delivery;
- return-to-warehouse;
- COD/accounting;
- route optimization/tracking;
- production deploy hoặc production migration.

## Gate

- migration `047_logistics_trip_dispatch` apply/rerun/rehearsal;
- trip dispatch transaction và rollback khi một Delivery Order không còn issuable;
- concurrent dispatch chỉ một mutation thắng;
- exact idempotency replay read-only;
- inventory movement/issue/Delivery Order/trip reconciliation;
- permission và warehouse scope;
- NPP web build và Browser E2E locked -> dispatched;
- MCP principal boundary regression;
- exact-head CI xanh;
- merge ngay khi gate xanh, không chờ CodeRabbit.