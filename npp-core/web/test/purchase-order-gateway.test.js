import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('purchase-order web contract', () => {
  it('validates IDs, limits query keys and requires caller-owned idempotency keys', () => {
    const gateway = read('../lib/purchase-order-gateway.ts');
    assert.match(gateway, /const UUID_PATTERN/);
    assert.match(gateway, /const ALLOWED_QUERY_KEYS/);
    assert.match(gateway, /function assertIdempotencyKey/);
    assert.match(gateway, /idempotencyKey: assertIdempotencyKey\(idempotencyKey\)/);
    assert.doesNotMatch(gateway, /idempotencyKey\?\.trim\(\) \|\| `web-/);
  });

  it('uses canonical Core permissions and exact decimal helpers', () => {
    const types = read('../lib/purchase-order-types.ts');
    assert.match(types, /read: 'core\.purchase-order\.read'/);
    assert.match(types, /approve: 'core\.purchase-order\.approve'/);
    const lineEntry = read('../lib/purchase-order-line-entry-v2.js');
    assert.match(lineEntry, /const SCALE = 1_000_000n/);
    assert.match(types, /calculatePurchaseOrderDraftTotals/);
    assert.doesNotMatch(types, /parseFloat|parseInt/);
  });

  it('renders business labels and list counts without raw technical fallbacks', () => {
    const list = read('../app/purchasing/purchase-orders/components/PurchaseOrderList.tsx');
    assert.match(list, /PURCHASE_ORDER_STATUS_LABELS\[purchaseOrder\.status\]/);
    assert.match(list, /purchaseOrder\.lineCount/);
    assert.match(list, /purchaseOrder\.supplierName/);
    assert.match(list, /purchaseOrder\.warehouseName/);
    assert.doesNotMatch(list, /Number\(purchaseOrder\.total\)|purchaseOrder\.supplierId|purchaseOrder\.warehouseId/);
  });

  it('implements controlled editor and live lifecycle actions', () => {
    const workspace = read('../app/purchasing/purchase-orders/PurchaseOrderWorkspace.tsx');
    const editor = read('../app/purchasing/purchase-orders/components/PurchaseOrderEditorV2.tsx');
    assert.match(workspace, /<AppShell/);
    assert.match(workspace, /actionKeys = useRef\(new Map/);
    assert.match(workspace, /\/api\/purchase-orders\/\$\{purchaseOrder\.id\}\/\$\{action\}/);
    assert.match(workspace, /expectedRevision: purchaseOrder\.revision/);
    assert.match(editor, /<form className=\{localStyles\.form\} onSubmit=\{save\}>/);
    assert.match(editor, new RegExp('purchase-orders/sku-search'));
    assert.match(editor, /role="combobox"/);
    assert.match(editor, /Idempotency-Key': attemptKey/);
    assert.match(editor, /decimalToScaled/);
    assert.match(editor, /Chọn từ danh mục/);
    assert.match(editor, /Nhập nhiều dòng/);
    assert.doesNotMatch(editor, /MutationObserver|querySelector|parseFloat/);
  });

  it('keeps server tokens behind same-origin route handlers', () => {
    const collection = read('../app/api/purchase-orders/route.ts');
    const detail = read('../app/api/purchase-orders/[id]/route.ts');
    const action = read('../app/api/purchase-orders/[id]/_action.ts');
    assert.match(collection, /createPurchaseOrderDraft/);
    assert.match(detail, /patchPurchaseOrderDraft/);
    assert.match(action, /proxyPurchaseOrderAction/);
    assert.doesNotMatch(collection + detail + action, /CORE_API_SERVER_TOKEN/);
  });
});
