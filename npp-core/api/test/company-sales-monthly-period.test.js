import test from 'node:test';
import assert from 'node:assert/strict';
import { listSalesOrders } from '../src/services/sales-order-legacy.js';

test('từ chối phạm vi tháng không hợp lệ trước khi truy vấn cơ sở dữ liệu', async () => {
  const client = { async query() { throw new Error('unexpected query'); } };
  const requestContext = {};
  const invalid = [
    {scope:'month',dateFrom:'bad',dateTo:'2026-10-31T17:00:00.000Z'},
    {scope:'month',dateFrom:'2026-09-30T17:00:00.000Z',dateTo:'2026-11-30T17:00:00.000Z'},
    {scope:'pending',beforeDate:'invalid'},
    {scope:'something-else'},
    {scope:'range',dateFrom:'2026-09-30T17:00:00.000Z',dateTo:'2027-11-30T17:00:00.000Z'},
    {scope:'range',dateFrom:'2026-10-31T17:00:00.000Z',dateTo:'2026-09-30T17:00:00.000Z'},
    {scope:'month',dateFrom:'2026-09-30T17:00:00.000Z',dateTo:'2026-10-31T17:00:00.000Z',cursorId:'not-a-uuid'},
  ];
  for (const filters of invalid) {
    const result = await listSalesOrders(client, {requestContext,...filters});
    assert.equal(result.ok, false);
    assert.match(result.code, /^INVALID_ORDER_/);
  }
});
