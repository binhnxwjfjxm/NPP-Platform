# Hướng dẫn sử dụng NPP Operations

> Trạng thái: **Cập nhật theo chức năng hiện có trên `main`**  
> Ngày cập nhật: **2026-08-08**  
> Địa chỉ sử dụng: `https://office.nguyenlieuhungphat.com`  
> Phạm vi: NPP Operations và các màn liên quan trực tiếp đến công việc vận hành hằng ngày.
>
> **Lưu ý triển khai:** tài liệu mô tả chức năng đã có trên source `main`. Deploy/migration production là bước riêng. Nếu production chưa thấy một màn hoặc một nút đã nêu, trước tiên kiểm tra trạng thái rollout và quyền tài khoản; không tự tạo dữ liệu hoặc dùng đường tắt để vượt quyền.

---

## 1. Cách đọc tài liệu

Mỗi chức năng dùng một trong ba trạng thái:

- **Đã có trên hệ thống:** có màn và luồng xử lý thật trên `main`.
- **Sử dụng theo quyền:** chức năng có thật nhưng chỉ tài khoản được cấp permission/phạm vi phù hợp mới thấy hoặc thao tác.
- **Chưa xác nhận vận hành production:** source đã có nhưng production còn gate cấu hình, migration, deploy hoặc bằng chứng cần kiểm tra.

Nguyên tắc chung:

1. Không dùng tài khoản người khác.
2. Không tự thử thao tác ghi dữ liệu production khi chưa được phân công.
3. Nếu không thấy nút, kiểm tra quyền và trạng thái chứng từ trước khi coi là lỗi.
4. Không sửa trực tiếp số tồn, dữ liệu đã post hoặc lịch sử để “cho khớp”.
5. Không bấm gửi/lưu lặp lại khi gặp lỗi; đọc thông báo rồi xử lý nguyên nhân.

---

## 2. Đăng nhập và giao diện chung

**Trạng thái: Đã có trên hệ thống.**

### Đăng nhập

1. Truy cập `https://office.nguyenlieuhungphat.com`.
2. Nhập tài khoản và mật khẩu được cấp.
3. Chọn **Đăng nhập**.
4. Chờ hệ thống mở NPP Operations.

### Kết quả đúng

- Trang NPP Operations mở thành công.
- Menu hiển thị theo quyền tài khoản.
- Không báo hết phiên hoặc không có quyền.

### Dùng menu và danh sách

1. Chọn đúng nhóm nghiệp vụ như **Bán hàng**, **Mua hàng**, **Tồn kho**, **Kế toán & công nợ**, **Giao nhận & điều phối**, **Nhân sự & phân quyền**.
2. Chọn màn cần làm.
3. Dùng tìm kiếm và bộ lọc trước khi mở chi tiết.
4. Khi có bộ lọc kho, chỉ chọn kho thuộc phạm vi được cấp.
5. Khi trang có khoảng ngày, kiểm tra đúng kỳ cần xem trước khi kết luận số liệu.

### Đọc trạng thái

Một chứng từ có thể đồng thời có:

- trạng thái nghiệp vụ;
- trạng thái xử lý hàng;
- trạng thái giao hàng;
- trạng thái thanh toán.

Không hiểu “đã xác nhận đơn” là “đã giao hàng” hoặc “đã thanh toán”.

---

## 3. Tổ chức, chi nhánh, kho và vị trí kho

**Trạng thái: Xem theo quyền; tạo/sửa phụ thuộc permission.**

### Cách kiểm tra

1. Mở nhóm **Tổ chức** hoặc màn cơ cấu tương ứng.
2. Chọn chi nhánh, kho hoặc vị trí.
3. Tìm theo mã hoặc tên.
4. Kiểm tra trạng thái hoạt động.
5. Khi dùng trên chứng từ, chỉ chọn bản ghi còn hoạt động và đúng phạm vi.

### Quy tắc

