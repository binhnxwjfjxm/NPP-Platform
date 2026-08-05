# Phase 6F.0 — Owner Approval Record

> Status: **LOCKED**  
> Date: `2026-08-05`  
> Parent tracking: Issue `#284`  
> Decision issue: `#285`  
> Decision document: `docs/operations/phase-6f0-receivable-payment-cod-decisions.md`  
> Authorized next slice: **Phase 6F.1 — Sổ công nợ khách hàng**

## Xác nhận

Owner đã yêu cầu tiếp tục sau khi xem phần tóm tắt và bộ quyết định D1–D11 của Phase 6F.0.

Bản ghi này khóa toàn bộ đề xuất trong decision document và thay thế marker `PROPOSED — OWNER APPROVAL REQUIRED` ở đầu tài liệu đó. Các slice 6F.1–6F.5 phải triển khai đúng các quyết định đã khóa; không được tự đổi thời điểm phát sinh công nợ, cách phân bổ tiền, cách ghi credit hàng trả hoặc ranh giới COD trong lúc viết code.

## Luật đã khóa

- Xác nhận Sales Order và dispatch không tự tạo công nợ.
- Chỉ giá trị hàng khách thực nhận khi delivery/pickup thành công mới tạo receivable.
- Giao một phần chỉ post phần thực giao; failed/rescheduled post zero cho phần chưa giao.
- Payment và allocation là hai sự thật riêng; không dùng cờ `paid=true` thay ledger.
- PREPAID chưa giao hết là customer credit/unapplied advance.
- Customer Return chỉ tạo credit sau khi kho nhận ở trạng thái `RECEIVED`.
- Hàng chưa giao quay về kho qua Trip Return Receipt không tạo credit khách.
- COD khách đã trả và tiền tài xế chưa nộp là hai trục trạng thái riêng.
- Sai lệch bàn giao COD là nghĩa vụ nội bộ, không làm khách mắc nợ lại.
- Refund và write-off là mutation riêng, có quyền, lý do, idempotency và audit.
- MCP không đọc hoặc ghi công nợ/COD trong Phase 6F.1–6F.5.

## Audit trạng thái source khi khóa

Decision PR được tạo từ `main@2725c65f5754aacbab923578f0a05369958a10af`.

Trước khi khóa, `main` đã tiến thêm tới `f34f6f50dce40694bd4daa0c73bc8b10afbd2ffc` do một merge chỉ thay đổi MCP frontend. Thay đổi đó không sửa `database/**`, `npp-core/**`, `delivery/**` hoặc decision contract Phase 6F, nên không làm đổi các quyết định D1–D11.

## Quyền được cấp bởi approval này

Approval này cho phép:

- merge tài liệu Phase 6F.0 sau khi exact-head CI xanh;
- bắt đầu source work Phase 6F.1 trên branch riêng từ exact `main` mới nhất;
- thiết kế migration, Core backend, NPP Operations UI và tests cho sổ công nợ theo Issue #286.

Approval này không cho phép:

- migration hoặc mutation production;
- deploy Core, NPP, Delivery, MCP hoặc Admin;
- provider, DNS, secret hoặc database thủ công;
- bắt đầu 6F.2–6F.5 trước gate của slice đứng trước;
- mở read model công nợ/COD trên MCP.

Source merge, production migration và production deploy tiếp tục là ba gate riêng.