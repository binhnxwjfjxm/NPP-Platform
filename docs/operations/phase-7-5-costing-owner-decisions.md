# Phase 7.5 — Costing Owner Decision Lock

> Status: **OWNER LOCKED**
> Parent: Issue #328
> Decision gate: Issue #335
> Foundation implementation: Issue #344
> Backdate/reversal/reconciliation: Issue #345
> Audited baseline: `main@5137b708f1123c4086c2e2172acdff6a792828cc`
> Scope: lock the financial valuation method and boundaries before any costing migration, service, projection, UI or Accounting integration.
> Explicit exclusions: no production migration, no production deploy, no provider change, no MCP/Admin/Delivery mutation and no general-ledger journal.

## 1. Phần này giúp gì cho người dùng

Phase 7.5 khóa cách hệ thống tính giá trị tồn và giá vốn để cùng một tập movement bất biến luôn dựng lại ra cùng một kết quả. Người dùng sau Phase 7.5 foundation sẽ xem được giá trị tồn theo kho/SKU và truy ngược tới movement cùng chứng từ nguồn, thay vì nhập hoặc sửa một con số giá vốn rời khỏi sổ kho.

Physical FEFO/FIFO phục vụ chọn hàng vẫn giữ nguyên và không quyết định giá vốn tài chính.

## 2. Evidence trên source hiện tại

- Inventory quantity truth là `inventory.inventory_movements` và `inventory.inventory_movement_lines`.
- Inventory balance là read model rebuildable; costing cũng phải là read model/fact model tách khỏi quantity ledger.
- Quantity base dùng `numeric(30,12)` và fixed-point; money nguồn hiện dùng `numeric(20,6)`.
- Purchase Order có `currency_code`, mặc định `VND`; Goods Receipt giữ lineage tới PO line nhưng chưa có costing fact.
- Opening Balance hiện chỉ có quantity, chưa có opening unit cost.
- Negative stock đang fail closed.
- Transfer, stocktake và adjustment đã có movement append-only cùng source lineage.
- Không có cost ledger/projection chính thức trên baseline.

## 3. Phương pháp giá vốn đã khóa

### 3.1 Method

Chọn **perpetual moving weighted average — bình quân gia quyền di động**.

Mỗi inbound có giá trị hợp lệ cập nhật:

```text
new_quantity = old_quantity + inbound_quantity
new_value    = old_value + inbound_value
new_average  = new_value / new_quantity
```

Mỗi outbound dùng average của pool ngay trước event:

```text
outbound_value = outbound_quantity × current_average
```

Không dùng periodic average, FIFO tài chính hoặc client-supplied current cost.

### 3.2 Costing pool

Pool canonical:

```text
installation + warehouse + inventory base variant
```

- Location, lot, expiry và disposition vẫn nằm trong lineage/drill-down nhưng không tách thành pool tài chính riêng.
- Chuyển vị trí, quarantine và damaged trong cùng warehouse giữ nguyên tổng giá trị pool.
- Scrap/outbound làm giảm quantity và value theo current average.
- Physical allocation theo lot/FEFO/FIFO không thay đổi costing method.
- Không gộp average giữa hai warehouse.

### 3.3 In-transit

- `TRANSFER_ISSUE` lấy exact average của pool nguồn tại thời điểm dispatch.
- Giá trị xuất được giữ theo transfer line như một carrying-cost fact đang đi đường.
- `TRANSFER_RECEIPT` đưa đúng carrying cost của quantity thực nhận vào pool kho đích.
- Damaged receipt đưa carrying cost vào non-available location nhưng vẫn thuộc pool kho đích.
- Short/excess chưa resolution không tự tạo hoặc xóa giá trị.
- Không coi xe là warehouse hoặc cost pool.

## 4. Cost-source precedence

Thứ tự nguồn được phép:

