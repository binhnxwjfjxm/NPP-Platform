# NPP Platform — Audit 26 mục sửa Phase 10 theo yêu cầu Owner

**Ngày audit:** 2026-08-10  
**Chế độ:** READ-ONLY — không tạo Issue/branch/PR/commit/comment, không sửa code, không deploy/migrate/provider mutation.  
**Repo NPP:** `binhnxwjfjxm/NPP-Platform`  
**Exact `main`:** `aabeb61fece4a837e833b286cad4202fda03149b`  
**Customer Ordering repo:** `binhnxwjfjxm/nguyenlieuhungphat`  
**Exact `main` Customer Ordering:** `9d0c0bb361d2392fbe1387229c28d31776759cec`

> `FIXED IN SOURCE` chỉ có nghĩa code hiện tại đã có fix. Không tự suy ra production đã deploy đúng SHA. Nếu production vẫn lỗi sau exact deployment thì audit runtime riêng, không sửa trùng source.

## Ký hiệu

- ✅ **FIXED IN SOURCE**
- 🟢 **LOGIC ĐÚNG / KHÔNG CẦN SỬA**
- 🔴 **CẦN FIX**
- 🟠 **PRODUCT/STYLE DECISION**
- 🟡 **ĐANG ĐƯỢC XỬ LÝ**
- ⚪ **RUNTIME/E2E CẦN TRACE**

## Tóm tắt

Danh sách có **27 dòng audit** vì mục `24` có hai nội dung (`24a` số lượng dư số 0 và `24b` Aging 503).

- **5 mục đã fix source:** `7, 9, 17, 24b, 26`
- **2 mục logic đúng/không sửa business logic:** `2, 13` (13 có điều kiện)
- **1 cụm đang nằm PR hiện hữu:** `15` → PR #448
- **16 mục/cụm cần sửa UX/logic:** `1, 4, 5, 6, 8, 10, 11, 12, 14, 16, 18, 20, 21, 23, 24a, 25`
- **3 mục product/style audit:** `3, 19, 22`

---

## 1. Tạo đơn bán — dòng sản phẩm còn cao

**Trạng thái:** 🔴 CẦN FIX — UX density

Source: `npp-core/web/app/sales/sales-orders/sales-orders.module.css`

Current đã compact một phần:
- `.orderLineCard` padding khoảng `.65rem`, gap `.48rem`
- input/select min-height `36px`

**Kết luận:** chưa đạt density Owner muốn. Không phải business bug; còn UX gap.  
**Sau này:** giảm vertical padding/gap tiếp, tận dụng chiều ngang, giữ touch target đủ dùng.

---

## 2. Giá bán % khuyến mãi — nhóm KHTV nhưng không chọn khách riêng

**Trạng thái:** 🟢 LOGIC ĐÚNG

Source: `npp-core/web/app/pricing/pricing-workspace.tsx`

Pricing type tách:
`BASE / CHANNEL / CUSTOMER_GROUP / CUSTOMER`.

Khi type=`CUSTOMER_GROUP`, selector nhóm được bật và selector khách riêng bị disable. Selector khách riêng chỉ dùng với type=`CUSTOMER`.

**Kết luận:** chọn KHTV nghĩa là rule áp dụng toàn bộ khách thuộc nhóm KHTV. Không sửa business logic.  
Có thể thêm microcopy: “Áp dụng cho toàn bộ khách đang thuộc nhóm được chọn.”

---

## 3. Rà các chỗ nên lấy định vị/GPS

**Trạng thái:** 🟠 PRODUCT AUDIT

Đã có ở MCP:
- `mcp/src/features/mcp/RouteCustomerLocationEnhancer.tsx`
- dùng `navigator.geolocation.getCurrentPosition`
- field/check-in có lat/lng/accuracy.

Không thấy cơ chế geolocation browser tương đương được dùng rộng trong Core/Delivery.

**Kết luận:** không nên tự lấy GPS ở mọi màn. Chỉ cân nhắc nơi có giá trị nghiệp vụ:
- MCP check-in/outlet location: đã có
- Delivery result/POD/check-in điểm giao nếu Owner muốn chứng cứ vị trí
- cập nhật tọa độ địa chỉ khi người dùng chủ động xác nhận.

