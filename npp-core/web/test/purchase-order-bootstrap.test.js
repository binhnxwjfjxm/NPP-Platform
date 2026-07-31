import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('purchase order bootstrap keeps lookup, permission loading and price resolution on one safe contract', async () => {
  const [bootstrap, productLink, workspace, editorAlias, editor, permissionEditor, route] = await Promise.all([
    readSource('../lib/purchase-order-bootstrap.ts'),
    readSource('../lib/purchase-order-products-link.js'),
    readSource('../app/purchasing/purchase-orders/PurchaseOrderWorkspace.tsx'),
    readSource('../app/purchasing/purchase-orders/components/PurchaseOrderEditorV3.tsx'),
    readSource('../app/purchasing/purchase-orders/components/PurchaseOrderEditorV4.tsx'),
    readSource('../app/purchasing/purchase-orders/components/PurchaseOrderEditorV5.tsx'),
    readSource('../app/api/purchase-orders/bootstrap/route.ts'),
  ]);

  assert.match(bootstrap, /Promise\.allSettled/);
  assert.match(bootstrap, /listPurchaseOrders/);
  assert.match(bootstrap, /listAllSuppliers/);
  assert.match(bootstrap, /loadOrganizationSnapshot/);
  assert.doesNotMatch(bootstrap, /listProducts/);
  assert.match(editorAlias, /PurchaseOrderEditorV5/);
  assert.match(editor, /purchase-orders\/sku-search/);
  assert.match(editor, /purchase-orders\/sku-resolve/);
  assert.match(bootstrap, /loadPurchaseOrderPermissionKeys/);
  assert.match(bootstrap, /lookupErrorMessage/);
  assert.match(editor, /parsePurchaseOrderPasteGrid/);
  assert.match(editor, /SupplierPurchasePriceResolution/);
  assert.match(editor, /refreshLinePrice\(key: string, sourceLine\?: EditorLine\)/);
  assert.match(editor, /handleQuantityBlur/);
  assert.match(editor, /automaticLine/);
  assert.match(permissionEditor, /\/api\/purchase-orders\/bootstrap/);
  assert.match(permissionEditor, /loaded: false, keys: \[\]/);
  assert.match(permissionEditor, /redactPurchaseOrderPrice/);
  assert.match(permissionEditor, /PurchaseOrderEditorV4/);
  assert.match(route, /loadPurchaseOrderBootstrap/);

  assert.match(productLink, /shouldShowPurchaseOrderProductsCatalogLink/);
  assert.match(productLink, /shouldShowPurchaseOrderSkuCatalogLink/);
  assert.match(workspace, /purchase-order-refresh-button/);
  assert.match(workspace, /lookupMessage/);
  assert.match(workspace, /describePurchaseOrderLookupIssues/);
  assert.match(workspace, /purchase-order-create-button/);
  assert.match(editor, /href="\/products"/);
  assert.match(editor, /Tìm nhanh/);
  assert.match(editor, /Chọn từ danh mục/);
  assert.match(editor, /Nhập nhiều dòng/);
  assert.doesNotMatch(workspace, /Cập nhật dữ liệu và chỉ refresh danh sách đơn đặt hàng/);
});
