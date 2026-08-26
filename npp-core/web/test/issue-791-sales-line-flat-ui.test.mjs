import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cssPath = new URL('../app/sales/sales-orders/sales-orders.module.css', import.meta.url);
const formPath = new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url);

test('Issue #791 keeps quantity, price and line discount controls flat and baseline-stable', async () => {
  const [css, form] = await Promise.all([readFile(cssPath, 'utf8'), readFile(formPath, 'utf8')]);
  assert.match(css, /issue-791-sales-line-flat-controls/);
  assert.match(css, /\.quantityStepper input,\.directPriceInput,\.discountControls input,\.discountControls select\{[^}]*border:0!important;[^}]*border-bottom:1px solid/);
  assert.match(css, /\.quantityStepper button\{[^}]*border:0!important;[^}]*background:transparent!important/);
  assert.match(css, /\.priceCell\{display:flex;gap:\.32rem;flex-wrap:nowrap\}/);
  assert.match(css, /\.manualBadge\{display:none\}/);
  assert.match(css, /\.priceCell>\.linkButton::after\{content:"↺"/);
  assert.match(form, /aria-label={`Số lượng \${line\.sku}`}/);
  assert.match(form, /aria-label={`Đơn giá \${line\.sku}`}/);
  assert.match(form, /aria-label={`Chiết khấu \${line\.sku}`}/);
});
