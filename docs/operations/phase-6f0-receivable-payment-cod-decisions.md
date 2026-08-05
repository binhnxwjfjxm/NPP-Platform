# Phase 6F.0 — Quyết định công nợ, thu tiền, hàng trả và COD

> Status: **PROPOSED — OWNER APPROVAL REQUIRED**  
> Tracking: Issue `#284`, slice `#285`  
> Source baseline: `main@2725c65f5754aacbab923578f0a05369958a10af`  
> Scope: quyết định nghiệp vụ và acceptance contract cho Phase 6F.1–6F.5.  
> Tài liệu này không cho phép migration, API mutation, UI implementation, production deploy hoặc production database change.

## 1. Phần này giúp gì cho người dùng

Phase 6F phải trả lời được năm câu hỏi bằng cùng một nguồn sự thật:

1. Khách phát sinh nợ khi nào và nợ bao nhiêu?
2. Tiền đã thu được trừ vào khoản nợ nào?
3. Hàng khách trả làm giảm nợ hoặc tạo tiền dư thế nào?
4. Tiền COD đang ở khách, ở tài xế hay đã vào công ty?
5. Vì sao số tổng hợp thay đổi và truy ngược được về chứng từ nào?

Không có nút sửa trực tiếp số dư. Mọi thay đổi phải đi qua chứng từ, ledger append-only, allocation và reversal/adjustment có nguồn gốc.

## 2. Nguồn đã khóa và phần còn phải chốt

### Đã khóa từ Phase 6A, 6D và 6E

- Core Accounting sở hữu receivable, payment, allocation, cash handover và reconciliation.
- Order, fulfillment, delivery, customer settlement và cash handover là các trục trạng thái riêng.
- Đơn xác nhận hoặc hàng mới rời kho chưa tự tạo công nợ phải thu.
- Công nợ chỉ phát sinh từ số lượng thực tế được khách chấp nhận khi giao hoặc pickup đã bàn giao vật lý.
- Giao một phần chỉ ghi nhận giá trị phần đã nhận; giao thất bại/hẹn lại không ghi nợ phần chưa giao.
- Tài xế đã thu tiền nhưng chưa nộp công ty là nghĩa vụ tiền nội bộ; không tự tạo lại nợ khách.
- Customer Return `RECEIVED` là nguồn hàng khách trả đã được kho nhận. Draft return không tăng tồn và không tạo điều chỉnh tiền.
- Hàng chưa giao quay về kho theo Trip Return Receipt không phải Customer Return và không tạo credit cho khách, vì phần đó chưa phát sinh công nợ.

### Phần đề xuất trong tài liệu này

- Cách tạo receivable document/ledger từ delivery hoặc pickup.
- Cách ghi payment và allocation.
- Cách xử lý tiền trả trước, trả thừa, hoàn tiền và write-off.
- Cách nối Customer Return với credit adjustment.
- Cách tách COD collection, handover, accounting acceptance và discrepancy.
- Ranh giới UI/API của NPP Operations, Delivery, Admin và MCP.

## 3. D1 — Thời điểm phát sinh công nợ

### Delivery

```text
terminal delivery attempt
+ actual accepted delivered quantities
-> post receivable cho đúng phần khách đã nhận
```

- `delivered_full`: post toàn bộ giá trị các quantity thực giao.
- `delivered_partial`: post đúng giá trị từng quantity thực giao.
- `failed` hoặc `rescheduled`: post `0` cho phần chưa giao.
- Inventory OUT lúc dispatch chỉ chứng minh hàng rời kho; không phải bằng chứng khách đã nhận và không tự post receivable.
- Trip Return Receipt chỉ hoàn hàng chưa giao về kho; không đảo receivable vì phần chưa giao không được post.

### Pickup

```text
confirmed physical pickup handover
-> post receivable cho quantity đã bàn giao
```

Pickup ready hoặc Inventory OUT chưa kèm bàn giao vật lý không đủ để post receivable.

### Source lineage bắt buộc

Mỗi receivable line phải truy ngược được tới:

```text
customer + customer address
Sales Order + immutable version + line
Delivery Order + line
Delivery attempt + attempt line
hoặc pickup handover fact
actual accepted quantity
commercial/tax snapshots đã xác nhận
```

Không nhận giá, thuế, customer, quantity hoặc source snapshot do browser tự khai làm nguồn kế toán.

## 4. D2 — Giá trị công nợ và làm tròn

Giá trị phải lấy từ immutable Sales Order version snapshots, không lấy giá hiện tại trong master data.

