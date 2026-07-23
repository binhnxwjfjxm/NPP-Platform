# Gate 7D — Bepsi catalog import source

Nguồn sản phẩm không có file CSV local trong repo `report`.

Nguồn đúng nằm trong `src/product-catalog.js`:

- `SOURCE_PRODUCTS_URL`: `https://raw.githubusercontent.com/gustavjung01/F-B-Order/main/data/catalog/hung-phat/v2/products.csv`
- `SOURCE_REPO`: `gustavjung01/F-B-Order`
- fallback tối thiểu: `FALLBACK_PRODUCTS_CSV`
- nhóm biến thể/vị: `CHOICE_GROUPS_BY_SOURCE_KEY`

Hướng import đúng:

1. Tải CSV từ `SOURCE_PRODUCTS_URL`.
2. Bỏ `DISABLED_SOURCE_KEYS`.
3. Chuẩn hóa category/industry theo `CATEGORY_MAP`.
4. Chuẩn hóa brand + SKU theo logic trong `product-catalog.js`.
5. Seed vào `product_categories`, `product_brands`, `products`, `product_variants`.
6. Với sản phẩm có `CHOICE_GROUPS_BY_SOURCE_KEY`, sinh variant theo từng giá trị lựa chọn để popup đơn chọn được quy cách/vị trực tiếp.
7. Khi lưu đơn, ghi `order_items.product_id` và `order_items.variant_id`.