- Kho phải thuộc đúng chi nhánh.
- Không dùng vị trí đã ngừng hoạt động.
- Không tạo kho/vị trí giả để giải quyết một tình huống nghiệp vụ.
- Không thấy nút tạo/sửa không có nghĩa là lỗi; có thể tài khoản chỉ có quyền xem.

---

## 4. Khách hàng và điểm bán MCP

**Trạng thái: Đã có dữ liệu và luồng phân biệt rõ; sử dụng theo quyền.**

### Phân biệt

- **Khách hàng Core:** đã có mã khách chính thức, dùng cho Sales Order, giao hàng và công nợ.
- **Điểm bán MCP:** điểm ngoài thị trường phục vụ tuyến/phiên; không tự động trở thành khách hàng Core.

Điểm bán MCP chỉ trở thành khách dùng cho đơn chính thức khi đã được **tạo mới hoặc liên kết** với khách Core theo đúng luồng.

### Kiểm tra khách trước khi xử lý đơn

1. Tìm theo mã, tên, số điện thoại hoặc địa chỉ.
2. Kiểm tra khách còn hoạt động.
3. Kiểm tra địa chỉ giao hàng.
4. Nếu chưa có mã khách, chuyển sang hàng đợi **Mở / liên kết mã khách**.
5. Không tự tạo bản ghi trùng chỉ vì tên gần giống.

---

## 5. Mở hoặc liên kết mã khách

**Trạng thái: Có màn xử lý; hành động cuối phụ thuộc quyền.**

Đường dẫn nghiệp vụ hiện hữu: `/management/customer-onboarding`.

### Cách xử lý

1. Mở đề nghị cần kiểm tra.
2. Đối chiếu tên điểm bán/khách đề xuất.
3. Kiểm tra số điện thoại và địa chỉ.
4. Tìm khách hiện có để tránh trùng.
5. Kiểm tra nguồn đề nghị và thông tin còn thiếu.
6. Chọn hành động được tài khoản cho phép.

### Kết quả có thể có

- tạo khách mới;
- liên kết khách hiện có;
- yêu cầu bổ sung thông tin;
- từ chối;
- chuyển ngoại lệ cho cấp quản lý.

### Lưu ý

Các trường hợp rủi ro công nợ, khách bị khóa, hạn mức hoặc ngoại lệ đặc biệt phải chuyển đúng cấp xử lý. Không suy đoán rằng cùng tên là cùng khách.

---

## 6. Hàng hóa, SKU, đơn vị và giá

**Trạng thái: Tra cứu và dùng trong nghiệp vụ theo quyền.**

### Trước khi chọn SKU

1. Kiểm tra đúng SKU, không chỉ nhìn tên sản phẩm chung.
2. Kiểm tra đơn vị tính.
3. Kiểm tra quy đổi nếu bán/mua theo thùng, gói hoặc đơn vị khác.
4. Kiểm tra trạng thái hoạt động.
5. Kiểm tra giá hệ thống trả về.

### Khi giá bất thường

- Không tự sửa ngoài chính sách nếu không có quyền override.
- Không dùng SKU ngừng hoạt động.
- Nếu giá đang chờ hoặc không giải thích được, dừng bước xác nhận và báo người phụ trách giá.

---

## 7. Điều hành bán hàng

**Trạng thái: Có màn tổng hợp công việc bán hàng hằng ngày.**

Đường dẫn chính: `/management`.

Màn này dùng để theo dõi nhu cầu bán hàng, đơn cần xử lý và đề nghị mở/liên kết mã khách. Đây là công việc của NPP Operations; Admin MCP/NPP không thay thế màn vận hành hằng ngày.

### Cách dùng

1. Mở **Điều hành bán hàng**.
2. Xem các việc đang chờ.
3. Mở đơn cần kiểm tra hoặc hàng đợi mã khách.
4. Đối chiếu khách, kho, nguồn đơn và thời điểm cập nhật.
5. Chỉ thực hiện hành động khi nút được hiển thị theo quyền.

