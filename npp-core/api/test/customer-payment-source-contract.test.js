import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function apiSource(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const migration = readFileSync(
  new URL('../../../database/migrations/accounting/054_customer_payment_allocation.sql', import.meta.url),
  'utf8',
);
const migrationRegistry = apiSource('src/migrations/index.js');
const permissions = apiSource('src/access/permissions.js');
const requestContext = apiSource('src/request-context.js');
const requestContextBase = apiSource('src/request-context-base.js');
const routes = apiSource('src/routes/customer-payments.js');
const service = apiSource('src/services/customer-payment.js');

function blockBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('migration 054 keeps payment and allocation as immutable accounting facts', () => {
  assert.match(migration, /document_type IN \('SALE_DELIVERY', 'SALE_PICKUP', 'CUSTOMER_PAYMENT'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS accounting\.receivable_allocations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS accounting\.receivable_allocation_reversals/);
  assert.match(migration, /receivable_allocation_history_is_append_only/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION accounting\.create_receivable_allocation/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION accounting\.reverse_receivable_allocation/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION accounting\.reverse_customer_payment/);
  assert.match(migration, /allocation_customer_mismatch/);
  assert.match(migration, /allocation_currency_mismatch/);
  assert.match(migration, /allocation_exceeds_source_remaining/);
  assert.match(migration, /allocation_exceeds_target_remaining/);
  assert.doesNotMatch(migration, /UPDATE accounting\.receivable_allocations/);
  assert.doesNotMatch(migration, /DELETE FROM accounting\.receivable_(allocations|allocation_reversals)/);
});

test('migration 054 is registered after receivable ledger migration 053', () => {
  const position053 = migrationRegistry.indexOf('053_customer_receivable_ledger');
  const position054 = migrationRegistry.indexOf('054_customer_payment_allocation');
  assert.ok(position053 >= 0);
  assert.ok(position054 > position053);
  assert.match(migrationRegistry, /054_customer_payment_allocation\.sql/);
});

test('customer payment API exposes create read allocate and compensating reversal only', () => {
  assert.match(routes, /pathname === '\/api\/customer-payments'/);
  assert.match(routes, /\/api\/customer-payments\/\(\[\^\/\]\+\)\/allocations/);
  assert.match(routes, /\/api\/customer-payments\/\(\[\^\/\]\+\)\/reverse/);
  assert.match(routes, /\/api\/receivable-allocations\/\(\[\^\/\]\+\)\/reverse/);
  assert.match(routes, /executeRequestWithIdempotency/);
  assert.match(routes, /withAuditOutboxTransaction/);
  assert.doesNotMatch(routes, /paid\s*=\s*true/i);
  assert.doesNotMatch(routes, /refund|write[-_ ]?off|cod/i);
});

test('payment service permits cross-warehouse allocation only through authorized scopes', () => {
  assert.match(service, /warehouseIds: scopes/);
  assert.match(service, /target\.customer_id !== sourcePayment\.customer_id/);
  assert.match(service, /target\.currency_code !== sourcePayment\.currency_code/);
  assert.match(service, /items\.sort\(\(left, right\) => left\.targetDocumentId\.localeCompare/);
  assert.doesNotMatch(service, /target\.warehouse_id !== sourcePayment\.warehouse_id/);
});

test('payment permissions are deny-by-default and never granted to MCP principals', () => {
  assert.match(permissions, /coreCustomerPaymentRead: 'core\.customer-payment\.read'/);
  assert.match(permissions, /coreCustomerPaymentCreate: 'core\.customer-payment\.create'/);
  assert.match(permissions, /coreCustomerPaymentReverse: 'core\.customer-payment\.reverse'/);
  assert.match(permissions, /coreReceivableAllocationCreate: 'core\.receivable-allocation\.create'/);
  assert.match(permissions, /coreReceivableAllocationReverse: 'core\.receivable-allocation\.reverse'/);

  const bootstrap = blockBetween(
    requestContext,
    'const LOGISTICS_BOOTSTRAP_PERMISSIONS',
    'function withLogisticsBootstrapPermissions',
  );
  assert.match(bootstrap, /coreCustomerPaymentCreate/);
  assert.match(bootstrap, /coreReceivableAllocationCreate/);

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
  for (const principalSource of [mcpOnboarding, mcpSales]) {
    assert.doesNotMatch(principalSource, /coreCustomerPayment|coreReceivableAllocation/);
  }
});
