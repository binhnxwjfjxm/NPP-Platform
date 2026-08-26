# Issue #791 — Lô A: quyết định nghiệp vụ và ranh giới triển khai

> Trạng thái: **LOCKED FOR IMPLEMENTATION — 2026-08-26**  
> Tracking issue: #791  
> Audited baseline: `main@fbadefd192c341afa950abb1dcd471f7c4ba4ce1`  
> Mục tiêu của tài liệu này: khóa contract trước khi thay đổi giao diện, database và luồng Kho. Tài liệu **không** tự cho phép merge, deploy hay migration production.

## 1. Sự thật tại baseline

- PR #790 đã merge vào `main` bằng commit `fbadefd192c341afa950abb1dcd471f7c4ba4ce1` và đã xử lý việc tải đủ danh mục sản phẩm theo phân trang. Issue #791 không làm lại phần này.
- Exact-head CI của baseline không có workflow thất bại trong đợt kiểm tra Lô A; các gate chính gồm Browser E2E, migration rehearsal, grouped migration rehearsal và cross-domain integration đã hoàn tất thành công.
- Open PR cần tránh đè code:
  - #234: điều hướng Bán hàng, không phải contract lập đơn nhanh;
  - #717: MCP dùng khách Công Ty có sẵn, không đổi manual Sales Order fast-entry;
  - #643: nhánh cũ của Issue #633. Ý tưởng `is_inventory_managed` đã có trên current `main` bằng migration `093_product_inventory_management_policy`; không lấy migration/numbering cũ của #643 để làm lại;
  - #480: tài liệu handoff cũ, không chứa business code cần dùng cho #791.
- Current migration registry đã đi qua `113_ai_dialogflow_cx_request_billing`. **Không giữ trước số migration** cho Lô D hoặc Lô F; khi đến từng lô phải audit registry lại.

## 2. Reconcile các issue lịch sử

### #736 — hàng chưa có giá / giá nhập tay

Giữ các invariant còn đúng:

- SKU có giá hệ thống vẫn giữ price fingerprint/concurrency guard;
- `BASE_PRICE_NOT_FOUND` phải được phân biệt với lỗi kỹ thuật;
- dữ liệu tiền từ DB/API phải được chuẩn hóa đúng khi mở lại đơn.

Owner decision mới trong #791 **thay thế** phần xung đột:

- người có quyền sửa giá không phải mở panel giá ngoại lệ;
- không bắt nhập lý do cho mỗi lần sửa giá;
- giá được sửa trực tiếp tại ô Đơn giá và hệ thống tự audit.

### #622 — Giao thủ công

Giữ các invariant:

- trước Xuất kho, quick edit chỉ hoạt động trong lifecycle/permission đã cho phép;
- sau Xuất kho không sửa đè dòng hàng đã ghi sổ;
- In chỉ là presentation, không làm thay đổi tồn/trạng thái/tiền;
- Inventory Ledger, tracking, idempotency và audit vẫn là nguồn sự thật.

Owner decision mới trong #791 **thay thế duy nhất** hard rule “không cho âm kho trong mọi trường hợp”: hệ thống được bổ sung ngoại lệ xuất âm có kiểm soát, mặc định vẫn cấm.

### #637 — phiếu in / tồn kho / UI

#791 chỉ sửa phiếu in Đơn bán hàng và contract liên quan tới lập đơn nhanh. Không mở rộng thành redesign toàn bộ hệ thống mẫu in, kiểm kê, điều chỉnh tồn hay các màn khác của #637.

## 3. Contract Lô B — Tìm hàng nhanh: Giá / Tồn / Khả dụng

### 3.1 Không tạo nguồn dữ liệu thứ hai ở browser

Thanh tìm hàng nhanh tiếp tục dùng Sales Order entry/search contract hiện tại nhưng phải được mở rộng server-side. Browser không được:

- tải danh mục rồi tự nối Giá/Kho;
- gọi một request giá + một request tồn cho từng kết quả;
- tự tính “Có thể bán” từ dữ liệu rời.