1. **Transfer receipt:** exact carrying cost từ transfer issue line.
2. **Customer return:** exact historical cost của original sales/delivery issue lineage.
3. **Purchase receipt:** net purchase amount của PO line, không gồm recoverable tax.
4. **Opening balance:** explicit approved opening unit cost, bắt buộc trước khi costing projection nhận event.
5. **Landed-cost allocation:** immutable approved cost adjustment event gắn exact receipt lines.
6. **Stocktake/manual adjustment IN:** current pool average; nếu pool chưa có average thì bắt buộc explicit approved unit cost.
7. **Ordinary outbound, scrap, supplier return:** current pool average ngay trước event.
8. **Internal location/quarantine/damaged move:** preserve exact source value, net warehouse pool impact bằng zero.

Không fallback âm thầm sang zero hoặc giá bán.

### 4.1 Purchase receipt amount

```text
net_line_amount = ordered/received share of
                  (ordered_quantity × unit_price - discount_amount)
```

- Recoverable purchase tax không vào inventory cost.
- Nếu một receipt nhận một phần PO line, net amount được phân bổ theo exact received base quantity.
- Sau này invoice/price variance không sửa receipt fact; tạo immutable variance cost event theo rule của Phase 7.6.

### 4.2 Zero-cost receipt

- Purchase receipt thông thường có zero cost bị fail closed.
- Hàng biếu/tặng chỉ được zero cost khi document có reason code riêng, quyền riêng và metadata nguồn; không dùng zero mặc định vì thiếu giá.
- Zero-cost anomaly phải hiện trong reconciliation.

### 4.3 Opening balance

- Mọi opening quantity cần `unit_cost` theo base unit và `currency_code`.
- Existing opening movement thiếu cost không được coi là zero; rebuild ghi anomaly `OPENING_COST_MISSING`.
- Bổ sung cost cho lịch sử phải qua approved import/correction fact, không sửa movement cũ.

## 5. Currency, precision và rounding

### 5.1 Currency

- Installation hiện tại dùng base costing currency **VND**.
- Phase 7.5/7.6 không triển khai FX valuation.
- Cost source khác VND fail closed hoặc thành reconciliation anomaly cho tới khi có owner decision FX riêng.
- Currency được snapshot trên mọi cost fact.

### 5.2 Precision

```text
quantity            numeric(30,12)
unit_cost           numeric(38,12)
inventory_value     numeric(38,12)
source money        giữ exact scale hiện có
```

- Backend dùng decimal string/BigInt hoặc exact PostgreSQL numeric; không dùng JavaScript `number` làm truth.
- Không round trong phép nhân/chia trung gian ngoài giới hạn storage đã khóa.
- UI hiển thị VND 0 decimal nhưng không làm mất precision của source.
- Rounding residual không được bỏ đi.

### 5.3 Landed cost

- Landed cost là approved immutable allocation event, không sửa purchase receipt fact.
- Basis phải được chọn rõ: `PURCHASE_VALUE` hoặc `BASE_QUANTITY`.
- Không có basis mặc định ngầm.
- Weight-based allocation deferred cho tới khi product weight master đáng tin cậy.
- Residual dùng largest-remainder; tie-break deterministic theo receipt line ID.

## 6. Backdate và period lock

Costing period theo tháng:

```text
OPEN -> CLOSED
```

- Event có effective date thuộc OPEN period mới được project.
- Backdated event trong OPEN period rebuild từ event sớm nhất bị ảnh hưởng tới hiện tại.
- Event ordering deterministic:
  1. effective timestamp/date;
  2. inventory movement `posted_at`;
  3. movement ID;
  4. line number;
  5. cost-event ID.
- CLOSED period bất biến; không silently rewrite lịch sử đã khóa.
- Sai sót kỳ đã đóng dùng forward correction trong kỳ mở với lineage tới fact gốc.
- Phase 7.5 foundation chỉ chuẩn bị deterministic ordering và projection version; mutation đóng/mở kỳ cùng backdate workflow thuộc #345.

## 7. Reversal rule

