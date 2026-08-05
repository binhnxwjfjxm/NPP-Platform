# Hướng dẫn sử dụng NPP Operations

> Trạng thái: **Cập nhật theo chức năng hiện có trên `main`**  
> Ngày cập nhật: **2026-08-05**  
> Địa chỉ sử dụng: `https://office.nguyenlieuhungphat.com`  
> Nguyên tắc: hệ thống làm đến đâu, tài liệu hướng dẫn đến đó. Phần chưa chốt quyền hoặc chưa nghiệm thu không được coi là đã sẵn sàng vận hành.

---

## 1. Cách đọc tài liệu

Mỗi chức năng được gắn một trong ba trạng thái:

- **Đã có thể sử dụng:** có màn hình và luồng thao tác đủ rõ để hướng dẫn.
- **Sử dụng theo quyền được cấp:** chức năng đã có nhưng không phải tài khoản nào cũng được thao tác.
- **Chưa sử dụng chính thức:** mới có nền kỹ thuật, chưa chốt quyền hoặc chưa nghiệm thu đầy đủ.

Không tự thử chức năng ghi dữ liệu production khi chưa được phân công.

---

## 2. Đăng nhập

**Trạng thái: Đã có thể sử dụng.**

### Cách đăng nhập

1. Mở trình duyệt trên máy tính.
2. Truy cập `https://office.nguyenlieuhungphat.com`.
3. Nhập tài khoản và mật khẩu được cấp.
4. Chọn **Đăng nhập**.
5. Chờ hệ thống chuyển vào NPP Operations.

### Kết quả đúng

- Trang NPP Operations mở thành công.
- Menu chỉ hiển thị các phần tài khoản được phép xem.
- Không xuất hiện thông báo hết phiên hoặc không có quyền.

### Khi không đăng nhập được

1. Kiểm tra đúng địa chỉ `office.nguyenlieuhungphat.com`.
2. Nhập lại tài khoản và mật khẩu.
3. Kiểm tra bàn phím có bật Caps Lock hay không.
4. Tải lại trang rồi đăng nhập lại.
5. Nếu vẫn lỗi, báo người quản trị kiểm tra trạng thái tài khoản, installation và vai trò.

Không gửi mật khẩu hoặc token vào nhóm chat công khai.

---

## 3. Sử dụng giao diện chung

**Trạng thái: Đã có thể sử dụng.**

### Mở một chức năng

1. Nhìn thanh menu bên trái.
2. Chọn nhóm nghiệp vụ, ví dụ **Bán hàng**, **Mua hàng**, **Kho** hoặc **Tổ chức**.
3. Nếu nhóm có menu con, chọn đúng màn cần mở.
4. Kiểm tra tiêu đề trang để chắc chắn đã vào đúng chức năng.

### Tìm dữ liệu trong danh sách

1. Mở màn danh sách.
2. Nhập tên, mã hoặc từ khóa vào ô tìm kiếm nếu có.
3. Chọn bộ lọc trạng thái, kho, chi nhánh hoặc thời gian nếu có.
4. Chờ danh sách tải lại.
5. Chọn một dòng để mở chi tiết.

### Khi không tìm thấy dữ liệu

1. Xóa bớt bộ lọc.
2. Kiểm tra lại tên hoặc mã.
3. Kiểm tra dữ liệu có thuộc đúng chi nhánh hoặc kho đang xem không.
4. Kiểm tra tài khoản có quyền xem phạm vi dữ liệu đó không.
5. Nếu trang báo lỗi tải dữ liệu, không nhập lại nhiều lần; tải lại một lần rồi báo người phụ trách nếu lỗi còn tiếp diễn.

### Đọc trạng thái chứng từ

Một chứng từ có thể đồng thời có nhiều trạng thái:

- trạng thái đơn hàng;
- trạng thái xử lý hàng;
- trạng thái giao hàng;
- trạng thái thanh toán.

Không được hiểu “đã xác nhận đơn” là “đã giao hàng” hoặc “đã thanh toán”.

---

## 4. Tổ chức, chi nhánh, kho và vị trí kho

**Trạng thái: Xem được; tạo/sửa phụ thuộc quyền.**

### Cách xem cơ cấu

1. Mở nhóm **Tổ chức** hoặc màn cơ cấu hệ thống.
2. Chọn loại dữ liệu cần xem: chi nhánh, kho hoặc vị trí kho.
3. Tìm theo tên hoặc mã nếu màn hình có ô tìm kiếm.
4. Kiểm tra trạng thái hoạt động của bản ghi.
5. Mở chi tiết khi cần đối chiếu.

