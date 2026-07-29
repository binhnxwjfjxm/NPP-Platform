# Phase 5.1 Purchase Order contract

Trạng thái: **IMPLEMENTED IN SOURCE — PENDING FINAL CI/MERGE**  
Route người dùng: `/purchasing/purchase-orders`

Tài liệu quyết định nghiệp vụ chi tiết: `docs/operations/phase-5-1-purchase-order-decisions.md`.

## Ownership và quy trình

- Agent tạo bản thô local và chạy kiểm tra nhanh.
- Reviewer chính kiểm diff thật, sửa lỗi và hoàn thiện frontend/backend/database code trong repo.
- Codex chỉ dùng cho tác vụ ngoài repo hoặc bị môi trường chặn như provider audit, migration rehearsal hay backup/restore evidence.
- Merge source không đồng nghĩa deploy hoặc chạy migration production.

## Phạm vi P5.1

P5.1 sở hữu:

- PO header và lines;
- draft create/update;
- submit for approval;
- approval và cấp số chứng từ;
- cancellation;
- permissions;
- warehouse scope;
- decimal string và snapshot;
- idempotency;
- optimistic concurrency;
- audit/outbox;
- Core API, same-origin web routes và Core web UI.

P5.1 không sở hữu:

- goods receipt;
- inventory posting;
- quantity/quality variance;
- supplier return;
- payable;
- supplier payment/allocation.

## State machine

```text
draft -> pending_approval -> approved

draft | pending_approval | approved -> cancelled
```

- Chỉ `draft` được sửa nội dung.
- `pending_approval` và `approved` không sửa trực tiếp.
- Số PO chỉ cấp lúc approval.
- `partially_received`, `fully_received`, `closed` chỉ được hiển thị read-only để tương thích P5.2.
- Enum kỹ thuật không hiển thị trực tiếp cho người dùng.

## Permission catalog

Canonical keys:

- `core.purchase-order.read`
- `core.purchase-order.create`
- `core.purchase-order.update`
- `core.purchase-order.submit`
- `core.purchase-order.approve`
- `core.purchase-order.cancel`

Frontend fail-closed nếu không đọc được permission context. Backend kiểm permission riêng cho từng endpoint và là security boundary thực sự.

## Core API và same-origin routes

Các route dưới đây tồn tại ở cả Core API và Next.js same-origin proxy:

- GET `/api/purchase-orders?limit&offset&status&supplierId&warehouseId&search`
- GET `/api/purchase-orders/:id`
- POST `/api/purchase-orders`
- PATCH `/api/purchase-orders/:id`
- POST `/api/purchase-orders/:id/submit`
- POST `/api/purchase-orders/:id/approve`
- POST `/api/purchase-orders/:id/cancel`

Response envelope:

```text
{ data?: T, error?: { code?, message?, retryable?, details? }, requestId? }
```

Raw PostgreSQL/provider errors không được trả về browser.

## Request/response contract

- IDs là UUID.
- Quantity và money là decimal string.
- PostgreSQL trả numeric theo fixed scale; UI formatter bỏ zero dư chỉ để hiển thị.
- Dates trả ISO `YYYY-MM-DD` cho business dates.
- `revision` trả string để tránh giới hạn JavaScript integer.
- List trả `lineCount`; detail trả `lines` đầy đủ.
- Display names/code được trả riêng; UI không dùng raw ID làm fallback mặc định.

Header draft payload:

```text
supplierId
warehouseId
orderDate
expectedDate?
supplierReference?
currencyCode
note?
expectedRevision?   # bắt buộc khi PATCH
lines[]
```

Line draft payload:

```text
variantId
quantity
unitPrice
discountAmount
taxAmount
note?
```

Backend tự tra master data và snapshot SKU/name/unit/conversion. Browser không được gửi snapshot để áp đặt lịch sử.

## Decimal rules

- Scale nghiệp vụ: 6 chữ số thập phân.
- Backend dùng BigInt scaled arithmetic.
- UI preview cũng dùng BigInt; backend vẫn là nguồn tổng cuối cùng.
- Không dùng JavaScript float làm nguồn quantity/money.
- Công thức:

```text
base quantity = round(quantity × conversion, 6)
line total = round(quantity × unit price - discount + tax, 6)
PO total = subtotal - discount total + tax total
```

## Idempotency và concurrency

- Mọi mutation bắt buộc `Idempotency-Key`.
- Same key + same payload trả response cũ.
- Same key + different payload trả 409.
- Browser giữ key ổn định khi retry cùng attempt và đổi key khi payload thay đổi.
- PATCH/submit/approve/cancel bắt buộc `expectedRevision`.
- Hai update cùng revision chỉ một request được commit; request còn lại trả conflict.

## Approval và document numbering

- Series: `PURCHASE_ORDER`.
- Prefix: `PO-`.
- Template: `{PREFIX}{YYYY}{MM}-{SEQ}`.
- Reset monthly, timezone `Asia/Ho_Chi_Minh`.
- Allocation và approval nằm trong cùng transaction.
- Cùng approval idempotency key không cấp số lần hai.

## Audit và outbox

Mỗi mutation thành công ghi một audit record và một outbox event trong cùng transaction:

- `purchasing.purchase_order.created`
- `purchasing.purchase_order.updated`
- `purchasing.purchase_order.submitted`
- `purchasing.purchase_order.approved`
- `purchasing.purchase_order.cancelled`

Audit/outbox thất bại thì mutation rollback.

## Frontend implementation

Đã có:

- AppShell navigation “Mua hàng → Đơn đặt hàng”;
- list, search, status filter, summary và responsive table;
- permission-aware actions;
- controlled create/edit modal;
- supplier/warehouse/product/SKU lookups từ API thật;
- line editor và exact decimal preview;
- detail modal;
- submit/approve/cancel confirmation;
- stable idempotency key per logical attempt;
- refresh/upsert sau mutation;
- safe error/loading/empty states;
- desktop flow và mobile smoke E2E.

Production components không import fixture và không fallback sang mock success.

## Verification contract

P5.1 test coverage gồm:

- migration apply/rerun;
- exact decimal helpers;
- create/replay/mismatch;
- concurrent update revision guard;
- update/stale conflict;
- submit;
- approve/document number/replay;
- DB-level line lock after approval;
- cancel/replay;
- permission denial;
- audit/outbox counts;
- web source contracts;
- browser create/edit/submit/approve/view/cancel/mobile flow.

P5.1 chỉ merge khi tất cả workflow trên final head SHA xanh. Deploy, production migration, backup và restore rehearsal là bước riêng có operator approval.
