import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../app/sales/sales-orders/SalesOrderDetail.tsx', import.meta.url), 'utf8');
const form = readFileSync(new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../lib/sales-order-gateway.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/sales/sales-orders/page.tsx', import.meta.url), 'utf8');

function absent(source, pattern, label) {
  assert.equal(pattern.test(source), false, label);
}

test('Sales Order UI exposes separate lifecycle projections and immutable amendment flow', () => {
  assert.match(detail, /Đơn hàng/);
  assert.match(detail, /Chuẩn bị hàng/);
  assert.match(detail, /Giao hàng/);
  assert.match(detail, /Thanh toán/);
  assert.match(detail, /Tạo bản điều chỉnh/);
  assert.match(detail, /Xác nhận điều chỉnh/);
  assert.match(detail, /Lịch sử phiên bản/);
  assert.match(workspace, /phiên bản đang hiệu lực chưa bị thay đổi/);
});

test('Sales Order create/edit form relies on Core pricing and canonical master-data routes', () => {
  assert.match(form, /Giá do Core tự phân giải khi lưu/);
  assert.match(form, /\/api\/customers\/\$\{customerId\}\/addresses/);
  assert.match(form, /\/api\/products\/\$\{nextProductId\}\/variants/);
  assert.match(form, /COLLECT_AFTER_DELIVERY/);
  assert.match(form, /CREDIT_TERMS/);
  absent(form, /NEXT_PUBLIC_CORE_API_URL/, 'client form must not know the Core backend URL');
  absent(form, /CORE_API_SERVER_TOKEN/, 'client form must not contain the server token');
});

test('Sales Order browser routes stay same-origin and secrets remain server-only', () => {
  assert.match(page, /SalesOrderWorkspace/);
  assert.match(workspace, /\/api\/sales-orders/);
  assert.match(gateway, /import 'server-only'/);
  assert.match(gateway, /CORE_API_INTERNAL_URL/);
  assert.match(gateway, /CORE_API_SERVER_TOKEN/);
  absent(workspace, /CORE_API_INTERNAL_URL/, 'workspace must not contain backend URL');
  absent(workspace, /CORE_API_SERVER_TOKEN/, 'workspace must not contain backend token');
  absent(gateway, /NEXT_PUBLIC_CORE_API_URL/, 'gateway must not depend on a public backend URL');
});
