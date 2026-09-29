import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MCP_MOBILE_RUNTIME_E2E,
  assertEphemeralDatabase,
} from '../scripts/prepare-mcp-mobile-runtime-e2e.js';

test('MCP mobile runtime E2E fixture is deterministic and localhost-only', () => {
  assert.equal(
    MCP_MOBILE_RUNTIME_E2E.warehouseId,
    '94444444-4444-4444-8444-444444444444',
  );
  assert.equal(
    MCP_MOBILE_RUNTIME_E2E.customerId,
    '95555555-5555-4555-8555-555555555555',
  );
  assert.equal(
    MCP_MOBILE_RUNTIME_E2E.customerAddressId,
    '96666666-6666-4666-8666-666666666666',
  );
  assert.equal(
    MCP_MOBILE_RUNTIME_E2E.variantId,
    '99999999-9999-4999-8999-999999999999',
  );

  assert.doesNotThrow(() => {
    assertEphemeralDatabase(
      'postgresql://postgres:postgres@127.0.0.1:5432/npp_e2e',
      'test',
    );
  });
  assert.throws(
    () => assertEphemeralDatabase(
      'postgresql://postgres:postgres@155.248.219.241:5432/npp',
      'test',
    ),
    /MCP_MOBILE_RUNTIME_E2E_EPHEMERAL_DATABASE_REQUIRED/,
  );
  assert.throws(
    () => assertEphemeralDatabase(
      'postgresql://postgres:postgres@127.0.0.1:5432/npp_e2e',
      'production',
    ),
    /MCP_MOBILE_RUNTIME_E2E_TEST_ENV_REQUIRED/,
  );
});
