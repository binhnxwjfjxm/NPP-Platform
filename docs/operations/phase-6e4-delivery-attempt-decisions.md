# Phase 6E.4 — Delivery attempts và kết quả giao hàng

> Status: ACTIVE IMPLEMENTATION DECISION  
> Baseline: `main@7f139d8843fb3736a06f49bed2cfdbdf2719aa38`  
> Scope: driver-owned delivery attempt facts for dispatched trips only.

## Phần này làm gì cho người dùng

Tài xế mở từng phiếu trong chuyến đã xuất phát và ghi đúng một kết quả thực tế: giao đủ, giao một phần, không giao được hoặc hẹn giao lại. Điều phối viên đọc được kết quả và biết phiếu nào còn hàng trên xe.

```text
trip dispatched
-> tài xế mở đúng assignment của mình
-> ghi một delivery attempt terminal
-> giao đủ / giao một phần / thất bại / hẹn lại
-> audit + outbox + trip event cùng transaction
-> NPP Operations đọc attempt summary
```

## Ownership và nguồn sự thật

- `logistics.delivery_attempts`: sự kiện kết quả của một lần giao cho một assignment.
- `logistics.delivery_attempt_lines`: số lượng thực giao theo exact Inventory OUT issue line.
- `sales.delivery_order_inventory_issues`: nguồn số lượng đã rời kho.
- `inventory.inventory_movements`: sổ kho bất biến; slice này không ghi thêm movement.
- Delivery frontend: ghi attempt của đúng tài xế.
- NPP Operations: chỉ đọc attempt summary để điều phối.

Delivery attempt không thay thế Delivery Order, dispatch item, Inventory OUT, customer return hoặc payment.

## Identity và authorization

```text
Delivery server auth
-> trusted employeeId header
-> active shared employee
-> active logistics driver profile
-> trip.primary_driver_id đúng driver profile
-> warehouse scope
-> assignment thuộc trip
```

- Browser không gửi `driverId` hoặc `employeeId` trong body/query.
- Core token chỉ nằm server-side trong Delivery gateway.
- Tài xế khác nhận `404`, không lộ trip/assignment tồn tại.
- Permission deny-by-default:
  - `core.delivery-attempt.read`
  - `core.delivery-attempt.record`
- Driver principal chỉ có driver-trip read và hai quyền attempt; không có planning, dispatch, inventory hoặc quyền điều phối chung.
- Setup-pending không được gọi mutation.

## Lifecycle

Trong slice này trip phải giữ trạng thái:

```text
dispatched
```

Mỗi active assignment chỉ có đúng một attempt terminal:

```text
delivered_full
| delivered_partial
| failed
| rescheduled
```

Attempt đã ghi không sửa hoặc xóa. Sửa sai và retry-after-failure thuộc transition riêng sau này, không chắp vá bằng update row.

## Quantity rules

- `delivered_full`: server tự dùng toàn bộ exact issued quantity của mọi Inventory OUT issue line.
- `delivered_partial`: request phải gửi đủ từng issue line, quantity không âm, ít nhất một dòng lớn hơn 0 và tổng nhỏ hơn tổng đã xuất.
- `failed` và `rescheduled`: không có quantity line.
- Không quantity nào vượt `issued_base_quantity`.
- Quantity dùng `numeric(30,12)` và canonical decimal string; không dùng JavaScript float làm nguồn nghiệp vụ.
- Phần chưa giao vẫn là hàng đang ở custody chuyến/xe theo dispatch lineage; không tự Inventory IN.

## Reason và scheduling

- `failed`: bắt buộc `reasonCode`; `note` tùy chọn.
- `rescheduled`: bắt buộc `reasonCode` và `rescheduledFor` sau `occurredAt`.
- Giao đủ/giao một phần không nhận `rescheduledFor`.

## Idempotency và concurrency

- Header `Idempotency-Key` bắt buộc, 1–128 ký tự an toàn.
- Cùng key + cùng canonical payload trả read-only replay.
- Cùng key + khác payload trả conflict.
- Hai key cạnh tranh trên cùng assignment: chỉ một transaction thắng.
- Unique constraint theo assignment và advisory/row lock bảo vệ ở database, không chỉ frontend.

## Transaction, audit và event

Một mutation thành công ghi cùng PostgreSQL transaction:

1. attempt header;
2. attempt lines khi có;
3. `logistics.trip_events` loại `DELIVERY_ATTEMPT_RECORDED`;
4. một audit record;
5. một outbox event `core.delivery_attempt.recorded`.

Rollback ở bất kỳ bước nào không để attempt mồ côi.

## API

```text
POST /api/logistics/driver/trips/:tripId/assignments/:assignmentId/attempts
Idempotency-Key: required
```

Payload:

```json
{
  "result": "delivered_partial",
  "occurredAt": "2026-08-04T10:30:00.000Z",
  "reasonCode": null,
  "note": "Khách nhận một phần",
  "rescheduledFor": null,
  "lines": [
    {
      "inventoryIssueLineId": "uuid",
      "deliveredBaseQuantity": "2.500000000000"
    }
  ]
}
```

Response trả attempt canonical và `replayed`.

Read model của trip driver trả cho từng assignment:

- Inventory OUT issue lines an toàn: SKU, tên hàng, đơn vị, issued quantity;
- attempt summary và delivered quantity khi đã ghi;
- không trả movement internals, audit row hoặc secret.

## UI

Delivery mobile:

- mỗi phiếu chưa có attempt có nút ghi kết quả;
- bốn kết quả rõ ràng;
- partial nhập quantity từng dòng;
- khi submit khóa lặp, dùng stable idempotency key;
- attempt terminal hiển thị read-only;
- setup-pending không hiển thị hoặc gọi mutation.

NPP Operations:

- trip dispatched hiển thị attempt summary theo phiếu;
- chỉ đọc, không giả làm tài xế để ghi kết quả.

## Không thuộc Phase 6E.4

- POD, ảnh, chữ ký, GPS hoặc R2;
- COD, payment, receivable hoặc accounting;
- return-to-warehouse, Inventory IN, reversal hoặc customer return;
- route optimization, live tracking;
- Admin mutation, MCP mutation hoặc Website mutation;
- production deploy, production migration, provider/DNS/secret changes;
- PR #234.

## Gate

- migration `049_logistics_delivery_attempts` apply/verify/rerun/rehearsal;
- PostgreSQL integration cho ownership, cross-driver 404 và warehouse scope;
- dispatcher không thể ghi dưới danh nghĩa tài xế;
- setup-pending chặn mutation;
- concurrent duplicate chỉ một attempt;
- exact idempotency replay và payload mismatch;
- full/partial/failed/rescheduled quantity rules;
- không phát sinh Inventory movement;
- attempt terminal bất biến;
- audit/outbox/trip-event rollback cùng mutation;
- Core API full test/build;
- Delivery typecheck/test/build và Browser E2E;
- NPP web build/E2E cho read-only summary;
- exact-head required CI xanh; merge không chờ CodeRabbit nếu không có finding hợp lệ.