### Khi dùng dữ liệu tổ chức trên chứng từ

1. Chỉ chọn chi nhánh đang hoạt động.
2. Chỉ chọn kho đang hoạt động.
3. Kiểm tra kho thuộc đúng chi nhánh.
4. Không chọn vị trí kho đã ngừng sử dụng.

### Tạo hoặc sửa

Chỉ thực hiện khi tài khoản có nút tạo/sửa và được giao nhiệm vụ. Nếu không thấy nút, không coi là lỗi; trước tiên kiểm tra quyền.

---

## 5. Khách hàng và điểm bán từ MCP

**Trạng thái: Xem dữ liệu khách theo quyền; điểm bán MCP chưa tự động là khách chính thức.**

### Phân biệt hai loại dữ liệu

- **Khách hàng chính thức:** đã có mã trong NPP Core, được dùng cho đơn bán hàng, giao hàng và công nợ.
- **Điểm bán MCP:** điểm ghé hoặc điểm bán ngoài thị trường; chưa tự động có mã khách công ty.

Một điểm bán MCP chỉ được dùng cho đơn bán hàng chính thức sau khi được tạo thành khách mới hoặc liên kết với khách đã tồn tại.

### Cách kiểm tra khách trước khi xử lý đơn

1. Mở danh sách khách hàng hoặc màn chọn khách trong nghiệp vụ liên quan.
2. Tìm theo tên, số điện thoại, địa chỉ hoặc mã khách.
3. Kiểm tra trạng thái khách còn hoạt động.
4. Kiểm tra đúng địa chỉ giao hàng.
5. Nếu không tìm thấy khách, chuyển sang hàng đợi **Mở / liên kết mã khách**; không tự tạo dữ liệu trùng.

---

## 6. Mở hoặc liên kết mã khách

**Trạng thái: Có hàng đợi và màn xử lý; thao tác kết luận phụ thuộc quyền chưa chốt đầy đủ.**

### Mở hàng đợi

1. Mở nhóm **Bán hàng**.
2. Chọn **Mở / liên kết mã khách**.
3. Xem danh sách đề nghị đang chờ.
4. Chọn đề nghị cần kiểm tra.

### Kiểm tra một đề nghị

1. Đọc tên điểm bán hoặc tên khách đề xuất.
2. Kiểm tra số điện thoại và thông tin liên hệ nếu có.
3. Kiểm tra địa chỉ, phường/xã và tỉnh/thành.
4. Tìm trong dữ liệu khách hiện có để tránh tạo trùng.
5. Đối chiếu nguồn đề nghị và thời điểm cập nhật.
6. Ghi nhận phần thông tin còn thiếu nếu chưa đủ căn cứ xử lý.

### Kết quả nghiệp vụ có thể có

- tạo khách hàng mới;
- liên kết với khách hàng đã tồn tại;
- yêu cầu bổ sung thông tin;
- từ chối đề nghị;
- chuyển ngoại lệ lên cấp quản lý.

### Quy tắc hiện tại

Không phải mọi tài khoản NPP đều được tạo hoặc duyệt mã khách. Chỉ bấm hành động kết luận khi tài khoản đã được giao quyền rõ ràng. Trường hợp trùng khách, rủi ro công nợ, hạn mức đặc biệt hoặc mở lại khách bị khóa phải chuyển đúng cấp xử lý.

---

## 7. Hàng hóa, SKU, đơn vị và giá

**Trạng thái: Tra cứu được theo quyền.**

### Tìm sản phẩm hoặc SKU

1. Mở nhóm **Hàng hóa**.
2. Chọn danh sách sản phẩm hoặc SKU.
3. Nhập tên, mã hoặc từ khóa.
4. Chọn đúng SKU cần dùng.
5. Mở chi tiết để kiểm tra đơn vị tính, mã vạch và trạng thái hoạt động nếu có.

### Kiểm tra trước khi dùng trên chứng từ

1. Chọn đúng SKU, không chỉ dựa vào tên sản phẩm chung.
2. Kiểm tra đúng đơn vị tính.
3. Kiểm tra quy đổi đơn vị nếu mua hoặc bán theo thùng, gói hoặc đơn vị khác.
4. Kiểm tra giá được hệ thống trả về.
5. Nếu giá trống hoặc khác chính sách, dừng xác nhận và báo người phụ trách dữ liệu giá.

