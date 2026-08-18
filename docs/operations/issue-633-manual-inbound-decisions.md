# Issue #633 — Lô 1: nền tảng Nhập kho thủ công

## Phạm vi

Lô 1 chỉ khóa contract backend cho **Nhập kho thủ công** thuộc domain Kho. Không triển khai giao diện hoàn chỉnh, Excel, nhập trực tiếp, hoặc luồng của Issue #622.

## Semantic đã khóa

`Nhập kho thủ công` là một nguồn hàng vào kho riêng, khác với:

- `Tồn đầu kỳ` — khởi tạo số dư khi bắt đầu sử dụng hệ thống;
- `Kiểm kê / Điều chỉnh kho` — xử lý chênh lệch giữa sổ và thực tế;
- `Nhập hàng theo Mua hàng` — nhận hàng có chứng từ Mua hàng chuẩn;
- `Hàng khách trả` chính thức — phải dùng khi đã có chứng từ bán/giao đủ để nối nguồn.

Bốn loại nhập nghiệp vụ:

- `MANUAL_RECEIPT` — Nhập hàng thủ công;
- `OFF_DOCUMENT_CUSTOMER_RETURN` — Khách trả ngoài chứng từ;
- `RECOVERY` — Hàng thu hồi;
- `OTHER` — Khác, bắt buộc ghi chú.

## Nguồn sự thật và vòng đời

Một lần xác nhận tạo đúng một chứng từ bất biến và đúng một `MANUAL_INBOUND` Inventory IN canonical:

```text
Chứng từ Nhập kho thủ công
→ MANUAL_INBOUND / Inventory IN
→ Inventory Ledger
→ balance/read model
```

Không cập nhật tồn trực tiếp. Chứng từ đã ghi sổ không sửa/xóa; sai phải đảo movement canonical. Trạng thái `POSTED/REVERSED` được suy ra từ ledger/reversal, không cập nhật đè chứng từ gốc.

## Idempotency và transaction

- API nhận `Idempotency-Key` theo shared contract `[A-Za-z0-9._-]`, tối đa 128 ký tự.
- Retry cùng key + cùng payload trả lại đúng movement/chứng từ cũ và không ghi thêm audit/outbox.
- Cùng key + payload khác bị từ chối.
- Post chứng từ, movement, dòng snapshot, audit và outbox nằm trong cùng transaction.
- Reversal dùng contract Inventory reversal hiện có và cũng giữ replay identity.

## Quyền

Tách bốn quyền để Lô 2/3 có thể cấp theo nhiệm vụ thực tế:

- xem Nhập kho thủ công;
- chuẩn bị/kiểm tra dữ liệu;
- xác nhận nhập;
- đảo chứng từ.

## Giá vốn trong Lô 1

Lô 1 không tạo thuật toán giá vốn riêng. Để không sinh movement IN thiếu nguồn giá trước khi UI/resolver của Lô 3 hoàn chỉnh, contract post nền yêu cầu **giá vốn dương rõ ràng trên từng dòng** và ghi `unitCost`/`currencyCode=VND` vào metadata canonical mà engine moving-average hiện tại đã hiểu.

Lô 3 có thể mở rộng đúng policy đã khóa của Issue #633: nếu người dùng không nhập giá vốn thì resolve từ giá vốn hiện hành khi an toàn; nếu không resolve được mới yêu cầu nhập. Không bao giờ tự gán 0 làm giá vốn thật.

## Không thuộc Lô 1

- UI `Kho → Nhập kho thủ công`;
- nhập trực tiếp `SKU + Số lượng`;
- Excel/preview và sửa dòng lỗi;
- UX chỉ hỏi lô/HSD/vị trí/giá vốn khi thiếu;
- lịch sử/tra cứu hoàn chỉnh trên giao diện;
- thay đổi Sales fulfillment, phân bổ hàng hoặc Issue #622.
