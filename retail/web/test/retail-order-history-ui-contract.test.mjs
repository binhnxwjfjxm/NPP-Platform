import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/retail-orders-polish.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');

test('order history matches the approved compact list layout', () => {
  const start = workspace.indexOf('{activeTab === \'orders\'');
  const end = workspace.indexOf('{activeTab === \'settings\'', start);
  assert.ok(start >= 0 && end > start);
  const orders = workspace.slice(start, end);

  assert.match(orders, /placeholder="Nhập mã đơn, khách hàng, số điện thoại"/);
  assert.match(orders, /aria-label="Từ ngày"/);
  assert.match(orders, /aria-label="Đến ngày"/);
  assert.match(orders, /order-status-filter/);
  assert.match(orders, /\{ id: 'all', label: 'Tất cả' \}/);
  assert.match(orders, /\{ id: 'draft', label: 'Đang lập' \}/);
  assert.match(orders, /\{ id: 'confirmed', label: 'Đã chốt' \}/);
  assert.match(orders, /\{ id: 'issued', label: 'Đã xuất kho' \}/);
  assert.doesNotMatch(orders, /orders-heading|history-icon/);

  assert.match(orders, /retail-order-history-card/);
  assert.match(orders, /order-history-identity/);
  assert.match(orders, /order-history-state/);
  assert.match(orders, /order-history-facts/);
  assert.match(orders, /order-history-print/);
  assert.match(orders, /In đơn hàng/);
});

test('order search, date range and direct card print are functional contracts', () => {
  assert.match(workspace, /const \[orderSearch, setOrderSearch\] = useState\(''\)/);
  assert.match(workspace, /const \[orderDateFrom, setOrderDateFrom\] = useState\(''\)/);
  assert.match(workspace, /const \[orderDateTo, setOrderDateTo\] = useState\(''\)/);
  assert.match(workspace, /localDateKey\(item\.updatedAt\)/);
  assert.match(workspace, /itemDate < orderDateFrom/);
  assert.match(workspace, /itemDate > orderDateTo/);
  assert.match(workspace, /item\.customerPhone/);
  assert.match(workspace, /async function printOrderFromHistory\(id: string\)/);
  assert.match(workspace, /setPrintSourceOrder\(sourceOrder\)/);
  assert.match(workspace, /printConfiguredOrder\(sourceOrder, template, settings/);
});

test('approved order list styling is isolated and loaded after general retail polish', () => {
  assert.match(css, /\.orders-search-field/);
  assert.match(css, /\.order-date-range/);
  assert.match(css, /\.order-status-filter/);
  assert.match(css, /\.retail-order-history-card/);
  assert.match(css, /\.order-history-print/);
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(layout, /retail-final-polish\.css'[\s\S]*retail-orders-polish\.css'[\s\S]*retail-print-professional\.css'/);
});