---

## 8. Đơn bán hàng

**Trạng thái: Đã có luồng tạo, xem, sửa nháp, xác nhận, điều chỉnh và hủy theo quyền trên `main`.**

Đường dẫn: `/sales/sales-orders`.

### Xem danh sách và lọc nguồn

Danh sách có bộ lọc:

- **Tất cả**
- **Nội bộ**
- **MCP**
- **Khách hàng**

Nguồn chỉ giúp phân loại một danh sách Sales Order canonical; không tạo các loại đơn riêng biệt.

### Kiểm tra đơn

1. Tìm theo số đơn, khách hoặc kênh bán.
2. Chọn trạng thái nếu cần.
3. Chọn **Nguồn** nếu cần đối chiếu.
4. Mở đơn.
5. Kiểm tra khách, kho, kênh bán, địa chỉ và các dòng hàng.
6. Kiểm tra số lượng, đơn vị, giá và ghi chú.
7. Đọc riêng trạng thái đơn, fulfillment, delivery và settlement.

### Tạo đơn

Nếu tài khoản có quyền, màn hiển thị **Tạo đơn bán hàng**.

1. Chọn khách chính thức.
2. Chọn địa chỉ, kho và kênh bán đúng phạm vi.
3. Thêm SKU và số lượng.
4. Kiểm tra giá.
5. Lưu nháp.
6. Kiểm tra lại trước khi xác nhận.

### Xác nhận, điều chỉnh và hủy

- **Xác nhận:** cấp số/đưa đơn vào trạng thái xác nhận theo luồng.
- **Điều chỉnh:** tạo phiên bản điều chỉnh nháp; lịch sử cũ vẫn được giữ.
- **Xác nhận điều chỉnh:** phiên bản mới trở thành hiệu lực.
- **Hủy:** phải có lý do và quyền phù hợp.

Không sửa trực tiếp lịch sử đơn đã xác nhận.

---

## 9. Mua hàng

**Trạng thái: Có nghiệp vụ Purchase Order, nhận hàng và các báo cáo liên quan; thao tác theo quyền.**

Các màn mua hàng có thể gồm Purchase Order, Goods Receipt, trả hàng nhà cung cấp và công nợ/phải trả tùy permission.

### Quy tắc sử dụng

1. Chọn đúng nhà cung cấp.
2. Chọn đúng kho.
3. Kiểm tra SKU và đơn vị.
4. Phân biệt **đặt mua** với **nhận hàng thực tế**.
5. Chứng từ đã post không sửa/xóa trực tiếp.
6. Sai sau khi post phải dùng nghiệp vụ đảo/điều chỉnh được hệ thống hỗ trợ.

---

## 10. Tổng quan tồn kho

**Trạng thái: Đã có workspace điều hướng và các nghiệp vụ kho nâng cao trên `main`.**

Nhóm **Tồn kho & lô hàng** tập trung các màn:

- tồn khả dụng/số dư;
- chứng từ và ledger;
- chuyển kho;
- kiểm kê;
- điều chỉnh tồn;
- giá vốn;
- báo cáo tồn kho.

### Nguyên tắc bắt buộc

- Inventory ledger là nguồn sự thật cho movement.
- Không sửa trực tiếp số tồn.
- Reservation không phải hàng đã xuất.
- Hàng đang chuyển chưa phải tồn khả dụng tại kho đích.
- Chứng từ đã post không sửa/xóa trực tiếp.
- Sai phải dùng reversal, stocktake hoặc adjustment đúng nghiệp vụ.

---

## 11. Chuyển kho và hàng đang đi đường

**Trạng thái: Đã có trên `main`; sử dụng theo quyền kho.**

Đường dẫn: `/inventory/transfers`.

### Tạo và xuất chuyển kho

1. Tạo phiếu chuyển kho.
2. Chọn kho nguồn và kho đích.
3. Chọn SKU/số lượng.
4. Lưu nháp.
5. Người có quyền duyệt thực hiện duyệt.
6. Người có quyền xuất thực hiện dispatch.

