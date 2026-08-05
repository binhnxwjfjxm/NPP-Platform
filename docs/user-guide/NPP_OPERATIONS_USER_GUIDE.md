# Hướng dẫn sử dụng NPP Operations

> Trạng thái tài liệu: **Cập nhật theo chức năng hiện có trên `main`**  
> Ngày cập nhật: **2026-08-05**  
> Đối tượng sử dụng: nhân sự vận hành NPP, Sales Admin, CS, kế toán, kho, quản lý bán hàng và các vai trò được cấp quyền phù hợp.  
> Phạm vi: chỉ hướng dẫn những phần đã có trong hệ thống ở thời điểm hiện tại. Những chức năng chưa hoàn thiện hoặc chưa chốt quyền được ghi rõ là **chưa sử dụng chính thức**.

---

## 1. Mục đích của tài liệu

Tài liệu này dùng để hướng dẫn người dùng thao tác trên NPP Operations theo đúng chức năng đang có.

Nguyên tắc cập nhật:

- Hệ thống làm đến đâu, tài liệu cập nhật đến đó.
- Không hướng dẫn một chức năng chỉ mới có trong kế hoạch nhưng chưa có giao diện hoặc chưa đủ điều kiện sử dụng.
- Không mặc định người dùng nào cũng được thao tác mọi chức năng.
- Quyền thực tế của từng tài khoản phụ thuộc cấu hình phân quyền trong hệ thống.
- Khi một chức năng chưa chốt ma trận quyền, tài liệu chỉ mô tả mục đích và trạng thái, không coi đó là chức năng đã sẵn sàng vận hành.

---

## 2. Địa chỉ truy cập

NPP Operations được sử dụng tại:

```text
https://office.nguyenlieuhungphat.com
```

Các ứng dụng khác trong cùng nền tảng:

```text
Website đặt hàng:          https://nguyenlieuhungphat.com
MCP Field:                 https://mcp.nguyenlieuhungphat.com
Delivery / Giao hàng:      https://log.nguyenlieuhungphat.com
Admin MCP/NPP:             https://admin.nguyenlieuhungphat.com
```

NPP Operations là nơi xử lý công việc vận hành hằng ngày. Admin MCP/NPP chỉ dùng cho tổng hợp và các ngoại lệ cần cấp quản lý, không thay thế công việc thường ngày của nhân viên NPP.

---

## 3. Đăng nhập

### 3.1 Cách đăng nhập

1. Mở trình duyệt trên máy tính.
2. Truy cập `https://office.nguyenlieuhungphat.com`.
3. Nhập thông tin đăng nhập được cấp.
4. Chọn **Đăng nhập**.
5. Sau khi đăng nhập thành công, hệ thống chuyển vào khu vực làm việc phù hợp với quyền của tài khoản.

### 3.2 Khi không đăng nhập được

Kiểm tra lần lượt:

- Đúng địa chỉ NPP Operations.
- Đúng tài khoản và mật khẩu.
- Tài khoản chưa bị khóa hoặc ngừng hoạt động.
- Tài khoản đã được gán đúng installation và vai trò.
- Kết nối mạng đang hoạt động.

Không gửi mật khẩu, mã truy cập hoặc thông tin bí mật qua nhóm chat công khai.

---

## 4. Cách sử dụng giao diện chung

### 4.1 Thanh điều hướng

Thanh điều hướng dùng để mở các nhóm chức năng chính. Tùy quyền tài khoản, người dùng có thể chỉ nhìn thấy một phần menu.

Các nhóm hiện có thể bao gồm:

- Tổng quan hoặc cơ cấu hệ thống.
- Tổ chức.
- Đối tác.
- Hàng hóa.
- Kho.
- Bán hàng.
- Mua hàng.
- Giao hàng và điều phối.
- Quản lý tài khoản và quyền truy cập.

Không thấy một menu không có nghĩa hệ thống bị lỗi. Trước tiên cần kiểm tra vai trò và quyền của tài khoản.

### 4.2 Danh sách dữ liệu

Các màn danh sách thường có:

- Ô tìm kiếm.
- Bộ lọc trạng thái.
- Bộ lọc chi nhánh, kho hoặc thời gian.
- Danh sách bản ghi.
- Nút mở chi tiết.
- Thông báo lỗi khi dữ liệu không tải được.

Khi tìm kiếm không ra kết quả:

1. Xóa bớt điều kiện lọc.
2. Kiểm tra cách viết tên hoặc mã.
3. Kiểm tra dữ liệu có thuộc đúng chi nhánh hoặc kho đang xem hay không.
4. Kiểm tra tài khoản có quyền xem dữ liệu đó hay không.

