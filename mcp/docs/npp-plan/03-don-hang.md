# NPP-03 — Plan module Đơn hàng

> Ưu tiên: **P1 — quan trọng nhất**  
> Trạng thái: **DESIGNING**  
> Phụ thuộc: Khách hàng, Sản phẩm/đơn vị/bảng giá, Kho tối thiểu, User/permission/audit  
> Nguồn có sẵn: `orders`, `order_items`, đơn phát sinh từ MCP

## 1. Mục tiêu

Xây dựng vòng đời đơn hàng đủ chặt để xử lý thực tế NPP:

```text
Tạo đơn -> xác nhận -> giữ/phân bổ hàng -> chuẩn bị hàng
-> giao một hoặc nhiều lần -> ghi nhận công nợ/thanh toán
-> hoàn tất / hủy / trả / đổi / điều chỉnh
```

Không được thiết kế đơn hàng chỉ quanh happy path “tạo rồi giao đủ”.

## 2. Ngoài phạm vi ban đầu

- Tối ưu tuyến giao hàng nâng cao.
- Kết nối hóa đơn điện tử của nhà cung cấp cụ thể.
- Kế toán tổng hợp đầy đủ.
- Marketplace/EDI đa nền tảng.

Các phần này chỉ nối sau khi contract đơn, fulfillment, kho và công nợ ổn định.

## 3. Nguyên tắc nguồn sự thật

```text
Đơn hàng            = khách đặt gì, giá và điều kiện bán nào
Fulfillment/giao    = thực tế đã chuẩn bị/giao bao nhiêu
Inventory ledger    = kho đã giữ/xuất/nhập lại bao nhiêu
Receivable ledger   = khách phải trả/đã trả/được hoàn bao nhiêu
Audit/order events  = ai làm gì, lúc nào, trước và sau thay đổi
```

Không suy diễn “đã giao” chỉ từ `order_status`. Không suy diễn “đã trả tiền” chỉ từ đơn đã hoàn tất.

## 4. Tách ba trục trạng thái

### 4.1 Trạng thái nghiệp vụ đơn

```text
draft
confirmed
cancelled
completed
```

Quy tắc:

- `draft`: được sửa trực tiếp; chưa tạo nghĩa vụ kho/công nợ chính thức.
- `confirmed`: contract bán đã chốt; sửa phải qua amendment/version.
- `cancelled`: không còn nghĩa vụ giao phần chưa thực hiện; không xóa lịch sử đã giao/đã thu.
- `completed`: không còn phần cần giao/đổi/trả/xử lý; chỉ cho phép chứng từ điều chỉnh mới.

### 4.2 Trạng thái fulfillment

```text
unfulfilled
allocated
picking
packed
partially_delivered
delivered
returned
```

Nên tính từ dòng fulfillment/delivery, không cho UI tự gán tùy ý.

### 4.3 Trạng thái thanh toán

```text
unposted
unpaid
partially_paid
paid
overpaid
refunded
written_off
```

Nên tính từ receivable/payment allocation, không ghi tay trên order.

## 5. Trạng thái cấp dòng đơn

Mỗi `order_item` phải theo dõi tối thiểu:

```text
ordered_quantity
cancelled_quantity
allocated_quantity
picked_quantity
shipped_quantity
delivered_quantity
returned_quantity
exchanged_quantity
backordered_quantity
```

Bất biến:

```text
cancelled_quantity <= ordered_quantity
allocated_quantity <= ordered_quantity - cancelled_quantity
shipped_quantity <= picked_quantity
accepted delivered quantity <= shipped quantity
returned quantity <= accepted delivered quantity
```

Cần quy định rõ làm tròn theo đơn vị nhỏ nhất và conversion unit.

## 6. Data model dự kiến

Không chốt tên bảng trước audit, nhưng miền dữ liệu tối thiểu cần có:

```text
orders
order_items
order_versions hoặc order_amendments
order_events

fulfillments
fulfillment_items
deliveries
delivery_items

order_cancellations
order_cancellation_items

returns
return_items
exchanges
exchange_items

order_adjustments
credit_notes

inventory_reservations
inventory_movements
receivable_transactions
payment_allocations
```

Các bảng nghiệp vụ phải có:

```text
id
organization/distributor scope
business document number
status
created_at / updated_at
created_by / updated_by
source_type / source_id
idempotency_key khi cần
version hoặc optimistic lock
```

