# Phase 7.0 — Advanced Inventory and Costing Decision Lock

> Status: **PROPOSED SOURCE DECISION — OWNER LOCK REQUIRED BEFORE RELATED MUTATION**  
> Parent: Issue #328  
> Draft PR: #330  
> Baseline audited: `main@7d4b952db1b4c340b3bfb3e92a1e98f6356e717b`  
> Branch: `agent/phase-7-0-inventory-decision-lock`  
> Scope: audit the existing inventory truth, lock technical invariants, define dependency slices and record the owner decisions that still block implementation.  
> Explicit exclusions: no production migration, no production deploy, no provider change, no MCP change, no inventory mutation endpoint and no NPP UI change.

## 1. Phần này giúp gì cho người dùng

Phase 7.0 chưa thêm nút hay màn hình. Nó khóa cách hệ thống sẽ theo dõi hàng chuyển kho, kiểm kê, điều chỉnh, cách ly, tiêu hủy và giá vốn để các phần sau không tạo sổ kho thứ hai, không ghi đè số tồn và không đặt hành động nghiệp vụ sai chỗ.

Người dùng chỉ thấy tính năng mới sau khi từng vertical slice hoàn thành migration → Core API → NPP Operations UI cần thiết → test → exact-head CI. Admin, Delivery và MCP không sở hữu nghiệp vụ kho hằng ngày.

## 2. Evidence map trên baseline

| Concern | Source hiện tại | Kết luận |
| --- | --- | --- |
| Warehouse/location | `shared.warehouses`, `shared.warehouse_locations`; permission `core.warehouse.*`, `core.warehouse.location.*` | Dùng lại master hiện có; không tạo warehouse table trong schema inventory. |
| Inventory truth | `inventory.inventory_movements`, `inventory.inventory_movement_lines` | Ledger append-only là nguồn sự thật. |
| Balance | `inventory.inventory_balances`, projector trigger, rebuild service | Read model có thể rebuild; controller/UI không được ghi trực tiếp. |
| Reservation | reservation aggregate/event history hiện có | Available hiện tại là `on_hand - reserved`; negative stock fail closed. |
| Lot/expiry/location policy | `inventory.product_tracking_policies`, `inventory.inventory_lots` | Scope tồn là installation + warehouse + location + base variant + lot. |
| Existing posting | Opening Balance, Purchase Receipt, Supplier Return, Delivery Order issue/reversal, Customer Return receive và trip return receive | Mỗi domain sở hữu lifecycle; inventory service chỉ nhận snapshot server-owned. |
| Physical allocation | fulfillment candidate ordering | FEFO khi có expiry, FIFO theo first receipt khi không có expiry; manual override cần permission + reason. |
| Idempotency | canonical payload hash + installation-scoped lock/key | Same key + same payload replay; same key + different payload conflict. |
| Audit/outbox | `withAuditOutboxTransaction` | Domain transition, movement, projection, audit và outbox phải cùng transaction. |
| Quantity | fixed-point decimal strings + `BigInt`, DB `numeric` | Không dùng JavaScript floating point cho quantity hoặc money truth. |
| Migration registry | aggregate registry kết thúc ở `057_phase6f_reconciliation_views` | Migration Phase 7 đầu tiên chỉ là candidate `058`; phải re-audit ngay trước slice có migration và 7.0 không giữ số. |
| NPP navigation | inventory menu nằm trong `npp-core/web/app/components/app-shell-core.tsx` | Không tạo menu thứ hai hoặc shortcut toàn cục; nếu extract nav thì làm atomically sang một source dùng chung. |
| Transfer/stocktake/costing | chưa có aggregate/schema/service chính thức trên baseline | Không được suy diễn từ balance hoặc tạo mutation chắp vá. |

Tài liệu Phase 4 đúng path là `docs/operations/phase-4-inventory-foundation-decisions.md`. Path `docs/phase-4-inventory-foundation-decisions.md` trong bàn giao không phải source thật.

## 3. Invariants khóa cho toàn Phase 7

