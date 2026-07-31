import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const legacySource = readFileSync(
  new URL('../src/services/sales-order-entry-legacy.js', import.meta.url),
  'utf8',
);
const facadeSource = readFileSync(
  new URL('../src/services/sales-order-entry.js', import.meta.url),
  'utf8',
);

test('Sales Order tax stays Core-owned when entry settings are configured', () => {
  assert.match(legacySource, /if\s*\(!settings\)\s*return\s*lines/);
  assert.match(legacySource, /const\s+defaults\s*=\s*taxSettings\(settings\)/);
  assert.match(legacySource, /taxMode:\s*defaults\.taxMode/);
  assert.match(legacySource, /taxRate:\s*defaults\.taxRate/);
  assert.doesNotMatch(legacySource, /taxMode:\s*TAX_MODES\.has\(String\(line\?\.taxMode/);
  assert.doesNotMatch(legacySource, /taxRate:\s*line\?\.taxRate/);
  assert.match(facadeSource, /legacy\.normalizeSalesOrderEntryPayload/);
});
