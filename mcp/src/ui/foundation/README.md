# MCP PWA UI foundation — Issue #1244 / Lô 1

Đây là owner mới cho giao diện MCP PWA được chuyển từ Lô 1 trở đi.

## Ownership

- `tokens.css`: màu sắc, khoảng cách, bo góc, chữ, shadow, touch target và safe-area theo MCP Mobile.
- `McpFoundation.module.css`: style duy nhất của primitive mới.
- `McpPrimitives.tsx`: card, button, input/select/textarea, search, trạng thái, header, filter, list và state.
- `McpBottomNav.tsx`: primitive bottom navigation; Lô 2 mới nối vào AppShell.
- `McpSheet.tsx`: sheet/dialog mới; các màn được chuyển dần ở Lô 3–4.

## Luật chuyển đổi

1. Không thêm selector vào CSS legacy để làm primitive mới hiển thị đúng.
2. Không dùng `!important`.
3. Không tạo alias từ `--mcp-*` sang `--npp-*` hoặc ngược lại.
4. Màn chưa migrate tiếp tục dùng UI cũ cho tới đúng lô của nó; không “nửa cũ nửa mới”.
5. Khi một màn đã migrate, style của nó phải nằm trong foundation hoặc CSS Module của chính feature.
6. Lô 5 chỉ xóa legacy sau khi search caller/import và test chứng minh không còn owner thật.