Sau dispatch, hàng rời kho nguồn và được theo dõi là **đang đi đường**; kho đích chưa tăng tồn chỉ vì phiếu đã xuất.

### Nhận hàng tại kho đích

Hệ thống hỗ trợ nhận nhiều lần.

Khi nhận:

1. Mở phiếu đã dispatch.
2. Ghi số lượng thực nhận đạt.
3. Ghi riêng hư hỏng, thừa hoặc thiếu nếu có.
4. Chọn vị trí nhập cho phần đạt.
5. Xác nhận lần nhận.

### Chênh lệch

- Phần chưa nhận tiếp tục là in-transit.
- Hàng thừa không tự cộng vào tồn.
- Hàng hư không tự vào tồn khả dụng.
- Thiếu phải được xử lý bằng resolution có lý do và quyền.
- Reversal chỉ được phép khi chưa có downstream movement chặn việc đảo.

---

## 12. Kiểm kê kho

**Trạng thái: Đã có luồng kiểm kê thực tế trên `main`; sử dụng theo quyền.**

Đường dẫn: `/inventory/stocktakes`.

Hệ thống hỗ trợ kiểm kê toàn phần hoặc một phạm vi được chọn.

### Luồng cơ bản

1. Tạo phiếu kiểm kê.
2. Chọn kho/phạm vi cần đếm.
3. Lưu phạm vi snapshot.
4. Nhập số đếm thực tế.
5. Đếm lại khi cần.
6. Gửi/hoàn tất vòng đếm theo trạng thái màn hình.
7. Người có quyền duyệt kiểm tra chênh lệch.
8. Người có quyền post ghi kết quả vào inventory movement.

### Quy tắc

- Lịch sử các vòng đếm được giữ lại.
- Người gửi không tự duyệt cùng phiên bản nếu rule tách nhiệm vụ áp dụng.
- Nếu có movement làm thay đổi phạm vi sau snapshot, hệ thống có thể chặn submit/approve/post để tránh dùng số đếm cũ.
- Chênh lệch được hệ thống tính; không sửa balance trực tiếp.
- Chênh lệch bằng 0 không tạo movement rỗng.

---

## 13. Điều chỉnh tồn, cách ly, hư hỏng và tiêu hủy

**Trạng thái: Đã có trên `main`; sử dụng theo quyền và lý do.**

Đường dẫn: `/inventory/adjustments`.

### Các trường hợp

- điều chỉnh số lượng có lý do;
- chuyển hàng sang cách ly;
- ghi nhận hàng hư hỏng;
- tiêu hủy/scrap theo quy trình.

### Luồng chung

1. Tạo phiếu nháp.
2. Chọn kho, SKU/vị trí và lý do.
3. Nhập số lượng theo yêu cầu màn hình.
4. Gửi duyệt.
5. Người có quyền khác kiểm tra và duyệt.
6. Post để tạo movement tương ứng.

### Quy tắc

- Lý do là bắt buộc theo catalog của hệ thống.
- Người tạo và người duyệt có thể bị tách quyền.
- Hàng cách ly/hư không được coi là tồn khả dụng.
- Không dùng adjustment như đường tắt để sửa sai cho chứng từ nguồn.
- Sai sau post dùng reversal/luồng được hệ thống cho phép.

---

## 14. Giá vốn tồn kho và kỳ giá vốn

**Trạng thái: Đã có trên `main`; phần thao tác nhạy cảm chỉ dành cho tài khoản được cấp quyền.**

Đường dẫn: `/inventory/costing`.

Hệ thống sử dụng giá vốn bình quân gia quyền di động theo kho và SKU cơ sở.

### Người dùng có thể kiểm tra

- số dư giá vốn;
- dữ kiện/fact giá vốn;
- đối soát quantity và costing;
- bất thường/anomaly;
- kỳ giá vốn;
- chênh lệch cần xử lý.

