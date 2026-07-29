import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('purchase-order frontend safety contract', () => {
  it('validates IDs, limits query keys and requires caller-owned idempotency keys', () => {
    const gateway = read('../lib/purchase-order-gateway.ts');

    assert.match(gateway, /const UUID_PATTERN/);
    assert.match(gateway, /const ALLOWED_QUERY_KEYS/);
    assert.match(gateway, /function assertIdempotencyKey/);
    assert.match(gateway, /idempotencyKey: assertIdempotencyKey\(idempotencyKey\)/);
    assert.doesNotMatch(gateway, /idempotencyKey\?\.trim\(\) \|\| `web-/);
  });

  it('keeps money as decimal strings and centralizes status/action policy', () => {
    const types = read('../lib/purchase-order-types.ts');

    assert.match(types, /export function formatDecimalString/);
    assert.match(types, /PURCHASE_ORDER_STATUS_LABELS/);
    assert.match(types, /purchaseOrderActionPolicy/);
    assert.doesNotMatch(types, /parseFloat|parseInt/);
  });

  it('does not expose technical enum or raw IDs in the list', () => {
    const list = read('../app/purchasing/purchase-orders/components/PurchaseOrderList.tsx');

    assert.match(list, /PURCHASE_ORDER_STATUS_LABELS\[purchaseOrder\.status\]/);
    assert.match(list, /supplierName \|\| 'Chưa có tên nhà cung cấp'/);
    assert.match(list, /warehouseName \|\| 'Chưa có tên kho nhận'/);
    assert.doesNotMatch(list, /Number\(purchaseOrder\.total\)|Number\(po\.total\)/);
    assert.doesNotMatch(list, />\{purchaseOrder\.status\}</);
  });

  it('uses AppShell, controlled filters and fail-closed mutation actions', () => {
    const workspace = read('../app/purchasing/purchase-orders/PurchaseOrderWorkspace.tsx');

    assert.match(workspace, /<AppShell/);
    assert.match(workspace, /value=\{search\}/);
    assert.match(workspace, /value=\{statusFilter\}/);
    assert.match(workspace, /initialPermissionKeys\.length === 0/);
    assert.doesNotMatch(workspace, /style=\{\{/);
  });
});
