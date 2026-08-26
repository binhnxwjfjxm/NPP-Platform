import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../../database/migrations/sales/040_sales_order_commercial_controls.sql', import.meta.url),
  'utf8',
);
const contract = readFileSync(
  new URL('../../../docs/operations/phase-6b2-sales-order-commercial-controls.md', import.meta.url),
  'utf8',
);
const formEntry = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url),
  'utf8',
);
const form = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url),
  'utf8',
);
const workspace = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../app/sales/sales-orders/sales-orders.module.css', import.meta.url),
  'utf8',
);

test('commercial controls migration owns channel, document discount and line pricing provenance', () => {
  for (const token of [
    'default_sales_channel_id',
    'sales_channel_code_snapshot',
    'document_discount_mode',
    'document_discount_reason',
    'base_unit_price',
    'system_unit_price',
    'manual_override_reason',
    'pricing_trace_snapshot',
    'core.sales-order.discount.override',
  ]) assert.match(migration, new RegExp(token));
});

test('Phase 6B.2 contract forbids MCP and production rollout changes', () => {
  assert.match(contract, /`mcp\/\*\*` must remain unchanged/);
  assert.match(contract, /No production deployment, production migration/);
  assert.match(contract, /largest remainder/i);
  assert.match(contract, /SALES_PRICE_CHANGED/);
});

test('canonical Sales Order form activates the commercial implementation', () => {
  assert.match(formEntry, /SalesOrderCommercialForm/);
  assert.match(formEntry, /export default function SalesOrderForm/);
});

test('manual order UI is wired for channel and commercial permissions', () => {
  assert.match(workspace, /priceOverride/);
  assert.match(workspace, /discountOverride/);
  assert.match(form, /salesChannelId/);
  assert.match(form, /canPriceOverride/);
  assert.match(form, /canDiscountOverride/);
  assert.match(form, /documentDiscountMode/);
  assert.match(form, /Giá điều chỉnh thủ công/);
  assert.match(form, /Dùng lại giá hệ thống/);
  assert.match(form, /Chiết khấu bổ sung toàn đơn/);
  assert.doesNotMatch(form, /Kiểu CK thêm/);
});

test('Sales Order line keeps optional controls compact until explicitly expanded', () => {
  assert.match(form, /const \[expandedLineId, setExpandedLineId\] = useState<string \| null>\(null\);/);
  assert.match(form, /aria-expanded=\{expandedLineId === line\.clientLineId\}/);
  assert.match(form, /hidden=\{expandedLineId !== line\.clientLineId\}/);
  assert.doesNotMatch(form, /className=\{styles\.lineCommercialActions\}/);
  assert.doesNotMatch(form, /<details className=\{styles\.lineDetails\}>/);
});

test('desktop modal has one real stable vertical scroll owner', () => {
  assert.match(styles, /\.orderEditorBody\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*scroll;[\s\S]*?scrollbar-gutter:\s*stable;/);
  assert.match(styles, /\.orderEditorModal\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(formEntry, /grid-auto-rows:max-content/);
});
