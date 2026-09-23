import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('Retail Lên đơn dùng POS popup, chọn một/chọn nhiều và không mở trang phụ', async () => {
  const [workspace, css] = await Promise.all([read('app/retail-workspace.tsx'), read('app/retail-pos-entry.css')]);
  assert.match(workspace, /Tìm và thêm sản phẩm vào đơn/);
  assert.match(workspace, /Chọn nhiều/);
  assert.match(workspace, /Tất cả loại sản phẩm/);
  assert.match(workspace, /multiSelectRef = useRef\(false\)/);
  assert.match(workspace, /multiSelectRef\.current = enabled/);
  assert.match(workspace, /if \(multiSelectRef\.current\)/);
  assert.match(workspace, /Number\(row\.quantity\) \+ 1/);
  assert.match(workspace, /setMultiSelectMode\(event\.target\.checked\)/);
  assert.match(workspace, /multi-selection-count/);
  assert.match(workspace, /adjustSelected\(product, -1\)/);
  assert.match(workspace, /Xong\{selected\.size/);
  assert.match(workspace, /role="dialog"/);
  assert.match(css, /\.pos-product-search-trigger/);
  assert.match(css, /\.multi-select-toggle/);
  assert.match(css, /\.pos-checkout-bar \.pos-checkout-action[\s\S]*?flex: 1\.8 1 0/);
});

test('Khách lẻ là mặc định; khách Công Ty chỉ hiện theo quyền, dùng gần đây và tìm kiếm theo nhu cầu', async () => {
  const [workspace, gateway] = await Promise.all([read('app/retail-workspace.tsx'), read('app/api/retail/[...segments]/route.ts')]);
  assert.match(workspace, /useState\('Khách lẻ'\)/);
  assert.match(workspace, /boot\?\.canBrowseCompanyCustomers/);
  assert.match(workspace, /Khách mua gần đây/);
  assert.match(workspace, /\/api\/retail\/customers\?/);
  assert.match(gateway, /canBrowseCompanyCustomers/);
  assert.match(gateway, /recentCustomersFromOrders/);
  assert.match(gateway, /\/api\/customers\?active=true&limit=1/);
  assert.match(gateway, /path\[0\] === 'customers'/);
  assert.doesNotMatch(gateway, /const \[settings, warehouses, customers, orders, categories\]/);
  assert.doesNotMatch(gateway, /\/api\/customers\?active=true&limit=200/);
});

test('Retail dùng pricing engine, popup nguồn giá/khuyến mãi, chiết khấu có quyền và ghi chú canonical', async () => {
  const [workspace, catalog] = await Promise.all([read('app/retail-workspace.tsx'), readRepo('npp-core/api/src/services/retail-catalog.js')]);
  assert.match(workspace, /canDiscountOverride/);
  assert.match(workspace, /documentDiscountMode/);
  assert.match(workspace, /documentDiscountReason/);
  assert.match(workspace, /note: note\.trim\(\) \|\| null/);
  assert.match(workspace, /Giá & khuyến mãi/);
  assert.match(workspace, /Khuyến mãi phù hợp được áp dụng tự động/);
  assert.match(workspace, /preview\.inputKey !== priceInputKey\(line\.id, line\.quantity\)/);
  assert.match(catalog, /appliedRules/);
  assert.match(catalog, /step\?\.kind === 'RULE'/);
});

test('Nút Thanh toán gom lifecycle PICKUP nhưng vẫn gọi canonical endpoints và idempotency generator', async () => {
  const workspace = await read('app/retail-workspace.tsx');
  assert.match(workspace, /async function checkout\(\)/);
  assert.match(workspace, /checkout-confirm/);
  assert.match(workspace, /checkout-issue-stock/);
  assert.match(workspace, /checkout-complete/);
  assert.match(workspace, /\/confirm/);
  assert.match(workspace, /\/issue-stock/);
  assert.match(workspace, /\/complete/);
  assert.match(workspace, />Thanh toán</);
  assert.match(workspace, /operationKeyFor/);
});

test('Tồn kho tách ba cột Sản phẩm, Tồn, Đang giữ bằng canonical reservedQuantity', async () => {
  const [panel, css] = await Promise.all([read('app/retail-inventory-panel.tsx'), read('app/retail-inventory.module.css')]);
  assert.match(panel, /<span>Sản phẩm<\/span>[\s\S]*?<b>Tồn<\/b>[\s\S]*?<b>Đang giữ<\/b>/);
  assert.match(panel, /quantityCell/);
  assert.match(panel, /row\.onHandQuantity/);
  assert.match(panel, /row\.reservedQuantity/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 86px 86px/);
});