### Kỳ giá vốn

- Kỳ **OPEN** có thể nhận xử lý backdate theo quy tắc hệ thống.
- Kỳ **CLOSED** giữ lịch sử bất biến.
- Movement tới muộn thuộc kỳ đã đóng không được âm thầm viết lại quá khứ; phải đi qua forward correction/discrepancy đúng luồng.
- Reversal dùng giá vốn lịch sử của event gốc, không dùng giá bình quân hiện tại để đoán.

### Không được làm

- Không overwrite trực tiếp giá trị tồn.
- Không sửa quantity ledger để làm cho costing “khớp”.
- Không tự xử lý anomaly bằng số 0 nếu chưa có nguồn giá hợp lệ.

---

## 15. Fulfillment và Delivery Order

**Trạng thái: Có luồng vận hành; sử dụng theo quyền.**

Luồng tổng quát:

```text
Sales Order
→ Fulfillment / Allocation
→ Delivery Order
→ Delivery Trip / Delivery Attempt
```

### Cách đọc

1. Mở Sales Order.
2. Kiểm tra phần hàng được phân bổ.
3. Kiểm tra Delivery Order thuộc phần hàng nào.
4. Kiểm tra chuyến và từng lần giao.
5. Không kết luận toàn bộ đơn hoàn tất chỉ vì một lần giao thành công.

### Quy tắc

- Một Sales Order có thể có nhiều Delivery Order.
- Giao một phần không hoàn tất toàn bộ đơn.
- Giao thất bại phải giữ phần còn cần xử lý.
- Trạng thái giao hàng và thanh toán là hai trục khác nhau.

---

## 16. Điều phối chuyến, kết quả giao và đối soát cuối chuyến

**Trạng thái: Có chức năng; sử dụng theo quyền logistics/kho.**

### Theo dõi chuyến

1. Mở danh sách chuyến.
2. Chọn chuyến.
3. Kiểm tra tài xế, phương tiện, kho và các điểm giao.
4. Kiểm tra Delivery Order được gán.
5. Xem kết quả từng delivery attempt.

### Đối soát cuối chuyến

1. Kiểm tra lượng đã xuất lên xe.
2. Kiểm tra lượng đã giao.
3. Kiểm tra lượng trả về kho.
4. Kiểm tra phần còn chưa xử lý.
5. Kho chỉ nhận hàng về khi thực tế đã nhận.
6. Chỉ đóng chuyến khi toàn bộ điểm giao đã có kết quả và số lượng đã được giải quyết.

### Bằng chứng giao hàng

Nếu delivery attempt có bằng chứng:

- xem loại bằng chứng và thời điểm;
- mở ảnh qua liên kết được hệ thống cấp;
- không chia sẻ link tạm ra ngoài công việc;
- không có ảnh không tự động có nghĩa lần giao không hợp lệ.

---

## 17. Báo cáo bán hàng

**Trạng thái: Có trên `main`; đọc theo permission và phạm vi kho.**

Đường dẫn: `/sales/reporting`.

### Dùng báo cáo

1. Chọn khoảng ngày.
2. Chọn kho nếu tài khoản có nhiều kho.
3. Xem tổng hợp đơn hiệu lực, trạng thái và xu hướng.
4. Xem nhóm khách/SKU nổi bật.
5. Dùng liên kết drill-down để mở danh sách đơn thật khi cần đối chiếu.

Báo cáo không thay thế Sales Order. Khi số tổng hợp bất thường, luôn drill-down về chứng từ nguồn.

---

## 18. Báo cáo mua hàng

**Trạng thái: Có trên `main`; đọc theo permission và phạm vi kho.**

Đường dẫn: `/purchasing/reporting`.

Báo cáo giúp theo dõi:

- Purchase Order trong kỳ;
- nhận hàng;
- trạng thái đơn mua;
- nhà cung cấp/SKU nổi bật;
- luồng từ đặt mua tới thực nhận.

