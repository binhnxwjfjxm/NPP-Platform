import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPurchaseOrder } from '../src/services/purchase-order.js';

test('purchase-order create fails closed when warehouse scope is empty', async () => {
  const result = await createPurchaseOrder(null, {
    requestContext: {
      installationId: 'scope-test-installation',
      actorId: 'scope-test-actor',
      scopes: { warehouseIds: [] },
    },
    payload: {
      supplierId: randomUUID(),
      warehouseId: randomUUID(),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WAREHOUSE_SCOPE_DENIED');
});
