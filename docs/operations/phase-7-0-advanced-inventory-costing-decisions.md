# Phase 7.0 — Advanced Inventory and Costing Decision Lock

> Status: **ACTIVE SOURCE DECISION — NO PHASE 7 PRODUCTION MUTATION IN THIS SLICE**  
> Parent: Issue #328  
> Baseline audited: `main@7d4b952db1b4c340b3bfb3e92a1e98f6356e717b`  
> Branch: `agent/phase-7-0-inventory-decision-lock`  
> Scope: audit the existing inventory truth, lock Phase 7 invariants, define dependency slices and record the owner decisions that still block implementation.  
> Explicit exclusions: no production migration, no production deploy, no provider change, no MCP change, no inventory mutation endpoint and no NPP UI change.

## 1. Phần này giúp gì cho người dùng

Phase 7.0 chưa thêm nút hay màn hình. Nó khóa cách hệ thống sẽ theo dõi hàng chuyển kho, kiểm kê, điều chỉnh, cách ly, tiêu hủy và giá vốn để các phần sau không tạo sổ kho thứ hai, không ghi đè số tồn và không đặt hành động nghiệp vụ sai chỗ.

Người dùng sẽ chỉ thấy tính năng mới sau khi từng vertical slice hoàn thành migration → Core API → NPP Operations UI → test → exact-head CI. Admin, Delivery và MCP không sở hữu nghiệp vụ kho hằng ngày.

## 2. Evidence map trên baseline

| Concern | Source hiện tại | Kết luận |
| --- | --- | --- |
| Warehouse/location | `shared.warehouses`, `shared.warehouse_locations`; permission `core.warehouse.*`, `core.warehouse.location.*` | Dùng lại master hiện có; không tạo warehouse table trong schema inventory. |
| Inventory truth | `inventory.inventory_movements`, `inventory.inventory_movement_lines` | Ledger append-only là nguồn sự thật. |
| Balance | `inventory.inventory_balances`, projector trigger, rebuild service | Read model có thể rebuild; controller/UI không được ghi trực tiếp. |
| Reservation | Phase 4.3 reservation aggregate/event history | Available hiện tại là `on_hand - reserved`; negative stock fail closed. |
| Lot/expiry/location policy | `inventory.product_tracking_policies`, `inventory.inventory_lots` | Scope tồn là installation + warehouse + location + base variant + lot. |
| Existing posting | Opening balance, Purchase Receipt, Supplier Return, Delivery Order issue/reversal, Customer Return receive and trip return receive | Mỗi domain sở hữu lifecycle; inventory service chỉ nhận snapshot server-owned. |
| Idempotency | Canonical payload hash + installation-scoped lock/key | Same key + same payload replay; same key + different payload conflict. |
| Audit/outbox | `withAuditOutboxTransaction` | Domain transition, movement, projection, audit và outbox phải cùng transaction. |
| Quantity | fixed-point decimal strings + `BigInt`, DB `numeric` | Không dùng JavaScript floating point cho quantity hoặc money truth. |
| Migration registry | Core migration registry kết thúc ở `057_phase6f_reconciliation_views` | Migration Phase 7 đầu tiên chỉ là candidate `058`; phải re-audit ngay trước slice có migration và 7.0 không giữ số. |
| NPP navigation | Inventory menu hiện nằm trong `npp-core/web/app/components/app-shell-core.tsx` | Không tạo menu thứ hai hoặc shortcut toàn cục. Future UI chỉ sửa một nguồn nav hoặc extract atomically sang module dùng chung. |
| Transfer/stocktake/costing | Không có aggregate/schema/service chính thức trên baseline | Không được suy diễn từ balance hoặc tạo mutation chắp vá. |

Tài liệu Phase 4 đúng path là `docs/operations/phase-4-inventory-foundation-decisions.md`. Path `docs/phase-4-inventory-foundation-decisions.md` trong bàn giao không phải source thật.

## 3. Invariants khóa cho toàn Phase 7

