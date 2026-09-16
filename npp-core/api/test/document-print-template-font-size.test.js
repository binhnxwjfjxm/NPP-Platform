import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { documentPrintTemplateInternals } from '../src/services/document-print-templates.js';

test('print template font size migration and contract stay bounded', () => {
  const migration = CORE_API_MIGRATIONS.find((entry) => entry.id === '137_document_print_template_font_size');
  assert.ok(migration);
  assert.match(migration.sql, /font_size_percent smallint NOT NULL DEFAULT 100/);
  assert.match(migration.sql, /BETWEEN 80 AND 140/);

  const sales = documentPrintTemplateInternals.lookup('SALES_ORDER', 'standard');
  assert.ok(sales);
  assert.equal(documentPrintTemplateInternals.present(sales, null).fontSizePercent, 100);
  assert.equal(documentPrintTemplateInternals.present(sales, { font_size_percent: 125 }).fontSizePercent, 125);

  const valid = documentPrintTemplateInternals.normalizePayload(sales, {
    pageSize: 'A4',
    visibleFieldKeys: ['customer', 'line_item'],
    fontSizePercent: 115,
  });
  assert.equal(valid.fontSizePercent, 115);

  const omitted = documentPrintTemplateInternals.normalizePayload(sales, {
    pageSize: 'A4',
    visibleFieldKeys: ['customer', 'line_item'],
  });
  assert.equal(omitted.fontSizePercent, undefined);

  for (const fontSizePercent of [79, 141, 100.5, 'abc']) {
    const invalid = documentPrintTemplateInternals.normalizePayload(sales, {
      pageSize: 'A4',
      visibleFieldKeys: ['customer', 'line_item'],
      fontSizePercent,
    });
    assert.equal(invalid.code, 'INVALID_PRINT_FONT_SIZE');
  }
});