### 4.3 Trạng thái chứng từ

Một chứng từ có thể có nhiều loại trạng thái khác nhau, ví dụ:

- Trạng thái đơn hàng.
- Trạng thái xử lý hàng.
- Trạng thái giao hàng.
- Trạng thái thanh toán.

Không nên hiểu một trạng thái duy nhất là toàn bộ chứng từ đã hoàn tất.

---

## 5. Tổ chức, chi nhánh và kho

### 5.1 Mục đích

Khu vực tổ chức dùng để xem cơ cấu vận hành như:

- Chi nhánh.
- Kho.
- Vị trí trong kho.
- Trạng thái hoạt động của từng đơn vị.

### 5.2 Cách xem

1. Mở nhóm **Tổ chức** hoặc màn cơ cấu hệ thống.
2. Chọn loại dữ liệu cần xem.
3. Kiểm tra tên, mã và trạng thái hoạt động.
4. Chọn một bản ghi để xem chi tiết nếu giao diện có hỗ trợ.

### 5.3 Lưu ý

- Chỉ chọn chi nhánh và kho đang hoạt động khi lập chứng từ.
- Không tự ý dùng một kho đã ngừng hoạt động.
- Việc tạo, sửa hoặc khóa chi nhánh/kho phụ thuộc quyền quản trị được cấp.

---

## 6. Khách hàng và đối tác

### 6.1 Khách hàng chính thức

Khách hàng chính thức là khách đã có mã trong NPP Core.

Khách hàng chính thức được dùng cho các nghiệp vụ như:

- Lập đơn bán hàng chính thức.
- Giao hàng.
- Theo dõi công nợ.
- Áp dụng bảng giá hoặc chính sách thương mại.

### 6.2 Điểm bán từ MCP chưa phải khách hàng chính thức

Điểm bán được nhân viên thị trường thêm trong tuyến hoặc phiên làm việc chưa tự động trở thành khách hàng chính thức.

Điểm bán chỉ được dùng để tạo đơn bán hàng chính thức khi đã:

- Được tạo thành khách hàng mới trong Core; hoặc
- Được liên kết với một khách hàng Core đã tồn tại.

### 6.3 Đề nghị mở hoặc liên kết mã khách

Màn này dùng để xử lý các điểm bán đã phát sinh nhu cầu mua hàng nhưng chưa có mã khách chính thức.

Cách xem hàng đợi:

1. Mở nhóm **Bán hàng**.
2. Chọn **Mở / liên kết mã khách**.
3. Xem danh sách đề nghị đang chờ.
4. Mở đề nghị cần xử lý.
5. Kiểm tra thông tin đề xuất như tên khách, địa chỉ và thông tin liên hệ.
6. Kiểm tra khách có bị trùng với dữ liệu hiện có hay không.

Các kết quả nghiệp vụ có thể gồm:

- Tạo khách hàng mới.
- Liên kết với khách hàng đã tồn tại.
- Yêu cầu bổ sung thông tin.
- Từ chối đề nghị.
- Chuyển ngoại lệ lên cấp quản lý khi vượt quyền xử lý thông thường.

### 6.4 Trạng thái hiện tại

Hệ thống đã có nền xử lý đề nghị mở hoặc liên kết mã khách và hàng đợi theo dõi.

Tuy nhiên, quyền chi tiết cho từng vai trò vẫn phải được chốt rõ trước khi áp dụng rộng rãi. Không coi mọi tài khoản NPP đều được quyền tạo hoặc duyệt mã khách.

---

## 7. Hàng hóa, SKU, đơn vị và giá

### 7.1 Mục đích

Khu vực hàng hóa dùng để xem dữ liệu phục vụ mua bán và tồn kho, gồm:

- Sản phẩm.
- Biến thể hoặc SKU.
- Đơn vị tính.
- Quy đổi đơn vị.
- Mã vạch nếu có.
- Bảng giá và nền giá bán.

### 7.2 Cách tra cứu

1. Mở nhóm **Hàng hóa**.
2. Chọn danh sách sản phẩm hoặc SKU.
3. Tìm theo tên, mã hoặc từ khóa.
4. Mở chi tiết để kiểm tra đơn vị và thông tin liên quan.

### 7.3 Lưu ý khi dùng cho chứng từ

- Phải chọn đúng SKU, không chỉ chọn tên sản phẩm chung.
- Phải chọn đúng đơn vị tính.
- Không tự nhập giá ngoài chính sách khi tài khoản không có quyền.
- Khi giá không tải được hoặc không đúng, dừng xác nhận chứng từ và báo người phụ trách dữ liệu giá.

---

