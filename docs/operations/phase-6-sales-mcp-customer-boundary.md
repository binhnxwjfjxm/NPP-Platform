# Phase 6 — Sales and MCP Customer Boundary Decisions

> Status: **ACTIVE — UPDATED 2026-08-22**  
> Active boundaries are standalone customer verification and direct canonical Công Ty Sales Order creation.  
> Khách Công Ty đã tồn tại không phải mở / liên kết mã lại chỉ để tạo đơn.

## 1. Quyết định sản phẩm

Điểm bán MCP và khách Công Ty là hai danh tính khác nhau.

`Thêm khách` vẫn là thao tác hiện trường: MCP lưu tuyến, điểm bán, phiên làm việc, GPS, hình ảnh và ghi chú; không tự tạo mã khách Công Ty.

`Mở / liên kết mã` chỉ dùng khi một điểm bán MCP cần tạo mới hoặc xác lập liên kết với khách Công Ty. Nó không phải điều kiện bắt buộc đối với khách Công Ty đã tồn tại và đã được phân công nhân viên.

## 2. Phạm vi dữ liệu

### MCP quản lý

- tuyến và điểm bán hiện trường;
- phiên làm việc, lượt ghé, GPS, hình ảnh, báo cáo và theo dõi;
- trạng thái đề nghị mở / liên kết mã và các tham chiếu sang Công Ty;
- giao diện tạo đơn từ MCP.

### Công Ty quản lý

- khách hàng và địa chỉ chính thức;
- mã khách và trạng thái khách;
- nhân viên phụ trách khách;
- quy trình duyệt mở / liên kết mã;
- sản phẩm, giá, chính sách thương mại và đơn bán hàng chính thức.

MCP không tự sửa nhân viên phụ trách của khách Công Ty.

## 3. Quyền theo nhân viên

Trình duyệt không được tự khai báo nhân viên có thẩm quyền. MCP lấy nhân viên từ phiên đăng nhập tin cậy.

Với nhân viên thông thường, khách Công Ty được phép xem và tạo đơn phải có `shared.customers.responsible_employee_id` đúng bằng nhân viên đang đăng nhập và nhân viên đó còn hoạt động.

Tài khoản chủ hệ thống (`mcp.installation-owner`) có thể xem và thao tác khách trong toàn installation, nhưng việc tạo đơn không làm thay đổi nhân viên phụ trách của khách.

Quyền điểm bán hiện trường vẫn theo phân công tuyến; quyền khách Công Ty dùng nhân viên phụ trách trên dữ liệu Công Ty làm nguồn chuẩn.

## 4. Mở / liên kết mã

MCP gửi `FIELD_PROFILE_VERIFICATION` khi một điểm bán cần mở mới hoặc liên kết với khách Công Ty. Luồng này độc lập với đơn hàng.

Khách Công Ty đã tồn tại và đã được phân công đúng nhân viên không cần đi qua luồng này chỉ để bán hàng.

## 5. Trạng thái duyệt

Trạng thái đề nghị gồm:

`submitted`, `under_review`, `need_more_info`, `approved`, `linked_existing`, `rejected`, `cancelled`.

Quyền duyệt thuộc Công Ty. MCP chỉ gửi và đọc trạng thái.

## 6. Liên kết điểm bán

Trạng thái xác minh của điểm bán được lưu trên `mcp.mcp_route_customers`.

Khi điểm bán được duyệt hoặc liên kết, MCP lưu tham chiếu khách và địa chỉ Công Ty. Liên kết này có giá trị cho nguồn phát sinh, hình ảnh và nghiệp vụ hiện trường, nhưng không còn là điều kiện bắt buộc để một khách Công Ty đã hợp lệ được tạo đơn.

## 7. Giao diện khách hàng

`/customers` hiển thị khách Công Ty theo phạm vi nhân viên phụ trách; tài khoản chủ hệ thống có thể xem toàn installation.

`/customers/onboarding` hiển thị các điểm bán MCP và trạng thái mở / liên kết mã.

Hai danh sách phục vụ hai mục đích khác nhau và không được ép khách Công Ty đã có phải mở mã lại.

## 8. Tạo đơn chính thức

Điều kiện đủ để tạo đơn từ MCP:

- khách Công Ty đang hoạt động;
- khách có địa chỉ giao hàng đang hoạt động;
- với nhân viên thường: khách đang được Công Ty phân công đúng nhân viên đăng nhập;
- với tài khoản chủ hệ thống: khách nằm trong cùng installation.

Luồng chuẩn:

```text
khách Công Ty hợp lệ
-> /orders
-> MCP kiểm tra quyền theo nhân viên phụ trách và địa chỉ
-> nếu có đúng một Điểm bán MCP đã liên kết thì giữ tham chiếu Điểm bán làm nguồn
-> MCP gọi API đơn bán hàng Công Ty
-> Công Ty xác định giá, thuế, kênh bán và chính sách thương mại
```

`sourceId` vẫn là định danh idempotency chuẩn. `sourceOutletId` là thông tin nguồn **tùy chọn**: chỉ ghi khi có một liên kết Điểm bán MCP rõ ràng. Không có `sourceOutletId` không được dùng để chặn khách Công Ty hợp lệ tạo đơn.

Retry cùng thao tác phải dùng lại đúng Idempotency-Key cũ.

## 9. Luồng cũ

Luồng order-intent theo phiên cũ không còn là đường tạo đơn chính thức. `Có mua / Có đơn` chỉ là dữ liệu báo cáo và không tự tạo khách hoặc đơn.

## 10. Điều kiện nghiệm thu

- khách Công Ty import sẵn, đang hoạt động, có địa chỉ và đúng nhân viên phụ trách tạo đơn được ngay mà không mở mã lại;
- nhân viên không tạo được đơn cho khách thuộc nhân viên khác;
- tài khoản chủ hệ thống có thể thao tác toàn installation mà không đổi nhân viên phụ trách;
- điểm bán MCP chưa có khách Công Ty vẫn dùng luồng mở / liên kết mã;
- nếu đã có liên kết Điểm bán thì đơn giữ tham chiếu nguồn đó;
- nếu chưa có liên kết Điểm bán thì đơn MCP vẫn hợp lệ với `sourceOutletId = NULL`;
- giá và chính sách thương mại vẫn do Công Ty quyết định;
- Idempotency-Key dùng generator/contract chuẩn và retry dùng lại cùng key;
- CI đúng HEAD phải xanh trước merge.

Merge, migration và deploy production vẫn cần lệnh riêng.
