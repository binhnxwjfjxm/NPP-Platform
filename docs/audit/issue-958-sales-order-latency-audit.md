# Issue #958 — audit độ trễ tìm hàng / lập Đơn bán

Baseline source: `main@8542511deb5452a8c84afefacde7940d39e25134`.

## Baseline production do Owner đo

- Tìm 1 ký tự: khoảng 1–3 giây.
- Tìm 2 ký tự: khoảng 3–6 giây.
- Tìm đầy đủ tên: thường trên 5 giây.
- Máy yếu có thể 10–20 giây.
- Lập một đơn nhiều dòng có thể gần 10 phút.

## Root cause đã xác nhận từ source

### 1. Search SQL regression từ 09/09

Commit `bd477267a1acc3b43422009777bf0d3948c893f2` đổi tìm hàng sang normalize tiếng Việt trực tiếp trên SQL bằng `translate(lower(...)) + strpos(...)` cho từng token, trên nhiều cột và barcode. Các expression này còn lặp lại trong `ORDER BY`.

Query hiện tại không có search index tương ứng; các index btree hiện có không giúp `strpos(translate(lower(...)), token)` tìm substring. Kết quả là mỗi lần gõ phải quét và normalize nhiều chuỗi trên tập SKU đủ điều kiện.

### 2. Một lần gõ kéo nhiều round-trip DB

`sku-search` hiện không chỉ chạy query tìm SKU. Service còn đọc Sales Order settings song song rồi tiếp tục query metadata sản phẩm. Sau đó browser gọi `sku-previews`, backend lại kiểm context/orderable rồi đọc giá + tồn.

Client debounce hiện chỉ 120 ms và cho tìm từ 1 ký tự. Browser có AbortController nhưng backend không có cơ chế hủy PostgreSQL query khi HTTP request cũ bị abort; gõ nhanh có thể để lại nhiều SQL cũ tiếp tục chạy và cạnh tranh shared pool.

Pool mặc định hiện là 10 connection và đã có log `database_pool_pressure` khi `waitingCount > 0`. Không sửa bằng tăng pool mò.

### 3. Luồng lập đơn có request amplification gần O(N²)

`SalesOrderCommercialForm` đang có hai đường tính giá chồng nhau:

- `addSku()` gọi `/api/sales-orders/price-preview` cho SKU vừa thêm;
- đồng thời `quantitySignature` thay đổi và sau 320 ms gọi `repriceAll()` cho toàn bộ dòng;
- `repriceAll()` chạy `for ... await`, tức mỗi dòng một HTTP price-preview tuần tự.

Với 30 dòng, chỉ riêng thao tác thêm lần lượt có thể tạo khoảng 494 price-preview request theo logic hiện tại (chưa tính người dùng sửa số lượng, đổi khách/kênh giá, retry hoặc các request tìm hàng/preview tồn). Đây là nguyên nhân phù hợp trực tiếp với triệu chứng lập đơn kéo dài nhiều phút.

## Hướng sửa đã khóa

Không tăng timeout, không tăng pool mò và không bỏ khả năng tìm từ 1 ký tự.

Batch fix phải xử lý cùng lúc:

1. giảm CPU/query cost của SKU search, chỉ normalize search document một lần mỗi candidate thay vì lặp theo token/cột/barcode;
2. giảm round-trip của `sku-search`, tránh query settings + metadata riêng nếu cùng query có thể trả đủ dữ liệu;
3. tăng debounce ở mức vừa đủ để tránh request storm nhưng vẫn giữ UX tìm 1 ký tự;
4. không để add SKU kích hoạt reprice toàn đơn;
5. quantity change chỉ reprice dòng thật sự đổi;
6. trường hợp bắt buộc reprice toàn đơn (đổi khách/kênh/cách áp dụng giá) dùng bounded concurrency, không tuần tự N request và cũng không bắn N request cùng lúc;
7. thêm regression test cho request count/search-query shape, không chỉ test kết quả tìm kiếm.

## Boundary

- Chưa merge, chưa deploy production, chưa migration.
- Không sửa DB production thủ công.
- Không thay đổi nghiệp vụ giá/tồn hoặc optimistic concurrency.
- Branch sạch để code: `agent/sales-order-latency-fix` từ exact baseline `8542511...`.
