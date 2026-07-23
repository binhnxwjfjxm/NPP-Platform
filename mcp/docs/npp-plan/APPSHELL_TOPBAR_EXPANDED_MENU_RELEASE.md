# AppShell top bar + menu mở rộng + rollout theme

> Cập nhật: **2026-07-18**  
> Phạm vi: **frontend MCP / AppShell / design-token ownership**

## Kết quả PR #46

```text
PR:                         #46 — MERGED
Branch:                     ui/appshell-topbar-expanded-menu-theme-sequence
Final head:                 13500166b5a26a2e2ef695a268f28de77bcec515
Merge SHA:                  1c10990e728c793f7b7abe9d9bcf5493cbd1239c
Foundation F0.2:            #404 PASS
F05 UI Browser Smoke:       #45 PASS
Session Actions UI Smoke:   #12 PASS
Backend/schema change:      NONE
VPS pullmcp:                NOT REQUIRED
```

## AppShell ownership

AppShell sở hữu toàn bộ vùng đầu trang:

```text
sticky top bar
├─ nhận diện MCP-Plan + tên phân hệ hiện tại
├─ tool slot theo màn hình
│  └─ Xuất tuyến được portal vào đây
└─ một nút ☰ mở menu dùng chung
```

Không còn card `Xuất tuyến` nằm ngoài AppShell hoặc nút menu `position: fixed` tự chiếm vùng top.

## Menu ☰ mở rộng

Tác vụ ngữ cảnh của màn hình luôn xuất hiện trước. Điều hướng ứng dụng được chia thành ba nhóm:

```text
Vận hành hôm nay
- Tổng quan
- Đi tuyến hôm nay
- Đơn hàng
- Kế hoạch

Quản lý MCP
- MCP
- Tuyến bán hàng
- Lịch sử phiên
- Báo cáo phiên
- Điểm bán

Thiết lập nghiệp vụ
- Cài đặt MCP
```

Cài đặt ứng dụng vẫn là một item app-level duy nhất. Bottom navigation tiếp tục là shortcut cho các phân hệ thường dùng; không gánh toàn bộ inventory.

## Rollout theme đã khóa thứ tự

Theme dùng token tập trung tại `src/app/npp-theme.css` và áp theo ownership:

```text
1. Tổng quan
2. Tuyến
3. Phiên
4. Form nghiệp vụ: order / test / report / follow-up
```

Không tạo palette riêng theo từng màn. Các component cũ tiếp tục dùng alias `--bg`, `--panel`, `--brand`, `--line` trỏ về cùng nguồn token.

## Browser evidence

```json
{
  "F05_APP_SHELL_THEME_SMOKE": "PASS",
  "sections": ["routes", "business", "session"],
  "topBar": "PASS",
  "routeExportOwnership": "PASS",
  "expandedMenu": "PASS",
  "businessFormTheme": "PASS"
}
```

Artifact:

```text
name:    f05-ui-browser-smoke-evidence
id:      8430490109
digest:  sha256:e55369cbc2c748197d768c3449d3e905f05d97fbcb5ab9202713a70b3b57c9bc
```

## Production deployment

Vercel không chạy build cho merge SHA PR #46 do `build-rate-limit`; đây không phải lỗi source/build. PR handoff docs kế tiếp là controlled deployment carrier cho cùng cây frontend đã merge. Chỉ ghi production PASS sau khi GitHub commit status của carrier SHA trả `Vercel: success`.

## Live gate còn lại

Automated Chromium không thay thế lượt xác nhận trên điện thoại production:

1. Thanh trên xuất hiện đầu AppShell, không có control nổi phía trên.
2. Nút xuất tuyến mở đúng hai link export.
3. Menu ☰ hiển thị đủ ba nhóm và tác vụ màn hình.
4. Tổng quan, Tuyến, Phiên và một form nghiệp vụ nhận đúng theme.
5. Bốn thao tác order/test/report/follow-up vẫn lưu thành công trên dữ liệu production.
