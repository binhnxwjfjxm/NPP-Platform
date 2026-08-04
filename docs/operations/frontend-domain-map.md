# Bản đồ frontend và tên miền Hưng Phát

> Trạng thái: **ACTIVE — OWNER LOCKED**  
> Ngày chốt: `2026-08-04`

## Phần này làm gì

Khóa địa chỉ truy cập, project triển khai và ranh giới nghiệp vụ cho từng ứng dụng. Tên miền tùy chỉnh là alias truy cập chính, không thay thế hoặc xóa các URL `vercel.app` của project.

| Ứng dụng | Vercel project | Root source | Tên miền chính |
|---|---|---|---|
| Website + đặt hàng khách | `nguyenlieuhungphat` | repo website riêng | `nguyenlieuhungphat.com` |
| NPP Operations | `npp-platform` | `npp-core/web` | `office.nguyenlieuhungphat.com` |
| MCP Field | `mcp-field` | `mcp` | `mcp.nguyenlieuhungphat.com` |
| Admin MCP/NPP | `admin-mcp-npp` | `admin/web` | `admin.nguyenlieuhungphat.com` |
| Giao hàng | chưa audit/tạo project | `delivery/web` | `log.nguyenlieuhungphat.com` |

## URL Vercel và domain tùy chỉnh

- `https://npp-platform.vercel.app` tiếp tục là URL hợp lệ của NPP Operations.
- `office.nguyenlieuhungphat.com` được gắn thêm làm tên miền chính khi DNS/domain sẵn sàng; không được xóa URL Vercel hoặc coi domain là điều kiện để phát triển và kiểm tra source.
- Admin dùng `NPP_OPERATIONS_URL` khi đã cấu hình; nếu chưa có thì chuyển về `https://npp-platform.vercel.app`.
- Các alias `vercel.app` do Vercel tạo vẫn thuộc project tương ứng và không bị thay bằng subdomain tùy chỉnh.
- Delivery đã có source tại `delivery/web`; trạng thái project, domain, DNS và production deploy phải audit riêng, không được suy ra từ source merge.

## Ranh giới triển khai

- Mỗi frontend có Vercel project, root build, biến môi trường, tên miền và lệnh production riêng.
- Auto Deploy luôn tắt.
- Merge source không tự deploy production.
- Admin và Delivery không có backend riêng; dùng các API NPP Core được kiểm soát.
- Không frontend nào kết nối trực tiếp PostgreSQL.
- Chỉ tạo/cấu hình project Delivery sau khi source merge, CI xanh và có lệnh rollout rõ; không tự tạo trong Phase 6E.3.

## Ranh giới Delivery frontend

- Delivery chỉ đọc các chuyến `dispatched` được gán đúng cho tài xế đã xác thực trong Phase 6E.3.
- Core token và ánh xạ tài khoản app sang `employeeId` chỉ tồn tại phía server của Delivery.
- Delivery không dùng permission điều phối rộng và không được gọi planning/dispatch mutation.
- Ghi kết quả giao, actual quantity, POD/GPS, dời lịch, hàng quay về kho và COD thuộc các slice tiếp theo.

## Ranh giới Admin MCP/NPP và NPP Operations

### NPP Operations sở hữu công việc hằng ngày

Các đường sau phải chạy trực tiếp trong NPP Operations, không chuyển tiếp sang Admin:

```text
/management
/management/customer-onboarding
/sales/sales-orders
```

Sales Admin, CS, kế toán công nợ và quản lý bán hàng dùng NPP để:

- kiểm tra và xác nhận đơn hàng thông thường;
- theo dõi đơn nháp/chờ xác nhận;
- kiểm tra đề nghị mở mã khách;
- tạo mã khách mới hoặc liên kết khách đã có;
- yêu cầu bổ sung hoặc từ chối đề nghị thông thường;
- theo dõi trạng thái xử lý khách và đơn.

### Admin chỉ tổng hợp và duyệt ngoại lệ

Admin không tạo mã khách thay Sales Admin và không duyệt tất cả đơn hàng. Admin chỉ được mở hành động khi backend phân loại rõ một ngoại lệ, gồm loại việc, lý do đẩy lên, người gửi, dữ liệu tóm tắt, ngưỡng vượt và audit log.

Các ngoại lệ gồm:

- khách trùng chưa rõ gộp hay mở mới;
- khách rủi ro/công nợ xấu, hạn mức vượt chuẩn, giá đặc biệt hoặc mở lại khách bị khóa;
- đơn vượt hạn mức công nợ, chiết khấu vượt quyền, dưới giá sàn, giá trị lớn hoặc điều kiện giao hàng bất thường;
- yêu cầu mở khóa hoặc tiếp tục xử lý sau cảnh báo.

Khi backend chưa có hàng đợi ngoại lệ riêng, Admin chỉ hiển thị tổng hợp và thông báo ranh giới; không trình bày nút thao tác hằng ngày.
