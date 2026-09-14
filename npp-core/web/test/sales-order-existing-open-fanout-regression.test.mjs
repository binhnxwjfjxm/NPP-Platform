import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const form = await readFile(
  new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url),
  'utf8',
);

test('mở đơn đã lưu giữ giá hiện có thay vì tự tính lại toàn bộ ngay khi mount', () => {
  assert.match(
    form,
    /preserveSavedPricingOnInitialOpenRef\s*=\s*useRef\(props\.mode\s*!==\s*'create'\s*&&\s*Boolean\(version\?\.lines\?\.length\)\)/,
  );
  assert.match(
    form,
    /pricingContextRef\.current\s*=\s*signature;\s*if \(preserveSavedPricingOnInitialOpenRef\.current\) \{\s*preserveSavedPricingOnInitialOpenRef\.current = false;\s*return;\s*\}/,
  );
});

test('mở đơn cũ không tự fan-out sku-search và variants cho từng dòng', () => {
  assert.doesNotMatch(
    form,
    /useEffect\(\(\) => \{\s*for \(const line of lines\) \{\s*if \(line\.productId\) void loadProductVariants/,
  );
  assert.match(
    form,
    /onFocus=\{\(\) => \{\s*if \(line\.productId\) void loadProductVariants\(line\.productId\);\s*else void resolveLineProduct\(line\);\s*\}\}/,
  );
});

test('tính lại nhiều dòng không bắn price-preview song song vào backend', () => {
  assert.doesNotMatch(form, /Promise\.all\(snapshot\.map/);
  assert.match(
    form,
    /for \(const line of snapshot\) \{[\s\S]*?const resolution = await priceFor\(/,
  );
});
