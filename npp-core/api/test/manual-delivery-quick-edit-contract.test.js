import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  salesOrderDeliveryExecutionInternals,
} from '../src/services/sales-order.js';

const { manualQuickEditGuard } = salesOrderDeliveryExecutionInternals;
const servicePath = fileURLToPath(new URL('../src/services/sales-order.js', import.meta.url));
const routePath = fileURLToPath(new URL('../src/routes/sales-orders.js', import.meta.url));

test('manual quick edit is allowed for confirmed manual delivery and leaves unwind to the transaction service', () => {
  assert.deepEqual(manualQuickEditGuard({
    status: 'confirmed',
    deliveryMode: 'DELIVERY',
    deliveryExecutionMode: 'MANUAL',
    fulfillment: { totals: { issuedBaseQuantity: '0.000000' } },
  }), { ok: true });

  const trip = manualQuickEditGuard({
    status: 'confirmed',
    deliveryMode: 'DELIVERY',
    deliveryExecutionMode: 'TRIP',
    fulfillment: { totals: { issuedBaseQuantity: '0' } },
  });
  assert.equal(trip.ok, false);
  assert.equal(trip.code, 'MANUAL_DELIVERY_EDIT_NOT_AVAILABLE');

  const issued = manualQuickEditGuard({
    status: 'confirmed',
    deliveryMode: 'DELIVERY',
    deliveryExecutionMode: 'MANUAL',
    fulfillment: { totals: { issuedBaseQuantity: '1.000000' } },
  });
  assert.equal(issued.ok, true);
});

test('manual quick edit stays one canonical transaction and keeps audit history internally', async () => {
  const [serviceSource, routeSource] = await Promise.all([
    readFile(servicePath, 'utf8'),
    readFile(routePath, 'utf8'),
  ]);

  assert.match(serviceSource, /export async function quickEditManualSalesOrder/);
  assert.match(serviceSource, /createSalesOrderAmendment\(client/);
  assert.match(serviceSource, /updateSalesOrderDraft\(client/);
  assert.match(serviceSource, /expectedRevision: draft\.revision/);
  assert.match(serviceSource, /return confirmSalesOrder\(client/);
  assert.match(serviceSource, /reason: 'Sửa đơn trước khi giao khách'/);
  assert.match(serviceSource, /preExecutionReleaseIntent: 'manual-edit'/);

  assert.match(routeSource, /manual_quick_edit: 'sales\.sales_order\.manual_quick_edited'/);
  assert.match(routeSource, /action === 'manual-edit' && method === 'PUT'/);
  assert.match(routeSource, /options\.PERMISSIONS\.coreSalesOrderAmend/);
  assert.match(routeSource, /route: `\/api\/sales-orders\/\$\{id\}\/manual-edit`/);
  assert.match(routeSource, /service\.quickEditManualSalesOrder\(client/);
  assert.match(routeSource, /idempotencyKey: key/);
});