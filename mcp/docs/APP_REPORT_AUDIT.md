# Audit app report để làm lại MCP-Plan dễ dùng

Ngày audit: 2026-07-04

Repo reference:

```text
https://github.com/gustavjung01/report.git
```

Repo đang làm:

```text
https://github.com/minhmannguyengdp-sketch/MCP-Plan.git
```

## 1. Kết luận ngắn

Không tiếp tục sửa lẻ UI hiện tại. Càng sửa từng card/popup riêng lẻ càng rối vì app chưa có lại sitemap nghiệp vụ rõ ràng.

Cần làm lại theo hướng:

```text
Home -> chọn nghiệp vụ
Dữ liệu -> xem/tìm/sửa dữ liệu đã tạo
MCP -> đi tuyến hôm nay
Đơn -> tạo/xem đơn
Test -> tạo file test và nhập khách test
Báo cáo -> ghi nhận thị trường
Admin -> đồng bộ/cấu hình
```

## 2. Điểm tốt của app report nên học

### 2.1 Home là nơi chọn nghiệp vụ

App report không đẩy người dùng vào một route kỹ thuật. Home có 4 card rõ:

```text
MCP tuyến
Đơn hàng
Test sản phẩm
Báo cáo
```

Ý nghĩa tốt: người dùng nhìn thấy ngay mình đang làm nghiệp vụ nào.

### 2.2 Bottom nav không nhồi module nghiệp vụ

Bottom nav của report chỉ có:

```text
Home
Dữ liệu
AI
Admin
```

Nghiệp vụ nằm trong Home và Dữ liệu, không nhồi hết xuống bottom nav.

### 2.3 Test sản phẩm có luồng dễ hiểu

README report chốt luồng Test:

```text
1. Tạo file test tổng
2. Nhập sản phẩm cần test
3. Sang Dữ liệu test
4. Mở file test
5. Thêm khách vào file test
6. Mỗi khách chỉ test các sản phẩm đã chọn trong file tổng
```

Điểm quan trọng: tạo file tổng trước, sau đó mới thêm khách và kết quả.

### 2.4 Dữ liệu kỹ thuật nằm dưới, UI dùng chữ nghiệp vụ

App report có data model khá đầy đủ nhưng UI không bắt người dùng hiểu table/id. Người dùng thao tác theo:

```text
File test
Khách
Sản phẩm
Trạng thái
Đồng bộ
```

Không nên hiện ID kiểu `msc_...` trên card/popup.

## 3. Điểm xấu của app report không nên bê nguyên

### 3.1 Code root đang là runtime ngắn, khó mở rộng

`test-first-app.js` đang gom nhiều việc trong một file:

```text
render UI
modal
sync
Supabase REST
local DB
business logic
```

Không nên bê kiến trúc này sang MCP-Plan vì MCP-Plan cần backend/API rõ layer.

### 3.2 CSS trong index quá nhiều

`index.html` chứa inline CSS rất dài. Cách này dễ làm nhanh nhưng khó bảo trì khi app lớn.

MCP-Plan nên giữ component + CSS module/global theo layer.

### 3.3 Một số tên vẫn còn kỹ thuật

Report vẫn có `mcpRoutes`, `mcpRouteSessions`, `onaTests`, nhưng nên chỉ giữ ở data layer, không đưa lên UI.

## 4. Vì sao MCP-Plan hiện đang rối

### 4.1 Bottom nav đi thẳng vào phiên ngày

Hiện nav MCP-Plan:

```text
MCP -> /visits
```

Tức là người dùng bấm MCP là vào phiên MCP ngày, trong khi còn chưa thấy rõ:

```text
Tuyến gốc ở đâu?
Mở phiên ở đâu?
Hôm nay đang đi tuyến nào?
```

### 4.2 /routes và /visits bị đặt theo route kỹ thuật

Người dùng không cần biết `/routes` là gì. Người dùng cần thấy:

```text
Tuyến MCP
Đi tuyến hôm nay
```

### 4.3 Popup đang lộ tư duy database

Các chữ không nên xuất hiện với người dùng:

```text
Session customer
source
planned
msc_...
route_id
session_id
```

Nên đổi thành:

```text
Khách theo tuyến
Khách phát sinh
Trạng thái ghé
Có đơn
Có test
Có báo cáo
Cần theo dõi lại
```

### 4.4 Một màn đang ôm quá nhiều việc

Màn `/visits` hiện vừa:

```text
xem phiên ngày
xem khách
lọc kết quả
ghi đơn
ghi test
ghi báo cáo
tạo follow-up
```

Nên tách trải nghiệm thành flow rõ:

```text
Danh sách khách -> Mở khách -> Chọn kết quả -> Lưu
```

Không show tất cả trạng thái/kỹ thuật ngay trên card.

## 5. Sitemap đề xuất cho MCP-Plan

### 5.1 Bottom nav mới

```text
Tổng quan
Làm việc
Dữ liệu
Báo cáo
Admin
```