## 8. Điều hành bán hàng

### 8.1 Mục đích

**Điều hành bán hàng** là trung tâm tiếp nhận và theo dõi nhu cầu bán hàng từ nhiều nguồn.

Các nguồn có thể gồm:

- Nhân viên NPP nhập trực tiếp.
- MCP Field gửi nhu cầu hoặc order intent.
- Website đặt hàng.
- Các nguồn tích hợp khác trong tương lai.

### 8.2 Nội dung hiện có

Màn điều hành hiện có thể hiển thị:

- Số lượng việc bán hàng đang chờ.
- Đơn nháp chờ xác nhận.
- Đề nghị mở hoặc liên kết mã khách.
- Liên kết sang màn đơn bán hàng.
- Liên kết sang màn xử lý mã khách.

### 8.3 Cách sử dụng

1. Mở nhóm **Bán hàng**.
2. Chọn **Điều hành bán hàng**.
3. Kiểm tra phần **Đơn chờ xác nhận**.
4. Kiểm tra phần **Đề nghị mở hoặc liên kết mã khách**.
5. Chọn bản ghi cần xử lý hoặc mở màn chuyên trách tương ứng.

### 8.4 Phân biệt NPP Operations và Admin

NPP Operations xử lý việc thường ngày như:

- Kiểm tra nhu cầu bán hàng.
- Xử lý đơn nháp thông thường.
- Xử lý mã khách thông thường.
- Theo dõi tiến độ xử lý.

Admin MCP/NPP chỉ xử lý ngoại lệ như:

- Khách trùng chưa rõ cách xử lý.
- Khách có rủi ro công nợ.
- Đơn vượt hạn mức.
- Đơn vượt quyền chiết khấu.
- Đơn dưới giá sàn.
- Đơn cần duyệt trong điều kiện thiếu hàng hoặc rủi ro đặc biệt.

---

## 9. Đơn bán hàng

### 9.1 Mục đích

Đơn bán hàng là chứng từ ghi nhận khách mua sản phẩm gì, số lượng bao nhiêu, tại kho hoặc chi nhánh nào và theo điều kiện thương mại nào.

### 9.2 Các phần nền hiện có

Hệ thống đã có nền cho:

- Danh sách Sales Order.
- Đơn nháp.
- Chi tiết đơn.
- Dòng hàng.
- Dữ liệu thương mại.
- Xác nhận hoặc chuyển trạng thái theo luồng được triển khai.
- Liên kết sang các bước fulfillment và giao hàng ở các phase đã có.

### 9.3 Trạng thái sử dụng thực tế hiện tại

**Chưa coi chức năng tạo đơn mới là đã sẵn sàng cho toàn bộ người dùng XNT.**

Lý do:

- Chưa chốt ma trận quyền chi tiết cho từng vai trò.
- Chưa xác nhận mọi tài khoản cần dùng đã có nút và quyền tạo đơn.
- Chưa nghiệm thu đầy đủ luồng tạo đơn đầu-cuối cho từng nhóm người dùng.

Do đó, tại thời điểm cập nhật tài liệu này:

- Có thể xem và xử lý những đơn mà tài khoản được cấp quyền truy cập.
- Chỉ thao tác tạo, sửa, xác nhận hoặc hủy khi tài khoản đã được cấp quyền rõ ràng và luồng đã được nghiệm thu.
- Không hướng dẫn người dùng tự thử bằng dữ liệu production khi chưa có phân công.

### 9.4 Quy trình dự kiến khi chức năng tạo đơn được mở chính thức

Phần này chỉ dùng làm khung cập nhật, chưa coi là hướng dẫn vận hành hoàn chỉnh:

1. Chọn khách hàng chính thức.
2. Chọn địa chỉ giao hàng.
3. Chọn chi nhánh và kho.
4. Chọn SKU và đơn vị.
5. Nhập số lượng.
6. Kiểm tra giá và chính sách.
7. Lưu nháp.
8. Kiểm tra lại toàn bộ đơn.
9. Xác nhận theo quyền.
10. Chuyển sang fulfillment, giao hàng và công nợ theo lifecycle.

Khi chức năng tạo đơn được hoàn thiện, mục này phải được cập nhật bằng ảnh màn hình, tên nút thật và quyền thao tác cụ thể.

---

## 10. Mua hàng

### 10.1 Mục đích

Khu vực mua hàng phục vụ nghiệp vụ với nhà cung cấp.

Nền chức năng đã có gồm:

- Purchase Order.
- Dòng hàng mua.
- Nhận hàng từng phần.
- Chênh lệch số lượng hoặc chất lượng.
- Trả hàng nhà cung cấp.
- Ghi nhận phải trả.
- Thanh toán và phân bổ thanh toán theo phạm vi đã triển khai.