1. Ledger bất biến tiếp tục là nguồn sự thật duy nhất của on-hand.
2. Balance, in-transit và costing chỉ là read/reconciliation model có thể dựng lại từ ledger cùng source documents.
3. Không update/delete posted movement; correction dùng reversal hoặc adjustment append-only.
4. Không có API công khai generic cho client tự chọn movement type, direction, trusted snapshot hoặc signed ledger delta.
5. Installation và warehouse scope do server cấp; thiếu scope hoặc sai kho phải fail closed, kể cả idempotent replay.
6. Quantity và money dùng fixed-point exact decimal; không round ngầm và không dùng JS `number` làm nguồn nghiệp vụ.
7. Mọi transition tạo movement phải commit domain row, movement, projection, audit và outbox trong một transaction.
8. Retry mutation bắt buộc idempotent; concurrency phải có DB uniqueness/row lock/version, không chỉ khóa nút frontend.
9. Negative stock tiếp tục bị chặn. Phase 7 không mở exception âm kho nếu chưa có decision riêng và test reconciliation.
10. Lot-tracked SKU giữ nguyên canonical lot/expiry qua transfer, stocktake và adjustment. Không tự thay lô hoặc làm mất lineage.
11. NPP Operations sở hữu thao tác kho hằng ngày. Admin chỉ duyệt ngoại lệ khi một decision cụ thể yêu cầu; Delivery và MCP không được điều chỉnh tồn/giá vốn.
12. Mọi số tồn hoặc giá vốn hiển thị phải drill-down về movement và chứng từ nguồn.

## 4. Warehouse transfer và in-transit — proposed owner contract

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
- Không sửa dòng, kho nguồn, kho đích hoặc lot sau `APPROVED`. Nếu nội dung sai thì cancel trước dispatch và tạo draft mới có lineage; không có transition quay ngược để sửa âm thầm.
- Kho nguồn và kho đích phải khác nhau, cùng installation và nằm trong server-owned warehouse scope của actor.
- Một transfer có nhiều receipt.
- Trên mỗi dispatched line, tổng quantity đã accepted + damaged resolution + short resolution không được vượt dispatched quantity. Excess được ghi riêng để xử lý, không cộng lẫn hoặc tự nhận vào kho.

### 4.2 Posting point

- `APPROVED` chỉ khóa nội dung và cấp số chứng từ; chưa đổi tồn.
- `DISPATCHED` post `TRANSFER_ISSUE` Inventory OUT tại exact warehouse/location/lot nguồn.
- Mỗi receipt post `TRANSFER_RECEIPT` Inventory IN chỉ cho quantity thực nhận vào exact warehouse/location/lot đích.
- Outstanding in-transit là projection từ dispatched quantity trừ quantity đã được receipt/resolution xử lý; không tạo warehouse “đang đi đường”, không coi xe là kho và không ghi balance giả.
- Issue và receipt là immutable movements liên kết với cùng transfer/line; không gộp hai thời điểm vật lý thành một movement atomic giả.

### 4.3 Variance/damage

- Receipt ghi riêng accepted, damaged, short và excess; không âm thầm đổi accepted quantity.
- Accepted quantity mới post vào available destination stock.
- Trước khi Phase 7.4 có quarantine/disposition foundation, damaged quantity vẫn là unresolved transfer exception và không được đưa vào available stock.
- Sau Phase 7.4, damaged quantity chỉ được nhận vào exact non-available quarantine/damaged location bằng movement có lineage.
- Transfer chỉ đóng khi toàn bộ dispatched quantity đã được accepted hoặc có resolution append-only được duyệt.
- Không mở rộng Goods Receipt Phase 5 hoặc Delivery trip để sở hữu transfer.

### 4.4 Reversal

- Transfer issue chỉ được reverse trước khi có receipt/downstream fact và phải trả transfer về trạng thái trước dispatch theo transition có audit.
- Transfer receipt chỉ được reverse khi chưa có downstream consumption/disposition của exact receipt lines.
- Sau downstream fact, correction dùng transfer variance/adjustment document, không xóa movement cũ.

## 5. Stocktake, recount, approval và posting — proposed owner contract

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
- `SUBMITTED` khóa lần đếm; người submit không được tự approve cùng submitted version.
- `RECOUNT_REQUIRED` mở một count round mới, giữ lịch sử round cũ bất biến.
- `APPROVED` khóa kết quả cuối; chưa được phép sửa quantity.
- `POSTED` là terminal và chỉ đạt sau transaction posting thành công.

### 5.2 Snapshot và concurrency

- Mỗi count round lưu expected on-hand snapshot và một DB-owned stable scope version/watermark tại thời điểm bắt đầu round.
- Timestamp đơn lẻ không đủ làm concurrency token. Nếu schema hiện tại chưa có monotonic scope version/watermark thì Phase 7.3 phải bổ sung invariant đó trước mutation.
- Khi submit/approve/post, service khóa stocktake và các inventory scope theo deterministic order, rồi so version/watermark hiện tại với snapshot.
- Nếu scope đã biến động, transition fail bằng stable conflict và yêu cầu refresh/recount; không lấy số đếm cũ ghi đè movement hợp lệ mới.
- Client không gửi trusted SKU/lot snapshot hoặc signed ledger delta. Service tính `counted - current_on_hand` bằng exact decimal từ dữ liệu server-owned.