### Không được làm

- Không tự đổi giá ngoài chính sách khi không có quyền.
- Không dùng SKU ngừng hoạt động.
- Không nhập số lượng bằng một đơn vị nhưng hiểu theo đơn vị khác.

---

## 8. Điều hành bán hàng

**Trạng thái: Đã có thể xem và mở hàng đợi.**

Đây là nơi Sales Admin, CS hoặc kế toán theo dõi nhu cầu bán hàng từ các nguồn.

### Cách sử dụng

1. Mở nhóm **Bán hàng**.
2. Chọn **Điều hành bán hàng**.
3. Xem tổng số việc bán hàng đang chờ.
4. Kiểm tra khu vực **Đơn chờ xác nhận**.
5. Kiểm tra khu vực **Đề nghị mở hoặc liên kết mã khách**.
6. Chọn liên kết sang màn chuyên trách tương ứng.

### Xử lý đơn chờ xác nhận

1. Mở **Đơn chờ xác nhận** hoặc chọn **Xem đơn bán hàng**.
2. Mở đơn cần kiểm tra.
3. Đối chiếu khách hàng, kho, nguồn đơn và thời điểm cập nhật.
4. Kiểm tra dòng hàng, số lượng và dữ liệu thương mại nếu tài khoản được xem.
5. Chỉ xác nhận hoặc chuyển trạng thái khi vai trò đã được cấp quyền.

### Xử lý đề nghị mã khách

1. Mở dòng đề nghị.
2. Kiểm tra thông tin điểm bán.
3. Tìm khách trùng.
4. Chuyển sang màn xử lý mã khách để thực hiện hành động được phép.

### Ranh giới với Admin MCP/NPP

NPP Operations xử lý công việc hằng ngày. Admin MCP/NPP chỉ xử lý ngoại lệ vượt quyền như hạn mức lớn, giá đặc biệt, khách rủi ro, khách bị khóa hoặc đơn cần cấp quản lý chấp thuận.

---

## 9. Đơn bán hàng

**Trạng thái: Có danh sách, chi tiết và nền xử lý; chưa coi việc tạo đơn mới là đã mở chính thức cho toàn bộ XNT.**

### Xem danh sách đơn

1. Mở nhóm **Bán hàng**.
2. Chọn **Đơn bán hàng**.
3. Dùng bộ lọc trạng thái hoặc ô tìm kiếm nếu có.
4. Chọn đơn cần xem.
5. Kiểm tra thông tin khách, kho, nguồn đơn, dòng hàng và trạng thái.

### Kiểm tra đơn nháp

1. Mở đơn có trạng thái nháp hoặc chờ xác nhận.
2. Kiểm tra khách có mã chính thức và đang hoạt động.
3. Kiểm tra địa chỉ giao hàng.
4. Kiểm tra chi nhánh và kho.
5. Kiểm tra từng SKU, đơn vị và số lượng.
6. Kiểm tra giá và thông tin thương mại.
7. Kiểm tra ghi chú hoặc nguồn tạo đơn.
8. Chỉ thực hiện hành động tiếp theo khi có quyền.

### Tạo đơn mới

**Chưa sử dụng chính thức cho toàn bộ người dùng XNT.**

Tại thời điểm cập nhật tài liệu:

- chưa chốt ma trận quyền ai được tạo, sửa, xác nhận, hủy hoặc duyệt ngoại lệ;
- chưa xác nhận mọi tài khoản XNT đã nhìn thấy đúng nút tạo đơn;
- chưa nghiệm thu đầy đủ luồng đầu-cuối theo từng vai trò.

Vì vậy tài liệu không hướng dẫn người dùng tự tạo đơn production ở thời điểm này. Khi chức năng được mở chính thức, mục này phải được cập nhật theo đúng tên nút, trường nhập, quyền và kết quả thật trên giao diện.

---

## 10. Mua hàng

**Trạng thái: Đã có nền Purchase Order, nhận hàng và công nợ nhà cung cấp; chưa phát hành hướng dẫn thao tác đại trà.**

Hệ thống đã có các phần nghiệp vụ như Purchase Order, nhận hàng từng phần, chênh lệch, trả hàng nhà cung cấp, phải trả và phân bổ thanh toán.

### Người dùng hiện tại cần làm gì

