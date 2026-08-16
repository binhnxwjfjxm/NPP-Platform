# Admin MCP/NPP — đặc tả quản trị mobile

> Trạng thái: **ACTIVE — OWNER LOCKED**  
> Cập nhật: **2026-08-16 — Issue #606 / Lô 1**  
> Phạm vi Lô 1: `admin/web/**`, tài liệu và test bảo vệ.  
> **Không migration. Không đổi backend. Không deploy production.**

---

## 1. Vai trò sản phẩm

Admin MCP/NPP là ứng dụng dành cho chủ doanh nghiệp và quản lý cấp cao. Ứng dụng chỉ có ba nhiệm vụ:

1. đọc số liệu quản trị từ tổng quan đến chi tiết cần thiết;
2. giám sát hoạt động hiện trường MCP;
3. xử lý **Đề xuất** khi một việc thật sự cần quyết định cấp quản lý.

Admin không phải bản sao của Công Ty và không nhận các thao tác hằng ngày của Sales Admin, kế toán, kho, giao nhận hoặc nhân viên MCP.

Các việc sau tiếp tục thuộc ứng dụng Công Ty hoặc ứng dụng nghiệp vụ tương ứng:

- tạo/chỉnh sửa đơn thông thường;
- mở hoặc liên kết mã khách thường ngày;
- thu tiền, phân bổ công nợ, ghi sổ kế toán;
- nhập/xuất/chuyển kho, kiểm kê và xử lý tồn kho thường ngày;
- điều phối/giao hàng thường ngày;
- thực hiện tuyến, check-in và nhập dữ liệu hiện trường MCP.

Admin chỉ đọc, giám sát, cảnh báo và quyết định khi có việc vượt ngưỡng/thẩm quyền được đẩy lên.

---

## 2. Ranh giới runtime và dữ liệu

Luồng chuẩn:

```text
Admin frontend
-> gateway phía máy chủ của Admin
-> API/reporting-management của Công Ty
-> PostgreSQL dùng chung của installation
```

Nguyên tắc bắt buộc:

- frontend Admin không kết nối PostgreSQL trực tiếp;
- frontend không tự tính lại KPI làm nguồn sự thật thứ hai;
- Admin dùng cùng workforce identity và quyền do Công Ty quản lý;
- mỗi màn đọc dữ liệu phải fail closed theo quyền/phạm vi;
- không coi dữ liệu minh họa hiện tại là dữ liệu vận hành thật;
- thông tin MCP phải đi qua contract đọc được phía máy chủ, không lấy trực tiếp từ trình duyệt MCP.

---

## 3. IA cấp cao — đúng 4 mục

Thanh điều hướng chính cố định:

```text
Tổng quan | Đề xuất | Cảnh báo | Báo cáo
```

Không thêm mục thứ năm. Không đưa thao tác Công Ty thường ngày vào thanh này.

### Route trong Lô 1

- `Tổng quan` -> `/`
- `Đề xuất` -> tạm giữ `/approvals`
- `Cảnh báo` -> `/alerts`
- `Báo cáo` -> `/reports`

`/approvals` chỉ là route kỹ thuật kế thừa. Từ Lô 1 toàn bộ chữ người dùng phải là **Đề xuất**. Việc chuyển route sang `/proposals` chỉ thực hiện cùng lifecycle thật ở Lô 5 để tránh đổi route trước dữ liệu/migration.

---

## 4. Bản đồ nguồn dữ liệu theo 4 mục

### 4.1 Tổng quan

Nguồn đang có thật: `GET /api/reporting/control-tower` qua `admin/web/lib/control-tower.ts`.

Control Tower phải tiếp tục tái sử dụng các họ báo cáo hiện có, không viết SQL/KPI riêng cho Admin:

- bán hàng;
- mua hàng;
- tồn kho;
- công nợ;
- lãi gộp;
- nhân viên/MCP;
- giao hàng;
- COD/đối soát.

Nếu một họ dữ liệu không đọc được thì hiển thị trạng thái thiếu dữ liệu của riêng họ; không biến giá trị thiếu thành `0`.

### 4.2 Đề xuất

Lô 1 chỉ khóa UX/IA. Dữ liệu hiện tại trong `approval-fixtures.ts` là minh họa, chưa phải nguồn vận hành.

Nguồn đích ở Lô 5 là các đề xuất được tạo từ Công Ty hoặc MCP khi:

- vượt thẩm quyền người thao tác;
- vượt ngưỡng quản trị;
- là ngoại lệ cần chủ/quản lý quyết định;
- có đủ người gửi, lý do, tác động, bằng chứng và lịch sử.

