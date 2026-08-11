import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const gatewaySource = readFileSync(new URL('../lib/logistics-gateway.ts', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../app/logistics/trips/trip-planning-workspace.tsx', import.meta.url), 'utf8');
const dispatchWorkspaceSource = readFileSync(new URL('../app/logistics/dispatch/trip-dispatch-workspace.tsx', import.meta.url), 'utf8');
const coreIdempotencySource = readFileSync(new URL('../../api/src/idempotency.js', import.meta.url), 'utf8');

class TestInventoryGatewayError extends Error {
  constructor(code, publicMessage, statusCode, retryable, details = {}) {
    super(publicMessage);
    this.code = code;
    this.publicMessage = publicMessage;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;
  }
}

function loadGateway(mockFetch) {
  const compiled = ts.transpileModule(gatewaySource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const mockRequire = (specifier) => {
    if (specifier === 'server-only') return {};
    if (specifier === 'node:crypto') return { createHash, randomUUID };
    if (specifier === './inventory-gateway') return { InventoryGatewayError: TestInventoryGatewayError };
    if (specifier === './internal-auth-client') return { requireNppWorkforceSessionToken: () => 'test-session-token' };
    throw new Error(`Unexpected gateway dependency: ${specifier}`);
  };
  const execute = new Function('require', 'module', 'exports', 'process', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', compiled);
  execute(
    mockRequire,
    module,
    module.exports,
    { env: { CORE_API_INTERNAL_URL: 'https://core.example.test', NODE_ENV: 'test' } },
    mockFetch,
    globalThis.AbortController,
    globalThis.setTimeout,
    globalThis.clearTimeout,
  );
  return module.exports;
}

function successfulFetchRecorder() {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ data: { ok: true } }) };
    },
  };
}

test('all NPP logistics mutations send Core-safe idempotency headers at the gateway boundary', async () => {
  assert.ok(workspaceSource.includes("return `${prefix}:${parts.filter(Boolean).join(':')}`;"));
  assert.ok(workspaceSource.includes("const scope = keyScope('update-trip'"));
  assert.ok(workspaceSource.includes('const scope = keyScope(action, selectedTrip.id, selectedTrip.revision, discriminator);'));
  assert.ok(dispatchWorkspaceSource.includes('const scope = `${selectedTrip.id}:${dispatchedAt}:${normalizedReceiver}:${handoverNote.trim()}`;'));
  assert.ok(coreIdempotencySource.includes('const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;'));

  const recorder = successfulFetchRecorder();
  const gateway = loadGateway(recorder.fetch);

  for (const resource of ['routes', 'vehicles', 'drivers', 'trips']) {
    const sourceKey = `${resource}:create`;
    const expected = createHash('sha256').update(sourceKey, 'utf8').digest('hex');
    await gateway.createLogisticsResource(resource, `req-${resource}`, { code: resource }, sourceKey);
    const call = recorder.calls.at(-1);
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['Idempotency-Key'], expected);
    assert.match(call.init.headers['Idempotency-Key'], /^[A-Za-z0-9._-]{64}$/);
  }

  await gateway.createLogisticsResource('drivers', 'req-safe-driver', { code: 'driver-safe' }, 'driver_create');
  assert.equal(recorder.calls.at(-1).init.headers['Idempotency-Key'], 'driver_create');

  await gateway.createLogisticsResource('trips', 'req-safe-trip', { warehouseId: '11111111-1111-4111-8111-111111111111' }, 'trip_create_safe');
  assert.equal(recorder.calls.at(-1).init.headers['Idempotency-Key'], 'trip_create_safe');

  const tripId = '11111111-1111-4111-8111-111111111111';
  const updateSourceKey = `update-trip:${tripId}:1:vehicle:driver:route:2026-08-11T21:51:00`;
  const expectedUpdateKey = createHash('sha256').update(updateSourceKey, 'utf8').digest('hex');
  await gateway.updateDeliveryTrip(tripId, 'req-update-trip', { revision: '1' }, updateSourceKey);
  assert.equal(recorder.calls.at(-1).init.method, 'PUT');
  assert.equal(recorder.calls.at(-1).init.headers['Idempotency-Key'], expectedUpdateKey);

  await gateway.updateDeliveryTrip(tripId, 'req-safe-update-trip', { revision: '1' }, 'trip_update_safe');
  assert.equal(recorder.calls.at(-1).init.headers['Idempotency-Key'], 'trip_update_safe');

  const actions = ['assign', 'unassign', 'reorder', 'plan', 'reopen', 'lock', 'dispatch', 'return-receipts', 'close'];
  for (const action of actions) {
    const sourceKey = `trip:${action}:${tripId}:1`;
    const expected = createHash('sha256').update(sourceKey, 'utf8').digest('hex');
    await gateway.transitionDeliveryTrip(tripId, action, `req-${action}`, {}, sourceKey);
    const call = recorder.calls.at(-1);
    assert.equal(call.init.method, 'POST');
    assert.ok(call.url.endsWith(`/api/logistics/trips/${tripId}/${action}`));
    assert.equal(call.init.headers['Idempotency-Key'], expected);
    assert.match(call.init.headers['Idempotency-Key'], /^[A-Za-z0-9._-]{64}$/);
  }

  await gateway.transitionDeliveryTrip(tripId, 'plan', 'req-safe-plan-trip', {}, 'trip_plan_safe');
  assert.equal(recorder.calls.at(-1).init.headers['Idempotency-Key'], 'trip_plan_safe');

  assert.notEqual(
    createHash('sha256').update('trip:create', 'utf8').digest('hex'),
    createHash('sha256').update('trip:plan', 'utf8').digest('hex'),
  );
});