1. Ledger bất biến tiếp tục là nguồn sự thật duy nhất của on-hand.
2. Balance và costing chỉ là read model/reconciliation model có thể dựng lại từ ledger cùng source documents.
3. Không update/delete posted movement; correction dùng reversal hoặc adjustment append-only.
4. Không có API công khai generic cho client tự chọn movement type, direction, snapshot hoặc signed delta.
5. Installation và warehouse scope do server cấp; thiếu scope hoặc sai kho phải fail closed, kể cả idempotent replay.
6. Quantity và money dùng fixed-point exact decimal; không round ngầm và không dùng JS `number` làm nguồn nghiệp vụ.
7. Mọi transition tạo movement phải commit domain row, movement, balance projection, audit và outbox trong một transaction.
8. Retry mutation bắt buộc idempotent; concurrency phải có DB uniqueness/row lock, không chỉ khóa nút frontend.
9. Negative stock tiếp tục bị chặn. Phase 7 không mở exception âm kho nếu chưa có decision riêng và test reconciliation.
10. Lot-tracked SKU giữ nguyên canonical lot/expiry qua transfer, stocktake và adjustment. Không tự thay lô hoặc làm mất lineage.
11. NPP Operations sở hữu thao tác kho hằng ngày. Admin chỉ được duyệt ngoại lệ khi một decision cụ thể yêu cầu; Delivery và MCP không được điều chỉnh tồn/giá vốn.
12. Mọi số tồn hoặc giá vốn hiển thị phải drill-down về movement và chứng từ nguồn.

## 4. Warehouse transfer và in-transit

### 4.1 Aggregate và lifecycle

Transfer là chứng từ inventory-owned, không phải warehouse master và không phải Delivery trip.

```text
DRAFT
  -> APPROVED
  -> DISPATCHED
  -> PARTIALLY_RECEIVED
  -> RECEIVED

DRAFT/APPROVED -> CANCELLED
```

- Không cancel sau `DISPATCHED`.
- Không sửa dòng, kho nguồn, kho đích hoặc lot sau `APPROVED`; thay đổi phải quay về draft bằng transition có audit trước khi dispatch.
- Kho nguồn và kho đích phải khác nhau, cùng installation và nằm trong server-owned warehouse scope của actor.
- Một transfer có nhiều receipt; tổng accepted + damaged + short/variance không được vượt dispatched quantity.

### 4.2 Posting point

- `APPROVED` chỉ khóa nội dung và cấp số chứng từ; chưa đổi tồn.
- `DISPATCHED` post `TRANSFER_ISSUE` Inventory OUT tại exact warehouse/location/lot nguồn.
- Mỗi receipt post `TRANSFER_RECEIPT` Inventory IN chỉ cho quantity thực nhận vào exact warehouse/location/lot đích.
- Outstanding in-transit là projection từ dispatched quantity trừ quantity đã resolved bởi receipts; không tạo warehouse “đang đi đường”, không coi xe là kho và không ghi balance giả.
- Issue và receipt là immutable movements liên kết với cùng transfer/line; không gộp hai thời điểm vật lý thành một movement atomic giả.

### 4.3 Variance/damage

- Receipt ghi riêng accepted, damaged và short quantity; không âm thầm đổi accepted quantity.
- Accepted quantity mới post vào available destination stock.
- Damaged quantity không được đưa vào available stock khi chưa có quarantine disposition slice.
- Short/damaged còn là exception lineage của transfer; close transfer chỉ khi mọi dispatched quantity đã được accepted hoặc có resolution append-only được duyệt.
- Không mở rộng Goods Receipt Phase 5 hoặc Delivery trip để sở hữu transfer.

### 4.4 Reversal

- Transfer issue chỉ được reverse trước khi có receipt/downstream fact và phải trả transfer về trạng thái trước dispatch.
- Transfer receipt chỉ được reverse khi chưa có downstream consumption/disposition của exact receipt lines.
- Sau downstream fact, correction dùng transfer variance/adjustment document, không xóa movement cũ.

## 5. Stocktake, recount, approval và posting

### 5.1 Lifecycle

```text
DRAFT
  -> COUNTED
  -> SUBMITTED
  -> APPROVED
  -> POSTED

SUBMITTED -> RECOUNT_REQUIRED -> COUNTED
DRAFT/COUNTED -> CANCELLED
```

- `DRAFT` chọn warehouse và phạm vi count; chưa đổi tồn.
- `COUNTED` chứa quantity đếm thực tế theo exact location/base variant/lot scope.
- `SUBMITTED` khóa lần đếm; người sửa không được tự approve cùng lần submit.
- `RECOUNT_REQUIRED` mở một count round mới, giữ lịch sử round cũ bất biến.
- `APPROVED` khóa kết quả cuối; chưa được phép sửa quantity.
- `POSTED` là terminal và chỉ đạt sau transaction posting thành công.

### 5.2 Snapshot và concurrency

