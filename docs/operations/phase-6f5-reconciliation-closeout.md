# Phase 6F.5 — Đối soát, trạng thái tổng hợp và closeout

## Phần này giúp gì

Một màn đọc-only trong NPP Operations đối chiếu được toàn bộ dòng tiền sau bán hàng:

- số đã ghi nợ, số đã phân bổ, số còn phải thu và credit chưa dùng;
- trạng thái đơn hàng, chuẩn bị hàng, giao hàng và thanh toán hiển thị thành bốn trục riêng;
- tiền COD khách đã trả, tiền tài xế còn giữ, tiền đã bàn giao, tiền công ty đã nhận và chênh lệch;
- mọi số tổng hợp có đường mở về chứng từ, đơn, chuyến hoặc nghiệp vụ COD gốc.

## Phạm vi source

- Migration `057_phase6f_reconciliation_views` chỉ tạo read model trong schema `reporting`.
- Core API chỉ có `GET /api/accounting/reconciliation`, dùng quyền `core.receivable.read` và bắt buộc warehouse scope.
- NPP route `/accounting/reconciliation` nằm trong nhóm Kế toán & công nợ.
- Không thêm mutation, không sửa ledger, allocation, collection, handover hoặc trạng thái đơn.
- Không sửa MCP, Admin, Delivery hoặc Website.

## Công thức kiểm tra

- Chứng từ: tổng ledger phải bằng posting trừ reversal; allocated/remaining phải bằng active allocation sau khi loại reversal.
- Khách hàng: dư nợ đang mở trừ credit chưa dùng phải bằng tổng ledger trong cùng khách, kho và tiền tệ.
- Balance projection: tổng tài khoản khách toàn installation phải bằng `accounting.customer_receivable_balances`.
- COD collection: tiền mặt đã thu phải bằng tiền đã bàn giao cộng tiền tài xế còn giữ; lời hẹn `NONE` phải bằng 0 và không có payment document.
- COD handover: tiền khai bàn giao phải bằng tiền chờ nhận cộng tiền đã nhận cộng variance; acceptance reversal quay lại trạng thái chờ nhận.
- Trạng thái thanh toán đơn được tính lại từ receivable đã post, đã phân bổ và còn lại; không gộp với fulfillment/delivery.

## Bố cục giao diện

- Hai link điều hướng liên quan nằm trong vùng action của AppShell.
- Bộ lọc nằm đầu nội dung.
- Ba nút của bộ lọc nằm cùng một hàng, canh phải, theo thứ tự `Đặt lại`, `Xuất CSV`, `Áp dụng`.
- Drill-down nằm trong cột mã khách/chứng từ/đơn/chuyến.
- Không đặt nút mutation trong thẻ tổng hợp hoặc bảng đối soát.

## Source gate

```bash
npm --prefix npp-core/api run verify
npm --prefix npp-core/web run verify
node npp-core/api/scripts/phase-6f-reconciliation.js
```

Script trả exit code khác 0 nếu `reporting.phase6f_closeout_anomalies` còn dòng.

## Production closeout — bước riêng

Merge source không đồng nghĩa production hoàn tất. Chỉ khi có lệnh rõ mới thực hiện:

1. Audit exact `main`, provider, release và migration pending.
2. Xác nhận fresh backup và restore rehearsal.
3. Chạy đúng pending migration Phase 6F.
4. Deploy Core backend, NPP Operations và Delivery theo source diff thực tế.
5. Smoke health/API/UI/static assets, quyền deny-by-default và warehouse scope.
6. Chạy reconciliation script; lưu evidence và rollback/forward-fix.
7. Giữ Auto Deploy OFF.

Không deploy MCP, Admin hoặc Website khi không có source diff liên quan.
