# NPP-04 — Plan module Tồn kho

> Trạng thái: **PLANNED**  
> Phụ thuộc: Sản phẩm/SKU/unit, kho/vị trí, order fulfillment, permission/audit  
> Tích hợp: Đơn hàng, giao nhận, trả/đổi, mua hàng tương lai, báo cáo

## 1. Mục tiêu

Xây dựng inventory ledger làm nguồn sự thật duy nhất cho tồn kho.

Hệ thống phải trả lời được:

```text
Tồn gì?
Ở kho/vị trí/lô nào?
Có thể bán bao nhiêu?
Đang giữ cho đơn nào?
Đang đi đường bao nhiêu?
Vì sao số tồn thay đổi?
Ai tạo movement/chứng từ nào?
```

## 2. Không update số tồn trực tiếp

Không cho controller đơn hàng hoặc UI làm kiểu:

```text
stock = stock - quantity
```

Mọi thay đổi đi qua movement có đối tượng nguồn, transaction và audit.

Các số tổng hợp:

```text
on_hand
reserved
available = on_hand - reserved - blocked
in_transit
quarantine
```

Được tính từ ledger/read model có thể rebuild.

## 3. Data model tối thiểu

```text
warehouses
warehouse_locations
inventory_items
inventory_lots
inventory_balances hoặc read model
inventory_reservations
inventory_movements
inventory_movement_lines
stocktakes
stocktake_lines
inventory_adjustments
warehouse_transfers
```

Movement type tối thiểu:

```text
opening
receipt
reservation
reservation_release
issue
shipment
transfer_out
transfer_in
return_sellable
return_quarantine
scrap
adjustment_in
adjustment_out
stocktake_variance
```

## 4. Bất biến

- Movement đã post không sửa/xóa; sai thì tạo reversal/adjustment.
- Số lượng dùng decimal chính xác theo base unit.
- Không để movement orphan khỏi source document.
- Cùng idempotency key/source operation không post lặp.
- Lock/transaction khi reserve/issue để tránh oversell do concurrent request.
- Nếu policy không cho âm kho, backend phải chặn trước commit.
- Nếu cho âm kho, phải có quyền, reason và cảnh báo riêng.

## 5. Reservation và allocation

```text
Đơn confirmed
-> reserve theo policy
-> allocate kho/lô
-> pick
-> ship/issue
-> release phần hủy/thiếu
```

Reservation phải có:

```text
order_id/order_item_id
warehouse_id
variant_id
lot_id nếu có
reserved_quantity
consumed_quantity
released_quantity
status
expires_at nếu dùng soft reservation
```

Không coi reservation là on-hand movement; nó làm giảm available, không giảm on-hand.

## 6. Lô và hạn dùng

Nếu có thực tế hàng lô/date:

- lot number unique theo product/supplier scope phù hợp;
- nhận hàng lưu manufacturing/expiry date;
- FEFO/FIFO policy versioned;
- chặn giao lô hết hạn hoặc không đủ shelf-life tối thiểu;
- return phải chỉ rõ lô khi có thể;
- hàng không xác định lô vào quarantine/review, không đoán.

## 7. Giao thiếu và backorder

Khi thiếu kho:

```text
reserved < ordered remaining
```

Backend không tự sửa ordered quantity. Trả về shortage rõ ràng và cho chọn:

```text
partial allocation + backorder
cancel remaining
substitute through order amendment
wait/replenish
```

## 8. Trả/đổi

- Return sellable: receipt về kho bán được sau kiểm tra.
- Return damaged/expired: quarantine hoặc scrap.
- Exchange: return movement và issue movement mới độc lập.
- Không cộng kho chỉ vì return request được tạo; chỉ post khi kho thực nhận theo policy.

## 9. Kiểm kê và điều chỉnh

Stocktake flow:

```text
create/count/freeze scope nếu cần
-> record counted quantity
-> review variance
-> approve
-> post variance movement
```

Không sửa balance bằng tay. Điều chỉnh phải có reason code, chứng từ, người duyệt.

## 10. Chuyển kho

```text
draft transfer
-> approve
-> pick/ship transfer_out
-> in_transit
-> receive transfer_in
-> variance/damage resolution
```

Không giảm kho nguồn và tăng kho đích trong một thao tác nếu thực tế có thời gian vận chuyển, trừ transfer nội bộ tức thời được định nghĩa riêng.

## 11. API dự kiến

```text
GET  /api/inventory/balances
GET  /api/inventory/movements
POST /api/inventory/reservations
POST /api/inventory/reservations/:id/release
POST /api/inventory/issues
POST /api/inventory/receipts
POST /api/inventory/adjustments
POST /api/stocktakes
POST /api/stocktakes/:id/counts
POST /api/stocktakes/:id/post
POST /api/warehouse-transfers
POST /api/warehouse-transfers/:id/ship
POST /api/warehouse-transfers/:id/receive
```

## 12. UI

```text
Tổng tồn theo kho/SKU
Tồn khả dụng/đã giữ/quarantine/in-transit
Lịch sử movement
Reservation theo đơn
Nhập/xuất/điều chỉnh
Kiểm kê
Chuyển kho
Cảnh báo thiếu/cận date/tồn lâu
```

Mọi số tổng phải drill-down được tới movement.

## 13. Permission

- Sales xem available theo phạm vi, không điều chỉnh kho.
- Kho thao tác reserve/pick/receipt theo assignment.
- Adjustment/stocktake variance cần quyền duyệt.
- Transfer cần quyền kho nguồn và kho đích theo bước.
- Giá vốn có thể giới hạn khỏi sales.

## 14. Test matrix

```text
[ ] concurrent reserve không vượt available
[ ] retry issue không trừ kho hai lần
[ ] cancel order release reservation đúng
[ ] partial delivery chỉ issue số thực xuất
[ ] return request chưa nhận không tăng on-hand
[ ] return sellable/quarantine đi đúng bucket
[ ] transfer giữ in-transit đúng
[ ] stocktake post bằng movement, không sửa balance trực tiếp
[ ] rebuild balance từ ledger khớp read model
[ ] unit conversion và rounding chính xác
```

## 15. Checklist

```text
[ ] I-01 Audit kho/bảng tồn/movement hiện có
[ ] I-02 Chốt base unit và balance definition
[ ] I-03 Chốt negative stock policy
[ ] I-04 Chốt reservation/allocation
[ ] I-05 Chốt lot/expiry policy
[ ] I-06 Chốt return/transfer/stocktake
[ ] I-07 Migration/backfill/opening balance
[ ] I-08 Inventory service/API
[ ] I-09 UI + permission
[ ] I-10 Reconciliation/concurrency tests
[ ] I-11 Production smoke/freeze v1
```

## 16. Open questions

```text
[ ] Hiện có bao nhiêu kho và vị trí con?
[ ] Có quản lý hàng trên xe nhân viên như kho riêng không?
[ ] Có cho âm kho không?
[ ] Giá vốn dùng bình quân, FIFO hay phương pháp khác?
[ ] Lô/hạn dùng bắt buộc ở toàn bộ hay một số nhóm SP?
```
