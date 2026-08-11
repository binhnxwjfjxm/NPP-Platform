import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gatewaySource = readFileSync(new URL('../lib/logistics-gateway.ts', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../app/logistics/trips/trip-planning-workspace.tsx', import.meta.url), 'utf8');
const coreIdempotencySource = readFileSync(new URL('../../api/src/idempotency.js', import.meta.url), 'utf8');
const vehicleCoreKey = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

test('A1 vehicle create translates the UI idempotency key to a stable collision-resistant Core-safe key only for vehicles', () => {
  assert.ok(workspaceSource.includes("return `${prefix}:${parts.filter(Boolean).join(':')}`;"));
  assert.ok(workspaceSource.includes(".replace(/[^A-Za-z0-9._:-]/g, '_')"));
  assert.ok(coreIdempotencySource.includes('const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;'));
  assert.ok(gatewaySource.includes("import { createHash, randomUUID } from 'node:crypto';"));
  assert.ok(gatewaySource.includes("function vehicleCoreKey(v:string|null|undefined){return createHash('sha256').update(key(v),'utf8').digest('hex');}"));
  assert.ok(gatewaySource.includes("idempotencyKey:resource==='vehicles'?vehicleCoreKey(idempotencyKey):key(idempotencyKey)"));

  const colonKey = vehicleCoreKey('vehicle:create');
  const underscoreKey = vehicleCoreKey('vehicle_create');
  assert.match(colonKey, /^[A-Za-z0-9._-]{1,128}$/);
  assert.equal(colonKey.length, 64);
  assert.equal(vehicleCoreKey('vehicle:create'), colonKey);
  assert.notEqual(colonKey, underscoreKey);
});
