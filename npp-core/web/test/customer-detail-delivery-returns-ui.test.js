import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const page = source('app/customers/[id]/page.tsx');
const view = source('app/customers/[id]/customer-detail-view.tsx');
const section = source('app/customers/[id]/customer-delivery-returns-section.tsx');
const gateway = source('lib/customer-delivery-returns-gateway.ts');

test('Lô 4 chỉ tải khi mở tab và khóa endpoint theo đúng customerId', () => {
  assert.match(page, /if \(activeTab === 'delivery-returns'\)/);
  assert.match(page, /getCustomerDeliveryReturns\([\s\S]*id,[\s\S]*deliveryLimit: 20/);
  assert.match(gateway, /\/api\/customers\/\$\{id\}\/delivery-returns/);
  assert.doesNotMatch(page, /deliveryLimit:\s*1000/);
  assert.doesNotMatch(page, /returnLimit:\s*1000/);
});

test('Lô 4 giữ phân trang giao hàng và trả hàng độc lập', () => {
  assert.match(page, /deliveryOffset = normalizeOffset\(query\.deliveryOffset\)/);
  assert.match(page, /returnOffset = normalizeOffset\(query\.returnOffset\)/);
  assert.match(section, /query\.set\('deliveryOffset'/);
  assert.match(section, /query\.set\('returnOffset'/);
  assert.match(section, /Phân trang lịch sử giao hàng/);
  assert.match(section, /Phân trang hàng khách trả/);
});

test('UI có tab Giao hàng Trả hàng và không lộ mã kỹ thuật làm trạng thái chính', () => {
  assert.match(view, />Giao hàng \/ Trả hàng<\/Link>/);
  assert.match(section, /Giao một phần/);
  assert.match(section, /Giao chưa thành công/);
  assert.match(section, /Hẹn lại/);
  assert.match(section, /Đã nhận hàng trả/);
  assert.match(section, /Không có quyền xem/);
});

test('Lô 4 mở lại màn nghiệp vụ hiện hữu thay vì nhân bản màn chứng từ', () => {
  assert.match(section, /\/inventory\/delivery-orders/);
  assert.match(section, /\/inventory\/customer-returns/);
  assert.match(section, /\/sales\/sales-orders\?search=/);
});
