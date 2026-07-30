import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('purchase order bootstrap keeps lookup refresh and blocker classification on one snapshot', async () => {
  const [bootstrap, productLink, workspace, editor, route] = await Promise.all([
    readSource('../lib/purchase-order-bootstrap.ts'),
    readSource('../lib/purchase-order-products-link.js'),
    readSource('../app/purchasing/purchase-orders/PurchaseOrderWorkspace.tsx'),
    readSource('../app/purchasing/purchase-orders/components/PurchaseOrderEditor.tsx'),
    readSource('../app/api/purchase-orders/bootstrap/route.ts'),
  ]);

  assert.match(bootstrap, /Promise\.allSettled/);
  assert.match(bootstrap, /listPurchaseOrders/);
  assert.match(bootstrap, /listAllSuppliers/);
  assert.match(bootstrap, /loadOrganizationSnapshot/);
  assert.doesNotMatch(bootstrap, /listProducts/);
  assert.match(editor, /purchase-orders\/sku-search/);
  assert.match(editor, /purchase-orders\/sku-resolve/);
  assert.match(bootstrap, /loadPurchaseOrderPermissionKeys/);
  assert.match(bootstrap, /lookupErrorMessage/);
  assert.match(editor, /role="combobox"/);
  assert.match(editor, /parsePurchaseOrderPasteGrid/);
  assert.match(route, /loadPurchaseOrderBootstrap/);

  assert.match(productLink, /shouldShowPurchaseOrderProductsCatalogLink/);
  assert.match(productLink, /shouldShowPurchaseOrderSkuCatalogLink/);
  assert.match(workspace, /purchase-order-refresh-button/);
  assert.match(workspace, /lookupMessage/);
  assert.match(workspace, /describePurchaseOrderLookupIssues/);
  assert.match(workspace, /purchase-order-create-button/);
  assert.match(editor, /purchase-order-products-link/);
  assert.match(editor, /shouldShowPurchaseOrderSkuCatalogLink/);
  assert.match(editor, /skuSearchFailed/);
  assert.doesNotMatch(workspace, /Cập nhật dữ liệu và chỉ refresh danh sách đơn đặt hàng/);
});
