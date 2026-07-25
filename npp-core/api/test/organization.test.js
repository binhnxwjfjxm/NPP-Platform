import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSuccessEnvelope } from '@npp/contracts';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import { requireIdempotencyKey } from '../src/routes/organization.js';
import * as branchService from '../src/services/branch.js';
import * as warehouseService from '../src/services/warehouse.js';
import * as locationService from '../src/services/location.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3008',
    INSTALLATION_ID: 'test-installation',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

test('Branch service — create and list', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);

  try {
    // Create a branch
    const createResult = await branchService.createBranch(pool, {
      installationId: config.installationId,
      payload: {
        code: 'MAIN-BRANCH',
        name: 'Main Branch',
        address: '123 MainSt',
        phone: '1234567890',
        email: 'main@example.com',
      },
      createdBy: 'test:user1',
    });

    assert.ok(createResult.ok, `Failed to create branch: ${createResult.message}`);
    assert.ok(createResult.branch.id);
    assert.equal(createResult.branch.code, 'MAIN-BRANCH');
    assert.equal(createResult.branch.name, 'Main Branch');
    assert.equal(createResult.branch.is_active, true);

    // List branches
    const listResult = await branchService.listBranches(pool, {
      installationId: config.installationId,
      limit: 100,
      offset: 0,
    });

    assert.ok(listResult.ok);
    assert.ok(Array.isArray(listResult.branches));
    assert.ok(listResult.branches.some(b => b.id === createResult.branch.id));
  } finally {
    await closePool();
  }
});

test('Branch service — duplicate code conflict', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);

  try {
    const code = `DUP-${randomUUID().substring(0, 8)}`;

    // Create first branch
    const result1 = await branchService.createBranch(pool, {
      installationId: config.installationId,
      payload: {
        code,
        name: 'Branch 1',
      },
      createdBy: 'test:user1',
    });

    assert.ok(result1.ok);

    // Try to create second branch with same code
    const result2 = await branchService.createBranch(pool, {
      installationId: config.installationId,
      payload: {
        code,
        name: 'Branch 2',
      },
      createdBy: 'test:user1',
    });

    assert.equal(result2.ok, false);
    assert.equal(result2.code, 'DUPLICATE_CODE');
    assert.equal(result2.retryable, false);
  } finally {
    await closePool();
  }
});

test('Warehouse service — create and list', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);

  try {
    // Create a branch first
    const branchResult = await branchService.createBranch(pool, {
      installationId: config.installationId,
      payload: {
        code: `BR-${randomUUID().substring(0, 8)}`,
        name: 'Test Branch',
      },
      createdBy: 'test:user1',
    });

    assert.ok(branchResult.ok);
    const branchId = branchResult.branch.id;

    // Create a warehouse
    const warehouseResult = await warehouseService.createWarehouse(pool, {
      installationId: config.installationId,
      payload: {
        branchId,
        code: `WH-${randomUUID().substring(0, 8)}`,
        name: 'Main Warehouse',
        warehouseType: 'main',
      },
      createdBy: 'test:user1',
    });

    assert.ok(warehouseResult.ok, `Failed: ${warehouseResult.message}`);
    assert.ok(warehouseResult.warehouse.id);
    assert.equal(warehouseResult.warehouse.branch_id, branchId);
    assert.equal(warehouseResult.warehouse.warehouse_type, 'main');

    // List warehouses
    const listResult = await warehouseService.listWarehouses(pool, {
      installationId: config.installationId,
      limit: 100,
      offset: 0,
    });

    assert.ok(listResult.ok);
    assert.ok(Array.isArray(listResult.warehouses));
    assert.ok(listResult.warehouses.some(w => w.id === warehouseResult.warehouse.id));
  } finally {
    await closePool();
  }
});

test('Warehouse service — cannot create under inactive branch', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);

  try {
    // Create and deactivate a branch
    const branchResult = await branchService.createBranch(pool, {
      installationId: config.installationId,
      payload: {
        code: `BR-${randomUUID().substring(0, 8)}`,
        name: 'Inactive Branch',
      },
      createdBy: 'test:user1',
    });

    assert.ok(branchResult.ok);
    const branchId = branchResult.branch.id;

    const deactivateResult = await branchService.updateBranchStatus(pool, {
      id: branchId,
      installationId: config.installationId,
      isActive: false,
      updatedBy: 'test:user1',
    });

    assert.ok(deactivateResult.ok);

    // Try to create warehouse under inactive branch
    const warehouseResult = await warehouseService.createWarehouse(pool, {
      installationId: config.installationId,
      payload: {
        branchId,
        code: `WH-${randomUUID().substring(0, 8)}`,
        name: 'Warehouse',
        warehouseType: 'main',
      },
      createdBy: 'test:user1',
    });

    assert.equal(warehouseResult.ok, false);
    assert.equal(warehouseResult.code, 'BRANCH_INACTIVE');
  } finally {
    await closePool();
  }
});

