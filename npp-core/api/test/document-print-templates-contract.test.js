import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { PERMISSION_REGISTRY, PERMISSIONS } from '../src/access/permissions.js';
import { DOCUMENT_PRINT_TEMPLATE_CATALOG, documentPrintTemplateInternals } from '../src/services/document-print-templates.js';

const route = readFileSync(new URL('../src/routes/document-print-templates.js', import.meta.url), 'utf8');

test('print template migration is registered once with installation scope and canonical permissions', () => {
  const migration = CORE_API_MIGRATIONS.find((entry) => entry.id === '098_document_print_template_settings');
  assert.ok(migration);
  assert.match(migration.sql, /shared\.document_print_template_settings/);
  assert.match(migration.sql, /UNIQUE \(installation_id, document_type, template_code\)/);
  assert.match(migration.sql, /core\.print-template\.read/);
  assert.match(migration.sql, /core\.print-template\.manage/);
  assert.doesNotMatch(migration.sql, /shared\.role_permissions/);
  assert.ok(PERMISSION_REGISTRY.has(PERMISSIONS.corePrintTemplateRead));
  assert.ok(PERMISSION_REGISTRY.has(PERMISSIONS.corePrintTemplateManage));
});

test('print template catalog owns the defaults for sales, purchasing and operational forms', () => {
  const keys = DOCUMENT_PRINT_TEMPLATE_CATALOG.map((item) => `${item.documentType}:${item.templateCode}`);
  for (const expected of ['SALES_ORDER:standard', 'PURCHASE_ORDER:standard', 'GOODS_RECEIPT:standard', 'CUSTOMER_PAYMENT:standard', 'DELIVERY_ORDER:standard', 'DELIVERY_ORDER:packing-list', 'INVENTORY_TRANSFER:standard', 'STOCKTAKE:standard']) {
    assert.ok(keys.includes(expected), expected);
  }
  const sales = documentPrintTemplateInternals.lookup('sales_order', 'standard');
  assert.ok(sales);
  const valid = documentPrintTemplateInternals.normalizePayload(sales, { pageSize: 'A4', visibleFieldKeys: ['customer', 'line_item', 'total_total'] });
  assert.deepEqual(valid.visibleFieldKeys, ['customer', 'line_item', 'total_total']);
  assert.equal(documentPrintTemplateInternals.normalizePayload(sales, { pageSize: 'A3', visibleFieldKeys: ['customer'] }).code, 'INVALID_PAGE_SIZE');
  assert.equal(documentPrintTemplateInternals.normalizePayload(sales, { pageSize: 'A4', visibleFieldKeys: ['customer', 'not_allowed'] }).code, 'INVALID_PRINT_FIELDS');
  assert.equal(documentPrintTemplateInternals.normalizePayload(sales, { resetToDefault: true, expectedUpdatedAt: 'not-a-date' }).code, 'INVALID_TEMPLATE_VERSION');
});

test('print template writes are authorized, idempotent and audited at the Core boundary', () => {
  assert.match(route, /corePrintTemplateRead/);
  assert.match(route, /corePrintTemplateManage/);
  assert.match(route, /Cần có mã nhận diện yêu cầu \(Idempotency-Key\)/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /resourceType: 'document_print_template'/);
  assert.doesNotMatch(route, /DATABASE_URL|SUPABASE|R2_SECRET/);
});
