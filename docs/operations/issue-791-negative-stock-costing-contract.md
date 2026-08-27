# Issue #791 — Lô 7: contract giá vốn cho xuất âm có kiểm soát

> Trạng thái: nền tảng giá vốn, chưa mở quyền xuất âm
> Baseline audit: `main@3eca702e3070e2b8f734bc19923020d37ba9f702`
> Phạm vi: Costing của Công Ty; không deploy, không migration production, không thay DB guard trong bước này.

## 1. Mục tiêu

Lô 7 cần cho phép một số nghiệp vụ bán hàng xuất vượt tồn khi chính sách phía server cho phép. Giá vốn phải tiếp tục dựng lại được từ Inventory Ledger bất biến, không được biến cả cost pool thành `ANOMALY` chỉ vì số lượng tạm thời xuống âm, và không được đưa giá vốn tạm vào báo cáo như số đã chốt.

Tài liệu này mở rộng `docs/operations/phase-7-5-costing-owner-decisions.md` chỉ cho trường hợp tồn âm có kiểm soát của Issue #791. Các rule MWA, immutable cost facts, exact lineage, reversal, period lock và reconciliation còn lại giữ nguyên.

## 2. Deny-by-default ở Costing

Costing chỉ xem một OUT âm là được kiểm soát khi movement đã mang bằng chứng authorization do server snapshot tại thời điểm post:

```json
{
  "negativeStockAuthorization": {
    "source": "SERVER_POLICY",
    "decision": "ALLOW",
    "warehouseId": "<exact warehouse id>"
  }
}
```

Bằng chứng phải nằm trong metadata của canonical server-owned movement/line, đúng warehouse của dòng ledger. Client boolean không phải authorization.

Ở bước nền này chỉ `SALES_DELIVERY_ISSUE / OUT / SALES` được Costing nhận theo contract trên. Mọi OUT khác hoặc sales OUT thiếu bằng chứng vẫn giữ `COST_NEGATIVE_STOCK` và fail closed.

Bước này **không** tạo policy/capability và **không** mở DB guard. Phần policy/capability của Lô 7 sẽ là bước sau, sau khi Costing foundation xanh.

## 3. Giá tạm khi vượt tồn

Phương pháp tài chính vẫn là perpetual moving weighted average.

Khi một sales issue hợp lệ làm pool xuống âm:

- phần còn tồn dương dùng average hiện tại như cũ;
- phần vượt xuống âm dùng cùng cost anchor đó làm **provisional cost**;
- không fallback sang giá bán, không tự dùng 0;
- nếu pool chưa từng có cost anchor hợp lệ thì vẫn fail `OUTBOUND_AVERAGE_MISSING`.

Costing giữ negative layer theo movement line và event order để biết chính xác phần nào còn chờ hàng nhập bù.

## 4. Nhập bù và chốt giá vốn

Inbound có cost source hợp lệ bù negative layer theo thứ tự cũ trước; nếu inbound có exact historical lineage (reversal/return) thì ưu tiên layer của fact gốc trước rồi mới tới phần còn lại.

Với số lượng bù `q`, provisional unit cost `p` và actual inbound unit cost `a`:

```text
COGS adjustment = q × (a - p)
```

Giá trị inbound vào pool là:

```text
gross inbound value - COGS adjustment
```

Nhờ vậy khi negative được bù hết, inventory value còn lại đúng theo cost thực của phần hàng còn trong kho, còn outbound fact của đơn bán được dựng lại với COGS cuối cùng.

Ví dụ canonical:

```text
10 @ 100
OUT 15  -> quantity -5, provisional debt 5 @ 100
IN 8 @ 120
settlement adjustment = 5 × (120 - 100) = 100
final COGS của OUT 15 = 1,600
ending quantity = 3
ending inventory value = 360
ending average = 120
```

## 5. Không đưa giá tạm vào báo cáo

Trong lúc negative layer chưa được bù hết, fact của OUT được persist với:

- `status = ANOMALY`;
- `source_cost_type = NEGATIVE_STOCK_PENDING`;
- `unit_cost/value_delta = NULL` theo constraint hiện có;
- provisional cost và số lượng chờ bù nằm trong metadata để drill-down.

Do gross-margin hiện chỉ lấy COGS từ fact `COSTED`, giá tạm không bị coi là COGS cuối.

Khi inbound đã bù đủ, lần rebuild deterministic của cùng OPEN period tạo fact `COSTED` với `source_cost_type = NEGATIVE_STOCK_SETTLED` và giá vốn cuối. Các rebuild run cũ vẫn bất biến; không update cost fact đã persist.

## 6. Kỳ giá vốn

Negative layer chưa bù hết sinh `COST_NEGATIVE_STOCK_PENDING` và làm projection/balance ở trạng thái anomaly. Vì close-period hiện fail khi còn costing anomaly/reconciliation discrepancy, kỳ không thể đóng với giá vốn tạm.

Không mang negative debt chưa chốt xuyên qua CLOSED snapshot.

## 7. Lineage và idempotency

- Quantity truth vẫn chỉ là `inventory_movements` + `inventory_movement_lines`.
- Costing không sửa inventory balance trực tiếp.
- Settlement giữ source issue movement line và inbound settlement movement line trong metadata.
- Rebuild facts vẫn append-only theo rebuild run.
- Idempotency validation của projector dùng shared `IDEMPOTENCY_KEY_PATTERN` `[A-Za-z0-9._-]`; không tạo thêm regex/key có dấu `:`.
- Retry cùng command tiếp tục reuse đúng canonical key do lớp request sở hữu.

## 8. Gate sang bước policy/capability

Chỉ mở bước policy/capability và DB guard của Lô 7 sau khi các regression sau xanh:

1. thiếu server authorization -> negative OUT vẫn fail closed;
2. authorization đúng warehouse -> costing có thể giữ negative layer;
3. nhập bù đủ -> COGS và ending inventory value đúng;
4. nhập bù một phần -> COGS vẫn pending, không lọt vào gross margin;
5. rebuild deterministic không nhân đôi quantity/cost;
6. reversal giữ exact historical lineage;
7. kỳ giá vốn không đóng khi còn negative layer chưa chốt.

Bước foundation này không merge/deploy/migrate production nếu chưa có yêu cầu riêng của Owner.
