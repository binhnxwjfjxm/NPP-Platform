# Bản đồ frontend và tên miền Hưng Phát

> Trạng thái: **ACTIVE — OWNER LOCKED**  
> Ngày chốt ban đầu: `2026-08-04`  
> Cập nhật Retail: `2026-08-20`

## Phần này làm gì

Khóa địa chỉ truy cập, project triển khai và ranh giới nghiệp vụ cho từng ứng dụng. Tên miền tùy chỉnh là alias truy cập chính, không thay thế hoặc xóa các URL `vercel.app` của project.

| Ứng dụng | Vercel project | Root source | Tên miền chính |
|---|---|---|---|
| Website | `nguyenlieuhungphat` | repo website riêng | `nguyenlieuhungphat.com` |
| Đặt hàng khách | `customer-ordering` | `customer-ordering` ở repo website | `sales.nguyenlieuhungphat.com` |
| Vận hành Công Ty | `npp-platform` | `npp-core/web` | `office.nguyenlieuhungphat.com` |
| MCP Field | `mcp-field` | `mcp` | `mcp.nguyenlieuhungphat.com` |
| Admin MCP/NPP | `admin-mcp-npp` | `admin/web` | `admin.nguyenlieuhungphat.com` |
| Giao hàng | `npp-delivery` | `delivery/web` | `log.nguyenlieuhungphat.com` |
| Bán tại quầy | `npp-retail` | `retail/web` | `retail.nguyenlieuhungphat.com` |

## URL Vercel và domain tùy chỉnh

- `https://npp-platform.vercel.app` tiếp tục là URL hợp lệ của ứng dụng Vận hành Công Ty.
- `office.nguyenlieuhungphat.com` là tên miền chính của ứng dụng Vận hành Công Ty; URL `vercel.app` vẫn thuộc project tương ứng.
- Admin dùng `NPP_OPERATIONS_URL` khi đã cấu hình; nếu chưa có thì chuyển về `https://npp-platform.vercel.app`.
- Các alias `vercel.app` do Vercel tạo vẫn thuộc project tương ứng và không bị thay bằng subdomain tùy chỉnh.
- Giao hàng và Bán tại quầy là hai frontend độc lập; không dùng chung project Vercel và không deploy ké nhau.

## Ranh giới triển khai

- Mỗi frontend có Vercel project, root build, biến môi trường, tên miền và lệnh production riêng.
- Auto Deploy luôn tắt bằng cấu hình source và được kiểm lại trước deploy.
- Merge source không tự deploy production.
- Admin, Giao hàng và Bán tại quầy không có backend kinh doanh riêng; dùng API Công Ty qua boundary phía server.
- Không frontend nào kết nối trực tiếp PostgreSQL.
- Bán tại quầy dùng project `npp-retail`, root `retail/web`; production chỉ được deploy bằng lệnh Retail riêng sau khi main và CI đã được kiểm lại.

## Ranh giới Bán tại quầy

- Retail chỉ là giao diện làm việc tại quầy; không tạo sản phẩm, giá, tồn kho, công nợ hoặc báo cáo riêng.
- Browser không nhận `CORE_API_INTERNAL_URL` và không giữ server secret.
- Các lô nghiệp vụ tiếp theo phải dùng Đơn bán hàng, tồn kho, thanh toán và công nợ canonical của Công Ty.
- Giao tại quầy phải dùng engine trực tiếp dùng chung với Giao thủ công theo Issue #675; Lô 0 chỉ dựng runtime và khung kiểm thử, không thay đổi nghiệp vụ đó.

## Ranh giới Delivery frontend

- Delivery chỉ đọc các chuyến được gán đúng cho tài xế đã xác thực theo quyền hiện hành.
- Token Công Ty và ánh xạ tài khoản app sang `employeeId` chỉ tồn tại phía server của Delivery.
- Delivery không dùng permission điều phối rộng và không được gọi planning/dispatch mutation ngoài phạm vi được cấp.
- Ghi kết quả giao, actual quantity, POD/GPS, dời lịch, hàng quay về kho và COD phải đi qua API Công Ty canonical.

## Ranh giới Admin MCP/NPP và ứng dụng Vận hành Công Ty

### Ứng dụng Vận hành Công Ty sở hữu công việc hằng ngày

Các đường sau phải chạy trực tiếp trong ứng dụng Vận hành Công Ty, không chuyển tiếp sang Admin:

```text
/management
/management/customer-onboarding
/sales/sales-orders
```

Sales Admin, CS, kế toán công nợ và quản lý bán hàng dùng ứng dụng Vận hành Công Ty để:

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