Hoặc bản gọn hơn:

```text
Home
Đi tuyến
Đơn
Dữ liệu
Admin
```

Không nên để `Test`, `Plan`, `MCP`, `Routes` cùng một cấp nếu người dùng chưa hiểu.

### 5.2 Home

Home chỉ là cổng vào nghiệp vụ:

```text
Card: Đi tuyến hôm nay
Card: Tuyến MCP
Card: Đơn hàng
Card: Test sản phẩm
Card: Báo cáo thị trường
Card: Công việc cần xử lý
```

### 5.3 Đi tuyến hôm nay

Màn này thay cho `/visits` trong UI.

Header phải rõ:

```text
Đi tuyến hôm nay
Tuyến: Chợ Gạo - Thứ 6
Ngày: 2026-07-04
Sale: A Nam
```

Card khách chỉ cần:

```text
#1 Say Me
Tân Mỹ Chánh
Chờ ghé / Đã ghé / Bỏ qua
Chưa ghi kết quả / Có đơn / Có test / Có báo cáo

[Mở] [Ghi đơn]
```

Popup khách:

```text
Tên khách
Địa chỉ/khu vực
Trạng thái ghé
Các nút hành động:
- Check-in
- Có đơn
- Không mua
- Có test
- Báo cáo thị trường
- Hẹn ghé lại
```

### 5.4 Tuyến MCP

Màn này thay cho `/routes` trong UI.

Dùng để quản lý tuyến gốc:

```text
Tuyến Thứ 2
Tuyến Chợ Gạo
Tuyến Mỹ Tho
Tuyến Gò Công
```

Mỗi tuyến có:

```text
Tên tuyến
Khu vực
Sale phụ trách
Số khách
Số khách thiếu GPS
Trạng thái
```

Các hành động:

```text
Xem khách
Chuẩn bị phiên hôm nay
Sửa tuyến
```

### 5.5 Dữ liệu

Giống app report, nên có hub dữ liệu:

```text
MCP
Đơn
Test
Báo cáo
Khách
```

Dữ liệu là nơi xem lại, chỉnh sửa, lọc, xuất file.

### 5.6 Test sản phẩm

Nên học trực tiếp luồng report:

```text
Tạo file test
Chọn sản phẩm test
Mở file test
Thêm khách test
Ghi kết quả từng sản phẩm
```

Không gọi chung là field-checks/market-checks trên UI.

## 6. Nguyên tắc UI mới

```text
1. Không hiện route kỹ thuật: /routes, /visits, session, id.
2. Mỗi màn trả lời một câu hỏi nghiệp vụ.
3. Card chỉ hiện 3 dòng chính + 1-2 nút.
4. Popup chỉ dùng để xử lý 1 khách/1 đơn/1 file test.
5. Chỉ show ID trong admin/debug, không show ở màn sale.
6. Bottom nav không nhồi quá nhiều module con.
7. Dữ liệu master và dữ liệu phiên ngày phải tách rõ.
```

## 7. Đề xuất thứ tự làm lại

### Phase 0 - Khóa sửa lẻ

```text
[ ] Không sửa thêm màu/card/popup riêng lẻ
[ ] Không thêm banner test vào UI live nữa
[ ] Không sửa safe-area/menu cho tới khi sitemap chốt
```

### Phase 1 - Chốt sitemap

```text
[ ] Chốt bottom nav mới
[ ] Chốt tên màn theo nghiệp vụ
[ ] Chốt Home là cổng vào module
[ ] Chốt Dữ liệu là nơi xem lại
```

### Phase 2 - Làm Home mới

```text
[ ] Home có card Đi tuyến hôm nay
[ ] Home có card Tuyến MCP
[ ] Home có card Đơn hàng
[ ] Home có card Test sản phẩm
[ ] Home có card Báo cáo thị trường
[ ] Home có card Việc cần xử lý
```

### Phase 3 - Làm Đi tuyến hôm nay

```text
[ ] Header hiện tuyến/ngày/sale rõ
[ ] Card khách gọn
[ ] Popup khách bỏ ID kỹ thuật
[ ] Hành động khách theo tiếng người
```

### Phase 4 - Làm Tuyến MCP

```text
[ ] Danh sách tuyến gốc
[ ] Khách trong tuyến
[ ] GPS
[ ] Chuẩn bị phiên ngày
```

### Phase 5 - Làm Test sản phẩm theo report

```text
[ ] Tạo file test
[ ] Chọn sản phẩm
[ ] Thêm khách
[ ] Ghi kết quả từng sản phẩm
```

## 8. Chốt hướng

Không dùng app report để copy UI y nguyên.

Dùng report để học 3 ý:

```text
1. Home là cổng vào nghiệp vụ.
2. Dữ liệu là hub xem lại.
3. Test sản phẩm là flow theo file -> khách -> kết quả.
```

MCP-Plan phải làm lại UI theo nghiệp vụ NPP, không theo route kỹ thuật.
