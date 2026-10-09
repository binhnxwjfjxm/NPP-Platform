import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../lib/sales-order-gateway.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/sales-orders/summary/route.ts', import.meta.url), 'utf8');

test('lịch sử đơn tìm qua backend, phân trang, không giới hạn tìm kiếm trong 1000 đơn', () => {
 assert.match(workspace, /SALES_PAGE_SIZE = 50/);
 assert.match(workspace, /search\.trim\(\)/);
 assert.match(workspace, /stage: workStage/);
 assert.match(workspace, /offsetRef\.current/);
 assert.match(workspace, /Xem thêm đơn cũ/);
 assert.match(workspace, /listRequestRef\.current/);
 assert.doesNotMatch(workspace, /\/api\/sales-orders\?limit=1000/);
});

test('số đơn và các trạng thái lấy từ cùng bộ lọc máy chủ', () => {
 assert.match(workspace, /\/api\/sales-orders\/summary/);
 assert.match(gateway, /summarizeSalesOrders/);
 assert.match(route, /salesOrderErrorResponse/);
 assert.match(workspace, /summary\.total/);
});
