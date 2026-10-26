import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  salesOrderDeliveryExecutionInternals,
} from '../src/services/sales-order.js';

const { manualQuickEditGuard, pickupQuickEditGuard } = salesOrderDeliveryExecutionInternals;
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
  assert.match(serviceSource, /getSalesOrder\(client, \{ requestContext, id, forUpdate: true \}\)/);
  assert.match(serviceSource, /String\(before\.salesOrder\.revision\) !== expectedOrderRevision/);
  assert.match(serviceSource, /guardManualEditStoredPrices\(/);
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

test('pickup quick edit stays available only before stock issue and has its own canonical route', async () => {
  assert.deepEqual(pickupQuickEditGuard({
    status: 'confirmed',
    deliveryMode: 'PICKUP',
    fulfillmentStatus: 'held',
  }), { ok: true });

  const issued = pickupQuickEditGuard({
    status: 'confirmed',
    deliveryMode: 'PICKUP',
    fulfillmentStatus: 'issued',
  });
  assert.equal(issued.ok, false);
  assert.equal(issued.code, 'PICKUP_EDIT_LOCKED');

  const partiallyIssued = pickupQuickEditGuard({
    status: 'confirmed',
    deliveryMode: 'PICKUP',
    fulfillmentStatus: 'partially_issued',
  });
  assert.equal(partiallyIssued.ok, false);
  assert.equal(partiallyIssued.code, 'PICKUP_EDIT_LOCKED');

  const [serviceSource, routeSource] = await Promise.all([
    readFile(servicePath, 'utf8'),
    readFile(routePath, 'utf8'),
  ]);
  assert.match(serviceSource, /export async function quickEditPickupSalesOrder/);
  assert.match(serviceSource, /String\(payload\?\.expectedRevision \?\? ''\)\.trim\(\)/);
  assert.match(serviceSource, /String\(before\.salesOrder\.revision\) !== expectedRevision/);
  assert.match(serviceSource, /REVISION_CONFLICT/);
  assert.match(serviceSource, /reason: 'Sửa đơn trước khi Xuất kho'/);
  assert.match(serviceSource, /preExecutionReleaseIntent: 'pickup-edit'/);
  assert.match(routeSource, /pickup_quick_edit: 'sales\.sales_order\.pickup_quick_edited'/);
  assert.match(routeSource, /action === 'pickup-edit' && method === 'PUT'/);
  assert.match(routeSource, /service\.quickEditPickupSalesOrder\(client/);
});


test('manual edit rejects silent repricing of a saved zero and accepts only reviewed price', () => {
  const { guardManualEditStoredPrices } = salesOrderDeliveryExecutionInternals;
  const original = { currentVersionNumber: '1', versions: [{
    versionNumber: '1', customerMode: 'EXISTING', customerId: 'customer',
    salesChannelId: 'channel', priceSelectionMode: 'STANDARD', lines: [
      { id: 'old-1', lineNumber: 1, variantId: 'sku-a', quantity: '1',
        unitPrice: '0', priceSource: 'PRICE_ENGINE' },
      { id: 'old-2', lineNumber: 2, variantId: 'sku-b', quantity: '1',
        unitPrice: '0', priceSource: 'MANUAL_OVERRIDE' },
    ],
  }] };
  const revised = { versions: [{
    versionNumber: '2', customerMode: 'EXISTING', customerId: 'customer',
    salesChannelId: 'channel', priceSelectionMode: 'STANDARD', lines: [
      { id: 'new-1', lineNumber: 1, variantId: 'sku-a', quantity: '1.000000',
        unitPrice: '9000', systemUnitPrice: '9000', priceSource: 'PRICE_ENGINE' },
      { id: 'new-2', lineNumber: 2, variantId: 'sku-b', quantity: '1',
        unitPrice: '0', priceSource: 'MANUAL_OVERRIDE' },
    ],
  }] };
  const payload = { lines: [
    { sourceLineId: 'old-1', variantId: 'sku-a', quantity: '1', expectedSystemUnitPriceMinor: '9000' },
    { sourceLineId: 'old-2', variantId: 'sku-b', quantity: '1', manualUnitPriceMinor: '0' },
  ] };
  const blocked = guardManualEditStoredPrices(original, revised, payload, 2);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'SALES_PRICE_CHANGED');
  assert.equal(blocked.details.previousUnitPriceMinor, '0');
  assert.equal(guardManualEditStoredPrices(original, revised, {
    ...payload, priceChangeAcknowledged: true,
  }, 2).ok, true);
  assert.equal(guardManualEditStoredPrices(original, revised, {
    ...payload, priceChangeAcknowledged: true,
    lines: [{ ...payload.lines[0], expectedSystemUnitPriceMinor: '8000' }, payload.lines[1]],
  }, 2).code, 'SALES_PRICE_CHANGED');
  assert.equal(guardManualEditStoredPrices(original, revised, {
    lines: [{ sourceLineId: 'no-match', variantId: 'sku-a', quantity: '1' }],
  }, 2).code, 'REVISION_CONFLICT');
  const changedQuantity = { versions: [{
    ...revised.versions[0],
    lines: [{ ...revised.versions[0].lines[0], quantity: '2' }, revised.versions[0].lines[1]],
  }] };
  assert.equal(guardManualEditStoredPrices(original, changedQuantity, {
    lines: [{ sourceLineId: 'old-1', variantId: 'sku-a', quantity: '2' }],
  }, 2).ok, true);
});