- Quantity dùng canonical decimal string; không dùng JavaScript float làm nguồn nghiệp vụ.
- Tiền tính bằng fixed-point/decimal chính xác.
- Partial delivery phân bổ gross, discount và tax theo quantity thực nhận từ line snapshot.
- Tổng mọi lần post của một Sales Order line không được vượt total đã xác nhận.
- Lần post cuối đủ quantity còn lại hấp thụ phần dư làm tròn để tổng các partial postings khớp chính xác line total.
- VND hiển thị theo zero minor decimals; dữ liệu ledger giữ precision đủ để đối soát theo contract hiện hành.
- Một receivable document chỉ có một currency. Không tự đổi ngoại tệ trong Phase 6F.

Phase 6F không xây general ledger hoặc revenue recognition. Nguồn sự thật của slice này là customer receivable ledger.

## 5. D3 — Sổ công nợ

Đề xuất mô hình tương xứng với payable foundation đã có:

- immutable receivable documents và lines;
- immutable `accounting.receivable_ledger_entries` là nguồn sự thật;
- customer receivable balance là read model dựng lại được;
- một source business fact chỉ tạo tối đa một active receivable posting;
- sửa sai bằng compensating reversal, credit hoặc debit adjustment; không update/delete lịch sử đã post.

Các loại fact tối thiểu:

```text
SALE_DELIVERY_POST
SALE_PICKUP_POST
SALE_POST_REVERSE
CUSTOMER_RETURN_CREDIT
CUSTOMER_RETURN_CREDIT_REVERSE
CUSTOMER_PAYMENT_POST
CUSTOMER_PAYMENT_REVERSE
CUSTOMER_REFUND_POST
CUSTOMER_REFUND_REVERSE
CUSTOMER_WRITEOFF_POST
CUSTOMER_WRITEOFF_REVERSE
```

Tên migration/table/event cụ thể thuộc slice implementation, nhưng ý nghĩa trên không được gộp hoặc làm mất lineage.

## 6. D4 — Chính sách thu tiền đã snapshot trên đơn

Giữ bốn policy đã khóa:

```text
PREPAID
COLLECT_ON_DELIVERY
COLLECT_AFTER_DELIVERY
CREDIT_TERMS
```

### PREPAID

- Tiền có thể được ghi trước khi receivable phát sinh và nằm ở trạng thái customer advance/unapplied credit.
- Khi actual delivery/pickup post receivable, hệ thống phân bổ tối đa đúng delivered value.
- Phần tiền vượt delivered value vẫn là customer credit; không tự coi là doanh thu.
- Nếu đơn không giao, tiền vẫn là customer credit hoặc được refund qua action riêng.

### COLLECT_ON_DELIVERY

- Đây là policy mặc định/ thông thường đã khóa.
- Tại delivery attempt, tài xế ghi collection chỉ khi tiền mặt đã nhận thật hoặc chuyển khoản đã được xác nhận bằng reference kiểm chứng được.
- Payment collection thành công có thể post payment và allocate vào receivable cùng một idempotent business transaction.
- Khi đã thu đủ, customer settlement là `paid` ngay cả khi tiền mặt còn đang do tài xế giữ. Cash handover là trục nội bộ riêng.
- Nếu khách chưa trả ngay, delivery vẫn hoàn tất. Attempt phải ghi lý do, người hứa trả và `dueAt`; policy gốc của đơn không bị sửa thành policy khác.

### COLLECT_AFTER_DELIVERY

- Receivable post khi giao thành công.
- `dueAt` bắt buộc và được snapshot từ lời hẹn/điều khoản vận hành đã được phép.
- Payment pending không làm delivery thành failed và không yêu cầu trả lại hàng đã nhận.

### CREDIT_TERMS

- Receivable post khi giao/pickup thực tế.
- Due date lấy từ credit terms đã snapshot/được duyệt.
- Chỉ policy này tạo planned formal credit exposure từ đầu.

## 7. D5 — Payment và allocation là hai sự thật khác nhau

### Payment

Một payment chứng minh công ty hoặc người được ủy quyền đã nhận tiền từ khách.

- Payment post tạo một immutable ledger credit làm giảm tổng customer receivable balance.
- Một payment có một customer, installation và currency.
- Payment có thể chưa phân bổ hết; phần còn lại là `unapplied`/customer credit.
- Payment reversal chỉ được phép sau khi mọi active allocation của payment đã được đảo.

### Allocation

Allocation nối một nguồn tiền/credit với một receivable debit cụ thể.

- Một payment có thể phân bổ vào nhiều receivable.
- Một receivable có thể nhận nhiều payment.
- Allocation không làm thay đổi tổng customer balance; nó chỉ giải thích khoản tiền trừ vào khoản nợ nào.
- Tổng allocation không vượt payment remaining hoặc receivable remaining.
- Allocation row append-only; reversal tạo row đảo, không xóa.
- Cross-currency bị chặn.
- Foundation cho phép phân bổ nhiều warehouse trong cùng installation/customer/currency khi caller có scope đọc và thao tác trên toàn bộ target; không nới installation/customer boundary.

