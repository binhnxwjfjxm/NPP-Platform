import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {
  createIdempotencyKey,
  isValidIdempotencyKey,
  normalizeIdempotencyKey,
} from '../../../packages/contracts/index.js';

const gatewaySource = readFileSync(new URL('../lib/logistics-gateway.ts', import.meta.url), 'utf8');

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
    if (specifier === '@npp/contracts') {
      return { createIdempotencyKey, isValidIdempotencyKey, normalizeIdempotencyKey };
    }
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

const TEST_UUID = '11111111-1111-4111-8111-111111111111';

test('all NPP logistics mutations enforce the shared Core-safe idempotency contract without private hashing', async () => {
  const recorder = successfulFetchRecorder();
  const gateway = loadGateway(recorder.fetch);

  for (const resource of ['routes', 'vehicles', 'drivers', 'trips']) {
    const sourceKey = createIdempotencyKey(`logistics-${resource}-create`, TEST_UUID);
    await gateway.createLogisticsResource(resource, `req-${resource}`, { code: resource }, sourceKey);
    const call = recorder.calls.at(-1);
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['Idempotency-Key'], sourceKey);
    assert.equal(isValidIdempotencyKey(call.init.headers['Idempotency-Key']), true);
  }

  await gateway.createLogisticsResource('drivers', 'req-safe-driver', { code: 'driver-safe' }, 'driver_create');
  assert.equal(recorder.calls.at(-1).init.headers['Idempotency-Key'], 'driver_create');

  await gateway.createLogisticsResource('trips', 'req-safe-trip', { warehouseId: TEST_UUID }, 'trip_create_safe');
  assert.equal(recorder.calls.at(-1).init.headers['Idempotency-Key'], 'trip_create_safe');

  const tripId = TEST_UUID;
  const updateSourceKey = createIdempotencyKey('logistics-trip-update', TEST_UUID);
  await gateway.updateDeliveryTrip(tripId, 'req-update-trip', { revision: '1' }, updateSourceKey);
  assert.equal(recorder.calls.at(-1).init.method, 'PUT');
  assert.equal(recorder.calls.at(-1).init.headers['Idempotency-Key'], updateSourceKey);

  await gateway.updateDeliveryTrip(tripId, 'req-safe-update-trip', { revision: '1' }, 'trip_update_safe');
  assert.equal(recorder.calls.at(-1).init.headers['Idempotency-Key'], 'trip_update_safe');

  const actions = ['assign', 'unassign', 'reorder', 'plan', 'reopen', 'lock', 'dispatch', 'return-receipts', 'close'];
  for (const action of actions) {
    const sourceKey = createIdempotencyKey(`logistics-trip-${action}`, TEST_UUID);
    await gateway.transitionDeliveryTrip(tripId, action, `req-${action}`, {}, sourceKey);
    const call = recorder.calls.at(-1);
    assert.equal(call.init.method, 'POST');
    assert.ok(call.url.endsWith(`/api/logistics/trips/${tripId}/${action}`));
    assert.equal(call.init.headers['Idempotency-Key'], sourceKey);
    assert.equal(isValidIdempotencyKey(call.init.headers['Idempotency-Key']), true);
  }

  await gateway.transitionDeliveryTrip(tripId, 'plan', 'req-safe-plan-trip', {}, 'trip_plan_safe');
  assert.equal(recorder.calls.at(-1).init.headers['Idempotency-Key'], 'trip_plan_safe');

  const callsBeforeInvalidKey = recorder.calls.length;
  assert.throws(
    () => gateway.transitionDeliveryTrip(tripId, 'plan', 'req-invalid-plan-trip', {}, `trip:plan:${tripId}:1`),
    (error) => error?.code === 'INVALID_IDEMPOTENCY_KEY' && error?.statusCode === 400,
  );
  assert.equal(recorder.calls.length, callsBeforeInvalidKey);

  assert.notEqual(
    createIdempotencyKey('logistics-trip-create', TEST_UUID),
    createIdempotencyKey('logistics-trip-plan', TEST_UUID),
  );
});
