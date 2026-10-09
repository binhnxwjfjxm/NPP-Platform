import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectPricingStart, pricingStartStep } from '../src/services/pricing-start.js';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('thiếu giá nền và không có giá kênh hợp lệ dùng giá 0', () => {
 const start = selectPricingStart([]);
 assert.equal(start.source, 'ZERO_BASE');
 assert.equal(start.candidate.amount_minor, '0');
 assert.equal(pricingStartStep(start).afterUnitPriceMinor, '0');
});

test('giá riêng theo nhóm vẫn hợp lệ khi thiếu giá nền', () => {
 const start = selectPricingStart([{
  item_id: 'group', list_type: 'CUSTOMER_GROUP', adjustment_type: 'FIXED_PRICE', amount_minor: '624000',
 }]);
 assert.equal(start.source, 'SCOPED_FIXED_FALLBACK');
 assert.equal(start.candidate.amount_minor, '624000');
});

test('kênh có giá cố định vẫn được sử dụng khi nhóm khách hợp lệ và thiếu giá nền', () => {
 const start = selectPricingStart([{
  item_id: 'channel', price_list_id: 'list', price_list_code: 'CHANNEL',
  list_type: 'CHANNEL', adjustment_type: 'FIXED_PRICE', amount_minor: '610000',
 }]);
 assert.equal(start.source, 'CHANNEL_FIXED_FALLBACK');
 assert.equal(start.candidate.amount_minor, '610000');
});

test('cả ba đường kiểm tra giá đều ràng buộc kênh theo nhóm khách chính thức', () => {
 for (const file of [
  '../src/db/repositories/pricing.js',
  '../src/db/repositories/sales-order-applied-price.js',
  '../src/db/repositories/sales-order-search-pricing.js',
 ]) {
  assert.match(read(file), /shared\.sales_channel_customer_groups eligibility/);
  assert.match(read(file), /eligibility\.customer_group_id/);
 }
});

test('tìm đơn trên máy chủ dùng phân trang và cùng phạm vi quyền với số liệu tổng hợp', () => {
 const repo = read('../src/db/repositories/sales-order.js');
 assert.match(repo, /function salesOrderListQuery/);
 assert.match(repo, /stagedSalesOrderQuery\(input\)/);
 assert.match(repo, /export async function summarizeSalesOrders/);
 assert.match(repo, /appendWarehouseScope\(query,params,warehouseIds\)/);
 assert.match(repo, /appendEmployeeScope\(query,params/);
 assert.match(repo, /WHERE work_stage =/);
 assert.match(repo, /concat_ws\(' ', c\.code, c\.name\)/);
 assert.match(repo, /right\(coalesce\(so\.order_number/);
});