- Mỗi count round lưu expected on-hand snapshot và ledger watermark/server timestamp tại thời điểm bắt đầu round.
- Khi submit/approve/post, service khóa stocktake và các balance scope liên quan, đồng thời kiểm movement phát sinh sau watermark.
- Nếu scope đã biến động sau snapshot, transition fail với stable conflict và yêu cầu refresh/recount; không lấy số đếm cũ ghi đè movement hợp lệ mới.
- Client không gửi signed adjustment delta hoặc trusted SKU/lot snapshot. Service tính `counted - current_on_hand` bằng exact decimal từ stocktake server-owned.

### 5.3 Posting

- Một stocktake `POSTED` có tối đa một active `STOCKTAKE_ADJUSTMENT` movement.
- Chỉ dòng delta khác zero tạo movement line; zero-delta vẫn được giữ trong stocktake history.
- Nếu toàn bộ delta bằng zero, stocktake vẫn được post terminal với `movement_id = null`, audit/outbox đầy đủ và idempotent replay ổn định.
- Movement dùng:

```text
movement_type          = STOCKTAKE_ADJUSTMENT
source_domain          = INVENTORY
source_document_type   = STOCKTAKE
source_document_id     = stocktake id
source_document_number = stocktake number
reason_code            = STOCKTAKE_POST
```

- Stocktake adjustment không gọi generic client posting route; stocktake service dựng trusted payload nội bộ.

### 5.4 Authorization

Phase 7 stocktake dùng permission tách trách nhiệm:

```text
core.stocktake.read
core.stocktake.create
core.stocktake.count
core.stocktake.submit
core.stocktake.approve
core.stocktake.post
core.stocktake.cancel
```

Tất cả deny-by-default, installation + warehouse scoped. Actor submit không được approve cùng submitted version. Approval threshold đặc biệt chưa được tự đặt; nếu owner muốn threshold theo giá trị/quantity thì mở decision và permission ngoại lệ riêng.

## 6. Manual adjustment, quarantine, damaged và scrap

### 6.1 Manual adjustment

- Không đặt nút “Sửa tồn” trên balance hoặc ledger page.
- Adjustment là document riêng với DRAFT → SUBMITTED → APPROVED → POSTED/CANCELLED.
- Reason code và reason note bắt buộc; request không gửi signed delta trực tiếp.
- Movement dùng `MANUAL_ADJUSTMENT_IN` hoặc `MANUAL_ADJUSTMENT_OUT`, server tính direction và exact delta từ document đã duyệt.
- Approval threshold theo quantity/value vẫn là owner decision; chưa có threshold thì mọi manual adjustment phải có actor approve khác actor submit.

### 6.2 Quarantine/damaged

- Quarantine là disposition trong cùng warehouse/location model, không phải warehouse mới và không phải field sửa trực tiếp trên balance.
- Slice quarantine phải bổ sung location purpose/status có kiểm soát và paired append-only movement từ available location sang quarantine location.
- Quarantine quantity không được dùng cho reservation/allocation. Vì current balance chỉ có on-hand/reserved, availability policy phải exclude quarantine-purpose location ở service/read model; không sửa generated balance bằng tay.

### 6.3 Scrap

- Scrap chỉ post Inventory OUT từ exact available/quarantine location sau document approval.
- Reason, evidence metadata và approver bắt buộc; posted scrap sửa bằng reversal/correction theo downstream gate, không delete.

## 7. Costing boundary

### 7.1 Quyết định chưa được phép tự đoán

Các mục sau vẫn **BLOCKED BY OWNER DECISION**:

1. Costing method: moving weighted average, FIFO hoặc phương pháp khác.
2. Cost source precedence: receipt line price, landed cost allocation, manual opening cost và treatment của zero-cost receipt.
3. Backdated posting policy và period lock.
4. Reversal cost rule theo selected method.
5. Costing currency, precision và rounding boundary.
6. COGS/accounting posting boundary; Phase 7 không tự tạo accounting journal.

Không migration/service/UI costing trước khi một owner decision issue khóa đủ sáu mục trên.

### 7.2 Invariants đã khóa dù chưa chọn method

- Cost projection không được thay inventory quantity ledger.
- Cost event/layer phải tham chiếu immutable movement line và source commercial document line.
- Rebuild/reconcile phải cho cùng kết quả từ cùng ordered event set.
- Backdated event không được silently rewrite closed history.
- Quantity/cost amount dùng exact decimal và rounding chỉ tại boundary được quyết định.
- UI cost drill-down phải dẫn tới movement và source document; không hiển thị số tổng không truy vết được.

## 8. Permission, idempotency, audit/outbox matrix