1. Chỉ mở và thao tác khi được phân công vào nghiệp vụ mua hàng.
2. Kiểm tra nhà cung cấp, kho, SKU và đơn vị trước mọi hành động.
3. Phân biệt rõ đặt mua với nhận hàng thực tế.
4. Không sửa hoặc xóa chứng từ đã post.
5. Khi sai, dùng nghiệp vụ đảo hoặc điều chỉnh được hệ thống hỗ trợ.

### Chưa hướng dẫn thao tác tạo Purchase Order

Chưa có tài liệu người dùng đủ bằng chứng về tên nút, trường nhập và quyền từng vai trò trên production. Phần này sẽ được bổ sung sau khi màn và quyền được nghiệm thu.

---

## 11. Kho và tồn kho

**Trạng thái: Có nền inventory ledger và các luồng kho; chưa phát hành hướng dẫn thao tác đại trà cho mọi vai trò.**

### Cách xem thông tin kho

1. Mở nhóm **Kho**.
2. Chọn màn tồn kho hoặc nghiệp vụ kho được cấp quyền.
3. Chọn đúng kho và vị trí.
4. Tìm SKU cần kiểm tra.
5. Đọc đúng loại số lượng: tồn thực tế, đã giữ chỗ hoặc khả dụng nếu màn hình hiển thị.

### Nguyên tắc bắt buộc

- Không sửa trực tiếp số tồn.
- Không tự tạo tồn âm.
- Reservation không phải hàng đã xuất.
- Chứng từ đã post không sửa hoặc xóa trực tiếp.
- Sai phải dùng reversal hoặc adjustment theo nghiệp vụ.

### Các thao tác chưa hướng dẫn đại trà

Nhập, xuất, chuyển kho, stocktake, reservation và điều chỉnh chỉ được bổ sung hướng dẫn sau khi chốt vai trò và nghiệm thu đúng màn vận hành.

---

## 12. Fulfillment và Delivery Order

**Trạng thái: Có nền chức năng; sử dụng theo quyền và theo quy trình đã phân công.**

Luồng đúng:

```text
Sales Order
→ Fulfillment / Allocation
→ Delivery Order
→ Delivery Trip / Delivery Attempt
```

### Cách đọc dữ liệu

1. Mở đơn bán hàng.
2. Kiểm tra phần hàng đã được phân bổ.
3. Kiểm tra Delivery Order được tạo cho phần hàng nào.
4. Kiểm tra chuyến giao và kết quả từng lần giao.
5. Không kết luận toàn bộ đơn hoàn tất chỉ vì một lần giao thành công.

### Quy tắc

- Một Sales Order có thể có nhiều Delivery Order.
- Giao một phần không tự hoàn tất toàn bộ đơn.
- Giao thất bại không làm mất dấu phần hàng cần xử lý tiếp.
- Trạng thái giao hàng khác trạng thái thanh toán.

Các thao tác phân bổ, tạo Delivery Order hoặc thay đổi lifecycle chưa được hướng dẫn đại trà khi ma trận quyền chưa chốt.

---

## 13. Điều phối chuyến giao trong NPP Operations

**Trạng thái: Có workspace điều phối theo Phase 6E; chỉ người có quyền logistics được thao tác.**

### Theo dõi chuyến

1. Mở nhóm giao hàng hoặc điều phối.
2. Chọn danh sách chuyến.
3. Chọn chuyến cần xem.
4. Kiểm tra tài xế, kho, các điểm giao và Delivery Order được gán.
5. Kiểm tra trạng thái chuyến và kết quả giao.

### Xem kết quả giao hàng

1. Mở chuyến hoặc Delivery Order liên quan.
2. Xem từng delivery attempt.
3. Đọc kết quả: giao đủ, giao một phần, không giao được hoặc hẹn giao lại.
4. Kiểm tra số lượng thực giao và phần còn lại.
5. Không ghi kết quả thay tài xế từ NPP Operations nếu màn chỉ cho phép đọc.

---

## 14. Đối soát cuối chuyến

**Trạng thái: Đã có chức năng; dùng theo quyền điều phối và kho.**

### Cách đối soát

1. Mở chuyến cần đối soát.
2. Mở khu vực đối soát cuối chuyến.
3. Kiểm tra số lượng đã xuất lên xe.
4. Kiểm tra số lượng đã giao.
5. Kiểm tra số lượng đã nhận lại kho.
6. Kiểm tra phần còn trên xe hoặc chưa được giải quyết.
7. Kho chỉ ghi nhận hàng về sau khi thực nhận.
8. Chỉ đóng chuyến khi mọi điểm giao đã có kết quả và toàn bộ số lượng đã được giao hoặc nhận lại kho.

