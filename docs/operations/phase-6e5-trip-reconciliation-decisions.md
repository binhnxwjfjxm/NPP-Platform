# Phase 6E.5 — Đối soát cuối chuyến và hàng quay về kho

> Status: ACTIVE IMPLEMENTATION DECISION  
> Baseline: `main@14e971c76d4f40bcc7f144ea4496ad2d7ef42ed4`  
> Scope: warehouse-owned reconciliation for dispatched trips after immutable delivery attempts.

## Phần này làm gì cho người dùng

Điều phối viên đối chiếu kết quả giao của chuyến đã xuất phát. Kho xác nhận phần hàng chưa giao thực sự quay về, hệ thống ghi nhập kho đúng nguồn, rồi chỉ đóng chuyến khi không còn hàng treo trên xe.

```text
dispatched trip
-> mọi assignment có delivery attempt terminal
-> giao đủ: không còn hàng
-> giao một phần/thất bại/hẹn lại: còn hàng trong custody chuyến
-> kho thực nhận phần quay về
-> Inventory IN append-only theo exact issue-line lineage
-> đối soát bằng 0
-> đóng chuyến
```

## Nguồn sự thật và ownership

- `logistics.delivery_attempts` và `logistics.delivery_attempt_lines`: kết quả giao bất biến.
- `sales.delivery_order_inventory_issue_lines`: số lượng và exact inventory scope đã rời kho.
- `logistics.trip_return_receipts` và `logistics.trip_return_receipt_lines`: xác nhận vật lý hàng quay về từ chuyến.
- `inventory.inventory_movements`: sổ kho bất biến; receipt tạo movement IN mới.
- `logistics.delivery_trips`: chỉ chuyển `dispatched -> closed` sau khi đối soát bằng 0.
- NPP Operations sở hữu thao tác đối soát và xác nhận kho nhận lại.
- Delivery frontend không được ghi receipt hoặc đóng chuyến.

Không sửa delivery attempt, không đảo Inventory OUT cũ và không dùng Customer Return thay cho hàng giao thất bại quay về kho.

## Công thức đối soát

Theo từng `inventory_issue_line_id`:

```text
outstanding = issued - delivered - returned_to_warehouse
```

Trong đó:

- `issued`: `issued_base_quantity` của exact Delivery Order inventory issue line.
- `delivered`: tổng `delivered_base_quantity` của immutable attempt line; full delivery đã ghi đủ các line.
- `returned_to_warehouse`: tổng quantity của các return receipt đã `POSTED`.

Invariant:

```text
0 <= delivered + returned_to_warehouse <= issued
```

Chuyến chỉ được đóng khi:

1. mọi active assignment có đúng một terminal attempt;
2. mọi issue line có `outstanding = 0`;
3. không có receipt ở trạng thái `POSTING`.

## Return receipt lifecycle

```text
POSTING -> POSTED
```

- Receipt được tạo và post Inventory IN trong một PostgreSQL transaction.
- `POSTING` không được nhìn thấy như nghiệp vụ hoàn tất và không được tồn tại sau rollback.
- `POSTED` bất biến, không sửa/xóa.
- Sửa sai receipt thuộc capability correction/reversal riêng về sau; slice này không mở generic reversal.
- Một trip có thể có nhiều receipt vật lý, nhưng cumulative quantity không được vượt outstanding.

## Exact inventory scope

Mỗi receipt line bắt buộc truy ngược tới:

```text
trip
-> assignment
-> dispatch item
-> inventory issue
-> inventory issue line
-> original warehouse/location/base variant/lot
```

Inventory IN dùng đúng warehouse, location, base variant, base unit và lot của issue line nguồn. Browser không gửi các snapshot này; server resolve từ PostgreSQL.

## Rescheduled và failed

- `failed` hoặc `rescheduled` không tự tạo Inventory IN.
- Hàng vẫn thuộc custody chuyến cho đến khi kho xác nhận receipt.
- Nếu hàng tiếp tục đi giao lại mà chưa về kho, chuyến hiện tại chưa thể đóng trong slice này.
- Tạo assignment/trip giao lại là capability riêng; không sửa attempt cũ và không tự tạo chuyến mới.

## Authorization

Deny-by-default:

- `core.delivery-trip.reconciliation-read`
- `core.delivery-trip.return-receive`
- `core.delivery-trip.close`

Mọi thao tác bắt buộc đúng installation và warehouse scope. Bootstrap compatibility chỉ theo pattern hiện hữu; real user scope rỗng fail closed.

## Idempotency và concurrency

- `Idempotency-Key` bắt buộc cho receipt và close.
- Cùng key + cùng canonical payload trả replay.
- Cùng key + payload khác conflict.
- Advisory lock theo installation/trip/key và row lock trip/issue lines.
- Hai receipt cạnh tranh không được làm cumulative returned vượt outstanding.
- Close cạnh tranh với receipt phải serialize trên trip; chỉ trạng thái đã đối soát mới thắng.

## Transaction, audit và outbox

Return receipt thành công ghi cùng transaction:

1. receipt header/lines;
2. Inventory IN movement/lines;
3. link movement lineage;
4. trip event `RETURN_RECEIPT_POSTED`;
5. audit;
6. outbox `core.delivery_trip.return_received`.

Close thành công ghi cùng transaction:

1. trip `dispatched -> closed`;
2. trip event `CLOSED`;
3. audit;
4. outbox `core.delivery_trip.closed`.

## API

```text
GET  /api/logistics/trips/:tripId/reconciliation
POST /api/logistics/trips/:tripId/return-receipts
POST /api/logistics/trips/:tripId/close
```

Receipt payload chỉ nhận:

```json
{
  "receivedAt": "2026-08-05T08:00:00.000Z",
  "note": "Kho đã đếm và nhận lại",
  "lines": [
    {
      "inventoryIssueLineId": "uuid",
      "returnedBaseQuantity": "2.000000000000"
    }
  ]
}
```

Close payload:

```json
{
  "closedAt": "2026-08-05T08:15:00.000Z",
  "note": "Đã đối soát đủ"
}
```

## UI

NPP Operations:

- xem từng assignment, kết quả attempt, issued/delivered/returned/outstanding;
- chọn các line còn outstanding để xác nhận kho nhận lại;
- hiển thị movement receipt đã post;
- nút đóng chuyến chỉ khả dụng khi server trả `canClose = true`;
- mutation vẫn do backend quyết định, frontend prevalidation chỉ hỗ trợ thao tác.

## Không thuộc Phase 6E.5

- POD, ảnh, chữ ký, GPS, R2;
- COD, payment, receivable, accounting;
- tự tạo chuyến giao lại hoặc re-dispatch;
- correction/reversal receipt;
- customer return;
- live tracking, route optimization;
- Admin, MCP, Website mutation;
- production deploy/migration/provider/DNS/secret changes;
- PR #234.

## Gate

- migration apply/verify/rerun/rehearsal;
- exact lineage và warehouse scope;
- return quantity không vượt outstanding;
- receipt tạo đúng một Inventory IN, không đảo OUT;
- concurrent receipt và idempotent replay an toàn;
- close bị chặn khi thiếu attempt, còn outstanding hoặc receipt đang POSTING;
- audit/outbox/trip event rollback cùng nghiệp vụ;
- NPP typecheck/test/build và Browser E2E;
- full Core/PostgreSQL/inventory regression;
- exact-head CI xanh và không còn finding hợp lệ.