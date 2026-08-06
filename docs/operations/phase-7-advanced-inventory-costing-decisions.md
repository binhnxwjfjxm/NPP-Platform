# Phase 7 — Advanced Inventory and Costing Decisions

> Status: **PHASE 7.0 DECISION GATE**  
> Parent: Issue #328  
> Branch: `agent/phase-7-inventory-costing-decisions`  
> Base audited: `main@bde849a07d44b255cf1907350f7351ca3f86130c`  
> Scope: audit, source map, locked invariants, unresolved owner decisions and vertical-slice dependencies only.  
> Explicit exclusions: no production mutation, no production migration, no deploy, no MCP changes and no Phase 7 business UI yet.

## 1. Người dùng nhận được gì sau Phase 7

Phase 7 bổ sung nghiệp vụ kho nâng cao trong **NPP Operations**: chuyển kho có hàng đang đi đường, nhận một phần/chênh lệch/hư hỏng, kiểm kê có duyệt và ghi sổ, điều chỉnh/cách ly/tiêu hủy có chứng từ, cùng giá vốn có thể truy ngược về movement nguồn.

Phase 7.0 chưa thêm màn hình hay nút nghiệp vụ. Mục đích là khóa đúng nguồn sự thật và lifecycle trước khi tạo mutation, tránh làm sai cấu trúc app hoặc phải sửa lại dữ liệu sau này.

Không thay đổi MCP, Delivery, Admin hoặc Website trong Phase 7.0.

## 2. Evidence boundary

Đã audit các nguồn hiện hành sau:

```text
NPP_PLATFORM_MASTER_PLAN.md
docs/operations/master-plan-frontend-runtime-addendum.md
docs/operations/phase-4-inventory-foundation-decisions.md
Issue #284
Issue #290
Issue #327
Issue #328
database/migrations/**
npp-core/api/src/migrations/index.js
npp-core/api/src/request-context.js
npp-core/api/src/access/permissions.js
npp-core/api/src/audit-outbox.js
inventory posting, balance, reservation and reversal source/tests hiện hành
NPP Operations AppShell/menu và các trang inventory hiện hành
```

Exact `main` khi mở Phase 7.0 là `bde849a07d44b255cf1907350f7351ca3f86130c`. Commit này chỉ hoàn tất MCP UI #327 trên parent `7d4b952...`; Phase 7 vẫn độc lập.

## 3. Source-of-truth map

| Concern | Source of truth | Read model / UI | Quy tắc Phase 7 |
|---|---|---|---|
| Tồn thực tế | Immutable inventory movement + movement lines | Inventory balances, dashboards, exports | Không ghi balance trực tiếp; mọi số phải drill-down về movement và chứng từ nguồn |
| Đảo nghiệp vụ | New reversal movement referencing original | Derived reversed state | Không sửa/xóa movement đã post; một movement chỉ được reverse một lần |
| Giữ hàng | Reservation/allocation lifecycle | Available quantity | Consume/release phải cùng transaction với posting liên quan và fail closed theo scope |
| Nhập hàng | Goods Receipt document lifecycle | Receipt screens/reports | Phase 7 chỉ bổ sung transfer receive/variance/damage; không làm lại Phase 5 |
| Xuất giao | Delivery/inventory issue lifecycle | Delivery/order projections | Delivery không được tự điều chỉnh tồn hoặc giá vốn |
| Trả NCC | Supplier Return + inventory issue/reversal | Return screens | Dùng posting service hiện hữu, không tạo ledger riêng |
| Khách trả | Customer Return + inventory receipt/reversal | Return screens | Dùng posting service hiện hữu, không tạo ledger riêng |
| Giá vốn | **Chưa có source chính thức cho đến khi owner chọn phương pháp** | Cost projection/reconciliation tương lai | Không suy đoán moving average/FIFO; chưa tạo costing mutation |
| Audit/outbox | Transactional audit + outbox | Audit/reporting projections | Mutation + movement + audit + outbox cùng transaction |
| Installation/warehouse scope | Server-owned request context + authorization | Permission-gated UI | Backend quyết định cuối; thiếu scope thì fail closed |

## 4. Locked technical invariants

Các điểm sau được khóa, không cần hỏi lại ở từng slice:

