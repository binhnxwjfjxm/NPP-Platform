import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = () => readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');

test('Chọn sản phẩm có phân trang thật và tải tiếp bằng offset hiện tại', async () => {
  const page = await workspace();
  assert.match(page, /const PRODUCT_PAGE_SIZE = 30/);
  assert.match(page, /function productQuery\(offset: number\)/);
  assert.match(page, /offset: String\(offset\)/);
  assert.match(page, /productQuery\(products\.length\)/);
  assert.match(page, /setProducts\(\(current\) =>/);
  assert.match(page, /setProductsHasMore\(page\.length === PRODUCT_PAGE_SIZE\)/);
  assert.match(page, /onClick=\{\(\) => void loadMoreProducts\(\)\}/);
  assert.match(page, /'Tải thêm sản phẩm'/);
});

test('đổi tìm kiếm hoặc nhóm sản phẩm reset về trang đầu thay vì nối dữ liệu cũ', async () => {
  const page = await workspace();
  const effectStart = page.indexOf('setProducts([]);');
  const effectEnd = page.indexOf('}, [open, search, categoryId]);', effectStart);
  const effect = page.slice(effectStart, effectEnd);
  assert.match(effect, /setProductsHasMore\(false\)/);
  assert.match(effect, /setProductsLoading\(true\)/);
  assert.match(effect, /productQuery\(0\)/);
});
