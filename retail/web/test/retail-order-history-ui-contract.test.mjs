import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/retail-orders-polish.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');

test('order history matches the approved compact list layout', () => {
  const start = workspace.indexOf("{activeTab === 'orders'");
  const end = workspace.indexOf("{activeTab === 'settings'", start);
  assert.ok(start >= 0 && end > start);
  const orders = workspace.slice(start, end);

  assert.match(orders, /placeholder="Nhập mã đơn, khách hàng, số điện thoại"/);
  assert.match(orders, /aria-label="Từ ngày"/);
  assert.match(orders, /aria-label="Đến ngày"/);
  assert.match(orders, /order-summary/);
  assert.match(orders, /<span>Đơn<\/span>/);
  assert.match(orders, /<span>Doanh thu<\/span>/);
  assert.match(orders, /filteredOrders\.length/);
  assert.match(orders, /moneyNumber\.format\(filteredOrderRevenue\)/);
  assert.doesNotMatch(orders, /order-status-filter/);
  assert.doesNotMatch(orders, /label: 'Tất cả'/);
  assert.doesNotMatch(orders, /label: 'Đang lập'/);
  assert.doesNotMatch(orders, /label: 'Đã chốt'/);
  assert.doesNotMatch(orders, /label: 'Đã xuất kho'/);
  assert.doesNotMatch(orders, /orders-heading|history-icon/);

  assert.match(orders, /retail-order-history-card/);
  assert.match(orders, /order-history-identity/);
  assert.match(orders, /order-history-state/);
  assert.match(orders, /order-history-facts/);
  assert.match(orders, /order-history-print/);
  assert.match(orders, /In đơn hàng/);
  assert.match(orders, /Xem thêm đơn hàng/);
});

test('order search, date range and direct card print are functional contracts', () => {
  assert.match(workspace, /const \[orderSearch, setOrderSearch\] = useState\(''\)/);
  assert.match(workspace, /const \[orderDateFrom, setOrderDateFrom\] = useState\(''\)/);
  assert.match(workspace, /const \[orderDateTo, setOrderDateTo\] = useState\(''\)/);
  assert.match(workspace, /localDateKey\(item\.createdAt\)/);
  assert.match(workspace, /itemDate < orderDateFrom/);
  assert.match(workspace, /itemDate > orderDateTo/);
  assert.match(workspace, /item\.customerPhone/);
  assert.match(workspace, /const filteredOrderRevenue = filteredOrders/);
  assert.match(workspace, /item\.status === 'closed'/);
  assert.match(workspace, /async function printOrderFromHistory\(id: string\)/);
  assert.match(workspace, /setPrintSourceOrder\(sourceOrder\)/);
  assert.match(workspace, /printConfiguredOrder\(sourceOrder, template, settings/);
});

test('approved order list styling is isolated and loaded after general retail polish', () => {
  assert.match(css, /\.orders-search-field/);
  assert.match(css, /\.order-date-range/);
  assert.match(css, /\.order-date-field/);
  assert.match(css, /min-height:\s*38px/);
  assert.match(css, /\.order-summary/);
  assert.match(css, /\.order-summary-card/);
  assert.match(css, /\.retail-order-history-card/);
  assert.match(css, /\.order-history-print/);
  assert.match(css, /\.orders-load-more/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /\.order-status-filter/);
  assert.match(layout, /retail-final-polish\.css'[\s\S]*retail-print-professional\.css'[\s\S]*retail-product-picker-polish\.css'[\s\S]*retail-orders-polish\.css'/);
});

test('order history refactor keeps render and print boundaries single', () => {
  assert.equal((workspace.match(/function printBySystem\(paper: PrintPaper\)/g) ?? []).length, 1);
  assert.equal((workspace.match(/async function enableRetailNotifications\(\)/g) ?? []).length, 1);
  assert.equal((workspace.match(/\{activeTab === 'settings' \? <section className="settings-workspace retail-page">/g) ?? []).length, 1);
  assert.match(workspace, /return `\$\{hour\}:\$\{minute\} \$\{day\}\/\$\{month\}\/\$\{year\}`/);
  assert.match(workspace, /moneyNumber\.format\(Number\(item\.total \|\| 0\)\)/);
});
