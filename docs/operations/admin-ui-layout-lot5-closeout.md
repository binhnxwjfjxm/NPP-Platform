# Admin UI/UX — Lô 5 regression & closeout

Ngày chốt: 2026-08-24  
Issue nguồn: #749, #606  
Phạm vi: `admin/web/**` và regression/deploy contract trực tiếp của Admin.

## 1. Mục tiêu

Lô 5 là gate chốt của chương trình chuẩn hóa Admin theo #749. Lô này không thêm nghiệp vụ mới; mục tiêu là khóa lại các hành vi đã hoàn thiện ở Lô 1–4, rà ngôn ngữ hiển thị, mobile/desktop và các luồng có rủi ro cao trước khi coi hệ thống UI dùng chung là hoàn tất.

## 2. Baseline và boundary

- Baseline khi bắt đầu: `main@580ced6f258d9903e22d0745dad8259beb0ba195` (merge Lô 4, PR #758).
- Audit PR mở trước khi sửa: không có PR đang hoạt động chạm các file UI Admin của Lô 5.
- Không đổi backend, API, quyền, database hoặc migration.
- Không chạm MCP Field, Công Ty, Delivery, Retail, Website hoặc Customer Ordering.
- Không đổi Vercel project, domain, runtime source hay cơ chế deploy có kiểm soát.

## 3. Closeout UI

### Nhận diện ứng dụng

Tên hiển thị thống nhất là **Admin Hưng Phát** tại shell, metadata, PWA manifest, màn đăng nhập và trang mất kết nối. Chuỗi `Admin MCP/NPP` chỉ còn được giữ dưới dạng marker kỹ thuật không hiển thị trong màn đăng nhập để tương thích với production smoke hiện hữu; đây không phải nội dung người dùng nhìn thấy.

### Layout và interaction

Hệ thống tiếp tục dùng duy nhất:

- `AdminShell` cho điều hướng toàn cục và width archetype;
- `AdminIconTabs` cho tab nghiệp vụ;
- `AdminToolbar`, `AdminFilterChip`, `AdminStatusBadge`, `AdminKpiGrid`, `AdminKpiCard`, `AdminStatePanel`, `AdminActionBar` cho hierarchy dùng chung;
- `admin-mobile-interaction.css` là lớp interaction cuối để khóa rail ngang trong viewport và tắt page pinch zoom theo yêu cầu Owner.

Không tạo thêm UI system thứ hai và không dọn CSS cũ theo kiểu cơ học nếu chưa chứng minh ảnh hưởng runtime.

## 4. Regression khóa hành vi

Regression Lô 5 khóa các điểm sau:

1. Điều hướng toàn app vẫn là `Tổng quan | Đề xuất | Cảnh báo | Báo cáo`.
2. Proposal detail vẫn dùng shared canonical idempotency generator và `ProposalDecisionDialog`; dialog vẫn là nơi duy nhất submit quyết định.
3. Alert detail giữ đúng lifecycle `Mới -> Đã xem -> Đang xử lý -> Đã giải quyết`, shared idempotency key và `AdminActionBar`.
4. Báo cáo giữ tab, toolbar, kỳ/kho, trạng thái dữ liệu và `Xuất báo cáo Excel` trên shared primitives.
5. MCP supervision giữ 25 dòng/trang, tìm kiếm, trạng thái, phân trang, drill-down/GPS/map, read-only và không suy diễn định vị realtime.
6. Loading/error/not-found luôn hiển thị trạng thái rõ ràng; lỗi dữ liệu không được che bằng số `0` giả.
7. Mobile giữ rail ngang bên trong component, không làm rộng trang; viewport vẫn khóa zoom theo contract đã chốt.

## 5. Gate hoàn tất

Lô 5 chỉ được merge khi exact-head của PR có cả hai workflow sau xanh:

- Admin frontend CI;
- Foundation F0.2.

Trước merge phải kiểm lại `main`; nếu `main` đã tiến do chat/PR khác thì phải audit overlap và đồng bộ branch trước, không merge đè. Sau merge, production chỉ deploy Admin bằng command được bảo vệ trên Issue #5 và phải xác nhận exact merge SHA, canonical domain, login/static asset smoke.

## 6. Test production sau deploy

Owner nên kiểm nhanh trên desktop và mobile:

- nhận diện `Admin Hưng Phát` và điều hướng 4 khu vực;
- Tổng quan: kỳ xem, KPI, trạng thái nguồn, link ưu tiên;
- Đề xuất: filter/list/detail/dialog quyết định;
- Cảnh báo: list/detail/lifecycle;
- Báo cáo: tab, kỳ/kho, export và detail;
- MCP: tab con, search/status/pagination, drill-down/GPS/map;
- mobile: tab/toolbar cuộn ngang nội bộ, trang không tràn ngang, không pinch zoom và vẫn cuộn dọc bình thường;
- PWA/offline: tên ứng dụng và thông báo mất kết nối dùng ngôn ngữ văn phòng.

Khi các gate trên xanh và production smoke đúng exact SHA, chương trình UI/UX #749 có thể coi là hoàn tất; thay đổi tiếp theo phải đi theo backlog nghiệp vụ hoặc lỗi thực tế mới, không mở thêm một lớp layout song song.
