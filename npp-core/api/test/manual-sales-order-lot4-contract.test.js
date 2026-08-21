import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(new URL('../src/services/sales-manual-completion.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/routes/manual-sales-orders.js', import.meta.url), 'utf8');
const routesIndex = readFileSync(new URL('../src/routes/customer-receivables.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../database/migrations/accounting/090_manual_sales_order_receivable.sql', import.meta.url), 'utf8');
const migrationsIndex = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
const paymentRepository = readFileSync(new URL('../src/db/repositories/customer-payment.js', import.meta.url), 'utf8');
const receivableRepository = readFileSync(new URL('../src/db/repositories/customer-receivable.js', import.meta.url), 'utf8');

test('Giao thủ công ghi nhận doanh số khi Hoàn thành đơn, độc lập với tiền thu', () => {
  assert.match(service, /export async function completeManualSalesOrder/);
  assert.match(service, /postReceivable\(client, \{ requestContext, source, contract \}\)/);
  assert.match(service, /SET status = 'closed'/);
  assert.match(service, /const deliveryStatus = contract\.deliveryMode === 'PICKUP' \? 'not_required' : 'delivered'/);
  assert.match(service, /delivery_status = \$5/);
  assert.match(service, /\['issued', 'fulfilled'\]/);
  assert.doesNotMatch(service, /postServerOwnedSalesMovement/);
  assert.doesNotMatch(service, /inventory\.inventory_balances/);
});

test('Giao tại quầy Hoàn thành giữ delivery_status đúng constraint của PICKUP', () => {
  assert.match(service, /PICKUP: Object\.freeze\(\{/);
  assert.match(service, /deliveryMode: 'PICKUP'/);
  assert.match(service, /const deliveryStatus = contract\.deliveryMode === 'PICKUP' \? 'not_required' : 'delivered'/);
  assert.match(service, /\[requestContext\.installationId, id, requestContext\.actorId, total === 0n, deliveryStatus\]/);
});

test('Nộp tiền / Nợ chỉ phân bổ vào khoản phải thu đã tạo khi Hoàn thành đơn', () => {
  assert.match(service, /sourceDocumentType: 'MANUAL_SALES_ORDER'/);
  assert.match(service, /receivableRepository\.insertReceivableDocument/);
  assert.match(service, /receivableRepository\.insertReceivableLedgerEntry/);
  assert.match(service, /loadDirectReceivable/);
  assert.match(service, /\['pending', 'partially_paid'\]/);
  assert.match(service, /decimalToScaled\(payload\?\.paidAmount, \{ allowZero: true \}\)/);
  assert.match(service, /paid > remaining/);
  assert.match(service, /customerPaymentService\.createCustomerPayment/);
  assert.match(service, /if \(paid === 0n\)/);
  assert.match(service, /customerPayment: null/);
  assert.match(service, /paymentNamespace: 'manual-sales-payment'/);
  assert.match(service, /deriveIdempotencyKey\(contract\.paymentNamespace, idempotencyKey\)/);
  assert.match(service, /IDEMPOTENCY_KEY_PATTERN/);
  assert.doesNotMatch(service, /paidAmount \?\? '0'/);
});

test('audit/outbox giữ cùng transaction và tách sự kiện doanh số khỏi tiền thu', () => {
  assert.match(service, /postingOrigin: 'manual_sales_order_delivery_complete'/);
  assert.match(service, /manual_sales_order_payment/);
  assert.match(service, /insertAuditRecord/);
  assert.match(service, /insertOutboxEvent/);
  assert.match(route, /complete\|settlement/);
  assert.match(route, /coreSalesOrderConfirm/);
  assert.match(route, /coreCustomerPaymentCreate/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(routesIndex, /handleManualSalesOrderRoutes/);
});

test('migration 090 tiếp tục dùng sổ công nợ chuẩn, không cần schema riêng cho Giao thủ công', () => {
  assert.match(migration, /MANUAL_SALES_ORDER/);
  assert.match(migration, /ALTER COLUMN delivery_order_line_id DROP NOT NULL/);
  assert.match(migration, /ALTER COLUMN inventory_issue_line_id DROP NOT NULL/);
  assert.match(migration, /delivery_order_id IS NULL/);
  assert.match(migration, /sync_manual_sales_order_settlement_status/);
  assert.match(migration, /WHEN 'partially_allocated' THEN 'partially_paid'/);
  assert.match(migration, /WHEN 'settled' THEN 'paid'/);
  assert.match(migrationsIndex, /090_manual_sales_order_receivable/);
});

test('công nợ Giao thủ công vẫn xuất hiện trong màn công nợ và phân bổ tiền', () => {
  assert.match(paymentRepository, /LEFT JOIN sales\.delivery_orders delivery_order/);
  const leftJoinCount = (receivableRepository.match(/LEFT JOIN sales\.delivery_orders delivery_order/g) ?? []).length;
  assert.ok(leftJoinCount >= 2, 'chi tiết và danh sách công nợ phải cho phép không có Delivery Order');
});