### 5.3 Posting

- Một stocktake `POSTED` có tối đa một active `STOCKTAKE_ADJUSTMENT` movement.
- Chỉ dòng delta khác zero tạo movement line; zero-delta vẫn được giữ trong stocktake history.
- Nếu toàn bộ delta bằng zero, stocktake vẫn post terminal với `movement_id = null`, audit/outbox đầy đủ và idempotent replay ổn định.
- Movement dùng vocabulary đã được Phase 4 dự liệu:

```text
movement_type          = STOCKTAKE_ADJUSTMENT
source_domain          = INVENTORY
source_document_type   = STOCKTAKE
source_document_id     = stocktake id
source_document_number = stocktake number
reason_code            = STOCKTAKE_POST
```

- Stocktake service dựng trusted payload nội bộ; không gọi generic client posting route.

### 5.4 Authorization

```text
core.stocktake.read
core.stocktake.create
core.stocktake.count
core.stocktake.submit
core.stocktake.approve
core.stocktake.post
core.stocktake.cancel
```

Tất cả deny-by-default, installation + warehouse scoped. Approval threshold đặc biệt chưa được tự đặt; nếu owner muốn threshold theo giá trị/quantity thì khóa trong decision riêng.

## 6. Manual adjustment, quarantine, damaged và scrap — proposed owner contract

### 6.1 Manual adjustment

- Không đặt nút “Sửa tồn” trên Balance hoặc Ledger page.
- Adjustment là document riêng: `DRAFT -> SUBMITTED -> APPROVED -> POSTED/CANCELLED`.
- Reason code và reason note bắt buộc.
- UI gửi business intent tăng/giảm cùng positive quantity; service dựng `MANUAL_ADJUSTMENT_IN` hoặc `MANUAL_ADJUSTMENT_OUT` và signed ledger delta từ document đã duyệt.
- Nếu chưa có threshold được owner khóa thì mọi manual adjustment cần approver khác submitter.
- Lỗi transfer/receipt/issue/return dùng reversal của domain đó, không lạm dụng generic adjustment.

### 6.2 Quarantine/damaged

- Quarantine là disposition trong cùng warehouse/location model, không phải warehouse mới và không phải field sửa trực tiếp trên balance.
- Phase 7.4 bổ sung location purpose/status có kiểm soát và paired append-only movement từ available location sang quarantine location.
- Quarantine quantity không được dùng cho reservation/allocation. Availability policy phải exclude quarantine-purpose location ở service/read model; không sửa generated balance bằng tay.

### 6.3 Scrap

- Scrap chỉ post Inventory OUT từ exact available/quarantine location sau document approval.
- Reason, evidence metadata và approver bắt buộc; posted scrap sửa bằng reversal/correction theo downstream gate, không delete.

## 7. Costing boundary

### 7.1 Quyết định chưa được phép tự đoán

Các mục sau vẫn **BLOCKED BY OWNER DECISION** trong Issue #335:

1. Costing method: moving weighted average, FIFO hoặc phương pháp khác.
2. Cost source precedence: receipt line price, landed cost allocation, manual opening cost và treatment của zero-cost receipt.
3. Backdated posting policy và period lock.
4. Reversal cost rule theo selected method.
5. Costing currency, precision và rounding boundary.
6. COGS/accounting posting boundary; Phase 7 không tự tạo accounting journal.

Không migration/service/UI costing trước khi #335 khóa đủ sáu mục trên.

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
| Stocktake | `core.stocktake.read` | create/count/submit/approve/post/cancel tách permission | mọi mutation retryable; post key gắn stocktake version | created, counted, submitted, recount_required, approved, posted, cancelled |
| Adjustment | `core.inventory-adjustment.read` | create/submit/approve/post/cancel/reverse tách permission | mọi mutation retryable | created, approved, posted, reversed, cancelled |
| Costing | permission chỉ đặt sau #335 | không có generic client mutation | rebuild/import command idempotent | cost event projected/reconciled; không phát accounting event ngoài boundary |

- Replay không bypass permission/scope hiện tại.
- Same idempotency key + same canonical payload trả kết quả cũ; payload khác trả conflict.
- Unique source document/version/movement constraints chặn double-post ở DB.
- Affected document rows và inventory scopes phải lock theo deterministic order.
- Audit/outbox failure phải rollback domain transition và inventory movement.

## 9. NPP Operations UI boundary

Phase 7.0 không sửa UI. Các slice sau phải giữ bố cục hiện hành:

