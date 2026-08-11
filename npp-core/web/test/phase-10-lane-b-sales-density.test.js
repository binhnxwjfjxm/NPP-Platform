import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatExactDecimal } from '../lib/decimal-display.js';

const workspaceSource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../app/sales/sales-orders/sales-orders.module.css', import.meta.url), 'utf8');
const salesUiSource = readFileSync(new URL('../app/sales/sales-orders/sales-order-ui.ts', import.meta.url), 'utf8');
const inventoryTypesSource = readFileSync(new URL('../lib/inventory-types.ts', import.meta.url), 'utf8');

test('Phase 10 Lane B uses one exact decimal formatter across Sales and Inventory', () => {
  assert.equal(formatExactDecimal('1.000000'), '1');
  assert.equal(formatExactDecimal('1.250000'), '1.25');
  assert.equal(formatExactDecimal('-2.500000000000'), '-2.5');
  assert.equal(formatExactDecimal('12345678901234567890.000000000001'), '12345678901234567890.000000000001');
  assert.equal(formatExactDecimal('not-a-decimal'), 'not-a-decimal');
  assert.match(salesUiSource, /return formatExactDecimal\(value\)/);
  assert.match(inventoryTypesSource, /return formatExactDecimal\(value\)/);
});

test('Phase 10 Lane B compacts Sales list metadata and desktop order lines without shrinking mobile controls', () => {
  assert.match(workspaceSource, /className=\{styles\.orderCardMeta\}/);
  assert.match(cssSource, /\.orderCard\{[^}]*gap:\.22rem[^}]*padding:\.62rem \.75rem!important\}/);
  assert.match(cssSource, /\.orderCardMeta\{display:flex;align-items:center;gap:\.2rem \.7rem;flex-wrap:wrap/);
  assert.match(cssSource, /\.orderLineCard\{[^}]*gap:\.3rem \.4rem[^}]*padding:\.42rem \.6rem/);
  assert.match(cssSource, /\.orderLineCard input,\.orderLineCard select\{min-height:32px;padding:\.3rem \.5rem\}/);
  assert.match(cssSource, /@media\(max-width:780px\)[\s\S]*\.orderLineCard input,\.orderLineCard select\{min-height:38px\}/);
});

test('Lane B leaves confirm recovery and deterministic hydration safeguards in place', () => {
  assert.match(salesUiSource, /export function draftRecoveryTarget/);
  assert.match(salesUiSource, /priceChangedConfirm/);
  assert.match(salesUiSource, /VIETNAM_UTC_OFFSET_MS/);
  assert.match(salesUiSource, /statusCode = 0/);
});
