import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERMISSIONS, PERMISSION_REGISTRY } from '../src/access/permissions.js';
import { agingReport } from '../src/routes/reporting-finance.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('8.3 registers dedicated aging and gross-margin permissions', () => {
  assert.equal(PERMISSIONS.coreReportingAgingRead, 'core.reporting.aging.read');
  assert.equal(PERMISSIONS.coreReportingGrossMarginRead, 'core.reporting.gross-margin.read');
  assert.equal(PERMISSION_REGISTRY.has(PERMISSIONS.coreReportingAgingRead), true);
  assert.equal(PERMISSION_REGISTRY.has(PERMISSIONS.coreReportingGrossMarginRead), true);
});

test('8.3 current Core bootstrap compatibility includes the new reporting permissions', () => {
  const context = source('../src/request-context.js');
  assert.match(context, /PERMISSIONS\.coreReportingAgingRead/);
  assert.match(context, /PERMISSIONS\.coreReportingGrossMarginRead/);
});

test('8.3 reporting routes authenticate before aging validation and stay warehouse scoped', () => {
  const route = source('../src/routes/reporting-sales-purchasing.js');
  assert.match(route, /\/api\/reporting\/aging/);
  assert.match(route, /\/api\/reporting\/gross-margin/);
  assert.match(route, /coreReportingAgingRead/);
  assert.match(route, /coreReportingGrossMarginRead/);
  assert.match(route, /AGING_HISTORICAL_FILTER_UNSUPPORTED/);
  assert.match(route, /validateScope/);
  const handler = route.slice(route.indexOf('export async function handleReportingRoutes'));
  assert.ok(handler.indexOf('authenticateAndAuthorize') >= 0);
  assert.ok(handler.indexOf('AGING_HISTORICAL_FILTER_UNSUPPORTED') >= 0);
  assert.ok(handler.indexOf('authenticateAndAuthorize') < handler.indexOf('AGING_HISTORICAL_FILTER_UNSUPPORTED'));
});

test('8.3 AR age does not invent due date while AP uses canonical due_date', () => {
  const finance = source('../src/routes/reporting-finance.js');
  assert.match(finance, /accounting\.receivable_documents/);
  assert.match(finance, /source_document_date/);
  assert.match(finance, /AR has no canonical due_date/);
  assert.match(finance, /accounting\.payable_documents/);
  assert.match(finance, /document\.due_date/);
  assert.match(finance, /OVERDUE_91_PLUS/);
  assert.match(finance, /currency_code/);
  assert.doesNotMatch(finance, /customer_account_entries|supplier_payable_entries/);
});

test('8.3 aging warehouse options come from full authorized warehouse scope', () => {
  const finance = source('../src/routes/reporting-finance.js');
  assert.match(finance, /FROM shared\.warehouses warehouse/);
  assert.match(finance, /warehouse\.id = ANY\(\$2::uuid\[\]\)/);
  assert.match(finance, /scopeWarehouses: mapRows\(scopeWarehouses\.rows\)/);
});

test('10.1 aging warehouse scope query binds only the placeholders it declares', async () => {
  const calls = [];
  const adapter = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const warehouseIds = ['11111111-1111-4111-8111-111111111111'];
  await agingReport(
    adapter,
    {
      installationId: 'installation-1',
      receivedAt: '2026-08-10T00:00:00.000Z',
    },
    { warehouseId: null },
    warehouseIds,
  );
  assert.equal(calls.length, 7);
  assert.deepEqual(calls[0].params, ['installation-1', warehouseIds]);
  for (const call of calls.slice(1)) assert.equal(call.params.length, 4);
});

test('8.3 gross margin uses recognized net revenue and exact Phase 7 movement-line cost lineage', () => {
  const finance = source('../src/routes/reporting-finance.js');
  assert.match(finance, /line\.gross_amount - line\.discount_amount/);
  assert.match(finance, /delivery_order_inventory_issue_lines/);
  assert.match(finance, /inventory\.inventory_cost_facts/);
  assert.match(finance, /inventory_movement_line_id/);
  assert.match(finance, /-cost\.value_delta/);
  assert.match(finance, /CUSTOMER_RETURN_CREDIT/);
  assert.match(finance, /customer_return_receipt_lines/);
  assert.match(finance, /NON_VND_REVENUE/);
  assert.match(finance, /MISSING_COST_FACT/);
  assert.doesNotMatch(finance, /parseFloat\(|parseInt\(|Number\(/);
});

test('8.3 canonical accounting schema prevents zero return divisor and null currency facts', () => {
  const receivable = source('../../../database/migrations/accounting/053_customer_receivable_ledger.sql');
  const returnSchema = source('../../../database/migrations/accounting/055_customer_return_credit_refund_schema.sql');
  assert.match(receivable, /accepted_base_quantity numeric\(30,12\) NOT NULL CHECK \(accepted_base_quantity > 0\)/);
  assert.match(receivable, /currency_code text NOT NULL/);
  assert.match(returnSchema, /currency_code text NOT NULL/);
});

test('8.3 permission migration is metadata-only and ordered after 065', () => {
  const migration = source('../../../database/migrations/shared/066_reporting_aging_gross_margin_permission_catalog.sql');
  const manifest = source('../src/migrations/index.js');
  assert.match(migration, /core\.reporting\.aging\.read/);
  assert.match(migration, /core\.reporting\.gross-margin\.read/);
  assert.doesNotMatch(migration, /role_permission|INSERT INTO shared\.role/);
  assert.ok(manifest.indexOf('065_reporting_inventory_permission_catalog') < manifest.indexOf('066_reporting_aging_gross_margin_permission_catalog'));
});