Không cộng lẫn đặt mua với hàng đã nhận như cùng một sự kiện.

---

## 19. Báo cáo tồn kho

**Trạng thái: Có trên `main`; đọc theo permission và phạm vi kho.**

Đường dẫn: `/inventory/reporting`.

Có thể theo dõi:

- nhập – xuất – tồn theo kỳ;
- tồn hiện tại;
- reserved và available;
- giá trị tồn/giá bình quân;
- hàng chậm luân chuyển;
- tuổi lô/hạn dùng khi có dữ liệu lot;
- ngoại lệ quantity ↔ costing.

### Khi đọc số liệu

- Không cộng quantity của SKU khác nhau thành một “tổng số lượng” vô nghĩa.
- Aging chỉ dùng dữ liệu ngày sản xuất/hạn dùng canonical khi có.
- Khi có reconciliation exception, mở màn costing/ledger để đối chiếu nguồn.

---

## 20. Tuổi nợ và lãi gộp

### Tuổi nợ

**Đường dẫn:** `/accounting/aging`

Theo dõi công nợ phải thu/phải trả theo nhóm tuổi, đối tác, chứng từ, kho và currency theo dữ liệu hiện có.

Không cộng tiền khác currency thành một tổng chung.

### Lãi gộp

**Đường dẫn:** `/sales/gross-margin`

Theo dõi doanh thu ghi nhận, giá vốn và lãi gộp từ lineage Sales + Inventory Costing.

Khi thiếu cost lineage hoặc có anomaly, phần đó được đưa ra ngoại lệ; không tự coi giá vốn bằng 0.

---

## 21. Hiệu suất nhân viên / MCP Field

**Trạng thái: Có trên `main`; sử dụng theo quyền báo cáo nhân sự/MCP.**

Đường dẫn: `/access/employees/performance`.

Màn hiện có 5 tab:

1. **Tổng quan**
2. **Tuyến & phiên**
3. **Điểm bán / lượt ghé**
4. **Nhu cầu & đơn hàng**
5. **Hiệu quả hoạt động**

### Các số chính

- số phiên và tuyến;
- điểm kế hoạch / đã ghé;
- check-in / visit;
- order intent;
- onboarding đã gửi / đã chuyển đổi;
- Sales Order Core phát sinh từ lineage MCP;
- tỷ lệ hoàn thành và chuyển đổi.

### Cách hiểu đúng

- Điểm bán field chưa onboarding không tự thành khách Core.
- `area` của MCP chỉ là mô tả khu vực, không tự được coi là territory quyền.
- Nhân viên chỉ được map khi mã field actor khớp dữ liệu nhân viên canonical; không đoán theo tên gần giống.
- Khi báo cáo hiện “chưa map mã nhân viên” hoặc counter mismatch, đó là ngoại lệ dữ liệu cần đối chiếu, không nên sửa số tay.

---

## 22. Hiệu suất giao hàng / logistics

**Trạng thái: Có trên `main`; đọc theo quyền logistics.**

Đường dẫn: `/logistics/reporting`.

Có thể theo dõi:

- số chuyến, điểm giao và Delivery Order;
- kết quả giao đủ/một phần/thất bại/dời lịch;
- SLA đúng giờ khi có planned arrival hợp lệ;
- hiệu suất theo tài xế/phương tiện;
- lý do thất bại hoặc dời lịch;
- ngoại lệ thiếu SLA/reconciliation.

Không tự suy ra phần trăm “tải xe” nếu hệ thống chưa có dữ kiện tải thực tế canonical.

---

## 23. COD và đối soát tiền giao hàng

**Trạng thái: Có báo cáo và màn đối soát riêng; sử dụng theo quyền kế toán/COD.**

### Báo cáo COD

Đường dẫn: `/accounting/cod-reporting`.

Dùng để xem:

