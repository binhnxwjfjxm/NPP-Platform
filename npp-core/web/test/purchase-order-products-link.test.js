import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  shouldShowPurchaseOrderProductsCatalogLink,
  shouldShowPurchaseOrderSkuCatalogLink,
} from '../lib/purchase-order-products-link.js';

test('purchase order products link is only shown for empty product catalog or a successful SKU gap', () => {
  assert.equal(
    shouldShowPurchaseOrderProductsCatalogLink({
      products: [],
      errors: { products: null },
    }),
    true,
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
      skuIssue: 'Sản phẩm SP-01 — Sản phẩm 01 chưa có SKU mua hàng hợp lệ (đơn vị/quy đổi).',
      currentError: 'Sản phẩm SP-01 — Sản phẩm 01 chưa có SKU mua hàng hợp lệ (đơn vị/quy đổi).',
    }),
    true,
  );
  assert.equal(
    shouldShowPurchaseOrderSkuCatalogLink({
      loadingVariants: false,
      variantLookupFailed: true,
      skuIssue: 'Sản phẩm SP-01 — Sản phẩm 01 chưa có SKU nào để chọn.',
      currentError: 'Sản phẩm SP-01 — Sản phẩm 01 chưa có SKU nào để chọn.',
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
