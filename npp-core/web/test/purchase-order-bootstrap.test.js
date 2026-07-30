import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('purchase order bootstrap keeps lookup refresh and blocker classification on one snapshot', async () => {
  const [bootstrap, productLink, lookupState, workspace, editor, route] = await Promise.all([
    readSource('../lib/purchase-order-bootstrap.ts'),
    readSource('../lib/purchase-order-products-link.js'),
    readSource('../app/purchasing/purchase-orders/purchase-order-lookup-state.ts'),
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
  assert.match(bootstrap, /loadPurchaseOrderPermissionKeys/);
  assert.match(bootstrap, /lookupErrorMessage/);
  assert.match(editor, /role="combobox"/);
  assert.match(editor, /parsePurchaseOrderPasteGrid/);
  assert.match(route, /loadPurchaseOrderBootstrap/);

  assert.match(productLink, /shouldShowPurchaseOrderProductsCatalogLink/);
  assert.match(productLink, /shouldShowPurchaseOrderSkuCatalogLink/);






  assert.match(workspace, /purchase-order-refresh-button/);
  assert.match(workspace, /purchase-order-products-link/);
  assert.match(workspace, /lookupMessage/);
  assert.match(workspace, /describePurchaseOrderLookupIssues/);
  assert.match(workspace, /shouldShowPurchaseOrderProductsCatalogLink/);
  assert.match(workspace, /contextualHelp/);
  assert.match(workspace, /contextualLink/);
  assert.match(workspace, /purchase-order-create-button/);
  assert.match(workspace, /\/products/);
  assert.match(editor, /purchase-order-products-link/);
  assert.match(editor, /shouldShowPurchaseOrderSkuCatalogLink/);
  assert.match(editor, /skuSearchFailed/);
  assert.doesNotMatch(workspace, /Cáº­p nháº­t dá»¯ liá»‡u vÃ  chá»‰ refresh danh sÃ¡ch Ä‘Æ¡n Ä‘áº·t hÃ ng/);
});