### Không được làm

- Không đóng chuyến khi còn assignment chưa có kết quả.
- Không ghi nhận hàng về kho khi chưa thực nhận.
- Không tự đảo movement xuất cũ; hệ thống dùng luồng nhận lại có truy vết.

---

## 15. Bằng chứng giao hàng

**Trạng thái: Có chức năng tùy chọn; không bắt buộc mọi lần giao.**

Bằng chứng giao hàng được gắn vào delivery attempt đã ghi nhận.

### Trong NPP Operations

1. Mở chuyến hoặc kết quả giao hàng.
2. Mở phần bằng chứng giao hàng nếu có.
3. Xem loại bằng chứng, thời điểm và thông tin liên quan.
4. Mở ảnh bằng liên kết tạm thời nếu hệ thống cung cấp.
5. NPP Operations chỉ xem theo quyền; không sửa delivery attempt đã ghi.

### Lưu ý

- Không có ảnh không đồng nghĩa kết quả giao không hợp lệ.
- POD là tùy chọn theo chính sách công ty.
- Không chia sẻ liên kết ảnh tạm thời ra ngoài phạm vi công việc.

---

## 16. Admin MCP/NPP

**Trạng thái: Ứng dụng riêng, không phải nơi làm việc hằng ngày của XNT.**

Địa chỉ: `https://admin.nguyenlieuhungphat.com`.

Admin dùng để xem tổng hợp và xử lý ngoại lệ vượt quyền, không dùng thay Sales Admin, CS, kế toán hoặc kho.

Người dùng NPP Operations không chuyển toàn bộ đơn hoặc mã khách sang Admin. Chỉ chuyển trường hợp thật sự vượt quyền theo quy định.

---

## 17. Phân quyền hiện tại

**Trạng thái: Chưa chốt ma trận quyền nghiệp vụ đầy đủ cho toàn bộ vai trò XNT.**

Chưa được mặc định rằng một vai trò có thể thực hiện toàn bộ các thao tác sau:

- tạo đơn;
- sửa đơn nháp;
- xác nhận đơn;
- hủy đơn;
- tạo hoặc liên kết mã khách;
- duyệt ngoại lệ;
- phân bổ hàng;
- tạo Delivery Order;
- điều phối chuyến;
- ghi nhận hàng về kho;
- xử lý thanh toán hoặc công nợ.

Trước khi giao người dùng chính thức, phải chốt ma trận gồm vai trò, màn được xem, hành động được làm, phạm vi chi nhánh/kho và trường hợp cần cấp trên duyệt.

---

## 18. Xử lý lỗi chung

### Trang không tải được

1. Kiểm tra mạng.
2. Tải lại trang một lần.
3. Đăng nhập lại nếu phiên hết hạn.
4. Ghi lại thời điểm, tên màn và nội dung thông báo.
5. Báo người phụ trách; không bấm gửi lặp lại nhiều lần.

### Không thấy nút thao tác

1. Kiểm tra đang ở đúng màn.
2. Kiểm tra trạng thái chứng từ có cho phép hành động không.
3. Kiểm tra vai trò và quyền tài khoản.
4. Không dùng tài khoản người khác để làm thay.

### Bấm lưu nhưng không thành công

1. Đọc thông báo lỗi trên màn hình.
2. Kiểm tra các trường bắt buộc.
3. Kiểm tra khách, SKU, kho và đơn vị còn hoạt động.
4. Không bấm lưu liên tục.
5. Báo người phụ trách nếu lỗi lặp lại.

---

## 19. Quy tắc cập nhật tài liệu

Sau mỗi phần chức năng được hoàn thiện, tài liệu phải được cập nhật cùng đợt với các nội dung:

1. Trạng thái chức năng.
2. Vai trò được sử dụng.
3. Đường dẫn menu.
4. Tên nút và trường nhập đúng trên giao diện.
5. Các bước thao tác.
6. Điều kiện trước khi lưu hoặc xác nhận.
7. Kết quả sau thao tác.
8. Lỗi thường gặp.
9. Ảnh màn hình khi giao diện ổn định.

Không thêm quy trình dự kiến vào phần hướng dẫn sử dụng như thể chức năng đã hoạt động.