- Inventory features nằm trong nhóm `Tồn kho & lô hàng` của AppShell.
- Nav có một nguồn duy nhất. Hiện source nằm trong `app-shell-core.tsx`; nếu extract thì làm atomically sang module dùng chung, không để hai danh sách lệch nhau.
- Desktop dùng sidebar hiện tại; mobile dùng menu của top bar/AppShell, không thêm nút menu trong body trang.
- Page header/action row chỉ chứa primary action của đúng màn.
- Transfer actions chỉ ở Transfer screen; Stocktake actions chỉ ở Stocktake screen; Adjustment actions chỉ ở Adjustment screen.
- Balance và Ledger là read/drill-down screen, không có nút “Điều chỉnh tồn”, “Xác nhận kiểm kê” hoặc shortcut mutation rải trong summary card.
- Filter/search/export nằm ở đầu content theo pattern hiện có.
- Primary action không xuất hiện lặp lại ở header, card và mobile body.
- Nút theo permission để hiển thị đúng, nhưng backend vẫn là nơi quyết định cuối.
- Không thêm shortcut toàn cục, không đưa thao tác kho sang Admin, Delivery hoặc MCP.

## 10. Vertical slice plan và dependency

1. **7.1 Transfer foundation — #331**: schema, lifecycle, approve/dispatch, source OUT, in-transit projection.
2. **7.2 Transfer receipts — #332**: partial receive, accepted/short/damaged/excess, destination IN, reversal và reconciliation. Depends on #331.
3. **7.3 Stocktake — #333**: count rounds, submit/recount/approve/post, stable scope version và stocktake adjustment.
4. **7.4 Adjustment/disposition — #334**: manual adjustment, quarantine location purpose, damaged resolution, scrap.
5. **7.5 Costing owner decision — #335**: khóa method, cost source, backdate, reversal, precision và Accounting boundary; không implementation mutation.
6. **7.6 Costing foundation — #336**: chỉ sau #335, xây cost events/layers/projection/rebuild theo method đã chọn.
7. **7.7 Backdate/reversal costing — #337**: chỉ sau #336, triển khai period rule, rebuild và reconciliation.
8. **7.8 Production closeout — #338**: chỉ sau source merge và lệnh rollout production rõ ràng.

Optional vehicle virtual location không nằm trong plan. Chỉ mở decision riêng nếu có nhu cầu nghiệp vụ thật mà in-transit projection không biểu diễn được.

## 11. Gate cho từng implementation slice

- re-audit exact main, open PR/branch và migration registry trước khi tạo branch;
- migration clean apply, rerun no-op, single và grouped rehearsal;
- PostgreSQL integration cho invariant, lock/concurrency và reversal;
- idempotency replay/mismatch và current authorization trên replay;
- installation/warehouse/location/lot scope fail closed;
- exact fixed-point quantity/money tests;
- transaction rollback khi audit/outbox fail;
- ledger → balance/in-transit/cost reconciliation;
- Core API full regression;
- NPP web typecheck/build/tests và real browser E2E khi có UI diff;
- regression cho Inventory Ledger, Balance, Reservations, Purchasing, Sales, Delivery và Returns bị ảnh hưởng;
- exact-head CI xanh trước merge.

## 12. Owner lock còn cần

Trước khi mở mutation của từng nhóm, owner cần xác nhận hoặc chỉnh:

- [ ] Transfer lifecycle/posting/in-transit/variance contract ở mục 4.
- [ ] Stocktake lifecycle, stable scope version, recount, approval và posting ở mục 5.
- [ ] Manual adjustment approval, quarantine/damaged và scrap contract ở mục 6.
- [ ] Sáu quyết định costing trong #335 trước Phase 7.6/7.7.
- [ ] Giữ negative stock fail closed và không dùng vehicle virtual location trong initial Phase 7.

Khi owner khóa một nhóm, child issue liên quan mới được bỏ trạng thái blocked. Không cần chờ toàn bộ costing để triển khai transfer/stocktake nếu quyết định của chính slice đó đã được khóa và dependency đã đủ.

## 13. Production boundary

Phase 7.0 tạo tài liệu và planning only. Nó không:

- run hoặc apply migration `058`;
- mutate production database;
- deploy Core, NPP Operations, Admin, Delivery, MCP hoặc Website;
- change provider, DNS, secrets hoặc Auto Deploy;
- merge PR #330.

Trước mọi rollout tương lai: audit exact SHA/pending migrations/provider, xác nhận fresh shared-database backup và restore rehearsal, reconcile ledger/balance/in-transit/cost trước và sau, chạy script migration được duyệt, deploy đúng runtime có source diff và smoke URL thật.