Backend phải trả một search option đã được enrich theo ngữ cảnh lập đơn.

### 3.2 Ngữ cảnh tìm kiếm bắt buộc

Request tìm nhanh phải có ngữ cảnh tối thiểu đủ để backend quyết định đúng:

- `warehouseId` đang chọn;
- `salesChannelId` đang chọn;
- customer context hiện tại nếu có;
- thời điểm giá đang dùng cho đơn;
- search term + limit/offset theo contract hiện hữu.

`installationId`, permission và warehouse scope vẫn do server sở hữu.

### 3.3 “Bảng giá / Kênh giá” trên giao diện

Trong source hiện tại, Sales Order đã có `salesChannelId`, pricing engine tự phân giải bảng giá/rule theo khách + kênh + SKU + số lượng + hiệu lực. Vì vậy Lô B dùng **kênh bán/nguồn giá hiện có** làm bộ chọn cạnh ô tìm kiếm.

Không tạo một price-list selector thứ hai cho phép browser ép `priceListId` nếu pricing engine hiện không có contract đó.

Nếu source tại thời điểm Lô B đã có canonical selector khác, audit và reuse; không xây song song.

### 3.4 Giá trong search result

- Giá preview dùng quantity = `1` và pricing context hiện tại.
- Có giá hợp lệ: trả giá để người dùng nhìn trước khi Add.
- Không có giá nền: trả trạng thái `Chưa có giá`, **không** giả `0đ`.
- User có `core.sales-order.price.override` vẫn được Add SKU chưa có giá rồi nhập giá trực tiếp, kể cả `0`.
- SKU có giá hệ thống vẫn dùng fingerprint/expected-price guard khi lưu/chốt.

### 3.5 Tồn và Khả dụng

Hiển thị hai số có nghĩa khác nhau:

- **Tồn** = on-hand canonical của SKU tồn cơ sở tại kho đang chọn.
- **Khả dụng / Có thể bán** = lượng còn có thể dành cho thao tác mới sau khi trừ các giữ chỗ/reservation/fulfillment demand đang hiệu lực theo logic Kho hiện hành.

Phải lấy từ read model/repository Kho canonical. Không dùng giá trị browser cache làm nguồn quyết định.

Đối với sản phẩm `is_inventory_managed = false`:

- không hiển thị `Tồn 0` như thể hết hàng;
- hiển thị trạng thái văn phòng rõ nghĩa, ví dụ **`Không quản lý tồn`**;
- không tạo fulfillment demand hoặc Inventory movement chỉ để phục vụ UI.

### 3.6 Presentation

Search result mục tiêu:

```text
Tên sản phẩm                         30.000 ₫
SKU A001                             Tồn 12
                                     Khả dụng 10
```

Tên sản phẩm là primary text; SKU nhỏ hơn. Product code/variant/unit/barcode chỉ hiển thị phụ khi cần, không lấn thông tin quyết định nhanh.

### 3.7 Focus

Sau Add:

- focus vào ô Số lượng của **dòng vừa tạo**;
- focus/click vào Số lượng select toàn bộ giá trị hiện tại;
- không tự trả focus về ô tìm hàng cho tới khi flow số lượng hoàn tất.

Điều này yêu cầu mỗi draft line có client identity riêng; không dùng `variantId` làm React key duy nhất sau khi hỗ trợ trùng SKU.

## 4. Contract Lô C — Đơn giá trực tiếp theo quyền

### 4.1 Permission

Reuse key hiện có:

`core.sales-order.price.override`

User-facing label mục tiêu: **`Sửa giá bán trên đơn`**.

Không suy quyền từ tên Role. Backend tiếp tục authorize theo permission thật.

### 4.2 Người có quyền

Ô `Đơn giá` là control nhập trực tiếp:

```text
focus -> select all -> nhập giá -> Enter/Tab -> hoàn tất
```

Cho phép số tiền VND không âm, bao gồm `0`.

Không có:

- nút `Nhập giá bán` / `Sửa giá` để bật editor;
- panel `Dùng giá ngoại lệ`;
- field lý do bắt buộc;
- nút `Xong` riêng chỉ để áp giá.