Không đưa hàng đợi duyệt kế toán/kho thường ngày vào Admin. Nhóm hiển thị Lô 1:

```text
Tất cả
Thương mại
Khách hàng & công nợ
Ngoại lệ vận hành
MCP
Lịch sử
```

`Ngoại lệ vận hành` chỉ chứa việc đã vượt ngưỡng/thẩm quyền cấp quản lý; không phải màn duyệt kho, COD hay giao vận hằng ngày.

### 4.3 Cảnh báo

Lô 1 giữ UI hiện có và khóa ngôn ngữ. Dữ liệu đang có là minh họa.

Lô 4B mới tạo nguồn cảnh báo thật gồm rule definition + alert instance + lifecycle/history. Cảnh báo không đồng nghĩa với Đề xuất. Một cảnh báo chỉ sinh Đề xuất khi nghiệp vụ thật sự cần quyết định cấp quản lý.

### 4.4 Báo cáo

Nguồn đích là các họ reporting hiện hữu của Công Ty, không phải số liệu được hard-code trong Admin.

Nhóm quản trị:

```text
Điều hành
Kinh doanh & lợi nhuận
Công nợ
Kho
Giao vận & COD
MCP / thị trường
Nhân sự / hiệu suất
Đề xuất & cảnh báo
```

Lô 2 thay dữ liệu minh họa bằng số liệu thật. Lô 3 bổ sung drill-down quản trị từ tổng -> kênh -> nhân viên -> khách -> chứng từ.

---

## 5. Bản đồ quyền đọc hiện có

Admin không tự tạo quyền mới trong frontend. Các quyền reporting đã tồn tại và phải được tái sử dụng đúng phạm vi:

| Nguồn | Quyền hiện có |
|---|---|
| Tổng quan quản trị | `core.reporting.control-tower.read` |
| Bán hàng | `core.reporting.sales.read` |
| Mua hàng | `core.reporting.purchasing.read` |
| Tồn kho | `core.reporting.inventory.read` |
| Công nợ | `core.reporting.aging.read` |
| Lãi gộp | `core.reporting.gross-margin.read` |
| Nhân viên / MCP | `core.reporting.employee-mcp.read` |
| Giao hàng | `core.reporting.logistics.read` |
| COD / đối soát | `core.reporting.cod.read` |
| Lịch sử vận hành | `core.reporting.audit-history.read` |
| Xuất báo cáo | `core.reporting.export` + quyền đọc họ báo cáo tương ứng |

Quyền `core.reporting.control-tower.read` chỉ cho phép đọc tập tổng hợp quản trị. Nó không tự cấp quyền xem mọi chi tiết. Khi drill-down sang dữ liệu chi tiết ở Lô 3, endpoint đích phải kiểm lại quyền/phạm vi của chính dữ liệu đó.

Quyền dành riêng cho lifecycle **Đề xuất** và **Cảnh báo** chưa được phép bịa tên ở Lô 1. Lô 4/5 phải audit registry, khóa quyền deny-by-default và migration tương ứng trước khi mở thao tác thật.

---

## 6. Đề xuất — ngôn ngữ và UX

Màn người dùng gọi là **Trung tâm đề xuất**.

Mỗi dòng cần tối thiểu:

- loại đề xuất;
- nguồn `Công Ty` hoặc `MCP`;
- người gửi;
- đối tượng/chứng từ liên quan;
- tác động;
- lý do;
- mức ưu tiên;
- thời gian chờ;
- trạng thái.

Chi tiết hiển thị theo thứ tự:

```text
Tóm tắt quyết định
-> Tác động
-> Lý do / điều kiện vượt ngưỡng
-> Dữ liệu và bằng chứng
-> Người gửi và nguồn
-> Lịch sử
-> Hành động
```

Từ người dùng chuẩn:

```text
Đồng ý
Yêu cầu bổ sung
Từ chối
```

Trong Lô 1 các nút vẫn disabled vì lifecycle thật thuộc Lô 5. Không tạo endpoint giả để làm nút hoạt động.

---

## 7. Cảnh báo và giám sát MCP

Cảnh báo dùng ngôn ngữ văn phòng:

- `Quy tắc`, không dùng `Rule` trên giao diện;
- `Dữ liệu minh họa`, không dùng `frontend fixture`;
- không hiện `backend`, `API`, `production`, `phase`, `contract` cho người dùng.

Đối với MCP, source hiện tại xác nhận báo cáo đã có các cấp:

```text
nhân viên -> tuyến -> phiên -> số điểm dự kiến/đã ghé/check-in/đơn
```

Check-in hiện lưu:

