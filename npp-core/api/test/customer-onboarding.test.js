import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import { PERMISSIONS } from '../src/request-context.js';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import {
  hashSubmission,
  validateSubmission,
} from '../src/services/customer-onboarding.js';
import * as customerService from '../src/services/customer.js';

function testEnv(port, overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    INSTALLATION_ID: `customer-onboarding-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:customer-onboarding',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function validSubmission(suffix = randomUUID().slice(0, 8)) {
  return {
    sourceSystem: 'MCP',
    sourceOutletId: `outlet-${suffix}`,
    sourceDemandReference: `demand-${suffix}`,
    orderRequired: true,
    proposedCustomer: {
      name: `Điểm bán ${suffix}`,
      phone: '0901234567',
      address: {
        label: 'Cửa hàng',
        addressLine1: `1 Đường ${suffix}`,
        ward: 'Phường 1',
        district: 'Quận 1',
        province: 'TP.HCM',
        countryCode: 'VN',
      },
    },
    sourceMetadata: { routeId: `route-${suffix}`, orderIntentId: `intent-${suffix}` },
  };
}

async function postJson(baseUrl, path, config, payload, idempotencyKey = randomUUID()) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.backendApiToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
}

test('Phase 6C.1A source contract — MCP add-customer remains field-only', () => {
  const component = readFileSync(new URL('../../../mcp/src/features/mcp/McpSessionAddCustomerButton.tsx', import.meta.url), 'utf8');
  const proxy = readFileSync(new URL('../../../mcp/src/app/api/backend/mcp-day/session-customer/add/route.ts', import.meta.url), 'utf8');
  const forbidden = [
    '/api/customer-onboarding-requests',
    'customer-onboarding-requests',
    'core.customer-onboarding.submit',
    'approvedCustomerId',
  ];
  assert.match(component, /\/api\/backend\/mcp-day\/session-customer\/add/);
  assert.match(proxy, /\/api\/mcp-day\/session-customer\/add/);
  for (const marker of forbidden) {
    assert.equal(component.includes(marker), false, `MCP add-customer component must not contain ${marker}`);
    assert.equal(proxy.includes(marker), false, `MCP add-customer proxy must not contain ${marker}`);
  }
});

test('Phase 6C.1A validation — Core request requires a stable demand trigger and immutable snapshot', () => {
  const payload = validSubmission('validation');
  const valid = validateSubmission(payload);
  assert.equal(valid.ok, true);
  assert.equal(hashSubmission(valid.normalized).length, 64);
  assert.equal(hashSubmission(valid.normalized), hashSubmission(validateSubmission(structuredClone(payload)).normalized));
  const reorderedMetadata = structuredClone(payload);
  reorderedMetadata.sourceMetadata = { orderIntentId: 'intent-validation', routeId: 'route-validation' };
  assert.equal(hashSubmission(valid.normalized), hashSubmission(validateSubmission(reorderedMetadata).normalized));

  assert.equal(validateSubmission({ ...payload, sourceOutletId: '' }).code, 'MISSING_SOURCE_OUTLET');
  assert.equal(validateSubmission({ ...payload, sourceDemandReference: '' }).code, 'MISSING_DEMAND_REFERENCE');
  assert.equal(validateSubmission({ ...payload, orderRequired: false }).code, 'ORDER_REQUIRED_TRIGGER_MISSING');
  assert.equal(validateSubmission({ ...payload, status: 'approved' }).code, 'SUBMISSION_PRIVILEGED_FIELD_FORBIDDEN');
  assert.equal(validateSubmission({ ...payload, approvedCustomerId: randomUUID() }).code, 'SUBMISSION_PRIVILEGED_FIELD_FORBIDDEN');
});

test('Phase 6C.1A migration is registered after 040 and is rerun-safe by construction', () => {
  const migration = CORE_API_MIGRATIONS.at(-1);
  assert.equal(migration.id, '041_customer_onboarding_requests');
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS sales\.customer_onboarding_requests/);
  assert.match(migration.sql, /ON CONFLICT \(permission_key\) DO UPDATE/);
  assert.match(migration.sql, /customer_onboarding_requests_source_demand_unique/);
  assert.match(migration.sql, /order_required boolean NOT NULL CHECK \(order_required = true\)/);
});

test('Customer onboarding API — demand retries deduplicate and payload mismatch conflicts', async () => {
  const config = loadConfig(testEnv(3061));
  const pool = getPool(config);
  let server;
  try {
    server = await startServer({ config });
    const baseUrl = 'http://127.0.0.1:3061';
    const payload = validSubmission('dedupe');
    const idempotencyKey = `submit-${randomUUID()}`;

    const first = await postJson(baseUrl, '/api/customer-onboarding-requests', config, payload, idempotencyKey);
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    const requestId = firstBody.data.customerOnboardingRequest.id;
    assert.equal(firstBody.data.customerOnboardingRequest.status, 'submitted');

    const sameKey = await postJson(baseUrl, '/api/customer-onboarding-requests', config, payload, idempotencyKey);
    assert.equal(sameKey.status, 201);
    assert.equal((await sameKey.json()).data.customerOnboardingRequest.id, requestId);

    const changedSameKeyPayload = structuredClone(payload);
    changedSameKeyPayload.proposedCustomer.phone = '0911111111';
    const sameKeyMismatch = await postJson(
      baseUrl,
      '/api/customer-onboarding-requests',
      config,
      changedSameKeyPayload,
      idempotencyKey,
    );
    assert.equal(sameKeyMismatch.status, 409);
    assert.equal((await sameKeyMismatch.json()).error.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    const sameDemand = await postJson(baseUrl, '/api/customer-onboarding-requests', config, payload, `submit-${randomUUID()}`);
    assert.equal(sameDemand.status, 201);
    assert.equal((await sameDemand.json()).data.customerOnboardingRequest.id, requestId);

    const missingDemand = structuredClone(payload);
    missingDemand.sourceDemandReference = '';
    const missingDemandResponse = await postJson(
      baseUrl,
      '/api/customer-onboarding-requests',
      config,
      missingDemand,
      `submit-${randomUUID()}`,
    );
    assert.equal(missingDemandResponse.status, 400);
    assert.equal((await missingDemandResponse.json()).error.code, 'MISSING_DEMAND_REFERENCE');

    const changedPayload = structuredClone(payload);
    changedPayload.proposedCustomer.name = 'Tên khác';
    const conflict = await postJson(baseUrl, '/api/customer-onboarding-requests', config, changedPayload, `submit-${randomUUID()}`);
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'DEMAND_REFERENCE_PAYLOAD_MISMATCH');

    const count = await pool.query(
      `SELECT count(*)::int AS count
       FROM sales.customer_onboarding_requests
       WHERE installation_id = $1 AND source_demand_reference = $2`,
      [config.installationId, payload.sourceDemandReference],
    );
    assert.equal(count.rows[0].count, 1);

    const concurrentPayload = validSubmission('concurrent');
    const [concurrentFirst, concurrentSecond] = await Promise.all([
      postJson(baseUrl, '/api/customer-onboarding-requests', config, concurrentPayload, `submit-${randomUUID()}`),
      postJson(baseUrl, '/api/customer-onboarding-requests', config, concurrentPayload, `submit-${randomUUID()}`),
    ]);
    assert.equal(concurrentFirst.status, 201);
    assert.equal(concurrentSecond.status, 201);
    const concurrentFirstBody = await concurrentFirst.json();
    const concurrentSecondBody = await concurrentSecond.json();
    assert.equal(
      concurrentFirstBody.data.customerOnboardingRequest.id,
      concurrentSecondBody.data.customerOnboardingRequest.id,
    );
    const concurrentCount = await pool.query(
      `SELECT count(*)::int AS count
       FROM sales.customer_onboarding_requests
       WHERE installation_id = $1 AND source_demand_reference = $2`,
      [config.installationId, concurrentPayload.sourceDemandReference],
    );
    assert.equal(concurrentCount.rows[0].count, 1);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('Customer onboarding API — review then approve creates one customer/address atomically', async () => {
  const config = loadConfig(testEnv(3062));
  const pool = getPool(config);
  let server;
  try {
    server = await startServer({ config });
    const baseUrl = 'http://127.0.0.1:3062';
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const payload = validSubmission(suffix);

    const submitted = await postJson(baseUrl, '/api/customer-onboarding-requests', config, payload);
    assert.equal(submitted.status, 201);
    const created = (await submitted.json()).data.customerOnboardingRequest;

    const review = await postJson(
      baseUrl,
      `/api/customer-onboarding-requests/${created.id}/review`,
      config,
      {
        expectedVersion: created.version,
        proposedCustomer: { name: 'Không được phép ghi đè snapshot' },
      },
    );
    assert.equal(review.status, 200);
    const underReview = (await review.json()).data.customerOnboardingRequest;
    assert.equal(underReview.status, 'under_review');
    assert.equal(underReview.proposedCustomer.name, payload.proposedCustomer.name);

    const approveKey = `approve-${randomUUID()}`;
    const approvePayload = { expectedVersion: underReview.version, customerCode: `KH-${suffix}` };
    const approvedResponse = await postJson(
      baseUrl,
      `/api/customer-onboarding-requests/${created.id}/approve`,
      config,
      approvePayload,
      approveKey,
    );
    assert.equal(approvedResponse.status, 200);
    const approved = (await approvedResponse.json()).data.customerOnboardingRequest;
    assert.equal(approved.status, 'approved');
    assert.ok(approved.approvedCustomerId);
    assert.ok(approved.approvedCustomerAddressId);

    const replay = await postJson(
      baseUrl,
      `/api/customer-onboarding-requests/${created.id}/approve`,
      config,
      approvePayload,
      approveKey,
    );
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).data.customerOnboardingRequest.approvedCustomerId, approved.approvedCustomerId);

    const customerCount = await pool.query(
      'SELECT count(*)::int AS count FROM shared.customers WHERE installation_id = $1 AND id = $2',
      [config.installationId, approved.approvedCustomerId],
    );
    const addressCount = await pool.query(
      'SELECT count(*)::int AS count FROM shared.customer_addresses WHERE installation_id = $1 AND id = $2 AND customer_id = $3',
      [config.installationId, approved.approvedCustomerAddressId, approved.approvedCustomerId],
    );
    assert.equal(customerCount.rows[0].count, 1);
    assert.equal(addressCount.rows[0].count, 1);

    const auditCount = await pool.query(
      `SELECT count(*)::int AS count
       FROM shared.core_audit_records
       WHERE installation_id = $1
         AND resource_type = 'customer_onboarding_request'
         AND resource_id = $2`,
      [config.installationId, created.id],
    );
    const outboxCount = await pool.query(
      `SELECT count(*)::int AS count
       FROM shared.core_outbox_events
       WHERE installation_id = $1
         AND aggregate_type = 'sales.customer_onboarding_request'
         AND aggregate_id = $2`,
      [config.installationId, created.id],
    );
    assert.equal(auditCount.rows[0].count, 3);
    assert.equal(outboxCount.rows[0].count, 3);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('Customer onboarding API — MCP service principal may submit/read but cannot review', async () => {
  const config = loadConfig(testEnv(3064));
  const pool = getPool(config);
  let server;
  try {
    const authenticateRequest = () => ({
      ok: true,
      principal: {
        actorId: 'service:mcp-field',
        roles: ['service'],
        permissions: [
          PERMISSIONS.coreCustomerOnboardingRead,
          PERMISSIONS.coreCustomerOnboardingSubmit,
        ],
        scopes: { branchIds: [], warehouseIds: [], territoryIds: [] },
        sourceApp: 'mcp-field',
      },
    });
    server = await startServer({ config, authenticateRequest });
    const baseUrl = 'http://127.0.0.1:3064';

    const submitted = await postJson(
      baseUrl,
      '/api/customer-onboarding-requests',
      config,
      validSubmission('mcp-permission'),
    );
    assert.equal(submitted.status, 201);
    const request = (await submitted.json()).data.customerOnboardingRequest;

    const read = await fetch(`${baseUrl}/api/customer-onboarding-requests/${request.id}`, {
      headers: { Authorization: `Bearer ${config.backendApiToken}` },
    });
    assert.equal(read.status, 200);

    const review = await postJson(
      baseUrl,
      `/api/customer-onboarding-requests/${request.id}/review`,
      config,
      { expectedVersion: request.version },
    );
    assert.equal(review.status, 403);
    assert.equal((await review.json()).error.code, 'FORBIDDEN');

    const state = await pool.query(
      `SELECT status, version
       FROM sales.customer_onboarding_requests
       WHERE installation_id = $1 AND id = $2`,
      [config.installationId, request.id],
    );
    assert.deepEqual(state.rows[0], { status: 'submitted', version: 1 });
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});

test('Customer onboarding API — link-existing rejects inactive or mismatched customer/address', async () => {
  const config = loadConfig(testEnv(3063));
  const pool = getPool(config);
  let server;
  try {
    server = await startServer({ config });
    const baseUrl = 'http://127.0.0.1:3063';
    const suffix = randomUUID().slice(0, 8).toUpperCase();

    const firstCustomer = await customerService.createCustomer(pool, {
      installationId: config.installationId,
      payload: { code: `LNK-A-${suffix}`, name: 'Khách A' },
      createdBy: 'test:setup',
    });
    const secondCustomer = await customerService.createCustomer(pool, {
      installationId: config.installationId,
      payload: { code: `LNK-B-${suffix}`, name: 'Khách B' },
      createdBy: 'test:setup',
    });
    assert.ok(firstCustomer.ok && secondCustomer.ok);
    const address = await customerService.createCustomerAddress(pool, {
      installationId: config.installationId,
      customerId: firstCustomer.customer.id,
      payload: { label: 'Chính', addressLine1: '1 Đường A', isDefault: true },
      createdBy: 'test:setup',
    });
    assert.ok(address.ok);

    const submitAndReview = async (name) => {
      const submitted = await postJson(baseUrl, '/api/customer-onboarding-requests', config, validSubmission(name));
      const request = (await submitted.json()).data.customerOnboardingRequest;
      const reviewed = await postJson(
        baseUrl,
        `/api/customer-onboarding-requests/${request.id}/review`,
        config,
        { expectedVersion: request.version },
      );
      return (await reviewed.json()).data.customerOnboardingRequest;
    };

    const mismatchRequest = await submitAndReview('mismatch');
    const mismatch = await postJson(
      baseUrl,
      `/api/customer-onboarding-requests/${mismatchRequest.id}/link-existing`,
      config,
      {
        expectedVersion: mismatchRequest.version,
        customerId: secondCustomer.customer.id,
        addressId: address.address.id,
      },
    );
    assert.equal(mismatch.status, 404);
    assert.equal((await mismatch.json()).error.code, 'CUSTOMER_ADDRESS_NOT_FOUND');

    const inactive = await customerService.updateCustomer(pool, {
      id: firstCustomer.customer.id,
      installationId: config.installationId,
      payload: { isActive: false, expectedUpdatedAt: firstCustomer.customer.updated_at },
      updatedBy: 'test:setup',
    });
    assert.ok(inactive.ok);

    const inactiveRequest = await submitAndReview('inactive');
    const inactiveLink = await postJson(
      baseUrl,
      `/api/customer-onboarding-requests/${inactiveRequest.id}/link-existing`,
      config,
      {
        expectedVersion: inactiveRequest.version,
        customerId: firstCustomer.customer.id,
        addressId: address.address.id,
      },
    );
    assert.equal(inactiveLink.status, 400);
    assert.equal((await inactiveLink.json()).error.code, 'CUSTOMER_INACTIVE');
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
