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
const hardening = readFileSync(
  new URL('../../../database/migrations/accounting/054_customer_payment_allocation_hardening.sql', import.meta.url),
  'utf8',
);
const officeFlowMigration = readFileSync(
  new URL('../../../database/migrations/accounting/097_customer_payment_remitting_employee.sql', import.meta.url),
  'utf8',
);
const migrationRegistry = apiSource('src/migrations/index.js');
const permissions = apiSource('src/access/permissions.js');
const requestContext = apiSource('src/request-context.js');
const requestContextBase = apiSource('src/request-context-base.js');
const routes = apiSource('src/routes/customer-payments.js');
const service = apiSource('src/services/customer-payment.js');
const repository = apiSource('src/db/repositories/customer-payment.js');

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

test('customer payment series follows the customer installation lifecycle', () => {
  assert.match(migration, /ensure_customer_payment_series_for_installation/);
  assert.match(migration, /AFTER INSERT ON shared\.customers/);
  assert.match(migration, /customers_ensure_customer_payment_series/);
  assert.match(migration, /ON CONFLICT \(installation_id, code\) DO NOTHING/);
});

test('migration 054 hardening preserves active projections and deterministic append-only rejection', () => {
  assert.match(hardening, /status = 'reversed'/);
  assert.match(hardening, /allocated_amount = 0/);
  assert.match(hardening, /remaining_amount = 0/);
  assert.match(hardening, /status <> 'reversed'/);
  assert.match(hardening, /remaining_amount = original_amount - allocated_amount/);
  assert.ok(
    hardening.indexOf("IF TG_OP <> 'INSERT'")
      < hardening.indexOf("write_context IS DISTINCT FROM 'receivable_service'"),
  );
});

test('migration 054 is registered after receivable ledger migration 053', () => {
  const position053 = migrationRegistry.indexOf('053_customer_receivable_ledger');
  const position054 = migrationRegistry.indexOf('054_customer_payment_allocation');
  assert.ok(position053 >= 0);
  assert.ok(position054 > position053);
  assert.match(migrationRegistry, /054_customer_payment_allocation\.sql/);
  assert.match(migrationRegistry, /054_customer_payment_allocation_hardening\.sql/);
});

test('migration 097 stores the optional remitting employee as an immutable payment snapshot', () => {
  const position096 = migrationRegistry.indexOf('096_sales_order_unwind_locked_trip');
  const position097 = migrationRegistry.indexOf('097_customer_payment_remitting_employee');
  assert.ok(position096 >= 0);
  assert.ok(position097 > position096);
  assert.match(officeFlowMigration, /remitting_employee_id uuid NULL/);
  assert.match(officeFlowMigration, /FOREIGN KEY \(installation_id, remitting_employee_id\)/);
  assert.match(officeFlowMigration, /document_type = 'CUSTOMER_PAYMENT'/);
  assert.match(officeFlowMigration, /remitting_employee_code_snapshot IS NOT NULL/);
  assert.match(officeFlowMigration, /remitting_employee_name_snapshot IS NOT NULL/);
  assert.match(officeFlowMigration, /NEW\.remitting_employee_id IS DISTINCT FROM OLD\.remitting_employee_id/);
  assert.match(officeFlowMigration, /VALIDATE CONSTRAINT receivable_documents_remitting_employee_fk/);
});

test('customer payment API exposes create read allocate and compensating reversal only', () => {
  assert.match(routes, /pathname === '\/api\/customer-payments'/);
  assert.match(routes, /const allocationCreate = pathname\.match/);
  assert.match(routes, /service\.allocateCustomerPayment/);
  assert.match(routes, /const paymentReverse = pathname\.match/);
  assert.match(routes, /service\.reverseCustomerPayment/);
  assert.match(routes, /const allocationReverse = pathname\.match/);
  assert.match(routes, /service\.reverseReceivableAllocation/);
  assert.match(routes, /executeRequestWithIdempotency/);
  assert.match(routes, /withAuditOutboxTransaction/);
  assert.match(routes, /pathname === '\/api\/customer-payments\/remitting-employees'/);
  assert.match(routes, /service\.listRemittingEmployees/);
  assert.doesNotMatch(routes, /paid\s*=\s*true/i);
  assert.doesNotMatch(routes, /refund|write[-_ ]?off|\bcod\b/i);
});

test('payment history reads current receivable debt and keeps the remitting employee separate', () => {
  assert.match(repository, /getActiveRemittingEmployee/);
  assert.match(repository, /remitting_employee_code_snapshot/);
  assert.match(repository, /sum\(link\.remaining_amount\)/);
  assert.match(repository, /related_remaining_amount/);
  assert.match(service, /remittingEmployeeId: row\.remitting_employee_id/);
  assert.match(service, /relatedRemainingAmount: String\(row\.related_remaining_amount/);
  assert.match(service, /REMITTING_EMPLOYEE_NOT_FOUND/);
});

test('payment service permits cross-warehouse allocation only through authorized scopes', () => {
  assert.match(service, /warehouseIds: scopes/);
  assert.match(service, /target\.customer_id !== sourcePayment\.customer_id/);
  assert.match(service, /target\.currency_code !== sourcePayment\.currency_code/);
  assert.match(service, /items\.sort\(\(left, right\) => left\.targetDocumentId\.localeCompare/);
  assert.doesNotMatch(service, /target\.warehouse_id !== sourcePayment\.warehouse_id/);
  assert.match(repository, /source\.warehouse_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(repository, /target\.warehouse_id = ANY\(\$3::uuid\[\]\)/);
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