- Reversal dùng **exact historical cost của original event**, không dùng current average.
- Reversal tạo compensating immutable cost event và giữ original fact.
- Sau reversal, projection rebuild forward từ vị trí original/reversal ảnh hưởng.
- Transfer reversal mang exact transfer carrying cost.
- Reversal bị chặn hoặc chuyển forward correction khi kỳ gốc đã CLOSED theo Phase 7.6 policy.
- Foundation #344 phải lưu đủ lineage để #345 thực hiện rule này; không tự post journal.

## 8. Accounting/COGS boundary

Phase 7 costing sở hữu:

- immutable inventory valuation facts;
- moving-average pool projection;
- outbound COGS facts;
- transfer carrying-cost facts;
- rebuild/reconciliation;
- read/drill-down API và NPP Operations UI;
- outbox facts cho integration tương lai.

Phase 7 costing không sở hữu:

- general ledger;
- chart of accounts;
- debit/credit journal;
- tax accounting;
- FX revaluation;
- Accounting period close ngoài costing-period contract.

Accounting tương lai chỉ consume approved costing facts qua integration riêng. Costing không tự tạo journal từ inventory movement trong #344 hoặc #345.

## 9. Invariants bắt buộc

1. Quantity ledger không bị thay thế hoặc sửa bởi costing.
2. Mỗi cost fact tham chiếu immutable movement line và source commercial line khi có.
3. Cost facts append-only; projection rebuildable và projector-only.
4. Cùng ordered event set + cùng method version phải cho cùng quantity, value và average.
5. Không direct value overwrite và không generic client costing mutation.
6. Missing/ambiguous cost source tạo stable anomaly, không tự bịa giá.
7. Negative stock exception vẫn không có.
8. Installation/warehouse scope fail closed.
9. Rebuild/reconcile command idempotent và concurrency-safe.
10. Audit/outbox cùng transaction với run/fact/projection mutation.
11. Mọi số giá vốn hiển thị drill-down được tới cost fact, movement và chứng từ nguồn.
12. Transfer, stocktake, adjustment, purchasing, sales và return vẫn sở hữu lifecycle của chúng; costing chỉ consume posted facts.

## 10. Acceptance cho Issue #344 — nền tảng giá vốn

#344 chỉ đạt khi có:

- migration tiếp theo sau registry thực tế, không giữ số từ tài liệu;
- immutable costing facts với `method_version`;
- pool projection theo installation + warehouse + base variant;
- transfer carrying-cost lineage;
- source resolver cho purchase receipt, opening balance, transfer và ordinary IN/OUT;
- explicit anomalies thay vì zero fallback;
- deterministic rebuild và reconcile ledger quantity ↔ costing quantity;
- drill-down fact → movement line → source document;
- permissions read/rebuild/reconcile;
- idempotency, DB lock/version, audit/outbox;
- NPP Operations read/drill-down UI đúng nhóm tồn kho;
- PostgreSQL integration, fixed-point, rebuild determinism, scope, rollback, API/UI/E2E và exact-head CI.

Không triển khai full period close, late landed-cost variance, closed-period correction hoặc historical reversal workflow trong #344.

## 11. Acceptance cho Issue #345 — backdate/reversal/reconciliation

#345 bổ sung:

- OPEN/CLOSED costing period lifecycle;
- backdate rebuild từ earliest affected event;
- exact historical reversal;
- closed-period forward correction;
- landed-cost/price variance events và deterministic allocation;
- discrepancy queue cùng operational reconciliation;
- tests cho late event, period boundary, reversal chain và residual rounding.

## 12. Production boundary

Source merge không đồng nghĩa production rollout.

- Không chạy migration production trong decision gate.
- Không deploy Core/NPP trong decision gate.
- Foundation và backdate/reversal phải là PR riêng.
- Rollout Phase 7 phải audit backup, restore rehearsal, pending migrations, pre/post reconciliation, exact source SHA và đúng runtime có diff.