### 4.3 Người không có quyền

- nhìn thấy giá;
- ô giá read-only;
- direct API override vẫn bị backend từ chối.

### 4.4 Bỏ `manualReason` bắt buộc nhưng không bỏ audit

Backend hiện yêu cầu lý do khi `manualUnitPriceMinor` được gửi. Lô C phải sửa contract frontend + backend đồng bộ để permission đủ điều kiện sửa giá mà **không** cần người dùng nhập lý do.

Audit tự động tối thiểu phải xác định được:

- actor/request/source app;
- Sales Order + version + line;
- SKU;
- giá hệ thống;
- giá trước và giá mới;
- thời điểm thao tác.

Không cần tạo một bảng audit giá riêng nếu audit/outbox hiện hành đã biểu diễn được before/after/context sạch. Chỉ thêm schema nếu audit thực tế chứng minh thiếu fact bắt buộc.

### 4.5 Giá 0đ và SKU chưa có giá

- `0` là giá hợp lệ cho hàng khuyến mãi/tặng/mẫu khi user có quyền sửa giá.
- SKU chưa có giá nền vẫn Add được cho user có quyền và không bị biến thành technical 409 spam.
- `0đ` do user nhập phải phân biệt với `Chưa có giá`.

## 5. Contract Lô C — Chiết khấu từng dòng

Reuse contract dòng hiện có:

- `PERCENT`;
- `PER_UNIT`;
- `TOTAL_AMOUNT`.

Reuse permission:

`core.sales-order.discount.override`

UI chính phải có ô CK trên từng dòng. Backend vẫn là nguồn validate/reconcile.

### Quyết định scope

Giữ rule hiện tại `MIXED_DISCOUNT_SCOPE`:

> Một đơn không được đồng thời có chiết khấu toàn đơn dương và chiết khấu dòng dương.

Lý do: đây là invariant đã có để tránh phân bổ kép/mơ hồ. #791 yêu cầu CK từng dòng, không yêu cầu cộng chồng cả hai scope.

UI phải làm rõ khi người dùng chuyển scope, không bypass bằng cách gửi payload khác với ý nghĩa thật.

## 6. Contract Lô D — Cho phép trùng SKU theo dòng độc lập

### 6.1 Quyết định chính

Cùng một `variantId/SKU` được xuất hiện nhiều lần trong cùng một Sales Order version.

Ví dụ:

```text
A001 | SL 10 | Giá 30.000 | CK 0
A001 | SL  2 | Giá      0 | Hàng khuyến mãi
```

Mỗi dòng có identity độc lập và giữ riêng:

- quantity;
- unit price;
- discount;
- tax;
- note;
- pricing trace;
- audit.

### 6.2 Các chặn hiện tại phải bỏ đúng tầng

Current source có ba chặn chính:

1. frontend từ chối nếu đã có `variantId`;
2. backend legacy validation trả `DUPLICATE_VARIANT`;
3. DB có unique constraint `sales_order_version_lines_variant_unique` trên `(installation_id, sales_order_version_id, variant_id)`.

Lô D phải sửa đủ ba tầng. Không chỉ xóa message frontend.

### 6.3 Identity chuẩn sau khi mở trùng SKU

`variantId` chỉ là danh tính sản phẩm, **không** còn là danh tính dòng.

- Draft client: tạo `clientLineId` ổn định cho từng dòng để React key/focus/editor state không va nhau.
- Sau persist: dùng `sales_order_line_id` và `line_number` cho lineage.
- Không tự thêm `lineKey` xuống DB nếu line ID hiện tại đã đủ.

### 6.4 Downstream đã audit

Fulfillment foundation hiện giữ `sales_order_line_id` và demand uniqueness theo Sales Order line, không theo variant. Đây là nền phù hợp cho duplicate SKU.

Lô D vẫn phải regression toàn chuỗi:

- fulfillment demand;
- reservation/allocation;
- direct issue stock;
- Delivery Order line;
- amendment/quick edit/reversal;
- print/detail;
- accounting/reporting nào đang group line bằng variant.

