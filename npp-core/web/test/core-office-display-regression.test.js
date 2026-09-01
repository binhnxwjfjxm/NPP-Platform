import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatExactDecimal } from '../lib/decimal-display.js';

const detailSource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderDetail.tsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const globalsCss = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const densityCss = readFileSync(new URL('../app/core-office-density.css', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('../app/components/app-shell.module.css', import.meta.url), 'utf8');
const salesCss = readFileSync(new URL('../app/sales/sales-orders/sales-orders.module.css', import.meta.url), 'utf8');

test('Công Ty sales detail uses the shared exact-decimal formatter for displayed order quantities', () => {
  assert.equal(formatExactDecimal('1.000000'), '1');
  assert.equal(formatExactDecimal('1.500000'), '1.5');
  assert.match(detailSource, /formatQuantity\(line\.quantity\)/);
  assert.doesNotMatch(detailSource, /<span>\{line\.quantity\}\s+\{line\.unitCode\}<\/span>/);
});

test('Đơn bán hàng exposes distinct visual tones for business statuses', () => {
  assert.match(workspaceSource, /function orderCardTone\(order: SalesOrder\)/);
  assert.match(workspaceSource, /return 'waiting'/);
  assert.match(workspaceSource, /data-sales-order-tone=\{orderCardTone\(order\)\}/);
  assert.match(detailSource, /data-sales-order-tone=\{order\.status\}/);

  for (const tone of ['draft', 'confirmed', 'waiting', 'cancelled', 'closed']) {
    assert.match(densityCss, new RegExp(`data-sales-order-tone='${tone}'`));
  }
});

test('Công Ty screen typography keeps the shared 120 percent scale while print and main control hit areas stay stable', () => {
  assert.match(layoutSource, /import '\.\/core-office-density\.css';/);
  assert.match(globalsCss, /html\s*\{[\s\S]*?font-size:\s*120%;/);
  assert.match(globalsCss, /body\s*\{[\s\S]*?font-size:\s*0\.875rem;/);
  assert.doesNotMatch(densityCss, /font-size:\s*80%/);
  assert.doesNotMatch(densityCss, /font-size:\s*11\.2px/);
  assert.match(densityCss, /@media print[\s\S]*html\s*\{\s*font-size:\s*100%;/);
  assert.match(densityCss, /@media print[\s\S]*body\s*\{\s*font-size:\s*14px;/);

  assert.match(shellCss, /\.navItem\s*\{[\s\S]*?min-height:\s*48px/);
  assert.match(shellCss, /\.actionButton\s*\{[\s\S]*?min-height:\s*38px/);
  assert.match(salesCss, /\.toolbar input,\.toolbar select,\.reasonRow input\{min-height:42px/);
});
