import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { PERMISSION_REGISTRY, PERMISSIONS } from '../src/access/permissions.js';
import { DOCUMENT_PRINT_TEMPLATE_CATALOG, documentPrintTemplateInternals } from '../src/services/document-print-templates.js';
import { handleDocumentPrintTemplateRoutes } from '../src/routes/document-print-templates.js';

const route = readFileSync(new URL('../src/routes/document-print-templates.js', import.meta.url), 'utf8');

function responseRecorder() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(statusCode, headers) { this.statusCode = statusCode; Object.assign(this.headers, headers); },
    end(body = '') { this.body = body; },
  };
}

test('print template migrations keep installation scope and add configurable headings', () => {
  const migration = CORE_API_MIGRATIONS.find((entry) => entry.id === '098_document_print_template_settings');
  assert.ok(migration);
  assert.match(migration.sql, /shared\.document_print_template_settings/);
  assert.match(migration.sql, /UNIQUE \(installation_id, document_type, template_code\)/);
  assert.match(migration.sql, /core\.print-template\.read/);
  assert.match(migration.sql, /core\.print-template\.manage/);
  assert.doesNotMatch(migration.sql, /shared\.role_permissions/);
  const headingMigration = CORE_API_MIGRATIONS.find((entry) => entry.id === '102_document_print_template_heading');
  assert.ok(headingMigration);
  assert.match(headingMigration.sql, /ADD COLUMN IF NOT EXISTS heading/);
  assert.match(headingMigration.sql, /ADD COLUMN IF NOT EXISTS title/);
  assert.match(headingMigration.sql, /ADD COLUMN IF NOT EXISTS subtitle/);
  assert.ok(PERMISSION_REGISTRY.has(PERMISSIONS.corePrintTemplateRead));
  assert.ok(PERMISSION_REGISTRY.has(PERMISSIONS.corePrintTemplateManage));
});

test('print template catalog keeps Sales Order core columns and separates optional SKU', () => {
  const keys = DOCUMENT_PRINT_TEMPLATE_CATALOG.map((item) => `${item.documentType}:${item.templateCode}`);
  for (const expected of ['SALES_ORDER:standard', 'PURCHASE_ORDER:standard', 'GOODS_RECEIPT:standard', 'CUSTOMER_PAYMENT:standard', 'DELIVERY_ORDER:standard', 'DELIVERY_ORDER:packing-list', 'INVENTORY_TRANSFER:standard', 'STOCKTAKE:standard']) assert.ok(keys.includes(expected), expected);
  const sales = documentPrintTemplateInternals.lookup('sales_order', 'standard');
  assert.ok(sales);
  assert.equal(sales.fields.find((field) => field.key === 'line_item')?.label, 'Tên sản phẩm');
  assert.equal(sales.fields.find((field) => field.key === 'line_item')?.required, true);
  assert.equal(sales.fields.find((field) => field.key === 'line_sku')?.defaultSelected, false);
  assert.equal(sales.fields.find((field) => field.key === 'line_sku')?.required, false);
  assert.equal(sales.fields.find((field) => field.key === 'line_quantity')?.required, true);
  assert.equal(sales.fields.find((field) => field.key === 'line_unit')?.required, true);
  assert.equal(sales.fields.find((field) => field.key === 'line_unit_price')?.required, true);
  assert.equal(sales.fields.find((field) => field.key === 'line_total')?.required, true);

  const valid = documentPrintTemplateInternals.normalizePayload(sales, { pageSize: 'A4', visibleFieldKeys: ['customer', 'line_sku', 'total_total'], heading: 'NGUYÊN LIỆU TRÀ SỮA', title: 'PHIẾU XUẤT KHO', subtitle: 'Bán tại quầy' });
  assert.deepEqual(valid.visibleFieldKeys, ['customer', 'line_item', 'line_sku', 'line_quantity', 'line_unit', 'line_unit_price', 'line_total', 'total_total']);
  assert.equal(valid.heading, 'NGUYÊN LIỆU TRÀ SỮA');
  assert.equal(valid.title, 'PHIẾU XUẤT KHO');
  assert.equal(valid.subtitle, 'Bán tại quầy');

  const presented = documentPrintTemplateInternals.present(sales, { visible_field_keys: ['customer', 'line_sku'], page_size: 'A4' });
  assert.deepEqual(presented.visibleFieldKeys, ['customer', 'line_item', 'line_sku', 'line_quantity', 'line_unit', 'line_unit_price', 'line_total']);
  assert.equal(documentPrintTemplateInternals.normalizePayload(sales, { pageSize: 'A3', visibleFieldKeys: ['customer'] }).code, 'INVALID_PAGE_SIZE');
  assert.equal(documentPrintTemplateInternals.normalizePayload(sales, { pageSize: 'A4', visibleFieldKeys: ['customer', 'not_allowed'] }).code, 'INVALID_PRINT_FIELDS');
  assert.equal(documentPrintTemplateInternals.normalizePayload(sales, { pageSize: 'A4', visibleFieldKeys: ['customer'], heading: 'x'.repeat(161) }).code, 'INVALID_PRINT_HEADING');
  assert.equal(documentPrintTemplateInternals.normalizePayload(sales, { resetToDefault: true, expectedUpdatedAt: 'not-a-date' }).code, 'INVALID_TEMPLATE_VERSION');
});

test('printing reads template configuration without a second print permission while configuration stays controlled', () => {
  assert.doesNotMatch(route, /corePrintTemplateRead/);
  assert.match(route, /corePrintTemplateManage/);
  assert.match(route, /authenticatePrintTemplateRequest/);
  assert.match(route, /const requestContext = authenticatePrintTemplateRequest/);
  assert.match(route, /installationId: requestContext\.installationId/);
  assert.match(route, /requestContext,\n      requestId/);
  assert.match(route, /system:security-owner/);
  assert.match(route, /system:implementation-owner/);
  assert.match(route, /Cần có mã nhận diện yêu cầu \(Idempotency-Key\)/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /resourceType: 'document_print_template'/);
  assert.doesNotMatch(route, /DATABASE_URL|SUPABASE|R2_SECRET/);
});

test('print template read creates authenticated installation context before accessing storage', async () => {
  const req = { url: '/api/document-print-templates', method: 'GET', headers: {} };
  const res = responseRecorder();
  let queriedInstallationId = null;
  const handled = await handleDocumentPrintTemplateRoutes(req, res, {
    config: {}, requestId: 'print-template-read', receivedAt: '2026-08-20T00:00:00.000Z',
    authenticate: () => ({ ok: true, principal: { subject: 'owner' } }),
    createContext: () => ({ installationId: 'installation-a', actorId: 'owner', roles: [] }),
    authorize: () => ({ ok: false, code: 'FORBIDDEN', message: 'Không có quyền', statusCode: 403 }),
    PERMISSIONS,
    getPool: () => ({ query: async (_sql, values) => { queriedInstallationId = values?.[0] ?? null; return { rows: [] }; } }),
  });
  assert.equal(handled, true);
  assert.equal(queriedInstallationId, 'installation-a');
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.data.length, DOCUMENT_PRINT_TEMPLATE_CATALOG.length);
});
