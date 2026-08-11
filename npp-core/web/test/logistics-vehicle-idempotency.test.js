import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gatewaySource = readFileSync(new URL('../lib/logistics-gateway.ts', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../app/logistics/trips/trip-planning-workspace.tsx', import.meta.url), 'utf8');
const coreIdempotencySource = readFileSync(new URL('../../api/src/idempotency.js', import.meta.url), 'utf8');
const masterCreateCoreKey = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

test('A1-A3 logistics master create translates UI idempotency keys to stable collision-resistant Core-safe keys', () => {
  assert.ok(workspaceSource.includes("return `${prefix}:${parts.filter(Boolean).join(':')}`;"));
  assert.ok(workspaceSource.includes(".replace(/[^A-Za-z0-9._:-]/g, '_')"));
  assert.ok(coreIdempotencySource.includes('const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;'));
  assert.ok(gatewaySource.includes("import { createHash, randomUUID } from 'node:crypto';"));
  assert.ok(gatewaySource.includes("const MASTER_CREATE_RESOURCES=new Set(['routes','vehicles','drivers']);"));
  assert.ok(gatewaySource.includes("function masterCreateCoreKey(v:string|null|undefined){return createHash('sha256').update(key(v),'utf8').digest('hex');}"));
  assert.ok(gatewaySource.includes("idempotencyKey:MASTER_CREATE_RESOURCES.has(resource)?masterCreateCoreKey(idempotencyKey):key(idempotencyKey)"));
  assert.ok(!gatewaySource.includes("resource==='vehicles'?vehicleCoreKey"));

  for (const sourceKey of ['vehicle:create', 'driver:create', 'route:create']) {
    const coreKey = masterCreateCoreKey(sourceKey);
    assert.match(coreKey, /^[A-Za-z0-9._-]{1,128}$/);
    assert.equal(coreKey.length, 64);
    assert.equal(masterCreateCoreKey(sourceKey), coreKey);
  }
  assert.notEqual(masterCreateCoreKey('route:create'), masterCreateCoreKey('route_create'));

  assert.ok(gatewaySource.includes("updateDeliveryTrip<T>"));
  assert.ok(gatewaySource.includes("transitionDeliveryTrip<T>"));
  assert.ok(gatewaySource.includes("idempotencyKey:key(idempotencyKey)"));
});