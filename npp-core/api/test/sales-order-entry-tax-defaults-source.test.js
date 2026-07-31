import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/services/sales-order-entry.js', import.meta.url),
  'utf8',
);

test('Sales Order tax stays Core-owned when entry settings are configured', () => {
  assert.match(source, /if\s*\(!settings\)\s*return\s*lines/);
  assert.match(
    source,
    /taxMode:\s*defaults\.taxMode/,
  );
  assert.match(
    source,
    /taxRate:\s*defaults\.taxRate/,
  );
  assert.doesNotMatch(
    source,
    /taxMode:\s*TAX_MODES\.has\(String\(line\?\.taxMode/,
  );
  assert.doesNotMatch(
    source,
    /taxRate:\s*line\?\.taxRate/,
  );
});
