import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/routes/fulfillment-operations.js', import.meta.url),
  'utf8',
);

test('picking permission can read only the canonical data required by the picking workflow', () => {
  assert.match(source, /const acceptedPermissions = Array\.isArray\(permission\) \? permission : \[permission\]/);
  assert.match(source, /acceptedPermissions\.some\(\(candidate\) => options\.authorize\(requestContext, candidate\)\.ok\)/);

  const pickingReadGate = /\[options\.PERMISSIONS\.coreFulfillmentRead, options\.PERMISSIONS\.coreFulfillmentPick\]/g;
  assert.equal((source.match(pickingReadGate) ?? []).length, 3);

  assert.match(source, /permission: options\.PERMISSIONS\.coreFulfillmentPick/);
  assert.match(source, /permission: options\.PERMISSIONS\.coreFulfillmentAllocate/);
  assert.match(source, /options\.PERMISSIONS\.coreFulfillmentPack/);
});
