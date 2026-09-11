import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const page = source('app/customers/[id]/page.tsx');
const view = source('app/customers/[id]/customer-detail-view.tsx');
const sections = source('app/customers/[id]/customer-history-sections.tsx');

test('hồ sơ khách khóa Đơn hàng, Công nợ và Phiếu thu theo đúng customerId', () => {
  assert.match(page, /listSalesOrders<CustomerOrderListItem>[\s\S]*customerId: id/);
  assert.match(page, /listReceivables<ReceivableDocument>[\s\S]*customerId: id/);
  assert.match(page, /listCustomerPayments<CustomerPayment>[\s\S]*customerId: id/);
});

test('các tab lịch sử chỉ tải theo trang nhỏ, không kéo toàn bộ dữ liệu về trình duyệt', () => {
  assert.match(page, /const pageSize = 25;[\s\S]*limit: pageSize \+ 1/);
  assert.match(page, /const pageSize = 20;[\s\S]*limit: pageSize \+ 1/);
  assert.doesNotMatch(page, /limit:\s*1000/);
});

test('quyền công nợ và quyền Phiếu thu được xử lý độc lập', () => {
  assert.match(page, /if \(profile\.permissions\.receivable\)/);
  assert.match(page, /error instanceof CustomerPaymentGatewayError && error\.statusCode === 403/);
  assert.match(sections, /Bạn không có quyền xem công nợ/);
  assert.match(sections, /Bạn không có quyền xem lịch sử thu tiền/);
});

test('hồ sơ có tab Đơn hàng và Công nợ & thanh toán với link về chứng từ gốc', () => {
  assert.match(view, />Đơn hàng<\/Link>/);
  assert.match(view, />Công nợ &amp; thanh toán<\/Link>/);
  assert.match(sections, /\/sales\/sales-orders\?search=/);
  assert.match(sections, /\/accounting\/receivables\?id=/);
  assert.match(sections, /\/accounting\/customer-payments/);
});