1. Inventory ledger hiện hành là nguồn sự thật duy nhất; không tạo ledger thứ hai.
2. Balance và costing projection là read model có thể rebuild/reconcile.
3. Posted movement bất biến; sửa sai bằng reversal hoặc adjustment append-only.
4. Không ghi trực tiếp tồn kho từ controller, import, UI, Delivery hoặc MCP.
5. Negative stock mặc định fail closed. Chỉ thay đổi khi có decision riêng và invariant DB/test tương ứng.
6. Quantity và money dùng decimal/fixed-point chính xác; JavaScript float không được làm nguồn nghiệp vụ.
7. Installation ID và warehouse scope do server sở hữu; permission thiếu hoặc sai scope phải từ chối.
8. Retry mutation phải idempotent: cùng key+cùng payload trả kết quả cũ; cùng key+khác payload trả conflict.
9. Mutation, inventory movement, audit và outbox phải commit/rollback cùng transaction.
10. Concurrency phải được bảo vệ bằng DB invariant/locking, không chỉ kiểm tra ở UI.
11. Phase 7 thuộc NPP Operations/Core. MCP không sở hữu tồn kho hay giá vốn.
12. Delivery chỉ thực hiện giao nhận theo Core; không trở thành màn điều chỉnh tồn hoặc costing.
13. Admin chỉ xem tổng hợp/cảnh báo hoặc duyệt ngoại lệ khi decision quy định; không thay NPP CRUD hằng ngày.
14. Không coi xe là kho. Vehicle virtual location chỉ được mở bằng decision và issue riêng khi có nhu cầu thật.
15. Không code mutation hoặc UI nghiệp vụ trước khi lifecycle, posting point, reversal và permission của slice được khóa.

## 5. Transfer contract — phần đã khóa

- Transfer là chứng từ nghiệp vụ riêng; inventory ledger chỉ chứa facts đã post.
- Không dùng một movement instant source→destination vì Phase 7 yêu cầu theo dõi in-transit.
- Khi dispatch được post, hàng rời on-hand của kho nguồn và đi vào **in-transit inventory scope**.
- Khi receive được post, lượng thực nhận rời in-transit và vào kho/location đích.
- Partial receive giữ phần còn lại ở in-transit cho đến khi receive tiếp, close variance hoặc xử lý damage theo lifecycle đã duyệt.
- Source dispatch và destination receive là các posting point bất biến, idempotent và có chứng từ nguồn.
- Không dùng vehicle làm location mặc định. In-transit phải là inventory-owned scope/location policy có định danh ổn định, không phụ thuộc xe/tài xế.
- Reverse dispatch chỉ được phép khi chưa có downstream receive/variance/damage; nếu đã phát sinh downstream thì dùng forward correction theo lifecycle.

### Quyết định còn cần owner khóa trước slice receive

- Ai được close phần thiếu cuối cùng và ngưỡng nào cần duyệt ngoại lệ.
- Chênh lệch thiếu/thừa và hư hỏng đi vào reason/status/location nào.
- Cho phép thay đổi kho đích sau dispatch hay luôn cấm.

## 6. Stocktake contract — phần đã khóa

- Stocktake draft là chứng từ riêng, không phải ledger movement.
- Số hệ thống phải snapshot theo scope tại thời điểm bắt đầu/khóa đếm.
- Nhập số đếm và recount không làm thay đổi tồn.
- Chỉ hành động **Confirm/Post** được ủy quyền mới tạo một `STOCKTAKE_ADJUSTMENT` append-only.
- Adjustment phải lưu liên kết stocktake, số hệ thống snapshot, số đếm cuối, chênh lệch, reason và actor.
- Confirm phải idempotent và chống double-post bằng DB invariant.
- Sau confirm, stocktake bất biến; sửa sai bằng reversal/stocktake correction mới, không sửa movement cũ.
- NPP Operations là nơi nhân viên kho lập và thực hiện kiểm kê. Admin chỉ có thể duyệt ngoại lệ nếu ngưỡng duyệt được owner bật.

### Quyết định còn cần owner khóa trước mutation

- Có bắt buộc blind count hay hiển thị số hệ thống cho người đếm.
- Số vòng recount tối đa và vai trò được chốt số cuối.
- Ngưỡng chênh lệch theo số lượng/giá trị cần duyệt.
- Có khóa mutation khác trong scope đang kiểm kê hay dùng snapshot + reconciliation.

## 7. Manual adjustment, quarantine, damaged và scrap

Đã khóa:

- Mọi adjustment phải có reason code; note bắt buộc với reason yêu cầu giải trình.
- Adjustment không phải đường tắt để sửa trực tiếp balance hay né document lifecycle.
- Quarantine/damaged là trạng thái hoặc location policy trong inventory scope; không làm mất dấu hàng.
- Scrap là issue movement bất biến từ scope phù hợp, có reason, permission và chứng từ nguồn.
- Tách quyền tạo draft và quyền approve/post khi vượt ngưỡng.

Còn cần owner khóa:

- Danh mục reason chính thức.
- Ngưỡng số lượng/giá trị yêu cầu duyệt.
- Quarantine dùng dedicated location, stock status hay kết hợp cả hai.
- Damaged có được chuyển lại available sau kiểm tra hay chỉ scrap/return.

## 8. Lot, expiry và FEFO

