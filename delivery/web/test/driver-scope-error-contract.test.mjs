import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const presentation = await readFile(new URL('../lib/presentation.ts', import.meta.url), 'utf8');
const rolePresets = await readFile(new URL('../../../npp-core/web/app/access/roles/role-presets.ts', import.meta.url), 'utf8');

test('delivery app distinguishes warehouse scope, permission, profile and query failures', () => {
  assert.match(presentation, /WAREHOUSE_SCOPE_DENIED/);
  assert.match(presentation, /PERMISSION_DENIED/);
  assert.match(presentation, /DELIVERY_DRIVER_PROFILE_NOT_FOUND/);
  assert.match(presentation, /DELIVERY_DRIVER_TRIPS_QUERY_FAILED/);
  assert.match(presentation, /cấp đúng kho giao hàng rồi đăng nhập lại/);
});

test('driver delivery preset still includes canonical read permissions', () => {
  assert.match(rolePresets, /case 'driver-delivery'/);
  assert.match(rolePresets, /core\.delivery-trip\.driver-read/);
  assert.match(rolePresets, /core\.delivery-attempt\.read/);
  assert.match(rolePresets, /core\.delivery-attempt\.record/);
});
