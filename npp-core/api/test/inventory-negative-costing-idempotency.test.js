import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const projector = readFileSync(
  new URL('../src/services/inventory-costing-period-projector.js', import.meta.url),
  'utf8',
);
const lifecycle = readFileSync(
  new URL('../src/services/inventory-costing-period-lifecycle.js', import.meta.url),
  'utf8',
);

test('negative costing projector uses the shared canonical idempotency contract', () => {
  assert.match(projector, /IDEMPOTENCY_KEY_PATTERN\s+from\s+'@npp\/contracts'/);
  assert.doesNotMatch(projector, /\^\[A-Za-z0-9\._:-\]/);
  assert.match(lifecycle, /deriveIdempotencyKey/);
  assert.doesNotMatch(lifecycle, /period-snapshot:/);
});
