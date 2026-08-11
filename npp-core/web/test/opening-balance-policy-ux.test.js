import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = await readFile(new URL('../app/inventory/opening-balances/opening-balance-csv-workspace.tsx', import.meta.url), 'utf8');
const operator = await readFile(new URL('../../api/src/routes/opening-balance-operator.js', import.meta.url), 'utf8');
const dataExchange = await readFile(new URL('../app/operations/data-exchange/workspace.tsx', import.meta.url), 'utf8');

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

test('product data exchange exposes onboarding fields instead of leaving unit and tracking setup as a second manual task', () => {
  for (const field of ['unitCode', 'conversionToBase', 'lotTrackingMode', 'expiryTrackingMode', 'locationRequired']) {
    assert.match(dataExchange, new RegExp(field));
  }
  assert.match(dataExchange, /Mẫu XLSX/);
  assert.match(dataExchange, /Mẫu CSV/);
});