## 7. Nguồn đơn và chống duplicate

Nguồn đơn có thể gồm:

```text
manual
mcp_session_customer
sales_rep
import
api
```

Quy tắc:

- Mỗi request tạo đơn từ MCP phải có idempotency key ổn định.
- Gọi lại cùng key trả đúng đơn cũ, không tạo đơn/dòng đơn mới.
- Source reference phải unique trong phạm vi phù hợp, ví dụ `(source_type, source_id, operation)`.
- Không dùng tên khách/ngày để đoán duplicate.

## 8. Tính tiền

Mỗi dòng phải lưu snapshot tại thời điểm xác nhận:

```text
product_id
variant_id
sku
product_name
unit_id
unit_name
unit_conversion
quantity
list_price
unit_price
discount_type
discount_value
discount_amount
tax_rate
tax_amount
line_subtotal
line_total
```

Order header tối thiểu:

```text
subtotal
discount_total
tax_total
shipping_fee
adjustment_total
grand_total
currency
rounding_amount
```

Backend là nguồn tính tiền duy nhất. Frontend chỉ preview và hiển thị kết quả backend xác nhận.

## 9. Transition matrix bắt buộc

| Từ | Sang | Điều kiện | Hành động hệ thống |
|---|---|---|---|
| draft | confirmed | khách/SP/giá/số lượng hợp lệ | khóa snapshot giá, tạo event, có thể tạo reservation |
| draft | cancelled | chưa phát sinh giao/thu | ghi lý do hủy |
| confirmed | cancelled | chưa giao hoặc chỉ hủy phần còn lại | release reservation, giữ lịch sử |
| confirmed | completed | đã xử lý hết giao/trả/đổi và nghĩa vụ liên quan | khóa sửa trực tiếp |
| completed | — | không reopen trực tiếp | tạo adjustment/return/exchange mới |

Transition chi tiết phải được backend kiểm tra trong transaction.

## 10. Sửa đơn

### 10.1 Khi còn draft

Cho phép:

- thêm/xóa dòng;
- đổi số lượng;
- đổi giá/chiết khấu nếu có quyền;
- đổi địa chỉ/ngày giao/ghi chú;
- đổi khách nếu chưa có ràng buộc nguồn.

Mọi thay đổi vẫn cần audit tối thiểu.

### 10.2 Sau confirmed

Không ghi đè âm thầm. Dùng amendment/version:

```text
original confirmed version
-> requested amendment
-> validation tác động kho/công nợ/giao hàng
-> approve/apply
-> new order version + event
```

Các trường hợp:

- tăng số lượng: thêm reservation/backorder;
- giảm số lượng chưa giao: release reservation;
- giảm thấp hơn đã giao: không cho sửa, phải return;
- đổi sản phẩm chưa giao: cancel dòng cũ + thêm dòng mới;
- đổi giá sau đã ghi công nợ: tạo adjustment/credit/debit note.

## 11. Hủy đơn và hủy dòng

Bắt buộc lưu:

```text
reason_code
reason_note
cancelled_by
cancelled_at
scope: whole_order | item | remaining_quantity
quantity
```

Quy tắc:

- Không hủy số lượng đã giao bằng cách giảm ordered quantity.
- Phần đã giao phải xử lý qua return/exchange.
- Hủy phần chưa giao phải release reservation trong cùng transaction.
- Nếu đã post công nợ cho phần hủy, phải tạo bút toán đảo/credit note tương ứng.

## 12. Giao thiếu và giao nhiều đợt

Mô hình phải hỗ trợ nhiều fulfillment/delivery trên một order.

Một lần giao có thể ghi:

```text
planned_quantity
shipped_quantity
accepted_quantity
rejected_quantity
shortage_reason
rejection_reason
proof_of_delivery
receiver
received_at
```

Sau lần giao:

```text
remaining = ordered - cancelled - accepted_delivered
```

Phần còn lại phải được quyết định rõ:

```text
backorder
cancel_remaining
reschedule
substitute_before_delivery
```

Không tự động coi giao thiếu là hoàn tất đơn.

## 13. Trả hàng

Return phải tham chiếu delivery/order item gốc.

Phân loại:

```text
sellable_return      -> có thể nhập lại kho bán được
quarantine_return    -> chờ kiểm tra
scrap_return         -> hỏng/hết hạn, không nhập kho bán được
supplier_return      -> trả tiếp nhà cung cấp
```

