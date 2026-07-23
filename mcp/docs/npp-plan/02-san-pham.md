# NPP-02 — Plan module Sản phẩm

> Trạng thái: **PLANNED**  
> Phụ thuộc: Permission/audit, đơn vị tính, kho tối thiểu  
> Tích hợp: Đơn hàng, tồn kho, bảng giá, MCP test sản phẩm, báo cáo

## 1. Mục tiêu

Tạo product catalog chuẩn để mọi module dùng cùng một mã hàng, biến thể và đơn vị quy đổi.

Phải hỗ trợ:

```text
Sản phẩm -> biến thể/SKU -> đơn vị bán/mua/tồn
Danh mục/nhãn hiệu
Barcode
Bảng giá
Thuế/chiết khấu
Lô/hạn dùng nếu cần
Trạng thái kinh doanh
```

## 2. Nguồn sự thật

```text
products                 = sản phẩm chung
product_variants         = SKU/biến thể bán và tồn
units/unit_conversions   = đơn vị và quy đổi
price_lists/price_items  = giá theo khách/kênh/kỳ
order item snapshot      = tên/SKU/unit/price tại thời điểm xác nhận
inventory item/lot       = tồn thực tế theo SKU/lô
```

Sửa tên, barcode hoặc quy đổi không được làm thay đổi chứng từ lịch sử.

## 3. Data model tối thiểu

```text
products
product_variants
product_categories
brands
units
product_unit_conversions
product_barcodes
price_lists
price_list_items
product_status_history
```

Trường quan trọng:

```text
product_code
sku
name
variant_name
base_unit_id
sales_unit_id
purchase_unit_id
conversion_factor
barcode
status: draft | active | suspended | discontinued
track_inventory
track_lot
track_expiry
minimum_shelf_life_days
```

## 4. Đơn vị và quy đổi

- Mỗi SKU có một base inventory unit bất biến sau khi đã phát sinh movement, trừ migration có kiểm soát.
- Quy đổi dùng số thập phân chính xác, không dùng float.
- Quy định rounding cho đặt hàng, tồn kho và giá.
- Không cho conversion bằng 0/âm hoặc tạo vòng quy đổi mâu thuẫn.
- Order item phải lưu snapshot conversion đã dùng.

Ví dụ:

```text
1 thùng = 24 chai
Tồn ledger giữ chai
Đơn bán có thể đặt thùng
Backend quy đổi và lưu cả quantity bán lẫn base quantity
```

## 5. Bảng giá

Tối thiểu hỗ trợ:

```text
Giá mặc định
Giá theo kênh/nhóm khách
Giá riêng khách
Hiệu lực từ/đến
Đơn vị áp dụng
Giá có/không gồm thuế
```

Quy tắc ưu tiên phải khóa rõ ràng. Khi nhiều rule trùng nhau, backend trả nguồn giá đã chọn và lý do; không để frontend tự chọn giá thấp nhất.

## 6. Trạng thái sản phẩm

- `draft`: chưa cho đặt đơn thật.
- `active`: được bán/mua/tồn.
- `suspended`: tạm chặn giao dịch mới, vẫn xử lý chứng từ cũ.
- `discontinued`: ngừng kinh doanh; vẫn giữ tồn/lịch sử/return.

Không hard-delete SKU đã có order item, inventory movement hoặc MCP test.

## 7. Liên kết MCP

- MCP test sản phẩm tham chiếu product/variant hiện tại nhưng kết quả cũ giữ context snapshot cần thiết.
- Template test không được tạo SKU giả.
- Sản phẩm phát hiện ngoài catalog phải vào hàng chờ tạo/ghép, không ghi text tự do thành SKU chính thức.

## 8. API dự kiến

```text
GET    /api/products
POST   /api/products
GET    /api/products/:id
PATCH  /api/products/:id
POST   /api/products/:id/status
POST   /api/products/:id/variants
PATCH  /api/product-variants/:id
GET    /api/price-lists
POST   /api/price-lists
POST   /api/pricing/resolve
```

## 9. UI

### Danh sách

- tìm mã/tên/SKU/barcode;
- filter category/brand/status/stock tracking;
- cảnh báo thiếu đơn vị, trùng SKU/barcode, giá hết hiệu lực.

### Chi tiết

```text
Thông tin chung
Biến thể/SKU
Đơn vị quy đổi
Bảng giá
Tồn theo kho
Lịch sử giao dịch
MCP test/thị trường
Audit
```

## 10. Permission

- Sales xem catalog và giá trong phạm vi được cấp.
- Product admin tạo/sửa catalog.
- Pricing role sửa giá/chiết khấu.
- Kho không được đổi conversion sau khi có movement.
- Thay base unit hoặc merge SKU cần quyền quản trị và migration riêng.

## 11. Test matrix

```text
[ ] SKU/code/barcode unique đúng scope
[ ] conversion chính xác và không dùng float
[ ] order lưu snapshot tên/unit/conversion/price
[ ] đổi tên SP không đổi đơn cũ
[ ] suspended chặn dòng đơn mới
[ ] discontinued vẫn return được
[ ] pricing resolve đúng thứ tự ưu tiên và hiệu lực
[ ] concurrent create không tạo duplicate SKU
[ ] không cho đổi base unit sau movement nếu chưa migration
```

## 12. Checklist

```text
[ ] P-01 Audit product/variant/unit/price hiện có
[ ] P-02 Chốt SKU và product boundary
[ ] P-03 Chốt base unit/conversion/rounding
[ ] P-04 Chốt pricing precedence
[ ] P-05 Chốt status rules
[ ] P-06 Migration/backfill
[ ] P-07 Backend APIs
[ ] P-08 UI catalog/pricing
[ ] P-09 Integration order/inventory/MCP
[ ] P-10 Production smoke/freeze v1
```

## 13. Open questions

```text
[ ] Có quản lý lô/hạn dùng bắt buộc cho nhóm nào?
[ ] Một SKU có nhiều barcode theo đơn vị không?
[ ] Giá hiện lưu có VAT hay chưa VAT?
[ ] Có cho bán số lượng lẻ nhỏ hơn base unit không?
[ ] Có cần combo/bundle/khuyến mãi ngay phase đầu không?
```