test('Location service — create under warehouse', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);

  try {
    // Create branch
    const branchResult = await branchService.createBranch(pool, {
      installationId: config.installationId,
      payload: {
        code: `BR-${randomUUID().substring(0, 8)}`,
        name: 'Branch',
      },
      createdBy: 'test:user1',
    });

    assert.ok(branchResult.ok);

    // Create warehouse
    const warehouseResult = await warehouseService.createWarehouse(pool, {
      installationId: config.installationId,
      payload: {
        branchId: branchResult.branch.id,
        code: `WH-${randomUUID().substring(0, 8)}`,
        name: 'Warehouse',
        warehouseType: 'main',
      },
      createdBy: 'test:user1',
    });

    assert.ok(warehouseResult.ok);
    const warehouseId = warehouseResult.warehouse.id;

    // Create location
    const locationResult = await locationService.createWarehouseLocation(pool, {
      installationId: config.installationId,
      payload: {
        warehouseId,
        code: `LOC-${randomUUID().substring(0, 8)}`,
        name: 'Storage Area',
        locationType: 'storage',
      },
      createdBy: 'test:user1',
    });

    assert.ok(locationResult.ok, `Failed: ${locationResult.message}`);
    assert.ok(locationResult.location.id);
    assert.equal(locationResult.location.warehouse_id, warehouseId);
    assert.equal(locationResult.location.location_type, 'storage');
  } finally {
    await closePool();
  }
});

test('Branch deactivation — cannot deactivate if has active warehouses', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);

  try {
    // Create branch
    const branchResult = await branchService.createBranch(pool, {
      installationId: config.installationId,
      payload: {
        code: `BR-${randomUUID().substring(0, 8)}`,
        name: 'Branch',
      },
      createdBy: 'test:user1',
    });

    assert.ok(branchResult.ok);
    const branchId = branchResult.branch.id;

    // Create warehouse
    const warehouseResult = await warehouseService.createWarehouse(pool, {
      installationId: config.installationId,
      payload: {
        branchId,
        code: `WH-${randomUUID().substring(0, 8)}`,
        name: 'Warehouse',
        warehouseType: 'main',
      },
      createdBy: 'test:user1',
    });

    assert.ok(warehouseResult.ok);

    // Try to deactivate branch
    const deactivateResult = await branchService.updateBranchStatus(pool, {
      id: branchId,
      installationId: config.installationId,
      isActive: false,
      updatedBy: 'test:user1',
    });

    assert.equal(deactivateResult.ok, false);
    assert.equal(deactivateResult.code, 'CANNOT_DEACTIVATE');
    assert.equal(deactivateResult.retryable, false);

    // Deactivate warehouse first
    const warehouseDeactivateResult = await warehouseService.updateWarehouseStatus(pool, {
      id: warehouseResult.warehouse.id,
      installationId: config.installationId,
      isActive: false,
      updatedBy: 'test:user1',
    });

    assert.ok(warehouseDeactivateResult.ok);

    // Now branch deactivation should work
    const finalDeactivateResult = await branchService.updateBranchStatus(pool, {
      id: branchId,
      installationId: config.installationId,
      isActive: false,
      updatedBy: 'test:user1',
    });

    assert.ok(finalDeactivateResult.ok);
  } finally {
    await closePool();
  }
});

test('Validation — code normalization', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);

  try {
    // Create branch with lowercase code - should be normalized to uppercase
    const result = await branchService.createBranch(pool, {
      installationId: config.installationId,
      payload: {
        code: '  test-branch  ',
        name: 'Test',
      },
      createdBy: 'test:user1',
    });

    assert.ok(result.ok);
    assert.equal(result.branch.code, 'TEST-BRANCH'); // Uppercase and trimmed
  } finally {
    await closePool();
  }
});

test('Validation — empty name rejected', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);

  try {
    const result = await branchService.createBranch(pool, {
      installationId: config.installationId,
      payload: {
        code: 'TEST',
        name: '   ', // Empty when trimmed
      },
      createdBy: 'test:user1',
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_NAME');
  } finally {
    await closePool();
  }
});

test('Organization route helper — missing Idempotency-Key returns an error envelope', () => {
  const req = { headers: {} };
  const response = requireIdempotencyKey(req, 'req-id', '2026-07-25T00:00:00.000Z');

  assert.ok(response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, 'MISSING_IDEMPOTENCY_KEY');
});

test('Organization route helper — invalid Idempotency-Key returns a validation error', () => {
  const req = { headers: { 'idempotency-key': ' invalid key ' } };
  const response = requireIdempotencyKey(req, 'req-id', '2026-07-25T00:00:00.000Z');

  assert.ok(response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, 'IDEMPOTENCY_KEY_INVALID');
});
