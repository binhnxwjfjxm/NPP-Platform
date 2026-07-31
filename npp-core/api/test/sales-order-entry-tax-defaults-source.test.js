import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/services/sales-order-entry.js', import.meta.url),
  'utf8',
);

test('Sales Order tax preserves valid explicit values and defaults only missing fields', () => {
  assert.doesNotMatch(source, /if\s*\(!settings\)\s*return\s*lines/);
  assert.match(source, /const\s+defaults\s*=\s*taxSettings\(settings\)/);
  assert.match(
    source,
    /taxMode:\s*TAX_MODES\.has\(String\(line\?\.taxMode[\s\S]*?\?\s*String\(line\.taxMode\)[\s\S]*?:\s*defaults\.taxMode/,
  );
  assert.match(
    source,
    /taxRate:\s*line\?\.taxRate\s*===\s*null[\s\S]*?\?\s*defaults\.taxRate[\s\S]*?:\s*String\(line\.taxRate\)/,
  );
});