Tác động có thể gồm:

- inventory movement nhập lại/quarantine/scrap;
- credit note giảm công nợ;
- refund nếu khách đã trả;
- không hoàn tiền nếu đổi ngang tùy policy;
- cập nhật return status độc lập.

## 14. Đổi hàng

Không sửa sản phẩm trên dòng đã giao. Dùng quy trình:

```text
return item cũ
+ exchange issue item mới
+ tính chênh lệch giá/thuế
+ movement kho riêng
+ receivable adjustment riêng
```

Hỗ trợ:

- đổi cùng SKU khác lô;
- đổi SKU khác cùng giá;
- đổi SKU khác giá;
- đổi một phần số lượng;
- giao hàng đổi sau khi đã nhận hàng trả.

## 15. Giao dư hoặc khách nhận khác thực tế

Không tăng `delivered_quantity` vượt nghĩa vụ đơn mà không có chứng từ.

Các lựa chọn hợp lệ:

- amendment tăng đơn trước khi chấp nhận;
- tạo đơn bổ sung;
- ghi nhận hàng giao dư cần thu hồi;
- promotional/free item có dòng hàng riêng giá 0 và rule rõ ràng.

## 16. Liên kết tồn kho

Mọi tác động kho đi qua inventory service/ledger:

```text
confirm/reserve       -> reservation
cancel/reduce         -> reservation release
ship                  -> stock issue hoặc goods in transit
customer accept       -> delivery confirmation theo policy
return sellable       -> stock receipt
return damaged        -> quarantine/scrap receipt
exchange              -> return movement + new issue movement
```

Không update trực tiếp số tồn từ order controller.

## 17. Liên kết công nợ

Cần chốt thời điểm post phải thu:

```text
on_confirm
on_ship
on_delivery_acceptance
on_invoice
```

Khuyến nghị NPP: cấu hình policy nhưng mỗi tenant chỉ có một policy active/versioned trong một giai đoạn.

Tác động:

- giao một phần: post theo phần đủ điều kiện;
- trả hàng: credit note;
- đổi chênh lệch: debit/credit adjustment;
- hủy trước post: không tạo phải thu;
- hủy sau post: đảo bút toán, không xóa.

## 18. Permission matrix tối thiểu

| Hành động | Sales | Kho | Giao hàng | Kế toán | Quản lý |
|---|---:|---:|---:|---:|---:|
| Tạo/sửa draft | Có | Không | Không | Xem | Có |
| Xác nhận đơn | Theo hạn mức | Không | Không | Xem | Có |
| Đổi giá/chiết khấu | Theo policy | Không | Không | Xem | Duyệt |
| Hủy confirmed | Đề nghị | Không | Không | Kiểm tra | Duyệt |
| Allocate/pick/pack | Xem | Có | Xem | Không | Có |
| Xác nhận giao | Xem | Xem | Có | Xem | Có |
| Tạo return/exchange | Đề nghị | Nhận hàng | Ghi nhận | Xử lý tiền | Duyệt |
| Credit/write-off | Không | Không | Không | Theo hạn mức | Duyệt |

Permission thực tế phải deny-by-default và có scope NPP/kho/khu vực.

## 19. API contract dự kiến

```text
POST   /api/orders
GET    /api/orders
GET    /api/orders/:id
PATCH  /api/orders/:id/draft
POST   /api/orders/:id/confirm
POST   /api/orders/:id/amendments
POST   /api/orders/:id/cancel
POST   /api/orders/:id/items/:itemId/cancel

POST   /api/orders/:id/fulfillments
POST   /api/fulfillments/:id/allocate
POST   /api/fulfillments/:id/pick
POST   /api/fulfillments/:id/pack
POST   /api/fulfillments/:id/ship
POST   /api/deliveries/:id/confirm

POST   /api/orders/:id/returns
POST   /api/returns/:id/receive
POST   /api/orders/:id/exchanges

GET    /api/orders/:id/events
```

Tên endpoint cuối cùng chỉ khóa sau audit API hiện có.

## 20. UI bắt buộc

### Danh sách

- filter theo order/fulfillment/payment status riêng;
- khách, nhân viên, tuyến/MCP source, ngày, kho;
- cảnh báo đơn treo, giao thiếu, quá hạn, vượt tín dụng.

