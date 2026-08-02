import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import * as customerService from '../src/services/customer.js';

function testEnv(port) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    INSTALLATION_ID: `customer-onboarding-isolation-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:customer-onboarding-isolation',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function postJson(baseUrl, path, config, payload) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.backendApiToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(payload),
  });
}

test('Customer onboarding API rejects customer/address links from another installation', async () => {
  const config = loadConfig(testEnv(3065));
  const pool = getPool(config);
  const foreignInstallationId = `${config.installationId}-foreign`;
  let server;

  try {
    const foreignCustomer = await customerService.createCustomer(pool, {
      installationId: foreignInstallationId,
      payload: {
        code: `FOREIGN-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: 'Khách ngoài installation',
      },
      createdBy: 'test:foreign-setup',
    });
    assert.equal(foreignCustomer.ok, true);

    const foreignAddress = await customerService.createCustomerAddress(pool, {
      installationId: foreignInstallationId,
      customerId: foreignCustomer.customer.id,
      payload: {
        label: 'Địa chỉ ngoài installation',
        addressLine1: '1 Đường Ngoài Phạm Vi',
        isDefault: true,
      },
      createdBy: 'test:foreign-setup',
    });
    assert.equal(foreignAddress.ok, true);

    server = await startServer({ config });
    const baseUrl = 'http://127.0.0.1:3065';
    const suffix = randomUUID().slice(0, 8);
    const submittedResponse = await postJson(baseUrl, '/api/customer-onboarding-requests', config, {
      sourceSystem: 'MCP',
      sourceOutletId: `outlet-${suffix}`,
      sourceDemandReference: `demand-${suffix}`,
      orderRequired: true,
      proposedCustomer: {
        name: `Điểm bán ${suffix}`,
        phone: '0901234567',
        address: {
          label: 'Cửa hàng',
          addressLine1: '1 Đường Nội Bộ',
          countryCode: 'VN',
        },
      },
    });
    assert.equal(submittedResponse.status, 201);
    const submitted = (await submittedResponse.json()).data.customerOnboardingRequest;

    const reviewResponse = await postJson(
      baseUrl,
      `/api/customer-onboarding-requests/${submitted.id}/review`,
      config,
      { expectedVersion: submitted.version },
    );
    assert.equal(reviewResponse.status, 200);
    const underReview = (await reviewResponse.json()).data.customerOnboardingRequest;

    const linkResponse = await postJson(
      baseUrl,
      `/api/customer-onboarding-requests/${submitted.id}/link-existing`,
      config,
      {
        expectedVersion: underReview.version,
        customerId: foreignCustomer.customer.id,
        addressId: foreignAddress.address.id,
      },
    );
    assert.equal(linkResponse.status, 404);
    const linkBody = await linkResponse.json();
    assert.equal(linkBody.error.code, 'CUSTOMER_ADDRESS_NOT_FOUND');

    const requestState = await pool.query(
      `SELECT status, version, approved_customer_id, approved_customer_address_id
       FROM sales.customer_onboarding_requests
       WHERE installation_id = $1 AND id = $2`,
      [config.installationId, submitted.id],
    );
    assert.deepEqual(requestState.rows[0], {
      status: 'under_review',
      version: 2,
      approved_customer_id: null,
      approved_customer_address_id: null,
    });
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
