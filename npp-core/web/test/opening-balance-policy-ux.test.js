import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = await readFile(new URL('../app/inventory/opening-balances/opening-balance-csv-workspace.tsx', import.meta.url), 'utf8');
const operator = await readFile(new URL('../../api/src/routes/opening-balance-operator.js', import.meta.url), 'utf8');
const exchangeFiles = await Promise.all([
  '../app/operations/data-exchange/workspace.tsx',
  '../app/operations/data-exchange/data-exchange-model.ts',
  '../app/operations/data-exchange/data-exchange-file-utils.ts',
  '../app/operations/data-exchange/data-exchange-import-actions.ts',
  '../app/operations/data-exchange/data-exchange-preview.tsx',
  '../app/operations/data-exchange/data-exchange-view.tsx',
].map((file) => readFile(new URL(file, import.meta.url), 'utf8')));
const dataExchange = exchangeFiles.join('\n');

test('opening balance template keeps operator input small and edits lot facts in the preview', () => {
  assert.match(workspace, /TEMPLATE_COLUMNS/);
  assert.match(workspace, /SKU.*Số lượng.*Vị trí/s);
  assert.match(workspace, /lotTrackingMode/);
  assert.match(workspace, /expiryTrackingMode/);
  assert.match(workspace, /type="date"/);
  assert.match(workspace, /Không áp dụng/);
  assert.match(workspace, /updateRow/);
});

test('opening balance operator resolves tracking policy from the inventory-base SKU, not from batch input', () => {
  assert.match(operator, /base\.is_inventory_base = true/);
  assert.match(operator, /policy\.lot_tracking_mode/);
  assert.match(operator, /policy\.expiry_tracking_mode/);
  assert.match(operator, /policy\.location_required/);
  assert.match(operator, /baseVariantId: variant\.base_variant_id/);
});

test('product data exchange exposes onboarding fields through operator-facing preview controls', () => {
  for (const field of ['unitCode', 'conversionToBase', 'lotTrackingMode', 'expiryTrackingMode', 'locationRequired']) assert.match(dataExchange, new RegExp(field));
  assert.match(dataExchange, /Tải mẫu Excel/);
  assert.match(dataExchange, /Tải mẫu CSV/);
  assert.match(dataExchange, /Xem trước trước khi nhập/);
  assert.match(dataExchange, /Quản lý theo lô/);
  assert.match(dataExchange, /Quản lý hạn sử dụng/);
  assert.match(dataExchange, /không cần nhập TRUE\/FALSE trong file/);
});