### 10.2 Cách sử dụng ở thời điểm hiện tại

Người dùng chỉ thao tác phần mua hàng khi:

- Được cấp đúng quyền.
- Đã được hướng dẫn nghiệp vụ nội bộ.
- Kho, nhà cung cấp, SKU và đơn vị đã được thiết lập đúng.

Không sửa hoặc xóa chứng từ đã post. Khi sai phải dùng nghiệp vụ đảo hoặc điều chỉnh được hệ thống hỗ trợ.

### 10.3 Lưu ý

- Purchase Order không phải Goods Receipt.
- Đặt mua không đồng nghĩa đã nhập kho.
- Nhận hàng thực tế mới là cơ sở ghi nhận tồn kho và công nợ theo lifecycle.

---

## 11. Kho và tồn kho

### 11.1 Mục đích

Khu vực kho dùng để theo dõi:

- Kho và vị trí kho.
- Tồn kho.
- Reservation.
- Nhập, xuất, chuyển hoặc điều chỉnh theo nghiệp vụ được cho phép.
- Lô và hạn dùng khi áp dụng.

### 11.2 Nguyên tắc quan trọng

- Tồn kho phải dựa trên inventory ledger.
- Không sửa trực tiếp số tồn.
- Không cho âm kho mặc định.
- Chứng từ đã post không sửa hoặc xóa trực tiếp.
- Sai phải dùng reversal hoặc adjustment.

### 11.3 Trạng thái hướng dẫn

Các chức năng nền kho đã được triển khai theo từng phase, nhưng tài liệu người dùng chi tiết cho từng thao tác nhập, xuất, reservation và điều chỉnh sẽ được bổ sung khi vai trò và màn hình vận hành được nghiệm thu hoàn chỉnh.

---

## 12. Fulfillment và Delivery Order

### 12.1 Phân biệt các bước

Luồng bán hàng được tách như sau:

```text
Sales Order
→ Fulfillment / Allocation
→ Delivery Order
→ Delivery Trip / Delivery Attempt
```

Ý nghĩa:

- Sales Order: khách đặt mua gì.
- Fulfillment/Allocation: hàng nào được phân bổ để xử lý.
- Delivery Order: phần hàng cần giao.
- Delivery Trip: chuyến giao cụ thể.
- Delivery Attempt: kết quả từng lần giao.

### 12.2 Lưu ý

- Một Sales Order có thể tạo nhiều Delivery Order.
- Giao một phần không tự động hoàn thành toàn bộ đơn.
- Giao thất bại không được làm mất dấu hàng đã xuất hoặc công việc cần xử lý tiếp.
- Trạng thái đơn, trạng thái giao và trạng thái thanh toán là các trạng thái khác nhau.

### 12.3 Trạng thái hiện tại

Hệ thống đã có nền fulfillment, Delivery Order và điều phối theo các phase hiện tại. Hướng dẫn thao tác chi tiết sẽ được cập nhật sau khi từng vai trò vận hành được chốt và nghiệm thu trên giao diện production.

---

## 13. Delivery / Giao hàng

Ứng dụng giao hàng dùng tại:

```text
https://log.nguyenlieuhungphat.com
```

Ứng dụng này dành cho luồng giao hàng và tài xế, tách khỏi NPP Operations.

NPP Operations dùng để chuẩn bị và điều phối nghiệp vụ. Delivery dùng để thực hiện chuyến giao và cập nhật kết quả theo quyền được cấp.

Không sử dụng tài khoản NPP Operations thay cho tài khoản tài xế nếu hai vai trò được tách riêng.

---

## 14. Công nợ và thanh toán

### 14.1 Nguyên tắc

- Công nợ khách hàng dựa trên receivable ledger.
- Công nợ nhà cung cấp dựa trên payable ledger.
- Thanh toán phải có chứng từ và phân bổ.
- Không dùng một cờ đơn giản như `đã trả` để thay cho lịch sử thanh toán thực tế.

### 14.2 Trạng thái hiện tại

Nền phải thu, phải trả, thanh toán và phân bổ đã được triển khai theo phạm vi từng phase. Hướng dẫn thao tác chi tiết cho người dùng sẽ được bổ sung khi các màn và quyền tương ứng được nghiệm thu đầy đủ.

---

## 15. Phân quyền người dùng

### 15.1 Trạng thái hiện tại

Hệ thống có nền người dùng, vai trò và permission. Tuy nhiên, ma trận quyền nghiệp vụ chi tiết cho từng nhóm người dùng chưa được coi là đã chốt hoàn chỉnh trong tài liệu này.

