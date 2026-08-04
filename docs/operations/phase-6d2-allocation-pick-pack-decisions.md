# Phase 6D.2 — Exact allocation, pick and pack

> Status: **ACTIVE SOURCE DECISION**  
> Baseline: `main@057fdedf9bc8c586e0dc831c1a43e09067212d4e`  
> Issue: `#235`  
> Scope: warehouse reservation demand → exact location/lot allocation → pick → pack.  
> Production migration, backend deployment and provider mutation are not authorized by this document.

## 1. Phần này làm gì cho người dùng

Sau khi đơn bán hàng đã được xác nhận và giữ hàng ở cấp kho, nhân viên kho nhận đúng phần hàng được phép chuẩn bị:

```text
đơn đã giữ hàng
-> đề xuất vị trí/lô
-> phân bổ chính xác
-> xác nhận soạn hàng
-> xác nhận đóng gói
-> sẵn sàng cho Phase 6D.3 tạo Delivery Order
```

Một người có thể vừa tạo vừa xác nhận đơn nếu role có đủ permission. Đơn thông thường không bị ép qua người duyệt thứ hai; các ngoại lệ giá, chiết khấu và công nợ tiếp tục theo approval policy của Sales.

## 2. Ranh giới domain

- Sales sở hữu fulfillment demand và lineage về Sales Order/version/line.
- Inventory sở hữu exact reservation theo warehouse/location/base SKU/lot.
- NPP Operations là nơi kho thao tác.
- Sales Order chỉ đọc projection allocation/pick/pack.
- Admin không làm CRUD kho hằng ngày.
- Delivery frontend chưa tham gia trước khi có Delivery Order hoặc handover.

## 3. Allocation

Mỗi allocation phải:

- thuộc đúng installation và warehouse scope;
- nối đúng một active fulfillment demand;
- tạo đúng một active inventory reservation;
- dùng cùng warehouse, location, base variant, lot và quantity với reservation;
- không làm tổng allocation vượt `reserved_base_quantity`;
- chỉ dùng location loại `storage` đang hoạt động;
- không dùng location `receiving`, `shipping`, `quarantine`, `returns`, `damaged` hoặc `other`;
- không chọn lô đã hết hạn;
- không chọn tồn khả dụng âm hoặc bằng 0.

Nếu tracking policy bắt buộc location hoặc lot thì allocation thiếu scope tương ứng phải fail closed. Query đề xuất và database trigger cùng thực thi ranh giới này, nên manual/API call không thể bypass bằng cách gửi location cách ly hoặc lô hết hạn.

Allocation và reservation được ghi trong cùng transaction với audit/outbox. Không có public API ghi trực tiếp progress table.

## 4. FEFO và FIFO

Chính sách lấy hàng dựa trên dữ liệu hạn dùng thực tế và `inventory.product_tracking_policies`:

- Lô có `expiry_date`: FEFO, hạn dùng gần nhất trước.
- Lô không có `expiry_date`: FIFO theo thời điểm nhập kho sớm nhất có thể truy vết từ inventory ledger.
- `expiry_tracking_mode = REQUIRED`: lô thiếu hạn dùng không được allocation.
- `expiry_tracking_mode = OPTIONAL`: lô có hạn dùng đi theo FEFO; lô không có hạn dùng đi theo FIFO sau nhóm lô có hạn dùng.
- Bất kỳ lô nào có hạn dùng đã qua đều bị loại, không phụ thuộc tracking mode.
- Tie-break ổn định: location code, lot code, ID.

Auto allocation luôn dùng thứ tự policy. Manual allocation khác auto plan cần permission `core.fulfillment.override-allocation-policy` và lý do bắt buộc, nhưng không được vượt qua các chốt storage, lot, expiry, available quantity và warehouse scope.

## 5. Pick và pack

```text
allocated >= picked >= packed >= 0
```

- Pick và pack dùng quantity delta dương.
- Progress chỉ tăng.
- Pick không vượt phần đã allocation.
- Pack không vượt phần đã pick.
- Mỗi mutation retryable phải idempotent.
- Audit ghi actor, request ID, source app, before/after và lý do nếu có.

## 6. Projection trạng thái

```text
reserved / partially_reserved / backordered
partially_allocated / allocated
partially_picked / picked
partially_packed / packed
```

`packed` chỉ nghĩa là hàng đã đóng gói và sẵn sàng cho Delivery Order. Nó chưa có nghĩa hàng đã rời kho, đã giao hoặc đã thu tiền.

Khi đơn còn backorder, phần đã allocation/pick/pack chỉ tạo trạng thái `partially_*`; không được báo hoàn tất toàn bộ fulfillment.

## 7. Không thuộc Phase 6D.2

- Delivery Order và `ready_to_dispatch`;
- Inventory OUT/reversal;
- customer return;
- vehicle, driver, trip, stop, delivery attempt, POD hoặc COD;
- production migration/deploy/provider change.

## 8. Gate

- migration apply/rerun;
- exact reservation và allocation cùng transaction;
- FEFO/FIFO deterministic;
- manual override permission + reason;
- warehouse/location/lot scope fail closed;
- chỉ active storage location được allocation;
- required expiry và expired-lot rejection;
- concurrent allocation không vượt reserved demand hoặc available stock;
- pick/pack monotonic và quantity reconciliation;
- audit/outbox rollback cùng business mutation;
- API contract, NPP warehouse queue và Browser E2E;
- exact-head CI xanh trước merge.
