# NPP-05 — Plan module Công nợ

> Trạng thái: **PLANNED**  
> Phụ thuộc: Khách hàng, đơn/giao hàng, tiền tệ, permission/audit  
> Tích hợp: Thanh toán, return/credit note, dashboard, báo cáo

## 1. Mục tiêu

Xây dựng sổ phải thu làm nguồn sự thật cho:

```text
Khách phải trả bao nhiêu?
Phát sinh từ chứng từ nào?
Đã thu bao nhiêu và phân bổ vào đâu?
Còn nợ bao nhiêu, đến hạn khi nào?
Khoản nào quá hạn/vượt hạn mức?
Return/hủy/đổi đã điều chỉnh ra sao?
```

Không lưu công nợ chỉ bằng một trường `customer.debt` hoặc `order.paid_amount` rồi cập nhật cộng trừ trực tiếp.

## 2. Nguồn sự thật

```text
receivable_transactions = phát sinh nợ/giảm nợ/đảo bút toán
payments                = tiền thực nhận/hoàn
payment_allocations     = khoản tiền được cấn vào chứng từ nào
credit_notes/debit_notes = điều chỉnh có chứng từ
receivable_balances     = read model có thể rebuild
```

## 3. Data model tối thiểu

```text
customer_credit_profiles
receivable_documents
receivable_transactions
payments
payment_allocations
credit_notes
refunds
write_offs
receivable_balance_snapshots hoặc read model
```

Transaction type:

```text
invoice_or_delivery_post
debit_adjustment
credit_adjustment
payment_allocation
payment_unallocation
refund
write_off
reversal
opening_balance
```

## 4. Bất biến

- Transaction đã post không sửa/xóa; sai thì reversal + bút toán mới.
- Tổng balance phải rebuild được từ ledger.
- Payment và allocation tách riêng: nhận tiền chưa chắc đã biết cấn đơn nào.
- Một payment có thể cấn nhiều chứng từ; một chứng từ có thể được nhiều payment.
- Retry không tạo trùng transaction/allocation.
- Số tiền dùng decimal chính xác, có currency và rounding rule.
- Không cho allocation vượt số tiền chưa phân bổ hoặc vượt dư nợ chứng từ, trừ policy overpayment rõ ràng.

## 5. Thời điểm ghi nhận phải thu

Cần khóa một policy/version theo từng NPP hoặc giai đoạn:

```text
on_order_confirm
on_shipment
on_delivery_acceptance
on_invoice
```

Khuyến nghị không suy diễn. Phải audit cách NPP đang vận hành và chọn nguồn chứng từ thực tế.

Giao một phần chỉ post phần đủ điều kiện theo policy. Hủy/return sau post tạo credit/reversal, không xóa giao dịch cũ.

## 6. Hạn mức và điều khoản

Customer credit profile:

```text
credit_limit
payment_term_days
risk_status
allow_over_limit
approval_threshold
collection_owner
```

Khi xác nhận đơn:

```text
current exposure
+ order eligible amount
- approved credits/prepayments
```

Nếu vượt hạn mức:

- chặn;
- hoặc yêu cầu phê duyệt;
- hoặc cho phép theo role/threshold có audit.

Không chỉ cảnh báo ở UI rồi backend vẫn cho qua.

## 7. Thu tiền

Payment lifecycle:

```text
draft -> received -> allocated/partially_allocated -> reconciled
```

Hỗ trợ:

- tiền mặt;
- chuyển khoản;
- nhiều phương thức;
- thu một phần;
- thu dư;
- thu gộp nhiều đơn;
- payment chưa xác định khách/chứng từ;
- hủy/hoàn khoản thu bằng reversal/refund.

Không hard-delete payment đã reconciled.

## 8. Return, đổi hàng và hủy

- Hủy trước khi post: không tạo phải thu.
- Hủy sau post: credit/reversal phần hợp lệ.
- Return: credit note theo giá/thuế chính sách được khóa.
- Exchange ngang giá: có thể offset nhưng vẫn giữ chứng từ hai chiều.
- Exchange chênh giá: debit/credit adjustment.
- Refund chỉ sau khi xác định khách thực sự dư tiền và theo quyền duyệt.

## 9. Aging

Bucket mặc định có thể cấu hình:

```text
chưa đến hạn
1-7 ngày
8-15 ngày
16-30 ngày
31-60 ngày
61-90 ngày
trên 90 ngày
```

Aging dựa trên due date của từng receivable document/remaining amount, không dựa ngày đơn một cách cứng nhắc.

## 10. API dự kiến

```text
GET  /api/receivables
GET  /api/receivables/customers/:customerId
GET  /api/receivables/aging
POST /api/receivables/post
POST /api/receivables/:id/reverse
POST /api/payments
POST /api/payments/:id/receive
POST /api/payments/:id/allocations
POST /api/payment-allocations/:id/reverse
POST /api/credit-notes
POST /api/refunds
POST /api/write-offs
```

## 11. UI

```text
Tổng phải thu
Aging
Danh sách khách nợ/quá hạn/vượt hạn mức
Chi tiết sổ khách
Chứng từ phải thu
Thu tiền và phân bổ
Tiền chưa phân bổ
Credit/refund/write-off
Đối soát và audit
```

Mọi số tổng phải drill-down tới transaction/allocation.

## 12. Permission

- Sales xem công nợ khách được phân công; không sửa ledger.
- Người thu tiền tạo receipt trong phạm vi được cấp.
- Kế toán post/allocate/reconcile.
- Credit note/refund/write-off cần threshold và approval.
- Chủ NPP xem toàn bộ; export dữ liệu nhạy cảm cần quyền riêng.

## 13. Test matrix

```text
[ ] giao một phần post đúng phần đủ điều kiện
[ ] thu một phần cập nhật remaining đúng
[ ] một payment cấn nhiều đơn
[ ] unallocated payment không biến mất
[ ] retry payment/allocation không duplicate
[ ] return tạo credit đúng và không xóa phát sinh gốc
[ ] overpayment được giữ/hoàn đúng policy
[ ] aging theo due date và timezone đúng
[ ] reversal khôi phục balance chính xác
[ ] rebuild ledger khớp read model
[ ] permission không rò công nợ ngoài scope
```

## 14. Checklist

```text
[ ] AR-01 Audit dữ liệu công nợ/thanh toán hiện có
[ ] AR-02 Chốt posting policy
[ ] AR-03 Chốt payment/allocation/reversal
[ ] AR-04 Chốt credit limit/approval
[ ] AR-05 Chốt return/refund/write-off
[ ] AR-06 Migration/opening balance
[ ] AR-07 Backend ledger service/API
[ ] AR-08 UI + aging/read model
[ ] AR-09 Reconciliation/idempotency tests
[ ] AR-10 Production smoke/freeze v1
```

## 15. Open questions

```text
[ ] NPP hiện ghi nhận nợ khi nào?
[ ] Có hóa đơn/phiếu thu bên ngoài cần import không?
[ ] Có nhiều tiền tệ không?
[ ] Thu tiền nhân viên ngoài thị trường có cần phiên bàn giao quỹ không?
[ ] Hạn mức theo khách, nhóm khách hay chi nhánh?
```