- latitude;
- longitude;
- accuracy;
- thời điểm;
- nguồn tọa độ.

Nhưng hiện **chưa có kết luận server-side về khoảng cách giữa vị trí check-in và tọa độ điểm bán**. Vì vậy:

- `checked_in=true` không được trình bày như bằng chứng “đúng vị trí”;
- Lô 4A mới xây dựng phép đối chiếu GPS và kết luận sai lệch;
- Lô 4B mới dùng kết quả đó để tạo cảnh báo thật nếu đạt điều kiện cảnh báo.

---

## 8. Ngôn ngữ văn phòng toàn Admin

Quy tắc bắt buộc cho chữ người dùng:

- khi `Core` hoặc `NPP` mang nghĩa doanh nghiệp -> dùng **Công Ty**;
- giữ `MCP` vì đây là tên ứng dụng/kênh nghiệp vụ;
- không lộ từ dev nếu người dùng không cần biết: `frontend`, `backend`, `API`, `canonical`, `fixture`, `phase`, `contract`, `production`;
- dùng cùng một thuật ngữ cho cùng một khái niệm trên Tổng quan, Đề xuất, Cảnh báo và Báo cáo;
- câu chữ ngắn, thực tế, nêu sự kiện và tác động.

Tên kỹ thuật trong code, biến môi trường, permission key và tài liệu kỹ thuật được giữ nguyên khi cần chính xác; quy tắc trên áp dụng cho user-facing copy.

---

## 9. Trạng thái dữ liệu

Mỗi module phải phân biệt rõ:

```text
đang tải
không có dữ liệu
dữ liệu chưa đầy đủ
không thể tải dữ liệu
bình thường
cần chú ý
nghiêm trọng
không có quyền
```

Không coi dữ liệu thiếu là `0`. Không dùng dữ liệu minh họa để ra quyết định thật.

---

## 10. Thứ tự 7 lô của Issue #606

1. **Lô 1 — IA + ranh giới + ngôn ngữ**: `admin/web/**` + docs/tests, **không migration**.
2. **Lô 2 — Báo cáo thật**: nối các reporting family hiện có, dự kiến **không migration** nếu source audit không phát hiện thiếu schema.
3. **Lô 3 — Drill-down tổng -> kênh -> nhân viên -> khách -> chứng từ**: ưu tiên reuse reporting/read APIs, dự kiến **không migration**.
4. **Lô 4 — Giám sát MCP + GPS + Cảnh báo thật**: 4A có thể không migration nếu chỉ bổ sung derived read model; 4B gần như chắc chắn **có migration** cho rule/alert lifecycle.
5. **Lô 5 — Đề xuất thật**: lifecycle + audit/outbox/idempotency + quyền, **có migration**.
6. **Lô 6 — Tổng quan thật**: tổng hợp từ Báo cáo/Cảnh báo/Đề xuất đã ổn định, **không migration riêng** trừ khi audit phát hiện thiếu source bắt buộc.
7. **Lô 7 — tích hợp, responsive, regression, runtime gate**: **không migration riêng**.

Không gộp cả 7 lô vào một PR.

---

## 11. Gate Lô 1

Lô 1 chỉ đạt khi:

1. current `main` đã được audit ngay trước khi tạo branch;
2. thanh điều hướng đúng 4 mục `Tổng quan | Đề xuất | Cảnh báo | Báo cáo`;
3. không còn mô tả Admin như nơi duyệt công việc kế toán/kho thường ngày;
4. nhóm Đề xuất không còn tab `Kho` hoặc `Giao vận & COD` như hàng đợi tác nghiệp;
5. user-facing source dùng `Công Ty` thay cho `Core` khi mang nghĩa doanh nghiệp;
6. user-facing copy không lộ thuật ngữ dev nêu tại mục 8;
7. giữ nguyên route `/approvals` trong Lô 1, không kéo migration/lifecycle Lô 5 về sớm;
8. không sửa backend/database/migration;
9. exact-head CI hoàn tất xanh trước khi được phép merge;
10. không deploy production trong Lô 1 nếu Owner chưa ra lệnh rõ.

---

## 12. Git / runtime boundary

- Branch riêng: `agent/<task>` từ current `main`.
- Không force-push.
- Một exact SHA phải chạy xong toàn bộ CI; gom lỗi rồi mới sửa một batch tiếp theo nếu cần.
- Ngay trước merge phải kiểm `main` lần nữa và sync nếu có merge song song.
- Chỉ thay `admin/web/**` thì không tự deploy Heroku backend.
- Auto Deploy vẫn OFF.
- Merge, deploy và migration production đều cần lệnh riêng của Owner.
