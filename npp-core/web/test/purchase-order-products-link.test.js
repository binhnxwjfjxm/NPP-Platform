import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  shouldShowPurchaseOrderProductsCatalogLink,
  shouldShowPurchaseOrderSkuCatalogLink,
} from '../lib/purchase-order-products-link.js';

test('purchase order catalog link follows live SKU-search context', () => {
  assert.equal(
    shouldShowPurchaseOrderProductsCatalogLink({
      products: [],
      errors: { products: null },
    }),
    false,
  );
  assert.equal(
    shouldShowPurchaseOrderProductsCatalogLink({
      products: [],
      errors: { products: 'Không tải được dữ liệu sản phẩm mua hàng' },
    }),
    false,
  );
  assert.equal(
    shouldShowPurchaseOrderProductsCatalogLink({
      products: [{ id: 'p1' }],
      errors: { products: null },
    }),
    false,
  );

  assert.equal(
    shouldShowPurchaseOrderSkuCatalogLink({
      loadingVariants: false,
      variantLookupFailed: false,
      skuIssue: 'SKU chưa được gắn đơn vị mua hàng và hệ số quy đổi.',
      currentError: 'SKU chưa được gắn đơn vị mua hàng và hệ số quy đổi.',
    }),
    true,
  );
  assert.equal(
    shouldShowPurchaseOrderSkuCatalogLink({
      loadingVariants: false,
      variantLookupFailed: true,
      skuIssue: 'SKU chưa được gắn đơn vị mua hàng và hệ số quy đổi.',
      currentError: 'SKU chưa được gắn đơn vị mua hàng và hệ số quy đổi.',
    }),
    false,
  );
  assert.equal(
    shouldShowPurchaseOrderSkuCatalogLink({
      loadingVariants: false,
      variantLookupFailed: false,
      skuIssue: null,
      currentError: null,
    }),
    false,
  );
});
