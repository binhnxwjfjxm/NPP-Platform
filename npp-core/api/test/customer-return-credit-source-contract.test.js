import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function apiSource(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const migration = [
  '055_customer_return_credit_refund_schema.sql',
  '055_customer_return_credit_refund_posting.sql',
  '055_customer_return_credit_refund_actions.sql',
].map((filename) => readFileSync(
  new URL(`../../../database/migrations/accounting/${filename}`, import.meta.url),
  'utf8',
)).join('\n\n');
const migrationRegistry = apiSource('src/migrations/index.js');
const permissions = apiSource('src/access/permissions.js');
const requestContext = apiSource('src/request-context.js');
const requestContextBase = apiSource('src/request-context-base.js');
const routes = apiSource('src/routes/customer-return-credits.js');
const routeOwner = apiSource('src/routes/customer-receivables.js');
const service = apiSource('src/services/customer-return-credit.js');

function blockBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('migration 055 connects existing received Customer Return to immutable receivable credit', () => {
  assert.match(migration, /AFTER UPDATE OF status ON sales\.customer_returns/);
  assert.match(migration, /OLD\.status = 'received' OR NEW\.status <> 'received'/);
  assert.match(migration, /sales\.customer_return_receipt_lines/);
  assert.match(migration, /accounting\.receivable_document_lines/);
  assert.match(migration, /inventory_issue_line_id = receipt\.issue_line_id/);
  assert.match(migration, /customer_return_exceeds_posted_receivable_quantity/);
  assert.match(migration, /CUSTOMER_RETURN_CREDIT_POST/);
  assert.match(migration, /accounting\.create_credit_allocation/);
  assert.match(migration, /'automatic', true/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS sales\.customer_returns/);
  assert.doesNotMatch(migration, /UPDATE sales\.customer_return_lines/);
});

test('refund is explicit, bounded by unapplied credit and reversible by compensation', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS accounting\.customer_refunds/);
  assert.match(migration, /refund_exceeds_available_credit/);
  assert.match(migration, /CUSTOMER_REFUND_POST/);
  assert.match(migration, /CUSTOMER_REFUND_REVERSE/);
  assert.match(migration, /customer_refund_idempotency_payload_mismatch/);
  assert.match(migration, /destination_reference text NOT NULL/);
  assert.match(migration, /reason text NOT NULL/);
  assert.doesNotMatch(migration, /auto.*refund/i);
});

test('return-credit and refund history stays append-only', () => {
  assert.match(migration, /customer_return_credit_history_is_append_only/);
  assert.match(migration, /customer_return_credit_write_requires_service_context/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON accounting\.customer_return_adjustment_lines/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON accounting\.customer_refunds/);
  assert.match(migration, /customer_return_credit_has_active_refund/);
  assert.doesNotMatch(migration, /DELETE FROM accounting\.(customer_return|customer_refund)/);
});

test('migration 055 is registered after payment allocation migration 054', () => {
  const position054 = migrationRegistry.indexOf('054_customer_payment_allocation');
  const position055 = migrationRegistry.indexOf('055_customer_return_credit_refund');
  assert.ok(position054 >= 0);
  assert.ok(position055 > position054);
  assert.match(migrationRegistry, /055_customer_return_credit_refund_schema\.sql/);
  assert.match(migrationRegistry, /055_customer_return_credit_refund_posting\.sql/);
  assert.match(migrationRegistry, /055_customer_return_credit_refund_actions\.sql/);
});

test('API exposes read allocate refund and compensating reversal only', () => {
  assert.match(routeOwner, /handleCustomerReturnCreditRoutes/);
  assert.match(routes, /pathname === '\/api\/customer-return-credits'/);
  assert.match(routes, /service\.allocateCustomerReturnCredit/);
  assert.match(routes, /service\.createCustomerRefund/);
  assert.match(routes, /service\.reverseCustomerRefund/);
  assert.match(routes, /service\.reverseCustomerReturnCredit/);
  assert.match(routes, /executeRequestWithIdempotency/);
  assert.match(routes, /withAuditOutboxTransaction/);
  assert.doesNotMatch(routes, /\bCOD\b|MCP|write[-_ ]?off/i);
});

test('permissions remain deny-by-default and are not granted to MCP principals', () => {
  for (const permission of [
    'coreCustomerReturnCreditRead',
    'coreCustomerReturnCreditAllocate',
    'coreCustomerReturnCreditReverse',
    'coreCustomerRefundCreate',
    'coreCustomerRefundReverse',
  ]) {
    assert.match(permissions, new RegExp(`${permission}: 'core\\.`));
    assert.match(requestContext, new RegExp(`PERMISSIONS\\.${permission}`));
  }
  const mcpOnboarding = blockBetween(
    requestContextBase,
    'export function createMcpOnboardingPrincipal',
    'export function createMcpSalesPrincipal',
  );
  const mcpSales = blockBetween(
    requestContextBase,
    'export function createMcpSalesPrincipal',
    'export function createDeliveryFrontendPrincipal',
  );
  for (const principal of [mcpOnboarding, mcpSales]) {
    assert.doesNotMatch(principal, /coreCustomerReturnCredit|coreCustomerRefund/);
  }
  assert.match(service, /warehouseScopeIds\(requestContext\)/);
});