Không dùng `paid=true` thay payment và allocation.

## 8. D6 — COD có bốn bước tách biệt

```text
1. collection attempt / promise
2. customer payment collection fact
3. driver cash handover
4. company reconciliation + accounting allocation
```

### 8.1 Collection attempt hoặc lời hẹn

Tài xế có thể ghi:

- đã thu tiền mặt;
- chuyển khoản đã xác nhận;
- chưa thu và hẹn trả sau;
- thu một phần;
- sai lệch cần xử lý.

Chỉ tiền thực nhận hoặc transfer đã được xác nhận mới tạo payment fact. Lời hẹn không tạo payment.

### 8.2 Customer payment collection

- Gắn exact trip, assignment, delivery attempt, Delivery Order, customer và amount.
- Có idempotency riêng; retry không tạo receipt/payment trùng.
- Cash collection làm customer settlement giảm/paid ngay và tạo driver cash-in-transit custody.
- Confirmed bank transfer không tạo cash-in-transit của tài xế; vẫn cần reference và accounting verification phù hợp.

### 8.3 Driver cash handover

- Handover có thể gom nhiều cash collections của một trip nhưng từng dòng phải truy ngược tới collection gốc.
- Tách `expected`, `handed_over` và `difference`.
- Handover một phần hoặc thiếu/thừa bắt buộc reason/note.
- Không được handover một collection quá một lần hoặc vượt số tài xế đang giữ.

### 8.4 Company reconciliation

- Kế toán/thu ngân xác nhận số thực nhận.
- Trạng thái `reconciled` chỉ khi collection, handover và accounting acceptance đối chiếu được.
- Discrepancy là nghĩa vụ nội bộ; không tự tạo lại receivable của khách đã thanh toán.
- Xử lý nhân viên thiếu tiền, mất tiền hoặc cashbook/general ledger nằm ngoài foundation 6F, nhưng discrepancy phải giữ audit và không được bị xóa.

## 9. D7 — Customer Return và điều chỉnh công nợ

Chỉ `sales.customer_return` ở trạng thái `RECEIVED` mới tạo customer credit adjustment.

- Credit value lấy từ original receivable/delivered line snapshots, không lấy giá hiện tại.
- Accepted return quantity không vượt quantity đã thực giao và đã post receivable, trừ active credits trước đó.
- Return draft/cancelled không đổi công nợ.
- Trip Return Receipt cho hàng chưa giao không phải customer credit source.

Cách áp dụng:

1. Nếu original receivable còn mở, credit được phân bổ ưu tiên vào chính debit nguồn.
2. Nếu khách đã trả, credit còn lại trở thành unapplied customer credit/overpayment.
3. Refund là action riêng; không tự hoàn tiền chỉ vì kho nhận hàng trả.
4. Nếu source return sau này có correction hợp lệ, Accounting tạo compensating debit/credit; không sửa row cũ.

Phase 6F.3 phải nối flow hàng trả hiện có, không xây một Customer Return thứ hai.

## 10. D8 — Refund, overpayment và write-off

### Overpayment/customer credit

- Có thể phát sinh từ payment lớn hơn nợ, PREPAID chưa giao hết hoặc customer return sau khi khách đã trả.
- Số dư credit giữ trên customer account và có thể phân bổ vào receivable hợp lệ sau này hoặc refund.

### Refund

- Chỉ refund từ available unapplied customer credit.
- Không refund vượt available credit.
- Bắt buộc permission riêng, reason, payment destination/reference và idempotency.
- Refund reversal là compensating fact; không xóa refund cũ.

### Write-off

- Chỉ write off open receivable remaining.
- Bắt buộc permission riêng và reason.
- Không dùng write-off để che payment thiếu, COD discrepancy hoặc lỗi đối soát.
- Phase đầu không hardcode ngưỡng tiền hoặc dựng multi-level approval khi owner chưa cung cấp policy. Dedicated permission + reason + audit là gate tối thiểu; approval threshold là task policy riêng nếu owner yêu cầu.

## 11. D9 — Trạng thái hiển thị phải tách riêng

Giữ các axis đã khóa:

```text
order_status
delivery_status
fulfillment_status
payment_status
cod_handover_status
```

Customer settlement projection:

```text
not_due
pending
partially_paid
paid
overpaid
refunded
written_off
```

Internal cash-handover projection:

```text
not_applicable
pending_collection
collected_by_driver
handed_over
reconciled
discrepancy
```

Ví dụ hợp lệ:

```text
Đã giao — chờ chuyển khoản
Đã giao — khách đã trả — tài xế chưa nộp tiền
Giao một phần — đã thu một phần
Khách đã trả — hàng trả tạo tiền dư chờ hoàn/phân bổ
```