---

## 4. Bộ lọc khách hàng chưa đủ chi tiết

**Trạng thái:** 🔴 CẦN FIX

Source:
- `npp-core/web/app/customers/page.tsx`
- `npp-core/web/app/customers/customer-workspace.tsx`

Dedicated filters hiện có:
- search
- status
- customer group

Thông tin nhân viên phụ trách có thể đi qua broad search nhưng **không có dedicated filter nhân viên phụ trách**.

**Kết luận:** phản ánh đúng.  
**Sau này:** bổ sung filter employee/nhóm/status và các scope có dữ liệu thật; search ngắn lại, filter cùng hàng hoặc popover compact.

---

## 5. PO — add sản phẩm nhìn không cân đối

**Trạng thái:** 🔴 CẦN FIX — UX

Source:
- `npp-core/web/app/purchasing/purchase-orders/components/PurchaseOrderEditorV4.tsx`
- `purchase-order-editor-v2.module.css`

Quick result card đang dùng grid rộng kiểu `260 / 170 / 220px`, trong khi line editor đã compact hơn.

**Kết luận:** chooser/result card chưa cân với editor. Cần chỉnh layout, không đụng pricing/business logic.

---

## 6. Tạo tuyến/chuyến giao hàng không chọn được kho

**Trạng thái:** 🔴 CẦN FIX — DATA SOURCE

Source: `npp-core/web/app/logistics/trips/trip-planning-workspace.tsx`

Warehouse options hiện được dựng từ:
- `eligibleOrders`
- `trips`

**Root cause:** selector kho đang suy từ dữ liệu nghiệp vụ con, không lấy canonical warehouse master. Kho active/có quyền có thể không hiện nếu chưa có eligible order/trip.

**Hướng đúng:** `canonical warehouse master → permission/scope → screen-specific eligibility`.

---

## 7. Chính sách lô bắt UUID, không có selector SKU

**Trạng thái:** ✅ FIXED IN SOURCE — Phase 10.2 / PR #443

Current `npp-core/web/app/inventory/inventory-scoped-workspace.tsx` đã có:
- “Tìm SKU để thiết lập”
- candidate API
- SKU search/selector
- inactive SKU hiển thị nhưng không selectable.

**Kết luận:** không sửa lại. Nếu production còn form UUID cũ thì audit rollout/frontend source.

---

## 8. Nhiều tab chọn kho nhưng không hiện kho đang có

**Trạng thái:** 🔴 CẦN FIX — recurring warehouse-selector defect

