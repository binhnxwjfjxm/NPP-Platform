# NPP Platform — Latest Handoff

## Việc đang làm

Phase 6F.0 chốt luật công nợ, thu tiền, hàng trả và COD trước khi viết schema/API.

```text
đơn/giao hàng thực tế
-> phát sinh receivable đúng quantity khách nhận
-> ghi payment riêng
-> allocation giải thích tiền trừ vào khoản nợ nào
-> customer return tạo credit sau khi kho nhận
-> COD tách tiền khách đã trả khỏi tiền tài xế đang giữ
```

## Source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact base đã audit: `2725c65f5754aacbab923578f0a05369958a10af`.
- Active branch: `agent/phase-6f0-receivable-payment-cod-decisions`.
- Parent tracking: Issue `#284`.
- Current slice: Issue `#285`.
- Draft PR: `#293 — docs(accounting): chốt đề xuất công nợ và COD Phase 6F.0`.
- Decision document: `docs/operations/phase-6f0-receivable-payment-cod-decisions.md`.

PR #293 là decision-only và vẫn ở trạng thái Draft. Không có schema, migration, backend, frontend hoặc production mutation.

## Tiến độ plan đã xác minh

```text
Phase 0–5   nền tảng source đã đóng theo Master Plan
Phase 6B    Sales Order foundation đã hoàn tất
Phase 6C    MCP customer/order bridge đã hoàn tất và đã rollout theo evidence trước đó
Phase 6D    fulfillment, Delivery Order, inventory issue và Customer Return đã hoàn tất
Phase 6E    trip, dispatch, Delivery app, attempt, reconciliation và optional POD đã đóng production qua Issue #262
Phase 6F    đang ở 6F.0 decision gate; chưa bắt đầu mutation/schema
```

Issue #262 ghi nhận production migration đến `052`, backup/restore rehearsal, Core/NPP/Delivery rollout và smoke hoàn tất. Mọi production operation mới vẫn phải audit lại; không lấy evidence cũ làm quyền deploy Phase 6F.

## Bộ Issue Phase 6F

```text
#284  Phase 6F tổng
#285  6F.0 quyết định công nợ, tiền, hàng trả và COD
#286  6F.1 sổ công nợ khách hàng
#287  6F.2 thu tiền và phân bổ
#288  6F.3 hàng trả, giảm nợ và hoàn tiền
#289  6F.4 COD thu, bàn giao và đối soát
#290  6F.5 tổng hợp, reconciliation và production closeout
```

Thứ tự bắt buộc: `#285 -> #286 -> #287 -> #288 -> #289 -> #290`.

Không bắt đầu 6F.1 cho tới khi owner duyệt 6F.0.

## Quyết định chính đang đề xuất

- Order confirmation và dispatch không tự tạo receivable.
- Actual accepted delivery/pickup mới post receivable.
- Partial delivery chỉ post partial value; failed/rescheduled post zero cho phần chưa giao.
- Payment và allocation là hai facts riêng; không dùng `paid=true`.
- PREPAID chưa giao là customer credit/unapplied advance.
- COD cash collection có thể settle customer ngay; cash handover của tài xế là axis nội bộ riêng.
- Customer Return chỉ tạo credit sau trạng thái `RECEIVED`.
- Paid return tạo customer credit trước; refund là action riêng.
- Trip Return Receipt của hàng chưa giao không phải customer credit source.
- MCP chưa đọc/ghi công nợ hoặc COD trong Phase 6F core implementation.

Owner review theo D1–D11 trong decision document. Câu xác nhận đề xuất:

```text
APPROVE 6F.0 AS PROPOSED
```

## Luồng song song MCP UI

Issue `#291` cho phép một người khác sửa UI MCP trên branch riêng.

Chỉ được sửa MCP frontend/test. Không được đụng:

```text
mcp/apps/backend/**
database/**
npp-core/**
delivery/**
admin/**
workflow production
Core receivable/payment/COD read model
```

Mỗi màn phải kê rõ trước khi sửa; giữ nguyên route, menu và nút nghiệp vụ hiện có. Không dùng CSS tổng làm mất `PageHeader`, nút `Tạo tuyến` hoặc đường vào trang.

## PR cũ không được trộn

PR `#234` vẫn là nhánh NPP navigation cũ, không thuộc Phase 6F và không được trộn vào PR #293.

## Production boundary

Phase 6F.0 không cho phép:

```text
migration hoặc manual SQL production
Core/Delivery/MCP backend deploy
Vercel deploy
provider, DNS hoặc secret change
merge PR #293 trước owner approval
mở 6F.1 mutation/schema
```

Source merge, production migration và deploy luôn là ba gate riêng.

> Updated: `2026-08-05`
> Current checkpoint: Phase 6F.0 Draft PR #293 chờ owner review; MCP UI có thể chạy song song theo Issue #291.