Chưa được mặc định các vai trò sau có toàn quyền:

- XNT.
- Sales Admin.
- CS.
- Kế toán.
- Kho.
- Điều phối.
- Quản lý bán hàng.
- CEO hoặc Admin.

### 15.2 Ma trận quyền cần chốt

Mỗi chức năng cần xác định ít nhất các quyền:

- Xem danh sách.
- Xem chi tiết.
- Tạo mới.
- Sửa nháp.
- Gửi xác nhận.
- Xác nhận.
- Từ chối.
- Hủy.
- Duyệt ngoại lệ.
- Phân bổ kho.
- Tạo Delivery Order.
- Điều phối chuyến.
- Ghi nhận giao hàng.
- Ghi nhận hoặc phân bổ thanh toán.
- Đảo hoặc điều chỉnh chứng từ.
- Xuất dữ liệu.
- Quản trị người dùng và quyền.

### 15.3 Nguyên tắc sử dụng trước khi chốt quyền

- Không cấp rộng chỉ để người dùng thấy đủ nút.
- Không dùng tài khoản Admin cho công việc thường ngày.
- Không dựa vào việc nút bị ẩn để thay cho bảo vệ backend.
- Mọi thao tác quan trọng phải được backend kiểm tra quyền.
- Quyền phải theo nguyên tắc deny-by-default.

---

## 16. Các phần chưa hướng dẫn sử dụng chính thức

Tại thời điểm cập nhật tài liệu này, các phần sau chưa được coi là hoàn chỉnh cho người dùng phổ thông:

- Tạo Sales Order mới cho XNT và từng vai trò cụ thể.
- Ma trận quyền hoàn chỉnh cho toàn bộ nghiệp vụ.
- Duyệt ngoại lệ đầy đủ trong Admin.
- Hướng dẫn chi tiết fulfillment và allocation.
- Hướng dẫn thao tác kho đầy đủ theo từng loại chứng từ.
- Hướng dẫn Delivery Order và điều phối chuyến theo từng vai trò.
- Hướng dẫn công nợ và thanh toán đầy đủ.
- Báo cáo vận hành hoàn chỉnh.
- Các luồng MCP cutover chưa được nghiệm thu production.

Những mục này sẽ được bổ sung sau khi code, quyền, test và nghiệm thu tương ứng hoàn tất.

---

## 17. Cách báo lỗi

Khi gặp lỗi, người dùng cần cung cấp:

- Thời gian xảy ra lỗi.
- Ứng dụng đang dùng.
- Tên màn hình.
- Thao tác vừa thực hiện.
- Mã chứng từ hoặc mã bản ghi nếu có.
- Nội dung thông báo lỗi.
- Ảnh chụp màn hình không chứa mật khẩu hoặc bí mật hệ thống.

Không gửi:

- Mật khẩu.
- Token.
- API key.
- DATABASE_URL.
- Secret của Vercel, Heroku, Cloudflare hoặc dịch vụ khác.

---

## 18. Quy tắc cập nhật tài liệu

Mỗi khi hoàn thành một chức năng mới, cần cập nhật tài liệu này theo thứ tự:

1. Xác nhận chức năng đã merge vào `main`.
2. Xác nhận quyền của từng vai trò.
3. Xác nhận production đã deploy nếu hướng dẫn dành cho production.
4. Chạy nghiệm thu thao tác thực tế.
5. Bổ sung tên menu, tên nút và quy trình từng bước.
6. Ghi rõ trường hợp lỗi và cách xử lý.
7. Cập nhật ngày ở đầu tài liệu.
8. Không xóa cảnh báo của phần chưa hoàn thiện cho đến khi có đủ bằng chứng.

---

## 19. Tóm tắt phạm vi đang dùng

Hiện tại NPP Operations đã có nền cho:

- Đăng nhập và truy cập theo tài khoản.
- Cơ cấu tổ chức, chi nhánh và kho.
- Dữ liệu khách hàng, nhà cung cấp, hàng hóa và giá.
- Purchase Order và nhận hàng theo phạm vi đã triển khai.
- Sales Order foundation và hàng đợi đơn nháp.
- Điều hành bán hàng.
- Đề nghị mở hoặc liên kết mã khách.
- Fulfillment, Delivery Order và logistics foundation.
- Inventory, phải thu, phải trả và audit foundation.

Nhưng người dùng chỉ được thao tác chức năng đã được cấp quyền và nghiệm thu. Đặc biệt, chức năng tạo đơn cho XNT chưa được coi là sẵn sàng chính thức cho đến khi chốt quyền và hoàn thiện luồng sử dụng.