- tiền mặt tài xế đang giữ;
- thu tiền trong kỳ;
- bàn giao đang chờ kế toán nhận;
- tiếp nhận/chênh lệch;
- lời hẹn thu quá hạn;
- ngoại lệ lifecycle hoặc currency lineage.

### Màn thao tác đối soát

Các mutation chấp nhận/bàn giao/đảo được thực hiện tại workspace đối soát tương ứng, không làm trực tiếp trên báo cáo read-only.

### Quy tắc

- BANK_TRANSFER không phải cash custody.
- Current cash custody không biến mất chỉ vì lần thu nằm ngoài kỳ báo cáo.
- Không cộng chéo nhiều currency.

---

## 24. Lịch sử audit và import/export

**Trạng thái: Có màn lịch sử read-only trên `main`.**

### Lịch sử audit

Đường dẫn: `/operations/audit-history`.

Dùng để kiểm tra ai/luồng nào đã thực hiện hành động, thời điểm và đối tượng nghiệp vụ theo dữ liệu audit được phép hiển thị.

### Lịch sử import/export

Đường dẫn: `/operations/import-export-history`.

Dùng để xem metadata các job import/export canonical như thời gian, trạng thái và kết quả tổng quát.

### Quy tắc

- Đây là lịch sử vận hành, không phải nơi sửa dữ liệu.
- Dữ liệu nhạy cảm/payload trước-sau không nhất thiết được hiển thị.
- Browser CSV hoặc file export cũ không tự động được coi là canonical import/export history.

---

## 25. Vai trò và phân quyền

**Trạng thái: Hệ thống dùng permission + scope; deny-by-default.**

Đường dẫn quản lý vai trò: `/access/roles` khi tài khoản có quyền.

### Nguyên tắc

- Tên vai trò không tự quyết định quyền nghiệp vụ.
- Quyền thật nằm ở permission được gán và phạm vi dữ liệu của tài khoản.
- Preset vai trò chỉ là **gợi ý ban đầu**.
- Người có quyền quản trị có thể thêm/bớt permission trước khi lưu và sửa lại sau.
- Backend vẫn kiểm tra permission/scope; ẩn nút trên giao diện không phải cơ chế bảo mật duy nhất.

### Khi người dùng không thấy chức năng

Kiểm tra theo thứ tự:

1. tài khoản còn hoạt động;
2. permission của vai trò;
3. phạm vi kho/chi nhánh/nhân viên;
4. trạng thái chứng từ;
5. production đã rollout phiên bản có chức năng đó chưa.

Không cấp quyền rộng chỉ để “test cho nhanh” trên production.

---

## 26. Admin MCP/NPP và ranh giới công việc

**Trạng thái: Ứng dụng riêng.**

Địa chỉ: `https://admin.nguyenlieuhungphat.com`.

NPP Operations là nơi xử lý nghiệp vụ hằng ngày. Admin dùng cho tổng hợp và ngoại lệ quản lý.

Admin Control Tower hiện có thể tổng hợp KPI/cảnh báo từ các báo cáo NPP, nhưng khi cần xử lý chi tiết phải drill-down về màn nghiệp vụ NPP tương ứng.

Không chuyển toàn bộ công việc hằng ngày sang Admin.

---

## 27. Nguồn đơn từ MCP và Customer Ordering

### MCP

MCP Field có thể tạo nhu cầu/order intent và đồng bộ thành Sales Order Core theo lineage đã thiết kế. Trong NPP, dùng bộ lọc **Nguồn = MCP** để kiểm tra.

### Customer Ordering

Source `main` đã có kết nối:

```text
Customer Ordering
→ Customer Portal server route
→ Core Customer Portal API
→ Catalog / giá / Sales Order canonical
```

Trong NPP, đơn từ nguồn này được phân loại **Khách hàng**.

**Trạng thái production tại lần cập nhật 2026-08-08: chưa xác nhận vận hành end-to-end.** Audit thực tế đang thấy `/api/customer-portal/catalog` trả HTTP 503 và Vercel Customer Ordering chưa được cấu hình `CORE_API_BASE_URL` tại thời điểm kiểm tra.