Mọi nơi dùng map/set keyed chỉ bằng `variantId` trong **line-level behavior** phải được sửa sang line identity. Aggregate tồn theo base variant vẫn có thể group SKU khi đúng nghĩa Kho, nhưng không được làm mất hai source line.

### 6.5 Migration

**Lô D cần migration.** Tối thiểu phải drop/replace unique constraint theo variant trong Sales Order version.

Không chốt số migration trong Lô A. Lô D phải audit registry ngay trước khi tạo migration.

Không cần data backfill chỉ để cho phép duplicate rows, trừ khi audit Lô D phát hiện projection/index phụ có invariant khác.

## 7. Contract Lô E — Phiếu in Đơn bán hàng

Phiếu in là presentation-only.

Dòng sản phẩm phải phân tách đọc được:

- Tên sản phẩm;
- Mã SP / SKU;
- Số lượng;
- ĐVT;
- Đơn giá;
- CK khi có;
- Thuế khi có;
- Thành tiền.

Không ghép `Số lượng + ĐVT` thành một cell duy nhất khi layout đủ chỗ. Tên sản phẩm là primary text, SKU secondary/column riêng theo template khả dụng.

Sửa CSS/layout để preview và browser print không cắt các cột nghiệp vụ chính.

Hành động In không được:

- Chốt đơn;
- giữ/phân bổ hàng;
- Xuất kho;
- tạo tiền/nợ;
- đổi lifecycle.

**Ngoài phạm vi:** yêu cầu riêng máy in 80 mm.

## 8. Contract Lô F — Xuất âm có kiểm soát

### 8.1 Mặc định vẫn cấm

Mặc định toàn installation/kho là:

**`Không cho xuất âm`**.

Không xóa guard âm kho toàn hệ thống.

### 8.2 Hai gate bắt buộc

Một outbound Sales chỉ được làm tồn âm khi đồng thời:

1. policy nghiệp vụ cho scope đó bật `Cho phép xuất âm`;
2. actor có permission cho phép thực hiện ngoại lệ.

Browser không được tự gửi một boolean rồi bypass backend.

Permission key cụ thể sẽ khóa ở Lô F sau khi audit permission registry mới nhất; user-facing label mục tiêu là **`Cho phép xuất âm kho`**.

### 8.3 Scope policy

Policy phải nằm trong ownership Kho và hỗ trợ tối thiểu:

- mặc định theo warehouse;
- có khả năng override theo sản phẩm/SKU tồn cơ sở khi Công Ty chỉ cho một số hàng được âm.

Rule cụ thể hơn phải thắng rule warehouse. Không hardcode danh sách SKU trong frontend.

### 8.4 Không lấy hàng đã giữ cho đơn khác

Ngoại lệ âm kho không được biến thành quyền lấy quantity đã reservation/hold cho đơn khác.

Khi xuất:

- phần free/available dùng trước theo logic hiện tại;
- phần vượt tồn/khả dụng mới là negative exception của chính thao tác được phép;
- reservation/fulfillment facts của đơn khác vẫn được bảo vệ.

### 8.5 Ledger và DB guard

Inventory Ledger vẫn là source of truth. Nếu OUT hợp lệ làm balance âm:

- movement vẫn phải append canonical;
- audit đánh dấu rõ negative-stock exception;
- DB trigger/guard chỉ nới trong **server-owned transaction context** đã được service authorize;
- browser/client không thể tự set context đó.

Không update balance trực tiếp.

### 8.6 Tracking / lot / location

Nếu SKU bắt buộc location/lot/expiry:

- vẫn phải chọn scope hợp lệ theo tracking policy;
- không tạo lot/location giả để chứa số âm;
- nếu không có cách biểu diễn exact scope an toàn thì fail closed với lỗi nghiệp vụ rõ ràng.

Lô F phải khóa chi tiết trường hợp “không có lot/location nào tồn tại nhưng policy cho âm” theo tracking mode thực tế trước khi code posting path.

### 8.7 Costing là gate bắt buộc

