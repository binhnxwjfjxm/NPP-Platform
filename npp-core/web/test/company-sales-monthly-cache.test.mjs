import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

async function loadFunctions(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const period = await loadFunctions('../lib/sales-order-period.ts');
const filters = await loadFunctions('../lib/sales-order-list-filter.ts');

test('tháng Việt Nam chính xác ở ranh giới UTC, năm nhuận và tháng 1', () => {
  assert.equal(period.getVietnamMonthKey(new Date('2026-09-30T16:59:59.999Z')), '2026-09');
  assert.equal(period.getVietnamMonthKey(new Date('2026-09-30T17:00:00.000Z')), '2026-10');
  assert.deepEqual(period.vietnamMonthBounds('2026-10'), {
    dateFrom: '2026-09-30T17:00:00.000Z',
    dateTo: '2026-10-31T17:00:00.000Z',
  });
  assert.deepEqual(period.vietnamMonthBounds('2024-02'), {
    dateFrom: '2024-01-31T17:00:00.000Z',
    dateTo: '2024-02-29T17:00:00.000Z',
  });
  assert.equal(period.previousVietnamMonth('2026-01'), '2025-12');
  assert.equal(period.previousVietnamMonth('2026-03'), '2026-02');
  assert.throws(() => period.vietnamMonthBounds('2026-13'));
});

test('lọc tại trình duyệt theo mã đơn, khách có dấu, nguồn và hình thức giao', () => {
  const outlet = {number:'SO-260009-000123',customerName:'Cửa hàng Tân Phước',
    customerCode:'KH0008',sourceType:'MCP',sourceId:'field-order',
    deliveryMode:'DELIVERY',deliveryExecutionMode:'MANUAL'};
  assert.equal(filters.matchesSalesOrderSearch(outlet, 'SO000123'), true);
  assert.equal(filters.matchesSalesOrderSearch(outlet, 'tan phuoc'), true);
  assert.equal(filters.matchesSalesOrderSearch(outlet, 'kh0008'), true);
  assert.equal(filters.matchesSalesOrderSearch(outlet, 'không có'), false);
  assert.equal(filters.matchesSalesOrderSource(outlet, 'mcp'), true);
  assert.equal(filters.matchesSalesOrderSource(outlet, 'internal'), false);
  assert.equal(filters.matchesSalesOrderLane(outlet, 'manual'), true);
  const portal = {...outlet,sourceType:'API',sourceId:'CUSTOMER_PORTAL:123',
    deliveryMode:'PICKUP'};
  assert.equal(filters.matchesSalesOrderSource(portal, 'customer'), true);
  assert.equal(filters.matchesSalesOrderSource(portal, 'internal'), false);
  assert.equal(filters.matchesSalesOrderLane(portal, 'counter'), true);
});

test('1.500 đơn được tìm tại máy không cần chờ phản hồi API', () => {
  const orders = Array.from({length:1500}, (_, index) => ({
    number: `SO-260010-${String(index).padStart(6,'0')}`,
    customerName: `Khách hàng ${index}`,
    customerCode: `KH${index}`, sourceType:'MANUAL',sourceId:null,
    deliveryMode:'DELIVERY',deliveryExecutionMode:'TRIP',
  }));
  const start = performance.now();
  const results = orders.filter((order) => filters.matchesSalesOrderSearch(order, 'Khách hàng 1499'));
  const elapsed = performance.now() - start;
  assert.equal(results.length, 1);
  assert.ok(elapsed < 2000, `Quét 1.500 đơn mất ${elapsed.toFixed(1)}ms`);
});

test('danh sách tháng không yêu cầu máy chủ sau mỗi lần đổi từ khóa hay lọc', () => {
  const source = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /monthCacheRef\.current\.set\(cacheKey, complete\)/);
  assert.match(source, /while \(continuePaging\)/);
  assert.match(source, /params\.set\('cursorId', cursorId\)/);
  assert.match(source, /cursorId = next\[next\.length - 1\]\.id/);
  assert.match(source, /\[periodMode, periodKey, customRangeError\]/);
  assert.match(source, /matchesSalesOrderSearch\(order, search\)/);
  assert.match(source, /visibleOrders\.map/);
  assert.match(source, /listRequestRef\.current/);
  assert.match(source, /controller\.signal\.aborted/);
  assert.match(source, /setPeriodMode\('month'\)/);
  assert.match(source, /scope: 'history', compact: '1'/);
});

test('bộ chọn Thời gian - Từ ngày - Đến ngày luôn nằm trong một cụm cố định', () => {
  const source = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../app/sales/sales-orders/sales-orders.module.css', import.meta.url), 'utf8');
  const start = source.indexOf('<div className={styles.periodControls}');
  const end = source.indexOf('<label className={styles.orderSearchField}>', start);
  assert.ok(start > 0 && end > start);
  const group = source.slice(start, end);
  assert.match(group, /<select value=\{periodChoice\}/);
  assert.match(group, /type="date" value=\{rangeFrom\}/);
  assert.match(group, /type="date" value=\{rangeTo\}/);
  assert.doesNotMatch(group, /periodMode === 'range' &&/);
  assert.doesNotMatch(group, /Đơn chưa hoàn thành/);
  assert.doesNotMatch(source, /pendingFilterRow/);
  assert.doesNotMatch(source, /type="month"/);
  assert.match(styles, /\.toolbar \.periodControls\{display:grid;grid-template-columns:/);
  assert.match(styles, /flex-wrap:wrap/);
  assert.match(styles, /grid-template-columns:154px 132px 132px;overflow-x:auto/);
  assert.match(source, /scope: 'history', compact: '1'/);
});

test('đổi nhanh Tháng này - Tháng trước hoặc thay ngày dùng đúng bộ lọc', () => {
  const source = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /setRangeTo\(value === 'current' \? getVietnamDateKey\(new Date\(\)\) : lastDayOfVietnamMonth\(month\)\)/);
  assert.match(source, /setPeriodChoice\('custom'\)/);
  assert.match(source, /setPeriodMode\('range'\)/);
  assert.match(source, /lastDayOfVietnamMonth\(key: string\)/);
  assert.match(source, /monthCacheRef\.current\.set\(cacheKey, complete\)/);
  assert.match(source, /matchesSalesOrderSearch\(order, search\)/);
});

test('Ngày bao gồm cả ngày kết thúc theo giờ Việt Nam, chặn khoảng ngày sai', () => {
  assert.deepEqual(period.vietnamDateRangeBounds('2026-10-01', '2026-10-09'), {
    dateFrom: '2026-09-30T17:00:00.000Z',
    dateTo: '2026-10-09T17:00:00.000Z',
  });
  assert.deepEqual(period.vietnamDateRangeBounds('2024-02-29', '2024-02-29'), {
    dateFrom: '2024-02-28T17:00:00.000Z',
    dateTo: '2024-02-29T17:00:00.000Z',
  });
  assert.equal(period.getVietnamDateKey(new Date('2026-10-09T17:00:00.000Z')), '2026-10-10');
  for (const [from, to] of [
    ['2026-02-30','2026-03-01'], ['2026-10-10','2026-10-01'],
    ['','2026-10-01'], ['2024-01-01','2026-01-01'],
  ]) assert.throws(() => period.vietnamDateRangeBounds(from, to));
});
