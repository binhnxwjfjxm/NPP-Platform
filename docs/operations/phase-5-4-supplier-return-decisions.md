# Phase 5.4 Supplier Return decisions

Trạng thái: **LOCKED FOR IMPLEMENTATION**  
Phạm vi: NPP Core Purchasing - Supplier Return vertical slice  
Không bao gồm: payable/AP, supplier payment, credit note, general inventory adjustment, cost accounting, production deploy, production migration, `mcp/**`

## 1. Nguồn sự thật

- Purchase Order vẫn là nguồn sự thật cho đơn hàng mua.
- Goods Receipt đã post là nguồn sự thật cho số lượng đã nhận hợp lệ.
- Supplier Return là chứng từ đi ra kho dựa trên một goods receipt đã post.
- Một supplier return line chỉ được bám vào một goods receipt line.
- Số lượng trả không được lớn hơn `returnableQuantity = acceptedQuantity - postedReturnQuantity`.
- Supplier return chỉ được tạo từ posted goods receipt line có `acceptedQuantity > 0`.

## 2. Trạng thái chứng từ

```text
draft -> pending_approval -> approved -> posted -> reversed
```

Nhánh huỷ:

```text
draft/pending_approval/approved -> cancelled
```

Quy tắc:

- Chỉ `draft` được sửa.
- `pending_approval`, `approved`, `posted`, `reversed`, `cancelled` là bất biến nội dung.
- `post` tạo inventory movement OUT theo accepted quantity của line trả.
- `reverse` tạo chứng từ bù và đảo inventory movement của phiếu trả đã post.

## 3. Mô hình line

Mỗi supplier return line lưu snapshot từ goods receipt line:

- `sourceGoodsReceiptId`, `sourceGoodsReceiptNumber`, `sourceGoodsReceiptStatus`;
- `sourceGoodsReceiptLineId`, `sourceGoodsReceiptLineNumber`;
- `sourcePurchaseOrderId`, `sourcePurchaseOrderNumber`, `sourcePurchaseOrderLineId`, `sourcePurchaseOrderLineNumber`;
- `sourceSupplierId`, `sourceSupplierCode`, `sourceSupplierName`;
- `sourceWarehouseId`, `sourceWarehouseCode`, `sourceWarehouseName`;
- `sourceVariantId`, `sourceSku`, `sourceItemName`, `sourceUnitId`, `sourceUnitCode`;
- `baseVariantId`, `baseSku`, `conversionToBase`;
- `sourceAcceptedQuantity`, `returnQuantity`, `baseQuantity`;
- `reasonCode`, `reasonNote`, `note`;
- lot/location/manufactured/expiry/reference snapshot nếu source line có.

Quy tắc tính:

- `returnQuantity` là quantity gốc theo unit của line nguồn.
- `baseQuantity = returnQuantity * conversionToBase` scale 6.
- `lineNumber` là số thứ tự ổn định trong supplier return.
- `postedReturnQuantity` và `returnableQuantity` là projection đọc từ posted returns cùng source line.

## 4. Chặn reverse goods receipt

- Goods receipt không được reverse nếu còn bất kỳ supplier return nào ở trạng thái `draft`, `pending_approval`, `approved` hoặc `posted` trỏ về các source goods receipt line của nó.
- Chặn này là business invariant bắt buộc để không đảo ngược hàng đã được trả về nhà cung cấp.

## 5. Đánh số chứng từ

- Series: `SUPPLIER_RETURN`.
- Prefix mặc định: `SR-`.
- Template: `{PREFIX}{YYYY}{MM}-{SEQ}`.
- Reset theo tháng tại `Asia/Ho_Chi_Minh`.
- Chỉ cấp số lúc `post`.
- `draft`, `pending_approval`, `approved` không cấp số.

## 6. Permission catalog

Canonical keys:

- `core.supplier-return.read`
- `core.supplier-return.create`
- `core.supplier-return.update`
- `core.supplier-return.submit`
- `core.supplier-return.approve`
- `core.supplier-return.cancel`
- `core.supplier-return.post`
- `core.supplier-return.reverse`

Frontend fail-closed nếu thiếu context permission.

## 7. API

```text
GET    /api/supplier-returns
GET    /api/supplier-returns/:id
POST   /api/supplier-returns
PATCH  /api/supplier-returns/:id
POST   /api/supplier-returns/:id/submit
POST   /api/supplier-returns/:id/approve
POST   /api/supplier-returns/:id/cancel
POST   /api/supplier-returns/:id/post
POST   /api/supplier-returns/:id/reverse
GET    /api/supplier-returns/source-lines?goodsReceiptId=:id
```

Payload draft:

```text
supplierId
warehouseId
returnDate
note?
expectedRevision?   # required on PATCH/submit/approve/cancel/post/reverse
lines[]
```

Line draft:

```text
sourceGoodsReceiptLineId
returnQuantity
reasonCode
reasonNote
note?
```

Backend tự lấy snapshot nguồn từ posted goods receipt line và snapshot PO/source product data.

## 8. Browser UI

- Trang: `/purchasing/supplier-returns`
- Danh sách hiển thị số phiếu, nhà cung cấp, kho, ngày trả, trạng thái, số dòng, tổng số lượng và hành động.
- Tạo mới đi từ posted goods receipt qua source-lines.
- Modal post/reverse phải cho phép đi tiếp với giá trị mặc định khi người dùng không nhập ghi chú lý do.
- Sau submit/approve/post/reverse, danh sách phải phản ánh trạng thái mới ngay trên cùng dòng đang xem.

## 9. Verifications đã chốt

- Migration local đã đi qua `023` đến `028`.
- API test goods-receipt và supplier-return đều pass trên DB local của workspace.
- `npm --prefix npp-core/api run migration:verify` pass.
- `npm --prefix npp-core/api run build` pass.
- `npm --prefix npp-core/web run typecheck` pass.
- `npm --prefix npp-core/web run build` pass.
- Browser E2E `e2e/supplier-returns.spec.ts --project purchasing --no-deps` pass.

## 10. Boundary không mở

- Payable/AP posting.
- Supplier settlement/payment.
- Credit note.
- Generic inventory adjustment.
- Costing.
- Production deploy.
- Production migration.
- `mcp/**`.

Phase 5.4 chỉ khóa supplier return vertical slice và chặn reverse goods receipt khi còn return active.