Không để một axis ghi đè axis khác.

## 12. D10 — Quyền và phạm vi ứng dụng

### Core API

Sở hữu mọi receivable, payment, allocation, refund, write-off và accounting reconciliation mutation.

### NPP Operations

Nơi kế toán/thu ngân:

- xem công nợ;
- ghi nhận payment ngoài chuyến;
- phân bổ tiền;
- nhận/đối soát COD;
- xử lý customer credit, refund và write-off theo quyền.

### Delivery frontend

Chỉ được:

- ghi collection fact/lời hẹn của đúng assignment tài xế;
- xem số cần thu được server tính;
- lập/bàn giao cash custody theo trip và quyền.

Delivery không được tự sửa receivable, allocation, refund hoặc write-off.

### Admin MCP/NPP

Chỉ xem tổng hợp, cảnh báo, discrepancy và duyệt ngoại lệ nhỏ nếu policy sau này yêu cầu. Không thay NPP Operations làm nghiệp vụ tiền hằng ngày.

### MCP Field

Không đọc hoặc ghi công nợ/payment/COD trong Phase 6F.1–6F.5. Chỉ mở issue adapter/read projection riêng sau khi Core 6F ổn định và source contract đã đóng.

Tất cả permission deny-by-default; installation và relevant branch/warehouse/trip/customer scope do server sở hữu. Browser không tự cấp scope.

## 13. D11 — Idempotency, concurrency, audit và outbox

- Mọi mutation retryable bắt buộc `Idempotency-Key`.
- Same key + same canonical payload trả replay read-only.
- Same key + khác payload trả conflict.
- Posting, ledger, projection, allocation, audit và outbox cùng transaction.
- Concurrent delivery postings không double receivable.
- Concurrent allocations không over-allocate.
- Concurrent COD handovers không vượt cash custody remaining.
- Replay vẫn kiểm quyền/scope hiện tại trước khi trả dữ liệu.
- API public không trả SQL, provider error, stack trace hoặc secret.

Event groups tối thiểu:

```text
core.receivable.posted
core.receivable.reversed
core.customer_payment.posted
core.customer_payment.reversed
core.receivable_allocation.created
core.receivable_allocation.reversed
core.customer_return.credit_posted
core.customer_refund.posted
core.customer_writeoff.posted
core.cod.collection_recorded
core.cod.handover_recorded
core.cod.reconciled
core.cod.discrepancy_recorded
```

## 14. Thứ tự implementation sau khi owner duyệt

```text
6F.1 receivable ledger + posting/reversal + NPP read workspace
6F.2 customer payment + allocation + reversal
6F.3 customer return credit + overpayment + refund/write-off
6F.4 Delivery COD collection + handover + NPP reconciliation
6F.5 projections, reports, reconciliation và production closeout
```

Mỗi slice có migration, backend, UI, tests, exact-head CI và production rollout riêng. Source merge không tự cho phép production migration/deploy.

## 15. Acceptance tests bắt buộc cho các slice sau

- Order confirmation và dispatch không tạo receivable.
- Full delivery post đúng một receivable.
- Partial delivery chỉ post accepted partial value; tổng partials không vượt confirmed line total.
- Failed/rescheduled và returned-to-warehouse phần chưa giao không post receivable.
- Pickup chỉ post sau physical handover.
- PREPAID chưa giao giữ customer credit; giao xong allocate đúng delivered value.
- COD cash collection settle customer ngay nhưng cash handover vẫn pending riêng.
- Chưa thu tiền không làm delivery failed.
- Payment/allocation retry không duplicate.
- Một payment phân bổ nhiều receivable và một receivable nhận nhiều payment.
- Allocation concurrency không over-allocate.
- Customer Return draft không đổi nợ; `RECEIVED` tạo credit theo original value.
- Paid return tạo customer credit trước, không tự refund.
- Refund không vượt available credit.
- Write-off không che COD discrepancy.
- Handover partial/short/excess giữ exact collection lineage.
- COD discrepancy không tái tạo customer debt.
- MCP không có route/read model công nợ trong Phase 6F core implementation.
- Ledger rebuild khớp balance/read model.

## 16. Owner approval gate

Trước khi mở 6F.1, owner phải trả lời trong Issue `#285`:

```text
APPROVE 6F.0 AS PROPOSED
```

hoặc ghi thay đổi theo mã `D1` đến `D11`.

Sau approval mới được:

- đổi trạng thái tài liệu thành `OWNER_LOCKED` bằng commit/PR;
- đóng Issue `#285`;
- bắt đầu schema/mutation của Issue `#286`.

Approval này chỉ cho phép source work 6F.1. Nó không cho phép production migration, deploy, provider hoặc database mutation.
