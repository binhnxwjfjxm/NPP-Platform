# Phase 5.3 Goods Receipt Quantity/Quality Variance decisions

Trạng thái: **LOCKED FOR IMPLEMENTATION**  
Phạm vi: NPP Core Purchasing - Goods Receipt vertical slice  
Không bao gồm: supplier return, payable, supplier payment, quarantine/scrap, generic inventory adjustment, over-receipt tolerance, costing, MCP changes, production deploy, production migration

## 1. Nguồn sự thật

- Purchase Order vẫn là nguồn sự thật cho nhu cầu mua.
- Goods Receipt là nguồn sự thật cho hàng thực nhận, hàng bị loại và trạng thái chốt thiếu.
- Một PO có thể được nhận nhiều lần.
- Một receipt line phải bám đúng một PO line.
- Accepted quantity mới là phần được post vào inventory.
- Rejected quantity chỉ phục vụ ghi nhận chất lượng, không đẩy vào inventory.
- Shortage closure chỉ chốt phần thiếu còn lại của PO line, không tạo inventory movement.

## 2. Trạng thái receipt

```text
draft -> posted -> reversed
```

- Chỉ `draft` được sửa.
- `posted` và `reversed` là bất biến về nội dung.
- `posted` là trạng thái đã phát sinh inventory movement cho phần accepted.
- `reversed` là trạng thái đã phát hành chứng từ bù để đảo phần inventory đã post.

## 3. Mô hình variance

Mỗi receipt line có các số sau:

- `receivedQuantity` = tổng thực nhận từ nhà cung cấp;
- `acceptedQuantity` = phần đạt chất lượng, post vào kho;
- `rejectedQuantity` = phần bị loại, không post vào kho;
- `receivedQuantity = acceptedQuantity + rejectedQuantity`.

Nếu `rejectedQuantity > 0` thì phải có:

- `qualityReasonCode`;
- `qualityNote`.

Nếu người dùng chốt thiếu dòng, hệ thống tự tính:

- `shortageClosedQuantity = remainingBefore - receivedQuantity`.

Kết quả line projection cho PO:

- `accepted`;
- `rejected`;
- `shortageClosed`;
- `remaining`.

## 4. Điều kiện nhận hàng

- Chỉ PO `approved` hoặc `partially_received` được nhận hàng.
- Không nhận PO `draft`, `pending_approval`, `fully_received`, `closed` hoặc `cancelled`.
- Một receipt chỉ thuộc về một PO và một warehouse.
- Warehouse receipt phải khớp warehouse nhận hàng của PO.
- Receipt line phải tham chiếu PO line.
- `receivedQuantity` là decimal string, scale 6, lớn hơn 0.
- `acceptedQuantity` và `rejectedQuantity` là decimal string, scale 6, không âm.
- `receivedQuantity = acceptedQuantity + rejectedQuantity`.
- Không được vượt remaining của PO line.
- `finalizeLine` chỉ dùng để chốt phần thiếu còn lại, không được làm âm remaining.

## 5. Inventory posting boundary

- Purchasing không ghi trực tiếp vào inventory balance.
- Purchasing không tự tạo inventory ledger riêng.
- Phải gọi internal inventory posting service hiện có.
- Post receipt và inventory movement phải nằm trong cùng transaction boundary.
- Replay cùng idempotency key không được tạo thêm movement.
- Reverse receipt phải gọi cơ chế reversal chuẩn của inventory.
- Chỉ `acceptedQuantity` được đưa vào inventory movement.
- `rejectedQuantity` và `shortageClosedQuantity` không tạo inventory movement.

## 6. Tracking policy

Policy hiện có vẫn giữ nguyên:

- `location_required`
- `lot_tracking_mode`
- `expiry_tracking_mode`

Phần `manufacturedDate` vẫn được lưu và chuyển tiếp vào lot/inventory snapshot nếu có, nhưng slice này không tạo thêm policy mới riêng cho manufacturing date.

Quy tắc thực thi:

- `location_required = true` thì location bắt buộc.
- `lot_tracking_mode = REQUIRED` thì lot bắt buộc.
- `lot_tracking_mode = NONE` thì không được gửi lot, manufacturedDate, expiryDate hoặc supplierLotReference.
- `expiry_tracking_mode = REQUIRED` thì expiryDate bắt buộc.
- `expiry_tracking_mode = NONE` thì expiryDate không được gửi.

## 7. Document numbering

- Series: `PURCHASE_RECEIPT`.
- Prefix mặc định: `GR-`.
- Template: `{PREFIX}{YYYY}{MM}-{SEQ}`.
- Reset hàng tháng theo `Asia/Ho_Chi_Minh`.
- Số chỉ cấp lúc post.
- Draft không cấp số.

## 8. Permission catalog

Canonical keys:

- `core.goods-receipt.read`
- `core.goods-receipt.create`
- `core.goods-receipt.update`
- `core.goods-receipt.post`
- `core.goods-receipt.reverse`
- `core.goods-receipt.variance`

Backend kiểm từng route riêng. Frontend fail-closed nếu không có permission context.

## 9. Audit và outbox

Mỗi mutation thành công phải ghi:

- goods receipt audit/outbox;
- inventory movement audit/outbox cho post/reverse;
- trong cùng transaction boundary.

## 10. PO projection

Backend phải tính từ posted receipts chưa reversed.

Per PO line:

- orderedQuantity
- acceptedQuantity
- rejectedQuantity
- shortageClosedQuantity
- remainingQuantity

PO header:

- receiptCount
- acceptedQuantityTotal
- rejectedQuantityTotal
- shortageClosedQuantityTotal
- remainingQuantityTotal
- trạng thái tính theo active posted receipts:
  - `approved` khi chưa nhận gì;
  - `partially_received` khi còn remaining;
  - `fully_received` khi remaining = 0 và không có shortageClosed;
  - `closed` khi remaining = 0 và có shortageClosed.

Reversal phải khôi phục lại totals và trạng thái PO.

## 11. API

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
receivedQuantity?
acceptedQuantity?
rejectedQuantity?
finalizeLine?
qualityReasonCode?
qualityNote?
locationId?
lotCode?
manufacturedDate?
expiryDate?
supplierLotReference?
note?
```

Backend tự lấy variant, SKU, unit, conversion, remaining và policy từ PO/master data.

## 12. Browser UI

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
  - hiển thị ordered/previously received/accepted/rejected/shortage remaining cho từng line;
  - hiển thị location/lot/manufactured/expiry theo policy;
  - hiển thị quality reason/note khi có rejected quantity;
  - không cho số lượng vượt remaining;
  - backend vẫn là nguồn validation cuối.
- Posted receipt:
  - xem;
  - reverse nếu có quyền.
- Reversed receipt:
  - chỉ xem.

## 13. Boundary chưa làm

- Supplier return.
- AP/payable posting.
- Supplier payment/allocation.
- Downstream document consumption blocking reversal.
- Over-receipt tolerance.
- Costing.

P5.3 chỉ chốt variance receipt và không mở các nhánh trên.