- Giữ inventory scope hiện hành theo warehouse/location/base SKU/lot khi áp dụng.
- Lot/expiry phải theo product tracking policy, không do client tự chọn.
- Phase 7 không được làm mất historical snapshot lot/expiry trên movement line.
- FEFO chỉ là allocation policy; ledger vẫn ghi lot thực tế đã post.

Cần owner khóa trước khi thêm luồng mới:

- SKU nào bắt buộc lot, expiry hoặc cả hai.
- FEFO là bắt buộc hay warning/override có permission.
- Cách xử lý hàng hết hạn trong transfer, stocktake, quarantine và scrap.

## 9. Costing gate

Costing chưa được phép triển khai cho đến khi owner chọn rõ:

1. Phương pháp giá vốn: moving weighted average, FIFO hoặc phương pháp khác được mô tả chính xác.
2. Phạm vi pool: installation, warehouse hay location/lot.
3. Quy tắc backdated receipt/issue.
4. Reversal dùng historical layer/cost hay tái tính tại ngày reversal.
5. Negative-stock exception có tồn tại hay không.
6. Cách xử lý freight/landed cost, variance và rounding.
7. Reconciliation và kỳ khóa giá vốn.

Cho đến khi khóa đủ, ledger quantity vẫn hoạt động theo contract hiện hành nhưng không phát sinh costing entry giả định.

## 10. NPP Operations information architecture

Khi các slice sau thêm UI:

- Tất cả chức năng Phase 7 nằm trong nhóm menu **`Tồn kho & lô hàng`**.
- Danh sách/chứng từ là route chuẩn; không tạo shortcut toàn cục thay menu nghiệp vụ.
- Hành động chính nằm ở `PageHeader`/action row chuẩn của trang.
- Bộ lọc nằm đầu vùng nội dung; apply/reset/export theo pattern hiện có.
- Nút mutation không được rải trong KPI/card tổng hợp.
- Nút hiển thị theo permission, nhưng backend vẫn fail closed.
- Desktop-first, responsive; mobile không tràn ngang và không giấu hành động quan trọng trong bố cục ngẫu nhiên.

Bố cục dự kiến:

```text
Tồn kho & lô hàng
├── Tồn kho
├── Sổ kho
├── Giữ hàng
├── Chuyển kho
├── Kiểm kê
└── Điều chỉnh & cách ly   (chỉ mở khi slice tương ứng đạt gate)
```

Không thêm menu giá vốn như một CRUD hằng ngày. Costing thuộc báo cáo/đối soát có permission sau khi contract được khóa.

## 11. Vertical-slice plan và dependency

1. **7.1 Transfer dispatch + in-transit foundation**  
   Migration → posting service → API → NPP list/detail/create/dispatch → integration/E2E.
2. **7.2 Transfer receive + partial/variance/damage**  
   Phụ thuộc 7.1; không làm lại Goods Receipt.
3. **7.3 Stocktake draft + count/recount/confirm**  
   Phụ thuộc source map và permission/approval decisions.
4. **7.4 Manual adjustment + quarantine/scrap**  
   Phụ thuộc reason catalog và approval thresholds.
5. **7.5 Costing foundation**  
   Chỉ bắt đầu sau owner costing decision.
6. **7.6 Backdated/reversal costing + reconciliation**  
   Phụ thuộc 7.5 và kỳ khóa/reconciliation policy.
7. **7.7 Optional vehicle virtual location**  
   Không mở mặc định; chỉ tạo nếu có nhu cầu nghiệp vụ được chứng minh.
8. **Phase 7 production closeout**  
   Issue riêng sau source merge và khi owner ra lệnh rollout.

Mỗi slice dùng branch riêng, migration/backend/NPP UI/tests/CI/PR riêng. Không gộp thành một PR lớn.

## 12. Migration and production boundary

- Phase 7.0 không tạo migration.
- Migration ID tiếp theo phải lấy từ registry/migration runner thật tại exact `main` của slice, không đoán từ issue bàn giao.
- Clean apply, rerun no-op, rehearsal và grouped rehearsal là gate bắt buộc khi có migration.
- Không chạy production migration, không deploy Vercel/Heroku và không thay provider trong Phase 7.0.
- Production rollout sau này phải audit exact SHA, pending migrations, backup, restore rehearsal, pre/post reconciliation, runtime diff và smoke thực tế.

## 13. Acceptance gate Phase 7.0

Phase 7.0 đạt source gate khi:

- decision document này tồn tại trên branch riêng;
- source-of-truth, lifecycle, posting point, reversal, permissions, scope và runtime boundary được ghi rõ;
- các business decision chưa có được đánh dấu thật, không tự bịa;
- child issues được tạo theo dependency;
- diff chỉ thuộc tài liệu/issue Phase 7.0;
- MCP #327 vẫn độc lập;
- không có deploy hoặc migration production.
