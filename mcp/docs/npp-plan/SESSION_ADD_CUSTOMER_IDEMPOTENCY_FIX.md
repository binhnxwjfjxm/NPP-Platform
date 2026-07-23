# Session add-customer — Idempotency caller fix

> Cập nhật: **2026-07-17**  
> Trạng thái source: **MERGED + VERIFIED**  
> Runtime frontend: **VERCEL PRODUCTION READY — `/` + `/mcp` HTTP 200**

## 1. Lỗi người dùng

Trong tab Phiên, mở **Thêm khách**, nhập dữ liệu và bấm Lưu nhưng khách không được tạo. Gateway trả lỗi yêu cầu `Idempotency-Key`.

## 2. Root cause

Backend Foundation đã đúng khi bắt buộc idempotency cho operation:

```text
session-customer.add
```

API client chuẩn đã dùng `postIdempotentJson`, nhưng component live:

```text
src/features/mcp/McpSessionAddCustomerButton.tsx
```

gọi `fetch()` trực tiếp tới:

```text
/api/backend/mcp-day/session-customer/add
```

Vì vậy `Idempotency-Key` bị rơi tại caller UI trước khi request đi qua Next proxy. Không phải lỗi RPC, database hoặc proxy.

## 3. Fix đúng logic

- Component dùng `idempotentMutationFetch`.
- Operation cố định: `session-customer.add`.
- Helper tạo một key cho lần submit và giữ nguyên key qua retry mạng tự động.
- Next proxy tiếp tục chỉ forward key.
- Backend tiếp tục từ chối request thiếu key.
- Không thêm fallback tự tạo key ở Gateway hoặc proxy.

## 4. Regression protection

Test được mở rộng tại:

```text
test/a5-5-1-idempotency-caller-contract.test.mjs
```

Test bắt buộc:

- component Thêm khách gọi `idempotentMutationFetch`;
- route đúng `/api/backend/mcp-day/session-customer/add`;
- operation đúng `session-customer.add`;
- component không được quay lại raw `fetch()` cho route này.

## 5. Source / CI

```text
PR:          #28 — MERGED
Final head:  1ee7e93722ec0f500ccc864ba513d1a8fd0ec95c
Merge SHA:   dc000bd9b6e1ead9d4ae40eca429fd94d9c9cbad
CI:          Foundation F0.2 #294 — SUCCESS
Run ID:      29571820520
```

PASS:

- scanner + retirement policy;
- production hygiene;
- direct DB mutation audit;
- backend Foundation tests;
- TypeScript;
- Next production build.

## 6. Scope safety

Không thay đổi:

- Supabase schema/migration;
- typed RPC;
- Foundation Gateway requirement;
- backend transport;
- check-in;
- field-check;
- report settings;
- 21 legacy mutation routes.

Đây là frontend caller fix. Không cần migration và không có backend runtime change riêng.

## 7. Production deployment

```text
Vercel deployment: dpl_5GigX6fwHF3FrNJi9zZNBL9rxKrZ
Target:            production
State:             READY
Deployed main SHA: 35883e87e3580bcf66be70951b49ce77d6e1fbc4
Root `/`:          HTTP 200
MCP `/mcp`:        HTTP 200
```

Deployment chứa merge SHA hotfix `dc000bd9b6e1ead9d4ae40eca429fd94d9c9cbad` và các commit evidence/handoff mới hơn.

## 8. Remaining functional smoke

Vẫn cần thao tác thực tế trên trình duyệt:

1. mở một phiên đang active;
2. bấm **Thêm khách**;
3. nhập tên khách thử và bấm **Thêm khách**;
4. xác nhận lưu thành công, không còn lỗi thiếu `Idempotency-Key`;
5. xác nhận khách xuất hiện đúng trong phiên và tuyến gốc;
6. dọn khách thử theo đúng luồng nghiệp vụ nếu chỉ dùng cho smoke.

Không ghi giả functional smoke đã PASS khi chưa có thao tác thực tế này.