Bằng chứng:
1. Logistics (#6): derive kho từ eligible orders/trips.
2. `npp-core/web/app/inventory/stocktakes/stocktake-workspace.tsx`: derive warehouse options từ inventory balances.

Kho active nhưng chưa có balance row có thể không xuất hiện.

**Kết luận:** cần một contract chọn kho chung:
`canonical active warehouses → scope/permission → operation eligibility`.

---

## 9. Costing rebuild 503

Endpoint: `/api/inventory/costing/rebuild`

**Trạng thái:** ✅ FIXED IN SOURCE — Phase 10.1 / PR #442

Root cause cũ: `executeRequestWithIdempotency()` trả `{ response, replayed }` nhưng handler đọc nhầm trực tiếp `execution.statusCode/body/requestId`.

Fix đã unwrap `execution.response` + regression test.

**Kết luận:** không sửa trùng.

---

## 10. Chính sách lô + Lô hàng có hero/internal nav thừa

**Trạng thái:** 🔴 CẦN FIX — UX cleanup

`inventory-scoped-workspace.tsx` vẫn render internal `heroActions/inventoryTabs`, trong khi sidebar trái đã có navigation domain.

**Kết luận:** navigation bị lặp, tốn không gian. Giữ sidebar làm primary navigation; trong màn chỉ giữ action nghiệp vụ.

---

## 11. Card “Tài khoản” cuối sidebar thô

**Trạng thái:** 🔴 CẦN FIX — UX + identity display

Source:
- `npp-core/web/app/components/app-shell-core.tsx`
- `app-shell.module.css`

Current footer là card có avatar `A`, label `Tài khoản`, tên `Admin NPP`, border/background/shadow.

**Kết luận:** yêu cầu Owner hợp lý:
- avatar/logo tròn
- tên user từ session
- divider nhỏ
- bỏ card container
- collapsed chỉ còn avatar.

---

## 12. Chuyển tab/page bị giật, thiếu motion nhẹ

**Trạng thái:** 🔴 CẦN FIX — UX motion

Current CSS có transition cho sidebar/button/chevron nhưng chưa có route-content transition thống nhất.

**Sau này:** opacity + translate rất nhẹ, khoảng 120–180ms; `prefers-reduced-motion` phải được tôn trọng.

---

## 13. Customer Ordering catalog 403

Endpoint: `/api/customer-portal/catalog?...`

**Trạng thái:** 🟢 LOGIC ĐÚNG nếu shop chưa có active membership  
**Ngoại lệ:** ⚪ nếu shop đã approve/link active mà vẫn 403.

Audit:
- gateway lấy Clerk identity server-side
- catalog/order yêu cầu active Core membership
- registration routes được phép chạy trước membership
- Core trả Forbidden khi không có active membership
- customer UI có pre-membership access gate.

**Kết luận:** 403 không phải do “ẩn sản phẩm”. Nếu chưa đăng ký/được duyệt shop thì 403 là đúng. Nếu đã active mà vẫn 403 thì trace Clerk identity → Core membership.

---

## 14. MCP tạo đơn: không bỏ chọn SP + không thấy giá

**Trạng thái:** 🔴 CẦN FIX — hai vấn đề

### 14A. Không bỏ chọn ngay ở catalog

Source: `mcp/src/features/orders/OrderCreateSheet.tsx`

Catalog button chỉ `addProduct(product)`:
- chưa chọn → add
- đã chọn → tăng quantity

Remove/decrease chỉ có ở cart/right pane.

**Kết luận:** UX defect thật. Nên cho click selected item để deselect/decrement ngay tại catalog.

### 14B. Giá Core không hiện

Source: `mcp/apps/backend/foundation/core-sales-api.js`

`mapSkuOption()` **cố tình trả `price: null`**.

Decision: `docs/operations/phase-6c2-mcp-sales-order-adapter.md`
- MCP legacy price không authoritative
- Core resolve price/discount/tax khi tạo draft.

**Logic này đúng.**

Nhưng UI hiện dùng `Number(product.price || 0)` và biến `null` thành `0đ`.

**Kết luận:** không sửa bằng cách lấy legacy price. Sửa presentation thành “Giá xác định theo Core” hoặc canonical pricing preview nếu contract cho phép.

---

## 15. CSV/XLSX import-export, bulk update SKU, stocktake, quotation, config columns

**Trạng thái:** 🟡 ĐANG ĐƯỢC XỬ LÝ — Phase 10.4

PR #447 đã merge backend:
- product/pricing import-export
- stocktake count-file
- inventory movement timeline/export
- quotation export
- permission/scope/idempotency/history.

PR #448 đang mở:
`Phase 10.4 — Complete XLSX UI, stocktake blind count & quotation`

Live head lúc audit:
`ef6395f663fe1d86c898d6bf90d939eb9e2da4f7`

Scope đã bao phủ:
- `/operations/data-exchange`
- product/SKU import-export
- pricing import-export
- CSV + XLSX
- column selection/config
- SKU làm key cập nhật
- blind stocktake
- quotation all/category/SKU
- channel/customer-group/customer pricing context
- movement lookup/export
- history.

**Kết luận:** không mở PR duplicate cho #15.

---

## 16. Sidebar Core giật khi mở mục con

**Trạng thái:** 🔴 CẦN FIX — UI structure

Current CSS:
- `.subnav { display:none }`
- `.subnavOpen { display:grid }`

`display` không animate, nên nhóm con bật/tắt làm height nhảy ngay, rõ nhất ở nhóm nhiều mục như Nhân Sự & Phân Quyền.

**Hướng sửa:** animate grid-rows/height/opacity, giữ scroll position sidebar ổn định.

---

## 17. Core Aging 503

Endpoint: `/api/reporting/aging`

**Trạng thái:** ✅ FIXED IN SOURCE — Phase 10.1 / PR #442

Root cause: warehouse-scope query dùng `$1,$2` nhưng code truyền 4 bind params.

Fix đã đúng bind + regression test.

**Kết luận:** không sửa trùng.

---

## 18. Popup phải đủ ngang, không horizontal scrollbar

**Trạng thái:** 🔴 CẦN FIX — shared modal contract

Source:
- `npp-core/web/app/components/modal.tsx`
- `modal.module.css`

Shared modal default khoảng 720px, large khoảng 980px; body dùng `overflow:auto`.

Sales editor có override tốt hơn: gần full viewport và `overflow-x:hidden`.

**Kết luận:** không phải popup nào cũng hỏng, nhưng shared modal contract chưa đủ cho form/table lớn. Cần wide/workspace modal và reflow thay horizontal scroll.

---

## 19. MCP + Delivery đổi action button sang satin metal champagne

**Trạng thái:** 🟠 STYLE/PRODUCT CHANGE — chưa implement

Không thấy source theme hiện tại có system satin/champagne metal chung.

Contract Owner:
- giữ layout/text/tone
- chỉ action/button metal champagne satin
- brushed nhẹ, border mảnh, bevel/shadow nhẹ
- card matte/trắng ngà
- không mirror/gloss/3D quá tay.

**Kết luận:** visual PR riêng sau này, không trộn business logic.

---

## 20. Đổi icon Admin + Delivery bằng file Owner đã upload

**Trạng thái:** 🔴 CẦN FIX — asset wiring

Hai binary đã resolve tại root repo:
- `pwa-icon-admin.png`
- `pwa-icon-deliveri.png`

### Admin hiện tại
`admin/web/app/layout.tsx` vẫn dùng:
- `/api/pwa-icon?size=192`
- `/api/pwa-icon?size=512`

`admin/web/app/api/pwa-icon/route.ts` còn generate monogram `HP`.

=> `pwa-icon-admin.png` chưa được nối.

### Delivery hiện tại
`delivery/web/app/manifest.ts` vẫn dùng:
- `/icons/delivery-192.png`
- `/icons/delivery-512.png`
- `/icons/delivery-maskable-512.png`

=> `pwa-icon-deliveri.png` chưa được nối.

**Kết luận:** asset có trong repo nhưng app vẫn dùng icon cũ/generator.

---

## 21. Sales Order list card quá cao

**Trạng thái:** 🔴 CẦN FIX — UX density

Current `.orderCard` vẫn có `padding:1rem` và nhiều stacked metadata rows.

**Kết luận:** có thể giảm chiều cao bằng horizontal hierarchy, secondary metadata nhỏ hơn, action gọn. Nên xử lý cùng #1.

---

## 22. Rà tất cả nơi nên multi-select/bulk action

**Trạng thái:** 🟠 PRODUCT/UX AUDIT

Một số domain đã có checkbox/multi-select. Không nên thêm hàng loạt vào mọi chứng từ vì posted/immutable docs không được bulk mutate tùy ý.

Ưu tiên nơi an toàn/hợp lý:
- export
- quotation selection
- non-posted queue
- tagging/assignment
- stocktake scope
- batch action đã có backend permission/idempotency contract.

**Kết luận:** lập allowlist trước, không auto-code toàn app.

---

## 23. MCP gửi đơn Core không thấy nhận + không thấy khách liên kết

**Trạng thái:** ⚪/🔴 REAL E2E DEFECT — implementation đã có

Source:
- `mcp/apps/backend/foundation/sales-order-sync.js`
- `mcp/src/features/mcp/McpOfficialOrderPanel.tsx`
- `docs/operations/phase-6c2-mcp-sales-order-adapter.md`

Contract:
- chỉ create Core order khi onboarding `approved` hoặc `linked_existing`
- cần `core_customer_id` + `core_customer_address_id`
- source Core: `sourceType=MCP`, `sourceId=MCP order id`, `sourceOutletId`
- idempotency: `mcp-sales-order-<MCP order id>`
- MCP lưu Core order ID/number/status/version/total/sync timestamps.

UI đã có:
- trạng thái xác minh khách
- đồng bộ khách
- gate đủ điều kiện
- “Tạo đơn nháp NPP”
- đồng bộ đơn
- Core order number/total/status.

**Kết luận:** không phải feature chưa code. Triệu chứng Owner thấy là E2E/runtime/projection defect thật. Phải trace:
`onboarding submit → Core review/link → MCP sync → core_customer_id/address → MCP Sales submit → Core source=MCP → NPP list`.

---

## 24a. Quantity Core hiển thị `1.0000000`

**Trạng thái:** 🔴 CẦN FIX — display consistency

Sales formatter:
`npp-core/web/app/sales/sales-orders/sales-order-ui.ts`
đã trim trailing zero đúng.

Inventory formatter:
`npp-core/web/lib/inventory-types.ts`

hiện chỉ:
```ts
export function formatQuantity(value) {
  return value ?? '0';
}
```

=> trả raw decimal string.

**Root cause:** formatter không thống nhất giữa domain/UI.

**Hướng đúng:** giữ decimal exact ở API/DB; chỉ trim insignificant zeros ở presentation. Không convert nghiệp vụ sang JS float.

---

## 24b. Tuổi nợ phải thu 503

**Trạng thái:** ✅ DUPLICATE #17 — FIXED IN SOURCE

Không tạo task riêng.

---

## 25. Customer Ordering không cần hiện SKU

**Trạng thái:** 🔴 CẦN FIX — customer-facing UX

Customer repo:
- `customer-ordering/components/product-catalog.tsx`
- `customer-ordering/components/quick-order.tsx`

Current UI còn render:
- `SKU: ...`
- SKU column trong quick order.

**Kết luận:** ẩn SKU trong Customer Ordering; giữ SKU trong MCP/Core cho nhân viên đối chiếu. Internal key có thể vẫn tồn tại trong data nhưng không show cho khách.

---

## 26. Sales confirm 503 + React #423

**Trạng thái:** ✅ FIXED IN SOURCE

Phase 10.1 PR #442 đánh dấu PASS/NO CHANGE vì PR #437 đã sửa:
- recover failed retryable idempotency record
- stable confirm retry key
- draft ownership theo Sales Order
- deterministic UTC+7 timestamp để tránh hydration mismatch/React #423.

**Kết luận:** không sửa trùng. Nếu exact deployment mới vẫn tái hiện thì audit requestId + deployed SHA + runtime failure mới.

---

# Chia PR để THỰC THI SAU — CHỈ LÀ KẾ HOẠCH, KHÔNG TẠO PR

## PR Plan A — Core shell/navigation/modal polish
Mục: `10, 11, 12, 16, 18`

- bỏ nav lặp
- account footer
- sidebar subnav animation/stability
- route transition
- modal sizing/overflow

## PR Plan B — Sales compact UI + quantity display
Mục: `1, 21, 24a`

- line density
- list card density
- shared quantity display formatter

## PR Plan C — Customer filters + safe bulk-selection UX
Mục: `4, 22`

- matrix filter hiện có/thiếu
- dedicated responsible employee filter
- compact toolbar/popover
- allowlist safe bulk actions

## PR Plan D — Canonical warehouse selector
Mục: `6, 8`

Root cause chung:
warehouse selector suy từ child-data thay vì canonical master.

## PR Plan E — Purchasing product picker UX
Mục: `5`

Tách khỏi PO XLSX/10.4.

## PR Plan F — MCP order UX + MCP/Core E2E
Mục: `14, 23`

- toggle/deselect sản phẩm
- price-null presentation
- trace/repair onboarding→customer link→Sales Order bridge nếu runtime evidence xác nhận fail.

## PR Plan G — Customer Ordering
Mục: `25` + `13` chỉ khi approved active member vẫn 403

- ẩn SKU
- giữ membership deny-by-default
- chỉ sửa 403 khi mapping hợp lệ bị fail.

## PR Plan H — MCP/Delivery visual + PWA icons
Mục: `19, 20`

- satin champagne action system
- wire uploaded Admin/Delivery icons
- manifest/PWA regression.

## Product decision riêng — GPS
Mục: `3`

Không gộp bừa vào UI PR.

## Existing PR — KHÔNG TẠO DUPLICATE
Mục: `15` → tiếp tục PR #448.

## Không tạo source fix mới mặc định
Mục: `2, 7, 9, 17, 24b, 26`.

---

# Thứ tự ưu tiên khi Owner ra lệnh sửa thật

1. Hoàn thiện/review PR #448, không tạo duplicate #15.
2. Warehouse selector #6/#8.
3. MCP/Core bridge #23 + MCP order UX #14.
4. Customer Ordering #13 conditional + #25.
5. Sales density/quantity #1/#21/#24a.
6. Core shell/modal/sidebar #10/#11/#12/#16/#18.
7. Customer filters/multi-select #4/#22.
8. PO product picker #5.
9. Visual metal + icons #19/#20.
10. GPS chỉ sau product decision.

---

# Test matrix sau các fix tương lai

### Core
- Sales line/list density ở 1366/1440/1920.
- `1.000000 → 1`, `1.250000 → 1.25`.
- modal không scroll ngang.
- sidebar mở/đóng nhóm lớn không giật.
- route transition mượt + reduced-motion.

### Warehouse
- warehouse active nhưng chưa có stock/order/trip vẫn xuất hiện nơi contract cho phép.
- user thiếu scope không thấy kho.
- eligibility từng màn vẫn đúng.

### Customer/filter
- employee/group/status kết hợp.
- search/filter compact.
- multi-select chỉ ở operation an toàn.

### MCP
- click selected product có thể bỏ/giảm chọn.
- missing price không hiện `0đ` như giá thật.
- onboarding approved/link → MCP sync thấy Core customer.
- MCP tạo draft → Core có đúng 1 Sales Order source MCP.
- retry không duplicate.

### Customer Ordering
- pre-membership → 403 + registration state đúng.
- approved active membership → catalog 200.
- không show SKU customer-facing.

### PWA/Visual
- Admin/Delivery dùng đúng icon Owner.
- manifest/icon cache regression pass.
- metal action style giữ cards matte, contrast/touch target đạt.

---

# Kết luận

Các lỗi/UX gap **có thật** nổi bật:
- warehouse selector contract (#6/#8)
- MCP↔Core E2E (#23)
- MCP picker/price presentation (#14)
- customer filter (#4)
- quantity raw decimals (#24a)
- sidebar/modal/density (#1/#10/#11/#12/#16/#18/#21)
- Customer Ordering SKU (#25)
- PWA icon wiring (#20).

Không nên sửa trùng:
- Tracking Policy UUID (#7)
- Costing 503 (#9)
- Aging 503 (#17/#24b)
- Sales confirm 503 + React #423 (#26)
- customer-group pricing logic (#2)
- pre-membership catalog 403 (#13)
- import/export/quotation (#15) vì đang nằm PR #448.

**Audit này không thực hiện bất kỳ mutation nào lên repo/provider.**

---

# Addendum — production defects bổ sung 2026-08-10

Các mục dưới đây được bổ sung sau khi Owner test trực tiếp production. Không renumber 1–26 cũ để giữ nguyên tham chiếu audit ban đầu.

## A1. Kho tạo xong nhưng các màn khác không thấy; phải quay lại Kho/Tải lại mới xuất hiện

**Trạng thái:** 🔴 **CẦN FIX — persistence/revalidation + warehouse-source contract**

### Audit source
Màn quản trị tổ chức/kho `npp-core/web/app/organization/organization-workspace.tsx` sau khi POST/PATCH thành công có gọi `loadAll()` và reload lại 3 master list `branches / warehouses / warehouse-locations`. Vì vậy ngay trong màn quản trị Kho, code hiện có ý định refresh state sau mutation.

Tuy nhiên các màn nghiệp vụ khác không cùng dùng một canonical warehouse source. Audit trước đã xác nhận:
- Logistics Trip Planning dựng danh sách kho từ `eligibleOrders + trips`.
- Stocktake có chỗ dựng warehouse options từ inventory balances.

### Kết luận
Triệu chứng “tạo kho xong nhưng sang tab khác không thấy” là **lỗi thật ở cross-screen warehouse data source/revalidation**, không nên xử lý bằng cách bắt người dùng quay lại Kho rồi bấm tải lại.

### Hướng sửa đúng
- Một canonical endpoint/list warehouse active theo installation + permission/scope.
- Các tab dùng canonical warehouse options, sau đó mới áp operation eligibility riêng.
- Mutation tạo/sửa kho phải invalidate/revalidate cache/state có liên quan.
- Test: tạo kho mới → chuyển thẳng sang các màn có selector kho → kho phải hiện nếu user có quyền, không cần reload thủ công.

---

## A2. Chỉnh sửa vị trí kho — popup tự biến mất khi đang nhập text

**Trạng thái:** ⚪/🔴 **CẦN FIX — UI state/modal regression, cần browser repro để chốt trigger**

### Audit source
Trong `organization-workspace.tsx`:
- modal được giữ bởi `editor` state;
- typing vào code/name chỉ cập nhật `locationDraft`;
- backdrop gọi `closeModals` khi click backdrop;
- dialog có `stopPropagation()`.

Không thấy business rule nào cho phép modal tự đóng khi nhập text. Vì vậy hành vi Owner thấy **không phải logic nghiệp vụ đúng**.

### Kết luận
Đây là UI regression thật. Source đọc tĩnh chưa đủ chứng minh trigger chính xác (rerender/remount, click propagation, route/state refresh hoặc runtime khác), nên khi sửa phải reproduce browser trước rồi khóa regression test.

### Gate
- mở Edit Location;
- gõ liên tục code/name;
- đổi warehouse/type;
- modal không được tự đóng;
- draft không mất cho tới Save/Cancel/explicit backdrop close.

---

## A3. Điều phối giao hàng — tạo xe/tài xế/chuyến trả 400

Production evidence Owner báo:
- `POST /api/logistics/drivers` → 400
- `POST /api/logistics/vehicles` → 400
- tạo chuyến cũng lỗi trong cùng flow.

**Trạng thái:** 🔴 **CẦN FIX — form/API validation UX; warehouse defect có thể kéo theo trip create**

### Audit source frontend
`trip-planning-workspace.tsx` gửi:
- vehicle: `{ code, licensePlate, vehicleType }`
- driver: `{ code, name, phone }`
- trip: `{ warehouseId, deliveryRouteId, vehicleId, primaryDriverId, plannedStartAt, note }`

Master buttons chỉ disable khi `code` hoặc `name` rỗng. Trip button disable khi chưa có `warehouseId`.

### Audit source backend
Backend `logistics-trip-planning.js` trả 400 cho các validation code như:
- `INVALID_VEHICLE`
- `INVALID_DRIVER_PROFILE`
- `INVALID_DELIVERY_TRIP`

Vehicle yêu cầu code + licensePlate + vehicleType hợp lệ. Driver yêu cầu code + name; `employeeId` có thể null. Trip yêu cầu warehouseId hợp lệ và đúng scope; route/vehicle/driver có thể nullable theo contract nhưng nếu gửi giá trị thì phải là UUID hợp lệ.

### Kết luận
Không thể coi 400 là “thao tác sai của người dùng” khi form không giải thích field/contract nào sai. Đây là defect UX/API contract surfacing.

Đặc biệt trip create có thể fail dây chuyền từ lỗi warehouse selector A1/#6/#8: không có canonical warehouse option → không tạo được trip đúng contract.

### Hướng sửa
- Map error code/details thành lỗi ngay field, không chỉ generic banner.
- Client validation phải khớp backend contract.
- Xe: label/required state rõ code, biển số, loại xe.
- Tài xế: code + tên bắt buộc; phone optional; nếu sau này link employee thì dùng selector employee, không bắt UUID.
- Trip: warehouse lấy canonical warehouse selector; route/vehicle/driver select từ master active.
- API regression test payload UI ↔ backend schema.

---

## A4. Sales Order xác nhận vẫn 503 trên production dù source từng được fix

Production evidence Owner báo lại:
`POST /api/sales-orders/<id>/confirm` → `503 Service Unavailable`.

**Trạng thái:** ⚪/🔴 **PRODUCTION REGRESSION — KHÔNG ĐƯỢC ĐÁNH DẤU ĐÓNG CHỈ VÌ SOURCE ĐÃ FIX**

### Quan hệ với mục #26
Mục #26 vẫn đúng về lịch sử: PR #437/10.1 đã có source fix cho retry/idempotency/hydration.

Nhưng evidence mới chứng minh **production hiện vẫn tái hiện 503**. Do đó trạng thái vận hành của #26 phải hiểu là:
- source-level known bug: đã fix;
- production journey: **chưa pass**.

### Hướng audit/sửa
Không viết lại fix cũ trước khi biết root cause mới. Capture:
- exact frontend SHA đang chạy;
- exact Core backend release/SHA;
- response error code + requestId;
- idempotency record state;
- Core log của đúng request.

Nếu production đang chạy source cũ → rollout đúng SHA. Nếu exact fix đã deploy mà vẫn 503 → đây là defect mới và phải sửa theo request evidence.

### Gate
Một Sales Order draft hợp lệ confirm thành công; retry cùng intent không duplicate; không 503; không React hydration error.

---

## A5. Nhập tồn đầu/nhập kho đang bắt quá nhiều trường; SP không quản lý lô vẫn khó nhập

**Trạng thái:** 🔴 **CẦN FIX — operator input contract/UX**

### Owner requirement đã khóa bổ sung
Đối với thao tác nhập số lượng hàng thông thường, người vận hành không nên phải nhớ/gõ UUID hoặc các mã nội bộ đã có sẵn trong hệ thống.

Input lõi người dùng cần nhập là:
- **SKU**
- **Số lượng**

Các trường còn lại phải được resolve/chọn theo master data và policy:
- Kho: selector từ canonical warehouse master.
- Vị trí: selector theo kho; chỉ bắt buộc khi inventory/tracking policy yêu cầu.
- Lô: chỉ hiện/bắt buộc nếu SKU có `lot_tracking_mode = REQUIRED`; SKU không quản lý lô không được bị chặn vì thiếu lot.
- Hạn sử dụng: chỉ yêu cầu theo expiry policy (`OPTIONAL/REQUIRED`).
- Variant/baseVariant/internal IDs: resolve server-side từ SKU; không bắt người dùng nhập UUID.
- Các code/reference đã tồn tại: dùng selector/search, không bắt nhớ mã nội bộ.

### File import
File operator-facing nên ưu tiên cột dễ hiểu. Tối thiểu cho row đơn giản:
`SKU | Số lượng`

Nếu operation cần context thì thêm cột business-readable có điều kiện, ví dụ:
`Kho | Vị trí | SKU | Số lượng | Lô | Hạn sử dụng`

Trong đó `Vị trí/Lô/Hạn` không được blanket-required cho mọi SKU.

### Boundary nghiệp vụ
- Opening Balance vẫn là flow riêng, dùng cho khởi tạo/chuyển dữ liệu đầu kỳ.
- Stocktake actual-count vẫn không update balance trực tiếp; đi qua Stocktake lifecycle.
- Inbound receipt/GRN phải giữ source-document semantics của nhập hàng; UX đơn giản không được bypass accounting/inventory audit trail.

### Gate
- SKU không quản lý lô: nhập được với SKU + quantity + warehouse context cần thiết.
- SKU quản lý lô bắt buộc: UI/file yêu cầu lot rõ ràng.
- Không có raw UUID field cho người vận hành.
- Error chỉ đúng row/field thiếu, không trả generic “thiếu dữ liệu”.