Không cho âm chỉ ở quantity rồi để giá vốn sai.

Trước khi bật capability, Lô F phải audit current costing cho outbound `SALES_DELIVERY_ISSUE` khi stock/layer không đủ:

- nếu canonical costing đã có rule hợp lệ cho negative quantity, reuse;
- nếu chưa có, mở rộng canonical costing bằng một rule rõ ràng và test rebuild/reversal;
- không mặc định giá vốn `0`;
- không tạo thuật toán giá vốn riêng chỉ cho màn Sales;
- nếu chưa định giá an toàn thì fail closed dù user có quyền xuất âm.

### 8.8 Migration

**Lô F cần migration** cho policy/permission/DB guard context nếu source hiện tại vẫn như baseline.

Không chốt số migration trong Lô A. Audit registry và current negative-stock trigger lại khi bắt đầu Lô F.

## 9. Migration matrix khóa ở Lô A

| Lô | Migration | Quyết định |
| --- | --- | --- |
| B — tìm nhanh | Dự kiến không | mở rộng read contract/repository/UI |
| C — giá/CK trực tiếp | Dự kiến không | reuse permission + commercial fields + audit hiện có; chỉ thêm schema nếu audit chứng minh thiếu |
| D — duplicate SKU | **Có** | bỏ unique variant-per-version và regression downstream |
| E — in đơn | Không | presentation |
| F — xuất âm | **Có** | policy/permission/DB guard + costing gate |
| G — regression | Không riêng | test/closeout |

Số migration luôn lấy theo registry thật tại lúc thực thi, không lấy số từ tài liệu này.

## 10. File/domain touch map cho các lô sau

### Lô B

- `npp-core/web/app/sales/sales-orders/SalesOrderCommercialForm.tsx`
- `npp-core/web/lib/sales-order-types.ts`
- `npp-core/web/app/api/sales-orders/sku-search/route.ts`
- Sales Order gateway
- `npp-core/api/src/routes/sales-orders.js`
- Sales Order entry service/repository
- pricing + inventory availability read services
- focused web/API/PostgreSQL tests

### Lô C

- SalesOrderCommercialForm + styles/types
- `npp-core/api/src/services/sales-order.js`
- legacy/commercial validation + repository mapping
- permission label/preset surface nếu cần
- audit/outbox regression

### Lô D

- SalesOrderCommercialForm client line identity
- Sales service + legacy validation + repository
- Sales migration + migration registry
- fulfillment/direct stock issue/Delivery/reversal/reporting audits
- PostgreSQL concurrency/regression

### Lô E

- `SalesOrderPrintSheet.tsx`
- print CSS/shared print component only where needed
- print regression/browser test

### Lô F

- Inventory-owned policy schema/service/repository
- Sales direct stock issue adapter/command
- canonical Inventory Ledger guard/transaction context
- costing integration/rebuild/reversal
- permission + audit/outbox
- PostgreSQL integration tests

## 11. Non-scope đã khóa

Không làm trong #791:

- `tab ĐV` mở popup;
- yêu cầu riêng máy in 80 mm / nội dung “không quét được”;
- MCP customer/source redesign;
- Customer Ordering redesign;
- navigation refactor không liên quan;
- update balance trực tiếp;
- production deploy;
- production migration;
- manual SQL production.

## 12. Gate kết thúc Lô A

Lô A đạt khi:

- current main/open PR/CI đã được audit;
- overlap #736/#622/#637 đã reconcile theo quyết định Owner mới;
- contract Giá/Tồn/Khả dụng khóa rõ nguồn và ngữ cảnh;
- direct price edit + permission + audit/no-reason khóa rõ;
- line discount scope khóa rõ;
- duplicate SKU khóa line identity và xác định migration bắt buộc;
- print contract khóa rõ;
- negative-stock boundary khóa default-deny + policy + permission + ledger + reservation + tracking + costing + migration;
- chưa có UI/business migration implementation bị làm trước contract;
- không có production mutation.

Lô kế tiếp sau khi tài liệu này được review là **Lô B — Tìm hàng nhanh**.
