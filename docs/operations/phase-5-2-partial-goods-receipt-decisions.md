# Phase 5.2 Partial Goods Receipt decisions

Trạng thái: **LOCKED FOR IMPLEMENTATION**  
Phạm vi: NPP Core Purchasing - Goods Receipt vertical slice  
Không bao gồm: supplier return, credit note, payable, supplier payment, generic inventory adjustment

## 1. Nguồn sự thật

- Purchase Order vẫn là nguồn sự thật cho nhu cầu mua.
- Goods Receipt là nguồn sự thật cho việc nhận hàng thực tế.
- Một PO có thể được nhận nhiều lần.
- Mỗi receipt line phải bám đúng một PO line.
- Receipt post tạo inventory movement theo contract inventory hiện có.
- Reversal là chứng từ bù, không sửa ledger cũ.
- Receipt đã post chỉ có thể reverse, không sửa line và không xóa.

## 2. Trạng thái receipt

```text
draft -> posted -> reversed
```

- Chỉ `draft` được sửa.
- `posted` và `reversed` là bất biến về nội dung.
- `posted` là trạng thái có inventory movement đã ghi.
- `reversed` là trạng thái đã phát hành movement bù.

## 3. Điều kiện nhận hàng

- Chỉ PO `approved` hoặc `partially_received` được nhận hàng.
- Không nhận PO `draft`, `pending_approval`, `fully_received`, `closed` hoặc `cancelled`.
- Một receipt chỉ thuộc về một PO và một warehouse.
- Warehouse receipt phải khớp warehouse nhận hàng của PO.
- Receipt line phải tham chiếu PO line.
- Số lượng nhận là decimal string, scale 6.
- Số lượng phải lớn hơn 0.
- Không được vượt remaining của PO line.

## 4. Inventory posting boundary

- Purchasing không ghi trực tiếp vào inventory balance.
- Purchasing không tự tạo inventory ledger riêng.
- Phải gọi internal inventory posting service hiện có.
- Post receipt và inventory movement phải nằm trong cùng transaction boundary.
- Replay cùng idempotency key không được tạo thêm movement.
- Reverse receipt phải gọi cơ chế reversal chuẩn của inventory.

## 5. Tracking policy

Inventory hiện có chính thức khóa:

- `location_required`
- `lot_tracking_mode`
- `expiry_tracking_mode`

Phần `manufacturedDate` vẫn được lưu và chuyển tiếp vào lot/inventory snapshot nếu có, nhưng slice này không tạo thêm một policy mới riêng cho manufacturing date.

Quy tắc thực thi:

- `location_required = true` thì location bắt buộc.
- `lot_tracking_mode = REQUIRED` thì lot bắt buộc.
- `lot_tracking_mode = NONE` thì không được gửi lot, manufacturedDate, expiryDate hoặc supplierLotReference.
- `expiry_tracking_mode = REQUIRED` thì expiryDate bắt buộc.
- `expiry_tracking_mode = NONE` thì expiryDate không được gửi.

## 6. Document numbering

- Number series: `PURCHASE_RECEIPT`.
- Prefix mặc định: `GR-`.
- Template: `{PREFIX}{YYYY}{MM}-{SEQ}`.
- Reset hàng tháng theo `Asia/Ho_Chi_Minh`.
- Số chỉ cấp lúc post.
- Draft không cấp số.

## 7. Permission catalog

Canonical keys:

- `core.goods-receipt.read`
- `core.goods-receipt.create`
- `core.goods-receipt.update`
- `core.goods-receipt.post`
- `core.goods-receipt.reverse`

Backend kiểm từng route riêng. Frontend fail-closed nếu không có permission context.

## 8. Audit và outbox

Mỗi mutation thành công phải ghi:

- goods receipt audit/outbox;
- inventory movement audit/outbox cho post/reverse;
- trong cùng transaction boundary.

## 9. PO received/remaining

Backend phải tính từ posted receipts chưa reversed.

Per PO line:

- orderedQuantity
- receivedQuantity
- remainingQuantity

PO header:

- receiptCount
- receivedQuantity
- remainingQuantity
- trạng thái tính theo active posted receipts:
  - `approved` khi chưa nhận gì;
  - `partially_received` khi còn remaining;
  - `fully_received` khi tất cả line remaining = 0.

Reversal phải khôi phục lại totals và trạng thái PO.

## 10. API

```text
GET    /api/goods-receipts
GET    /api/goods-receipts/:id
POST   /api/goods-receipts
PATCH  /api/goods-receipts/:id
POST   /api/goods-receipts/:id/post
POST   /api/goods-receipts/:id/reverse
```

Payload draft:

```text
purchaseOrderId
receiptDate
supplierDeliveryReference?
note?
expectedRevision?   # required on PATCH/post/reverse
lines[]
```

Line draft:

```text
purchaseOrderLineId
quantity
locationId?
lotCode?
manufacturedDate?
expiryDate?
supplierLotReference?
note?
```

Backend tự lấy variant, SKU, unit, conversion, remaining và policy từ PO/master data.

## 11. Browser UI

- Trang: `/purchasing/goods-receipts`
- Menu dưới nhóm Mua hàng:
  - Đơn đặt hàng
  - Phiếu nhận hàng
- Danh sách có:
  - số phiếu;
  - ngày nhận;
  - số PO;
  - nhà cung cấp;
  - kho nhận;
  - số dòng;
  - trạng thái;
  - người tạo/post;
  - hành động.
- Form draft:
  - chọn PO đủ điều kiện;
  - supplier/warehouse hiển thị read-only sau khi chọn PO;
  - hiển thị ordered/previously received/remaining/quantity this receipt cho từng line;
  - hiển thị location/lot/manufactured/expiry theo policy;
  - không cho số lượng vượt remaining;
  - backend vẫn là nguồn validation cuối.
- Posted receipt:
  - xem;
  - reverse nếu có quyền.
- Reversed receipt:
  - chỉ xem.

## 12. Boundary chưa làm

- Tolerance nhận thừa.
- Quality variance.
- Supplier return.
- AP/payable posting.
- Supplier payment/allocation.
- Downstream document consumption blocking reversal.

P5.2 chỉ khóa boundary hiện tại và không mở các nhánh trên.
