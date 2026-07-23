# Quyết định kiến trúc giao diện app và subdomain

> Trạng thái: **LOCKED**  
> Cập nhật: **2026-07-18**  
> Phạm vi: **MCP-Plan / App vận hành Nhà phân phối**

## 1. Số lượng giao diện cấp app

Ứng dụng có **4 giao diện nội bộ chính** và **1 giao diện tùy chọn làm sau**. Không tách mỗi module nghiệp vụ thành một subdomain riêng.

```text
sales.<domain>       Sale mobile / MCP / tuyến / phiên / tạo đơn / follow-up
admin.<domain>       Điều hành / master data / đơn hàng / nhân viên / báo cáo / cấu hình
operations.<domain>  Kho + giao nhận
accounting.<domain>  Kế toán / công nợ / thu chi / đối soát / khóa sổ
portal.<domain>      Cổng khách hàng — làm sau
api.<domain>         Backend API — không tính là giao diện
```

## 2. Kho và giao nhận

Giai đoạn hiện tại, **Kho và Giao nhận dùng chung `operations.<domain>`** vì hai luồng nối tiếp trên cùng đơn hàng và cùng cần phối hợp reservation, soạn hàng, xuất kho, chuyến giao, giao thiếu và hoàn hàng.

Trong code, dữ liệu và permission vẫn phải tách rõ:

```text
Inventory domain  = nguồn sự thật nhập/xuất/giữ/điều chỉnh tồn
Delivery domain   = nguồn sự thật số lượng thực giao/trả/không giao
```

Không dùng một status chung để gánh cả hai domain.

Chỉ tách `delivery.<domain>` khỏi `operations.<domain>` khi có ít nhất một điều kiện:

- đội giao nhận vận hành độc lập với kho;
- dùng đơn vị giao hàng/3PL;
- cần release cadence hoặc quyền truy cập khác biệt rõ;
- lưu lượng và quy trình giao nhận đủ lớn để một app chung làm giảm hiệu quả vận hành.

## 3. Kế toán

**Kế toán dùng giao diện riêng `accounting.<domain>`** vì dữ liệu tài chính, hạn mức, đối soát, chứng từ và khóa sổ có permission/audit nhạy cảm hơn admin vận hành.

`admin.<domain>` chỉ xem dashboard hoặc read model được cấp quyền; không mặc nhiên có quyền ghi sổ kế toán.

## 4. Nguyên tắc triển khai

- Các giao diện có thể dùng chung source monorepo/design system/auth contract, nhưng route surface, permission và navigation tách theo vai trò.
- Subdomain không quyết định business permission; backend vẫn xác thực actor, role và scope cho từng request.
- Không nhân bản business logic giữa các giao diện.
- Mỗi NPP clone cấu hình domain/subdomain riêng, không hardcode domain trong business code.
- Portal khách hàng không nằm trong scope Foundation/Order Core hiện tại.

## 5. Kết luận khóa

```text
Nội bộ: 4 app surfaces
Tùy chọn: +1 customer portal
Kho + giao nhận: chung app, tách domain
Kế toán: app riêng
API: subdomain kỹ thuật, không tính là giao diện
```