### Chi tiết đơn

Tab hoặc khu vực:

```text
Tổng quan
Dòng hàng
Giao hàng
Trả/đổi
Thanh toán/công nợ
Lịch sử thay đổi
```

Không giấu ngoại lệ trong popup nhỏ khó kiểm tra.

## 21. Test matrix tối thiểu

### Happy path

```text
create draft -> confirm -> allocate -> pick -> ship -> deliver -> post receivable -> pay -> complete
```

### Edge cases bắt buộc

```text
[ ] gọi create từ MCP hai lần không duplicate
[ ] sửa draft tính lại tiền đúng
[ ] confirm khi giá/SP/unit không hợp lệ bị chặn
[ ] tăng số lượng sau confirm tạo amendment
[ ] giảm thấp hơn số đã giao bị chặn
[ ] hủy phần chưa giao release reservation
[ ] giao một phần giữ remaining/backorder đúng
[ ] giao lần hai cộng dồn đúng
[ ] khách từ chối một phần
[ ] return sellable nhập lại kho
[ ] return damaged không vào kho bán được
[ ] exchange tạo đủ hai chiều movement
[ ] credit note giảm công nợ đúng
[ ] payment đã phân bổ không bị mất khi hủy phần còn lại
[ ] concurrent confirm chỉ một request thành công
[ ] retry mutation không nhân đôi event/movement/receivable
```

## 22. Migration và dữ liệu cũ

Trước migration:

1. Audit schema `orders`, `order_items` và dữ liệu thật.
2. Phân loại status cũ và các giá trị không nhất quán.
3. Xác định đơn nào từ MCP/source khác.
4. Đối chiếu tổng tiền header với tổng dòng.
5. Tìm orphan item, duplicate source reference, quantity âm/0.
6. Không backfill trạng thái giao/thanh toán bằng suy đoán thiếu căn cứ.
7. Trường không xác định phải đánh dấu `legacy_unknown` hoặc queue review.

## 23. Checklist triển khai

```text
[ ] O-01 Audit DB/API/UI/production data hiện có
[ ] O-02 Chốt ba trục trạng thái
[ ] O-03 Chốt line quantity invariants
[ ] O-04 Chốt pricing snapshot và rounding
[ ] O-05 Chốt source/idempotency contract
[ ] O-06 Chốt amendment/cancel contract
[ ] O-07 Chốt partial delivery/backorder contract
[ ] O-08 Chốt return/exchange contract
[ ] O-09 Chốt inventory integration
[ ] O-10 Chốt receivable integration
[ ] O-11 Chốt permission matrix
[ ] O-12 Viết migration
[ ] O-13 Implement backend transaction/service
[ ] O-14 Implement UI vertical slice
[ ] O-15 Integration/concurrency/idempotency tests
[ ] O-16 Production migration + smoke
[ ] O-17 Khóa contract v1 của module đơn hàng
```

## 24. Open questions cần quyết định bằng dữ liệu thật

```text
[ ] Thời điểm NPP ghi nhận doanh thu/phải thu hiện tại là confirm, xuất kho hay giao thành công?
[ ] Có quản lý lô/hạn dùng/serial không?
[ ] Có cho âm kho không? Trong trường hợp nào và ai duyệt?
[ ] Một đơn có thể xuất từ nhiều kho không?
[ ] Chính sách backorder hay tự hủy phần thiếu?
[ ] Có giao hàng miễn phí/khuyến mãi theo dòng riêng không?
[ ] Đổi hàng có bắt buộc nhận hàng cũ trước khi xuất hàng mới không?
[ ] Hạn mức giảm giá và tín dụng theo vai trò là bao nhiêu?
[ ] Có hóa đơn/phiếu giao hàng đánh số theo chi nhánh không?
```

## 25. Decision log

| Ngày | Quyết định | Lý do | Ảnh hưởng |
|---|---|---|---|
| 2026-07-14 | Tách `order_status`, `fulfillment_status`, `payment_status` | Tránh một status gánh nhiều sự thật | DB/API/UI/report |
| 2026-07-14 | Không hard-delete đơn đã ảnh hưởng kho/công nợ | Bảo toàn audit và đối soát | Cancel/return/adjustment |
| 2026-07-14 | Sửa confirmed bằng amendment/version | Không mất lịch sử và tác động liên module | Order events, pricing, inventory, AR |
