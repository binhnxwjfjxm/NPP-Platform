# Bản đồ frontend và tên miền Hưng Phát

> Trạng thái: **ACTIVE — OWNER LOCKED**  
> Ngày chốt: `2026-08-03`

## Phần này làm gì

Khóa địa chỉ truy cập và ranh giới triển khai cho từng ứng dụng, tránh đưa nhầm chức năng vào sai frontend hoặc deploy nhầm project.

| Ứng dụng | Vercel project | Root source | Tên miền chính |
|---|---|---|---|
| Website + đặt hàng khách | `nguyenlieuhungphat` | repo website riêng | `nguyenlieuhungphat.com` |
| NPP Operations | `npp-platform` | `npp-core/web` | `office.nguyenlieuhungphat.com` |
| MCP Field | `mcp-field` | `mcp` | `mcp.nguyenlieuhungphat.com` |
| Admin MCP/NPP | `admin-mcp-npp` | `admin/web` | `admin.nguyenlieuhungphat.com` |
| Giao hàng | tạo khi có source Delivery | Delivery frontend theo Master Plan | `log.nguyenlieuhungphat.com` |

## Ranh giới

- Mỗi frontend có Vercel project, root build, biến môi trường, tên miền và lệnh production riêng.
- Auto Deploy luôn tắt.
- Merge source không tự deploy production.
- Admin và Delivery không có backend riêng; dùng các API NPP Core được kiểm soát.
- Không frontend nào kết nối trực tiếp PostgreSQL.
- Admin chỉ là trung tâm tổng hợp, cảnh báo và duyệt nhỏ; không sao chép toàn bộ NPP Operations.
- Chưa tạo project Delivery rỗng trước khi có source ứng dụng Delivery.

## Chuyển tiếp đường cũ

Hai đường từng nằm trong NPP Operations chỉ được giữ làm chuyển tiếp:

```text
/management -> https://admin.nguyenlieuhungphat.com
/management/customer-onboarding -> https://admin.nguyenlieuhungphat.com/customer-onboarding
```

Không giữ hai bản chức năng song song.
