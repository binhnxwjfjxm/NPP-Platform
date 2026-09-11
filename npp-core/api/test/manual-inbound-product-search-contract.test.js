import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../src/services/manual-inbound-product-search.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/routes/manual-inbound.js', import.meta.url), 'utf8');

test('Nhập kho thủ công tìm hàng theo đúng phạm vi Kho và chính sách quản lý tồn', () => {
  assert.match(service, /coreInventoryManualInboundPrepare/);
  assert.match(service, /allowedWarehouseIds/);
  assert.match(service, /location_management_mode/);
  assert.match(service, /p\.is_inventory_managed = true/);
  assert.match(service, /shared\.product_barcodes/);
  assert.match(service, /inventory\.inventory_cost_balances/);
  assert.match(service, /average_unit_cost/);
  assert.match(service, /lot_tracking_mode/);
  assert.match(service, /expiry_tracking_mode/);
});

test('route Nhập kho thủ công có endpoint tìm hàng riêng, không mượn quyền Bán hàng hay Mua hàng', () => {
  assert.match(route, /operator\/products/);
  assert.match(route, /searchManualInboundProducts/);
  assert.doesNotMatch(service, /coreSales/);
  assert.doesNotMatch(service, /corePurchasing/);
});