| Slice | Read | Mutation | Idempotency | Audit/outbox minimum |
| --- | --- | --- | --- | --- |
| Transfer | `core.inventory-transfer.read` | create/update/approve/dispatch/receive/reverse/cancel tách permission | mọi mutation retryable | created, approved, dispatched, partially_received, received, reversed, cancelled |
| Stocktake | `core.stocktake.read` | create/count/submit/approve/post/cancel | mọi mutation retryable; post key gắn stocktake version | created, counted, submitted, recount_required, approved, posted, cancelled |
| Adjustment | `core.inventory-adjustment.read` | create/submit/approve/post/cancel/reverse | mọi mutation retryable | created, approved, posted, reversed, cancelled |
| Costing | permission chỉ được đặt sau owner decision | không có generic client mutation | rebuild/import command idempotent | cost event projected/reconciled; không phát accounting event ngoài boundary |

- Replay không bypass permission/scope hiện tại.
- Same idempotency key + same canonical payload trả kết quả cũ; payload khác trả conflict.
- Unique source document/version/movement constraints chặn double-post ở DB.
- Audit/outbox failure phải rollback domain transition và inventory movement.

## 9. NPP Operations UI boundary

Phase 7.0 không sửa UI. Các slice sau phải giữ bố cục hiện hành:

- Inventory features nằm trong nhóm `Tồn kho & lô hàng` của AppShell.
- Nav có một nguồn duy nhất. Hiện source nằm trong `app-shell-core.tsx`; nếu extract thì làm atomically sang module dùng chung, không để hai danh sách lệch nhau.
- Desktop dùng sidebar hiện tại; mobile dùng menu của top bar/AppShell, không thêm nút menu trong body trang.
- Page header/action row chỉ chứa primary action của đúng màn.
- Transfer actions chỉ ở Transfer screen; Stocktake actions chỉ ở Stocktake screen; Adjustment actions chỉ ở Adjustment screen.
- Balance và Ledger là read/drill-down screen, không có nút “Điều chỉnh tồn”, “Xác nhận kiểm kê” hoặc shortcut mutation rải trong summary card.
- Filter/search/export nằm ở đầu content theo pattern hiện có; mutation buttons theo permission và backend là nơi quyết định cuối.
- Không thêm shortcut toàn cục, không đưa thao tác kho sang Admin, Delivery hoặc MCP.

## 10. Vertical slice plan và dependency

1. **7.1 Transfer foundation** — schema, lifecycle, approve/dispatch, source OUT, in-transit projection.
2. **7.2 Transfer receipts** — partial receive, accepted/short/damaged, destination IN, reversal and reconciliation.
3. **7.3 Stocktake** — count rounds, submit/recount/approve/post, stocktake adjustment.
4. **7.4 Adjustment and disposition** — manual adjustment, quarantine location purpose, damaged resolution, scrap.
5. **7.5 Costing owner decision** — lock method and commercial/accounting boundaries; no mutation implementation.
6. **7.6 Costing foundation** — only after 7.5, build cost events/layers/projection/rebuild.
7. **7.7 Backdate/reversal costing and reconciliation** — only after 7.6.
8. **7.8 Phase 7 production closeout** — separate issue after source merge and explicit rollout command.

Optional vehicle virtual location is not planned. It may only be opened as a separate decision when a proven business requirement cannot be represented by transfer in-transit projection.

## 11. Gate cho từng implementation slice

- migration clean apply, rerun no-op, single and grouped rehearsal;
- PostgreSQL integration for invariant, lock/concurrency and reversal;
- idempotency replay/mismatch and current authorization on replay;
- installation/warehouse/lot scope fail closed;
- exact fixed-point quantity/money tests;
- transaction rollback when audit/outbox fails;
- ledger → balance/in-transit/cost reconciliation;
- Core API full regression;
- NPP web typecheck/build/tests and real browser E2E when UI changes;
- regression for Inventory Ledger, Balance, Reservations, Purchasing, Sales, Delivery and Returns affected by the slice;
- exact-head CI green before merge.

## 12. Production boundary

Phase 7.0 creates documentation and planning only. It does not:

- run migration locally against production or apply migration `058`;
- mutate production database;
- deploy Core, NPP Operations, Admin, Delivery, MCP or Website;
- change provider, DNS, secrets or Auto Deploy;
- merge its own PR.

Before any future production rollout: audit exact SHA/pending migrations/provider, confirm fresh backup and restore rehearsal, reconcile ledger/balance/cost before and after, run the approved migration script, deploy only runtimes with source diff and smoke actual URLs.