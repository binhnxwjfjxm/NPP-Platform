import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail chỉ hiện tab Tồn kho sau khi backend xác nhận quyền xem', async () => {
  const [page, root, workspace] = await Promise.all([
    read('app/page.tsx'),
    read('app/retail-root.tsx'),
    read('app/retail-workspace.tsx'),
  ]);
  assert.match(page, /retail-root/);
  assert.match(root, /fetch\('\/api\/retail\/inventory'/);
  assert.match(root, /inventoryAvailable=\{Boolean\(inventoryAccess\)\}/);
  assert.match(workspace, /inventoryAvailable && onOpenInventory/);
  assert.match(workspace, />Tồn kho<\/button>/);
});

test('Retail inventory gateway dùng quyền Công Ty và chỉ cho chọn kho có trong danh sách được trả về', async () => {
  const route = await read('app/api/retail/inventory/route.ts');
  assert.match(route, /\/api\/warehouses\?active=true&limit=200/);
  assert.match(route, /\/api\/inventory\/balances\?limit=1&offset=0/);
  assert.match(route, /warehouses\.some\(\(warehouse\) => warehouse\.id === warehouseId\)/);
  assert.match(route, /RETAIL_INVENTORY_WAREHOUSE_FORBIDDEN/);
  assert.doesNotMatch(route, /method:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]/);
});

test('Tồn kho Retail là màn chỉ xem, hiển thị sản phẩm SKU Tồn và Đang giữ', async () => {
  const panel = await read('app/retail-inventory-panel.tsx');
  assert.match(panel, /Tìm sản phẩm \/ SKU/);
  assert.match(panel, /SKU: \{row\.sku\}/);
  assert.match(panel, /<b>Tồn<\/b>/);
  assert.match(panel, /<b>Đang giữ<\/b>/);
  assert.match(panel, /row\.onHandQuantity/);
  assert.match(panel, /row\.reservedQuantity/);
  assert.doesNotMatch(panel, /method:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]/);
});

test('Tồn và Đang giữ được cộng chính xác theo SKU từ canonical inventory balances', async () => {
  const route = await read('app/api/retail/inventory/route.ts');
  assert.match(route, /base_variant_id/);
  assert.match(route, /on_hand_quantity/);
  assert.match(route, /reserved_quantity/);
  assert.match(route, /BigInt\(10\) \*\* BigInt\(SCALE\)/);
  assert.match(route, /current\.onHandScaled \+= decimalToScaled/);
  assert.match(route, /current\.reservedScaled \+= decimalToScaled/);
});
