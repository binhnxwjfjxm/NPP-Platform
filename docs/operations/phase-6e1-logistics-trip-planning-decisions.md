# Phase 6E.1 — Logistics trip planning decisions

> Status: ACTIVE IMPLEMENTATION DECISION
> Baseline: `main@a77beee159837990dabe653af2f9dc27a0cda923`
> Scope: Core Logistics trip planning only.

## Phần này làm gì cho người dùng

Điều phối viên gom các Delivery Order đã sẵn sàng giao thành một chuyến, xếp thứ tự điểm giao, gán xe và tài xế, rồi khóa kế hoạch để kho và giao nhận cùng nhìn một nguồn.

```text
Delivery Order ready_to_dispatch
-> tạo chuyến giao
-> chọn kho xuất phát
-> gán xe và tài xế chính
-> gom Delivery Order theo điểm giao
-> xếp thứ tự điểm dừng
-> kiểm tra và khóa kế hoạch
```

## Ownership

- `sales`: Delivery Order và dữ liệu thương mại nguồn.
- `logistics`: route, vehicle, driver profile, trip, stop, assignment và lifecycle lập kế hoạch.
- `inventory`: chưa ghi OUT trong slice này.
- NPP Operations: màn điều phối chuyến.
- Delivery frontend: chưa tạo project/source trong slice này; bắt đầu khi có luồng chuyến đã dispatch/được giao cho tài xế.

## Lifecycle trong 6E.1

```text
draft -> planned -> locked
```

- `draft`: được sửa kế hoạch, gán/bỏ Delivery Order, đổi xe/tài xế, xếp lại stop.
- `planned`: đã đủ dữ liệu để rà soát, vẫn có thể trả về draft bằng transition explicit có lý do.
- `locked`: kế hoạch bất biến; không sửa vehicle, driver, stop, sequence hoặc assignment.
- Không có `dispatched`, `in_progress`, attempt, POD hoặc inventory issue trong 6E.1.

## Invariant

1. Chỉ Delivery Order `DELIVERY` và `ready_to_dispatch` thuộc cùng installation/warehouse mới được gán.
2. Một Delivery Order chỉ có một active assignment tại một thời điểm.
3. Một stop chỉ chứa Delivery Order cùng customer và cùng approved delivery address snapshot.
4. Một trip chỉ thuộc một warehouse.
5. Trip phải có vehicle và primary driver đang active trước khi chuyển `planned` hoặc `locked`.
6. Vehicle không phải warehouse/location; capacity chỉ hiển thị cảnh báo, chưa hard-block.
7. Stop sequence dương và duy nhất trong trip.
8. Locked trip không được sửa ngoài lifecycle Phase 6E.2.
9. Mọi mutation retryable dùng stable idempotency; business + audit + outbox cùng transaction.
10. Authorization deny-by-default, installation và warehouse scoped.

## Entities

- `logistics.delivery_routes`
- `logistics.vehicles`
- `logistics.driver_profiles`
- `logistics.delivery_trips`
- `logistics.trip_stops`
- `logistics.trip_order_assignments`
- `logistics.trip_events`
- `logistics.trip_operation_idempotency`

## Permission

- `core.logistics-route.read`
- `core.logistics-route.manage`
- `core.vehicle.read`
- `core.vehicle.manage`
- `core.driver-profile.read`
- `core.driver-profile.manage`
- `core.delivery-trip.read`
- `core.delivery-trip.create`
- `core.delivery-trip.plan`
- `core.delivery-trip.assign`
- `core.delivery-trip.lock`

## API capability

- list/create/update routes, vehicles, driver profiles;
- list/create/get trips;
- update draft trip planning data;
- assign/unassign Delivery Order;
- reorder stops;
- transition draft/planned/locked;
- list eligible Delivery Orders for one warehouse.

Không mở generic logistics posting endpoint.

## UI

NPP Operations có workspace `Điều phối giao hàng`:

- danh sách Delivery Order sẵn sàng;
- danh sách chuyến;
- tạo chuyến;
- chọn kho, xe, tài xế;
- gán/bỏ phiếu giao;
- xếp thứ tự điểm dừng;
- plan/lock;
- locked trip hiển thị read-only.

## Out of scope

- dispatch và Inventory OUT;
- handover checklist;
- delivery attempt;
- full/partial/failed delivery;
- POD/photo/signature/GPS;
- COD/accounting;
- return-to-warehouse;
- route optimization;
- vehicle tracking;
- Delivery Vercel project/domain/DNS;
- production deploy hoặc production migration.

## Gate

- migration apply/rerun/rehearsal;
- API/repository transaction tests;
- concurrent assignment test;
- permissions and warehouse scope;
- stable idempotency replay;
- NPP web build;
- Browser E2E planning and locked read-only state;
- exact-head CI green;
- merge only after all gates pass.
