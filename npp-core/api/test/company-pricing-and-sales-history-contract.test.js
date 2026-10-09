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

test('mọi đường tính giá xét phạm vi của từng bảng, không yêu cầu gán nhóm vào kênh', () => {
 for (const file of [
  '../src/db/repositories/pricing.js',
  '../src/db/repositories/sales-order-applied-price.js',
  '../src/db/repositories/sales-order-search-pricing.js',
 ]) {
  const source = read(file);
  assert.ok(!source.includes('sales_channel_customer_groups'));
  assert.ok(source.includes('channel_id = $6'));
  assert.ok(source.includes('customer_group_id IS NULL'));
 }
 assert.ok(!read('../src/services/pricing-legacy.js').includes('customerGroupIds'));
 assert.ok(!read('../src/db/repositories/sales-order-applied-price.js').includes("line.price_source = 'MANUAL_OVERRIDE'"));
});

test('migration chỉ gỡ bảng nhóm–kênh khi trống, không CASCADE', () => {
 const sql = read('../../../database/migrations/shared/164_remove_sales_channel_group_eligibility.sql');
 assert.ok(sql.includes('DROP TABLE shared.sales_channel_customer_groups'));
 assert.ok(sql.includes('EXISTS (SELECT 1 FROM shared.sales_channel_customer_groups)'));
 assert.ok(sql.includes('RAISE EXCEPTION'));
 assert.ok(!sql.includes('CASCADE'));
 assert.ok(!sql.includes('DROP TABLE shared.customers'));
 assert.ok(!sql.includes('DROP TABLE shared.price_lists'));
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
