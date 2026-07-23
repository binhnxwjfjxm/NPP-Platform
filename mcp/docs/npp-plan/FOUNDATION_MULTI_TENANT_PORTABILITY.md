# Foundation multi-tenant — Đã thay thế

> Trạng thái: **DEPRECATED / DO NOT IMPLEMENT**  
> Ngày thay thế: **2026-07-14**

Tài liệu multi-tenant cũ không còn là hướng kiến trúc của dự án.

Mô hình đã khóa hiện tại:

```text
Một NPP
-> một source clone
-> một frontend riêng
-> một backend riêng
-> một database riêng
-> một storage/config riêng
```

Không triển khai shared SaaS, tenant selector, tenant membership hoặc bắt buộc `tenant_id` trên mọi bảng trong phase hiện tại.

Tài liệu foundation chính thức:

[`FOUNDATION_SINGLE_NPP_PORTABILITY.md`](./FOUNDATION_SINGLE_NPP_PORTABILITY.md)

Mọi plan hoặc task còn tham chiếu foundation cũ phải tuân theo tài liệu mới. File này chỉ được giữ lại để các liên kết cũ không bị hỏng; không dùng nội dung lịch sử của nó để thiết kế hoặc code.