Vì vậy:

- không coi Customer Ordering → Core là đã vận hành production ổn cho tới khi cấu hình và smoke lại;
- không dùng mock data để thay thế kết luận production;
- sau khi kết nối được xác nhận, catalog/giá lấy từ Core còn Customer Ordering vẫn giữ bố cục UI của app khách.

---

## 28. Xử lý lỗi chung

### Trang không tải

1. Kiểm tra mạng.
2. Tải lại một lần.
3. Đăng nhập lại nếu hết phiên.
4. Ghi lại thời điểm, màn, thao tác và nội dung lỗi.
5. Báo người phụ trách nếu lỗi lặp lại.

### Không thấy nút

1. Kiểm tra đúng màn.
2. Kiểm tra trạng thái chứng từ.
3. Kiểm tra permission và scope.
4. Kiểm tra production đã rollout phiên bản tương ứng chưa.
5. Không dùng tài khoản người khác để làm thay.

### Lưu/gửi thất bại

1. Đọc thông báo.
2. Kiểm tra trường bắt buộc.
3. Kiểm tra khách/SKU/kho còn hoạt động.
4. Không bấm lặp nhiều lần.
5. Với thao tác có chống trùng/idempotency, không tự đổi dữ liệu rồi gửi lại nếu chưa hiểu kết quả lần trước.

### Số liệu báo cáo khác kỳ vọng

1. Kiểm tra kỳ ngày.
2. Kiểm tra kho/phạm vi.
3. Kiểm tra currency.
4. Drill-down về chứng từ/ledger nguồn.
5. Kiểm tra có exception/reconciliation warning hay không.
6. Không sửa chứng từ chỉ để làm báo cáo “đẹp”.

---

## 29. Checklist vận hành ngắn

### Đầu ngày

- Đăng nhập đúng tài khoản.
- Kiểm tra việc bán hàng đang chờ.
- Kiểm tra đơn cần xác nhận/xử lý theo quyền.
- Kiểm tra đề nghị mã khách.
- Kiểm tra tồn kho/chuyển kho có việc cần nhận.
- Kiểm tra chuyến giao/COD nếu thuộc trách nhiệm.
- Kiểm tra cảnh báo báo cáo liên quan vai trò.

### Cuối ngày

- Không để chứng từ nháp do chính mình tạo bị quên nếu cần bàn giao.
- Kiểm tra các phiếu chuyển còn đang đi đường bất thường.
- Kiểm tra stocktake/adjustment đang chờ duyệt/post.
- Kiểm tra chuyến chưa có đủ kết quả.
- Kiểm tra COD/bàn giao tiền nếu thuộc trách nhiệm.
- Ghi lại lỗi hoặc ngoại lệ chưa xử lý cho ca/người tiếp theo.

---

## 30. Phần chưa xác nhận vận hành production

Tại thời điểm 2026-08-08, kết nối **Customer Ordering → Core** đã có trên source nhưng production còn trả HTTP 503 khi tải catalog và cần cấu hình/smoke lại trước khi coi là vận hành ổn định.

Các gate hạ tầng, migration dữ liệu hoặc audit nội bộ không phải thao tác của người dùng NPP Operations nên không được đưa vào quy trình nghiệp vụ hằng ngày.

---

## 31. Quy tắc cập nhật tài liệu

Sau mỗi đợt chức năng thay đổi, tài liệu phải cập nhật cùng:

1. trạng thái chức năng;
2. vai trò/quyền;
3. đường dẫn màn;
4. tên hành động chính;
5. các bước thao tác;
6. điều kiện trước khi lưu/xác nhận/post;
7. kết quả đúng;
8. lỗi thường gặp;
9. trạng thái production nếu khác source `main`.

Không đưa tính năng dự kiến hoặc PR chưa merge vào hướng dẫn như thể đã hoạt động chính thức.
