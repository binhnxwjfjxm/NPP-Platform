import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const commercialRepository = source('src/db/repositories/sales-order-commercial.js');
const deliveryOrderRepository = source('src/db/repositories/sales-delivery-orders.js');
const deliveryOrderService = source('src/services/sales-delivery-orders.js');
const tripPlanningService = source('src/services/logistics-trip-planning.js');
const driverRepository = source('src/db/repositories/logistics-driver-delivery.js');
const driverService = source('src/services/logistics-driver-delivery.js');

test('Task B snapshots customer phone and address location URL into the Sales Order address snapshot', () => {
  assert.match(commercialRepository, /applyCustomerDeliveryAddressSnapshot/);
  assert.match(commercialRepository, /customer_address_snapshot/);
  assert.match(commercialRepository, /'customerPhone'/);
  assert.match(commercialRepository, /FROM shared\.customers AS customer/);
  assert.match(commercialRepository, /'locationUrl'/);
  assert.match(commercialRepository, /FROM shared\.customer_addresses AS address/);
  assert.match(commercialRepository, /address\.location_url/);
  assert.match(commercialRepository, /version\.version_status = 'draft'/);
  assert.match(commercialRepository, /applyCommercialSnapshot[\s\S]*applyCustomerDeliveryAddressSnapshot/);
  assert.match(commercialRepository, /copyCommercialSnapshotToDraft[\s\S]*applyCustomerDeliveryAddressSnapshot/);
});

test('Lane A4 snapshots customerPhone even when customer_address_id is null and scopes locationUrl to an address', () => {
  assert.match(commercialRepository, /WHEN version\.customer_id IS NULL THEN version\.customer_address_snapshot/);
  assert.match(
    commercialRepository,
    /'customerPhone'[\s\S]*?FROM shared\.customers AS customer[\s\S]*?\|\| CASE[\s\S]*?WHEN version\.customer_address_id IS NULL THEN '\{\}'::jsonb[\s\S]*?'locationUrl'/,
  );
  assert.doesNotMatch(
    commercialRepository,
    /WHEN version\.customer_address_id IS NULL THEN version\.customer_address_snapshot/,
  );
});

test('Task B keeps the address snapshot immutable through Delivery Order, Trip Stop and driver read projection', () => {
  assert.match(deliveryOrderRepository, /version\.customer_address_snapshot/);
  assert.match(
    deliveryOrderService,
    /const destinationSnapshot = first\.delivery_mode === 'DELIVERY'[\s\S]*?\? first\.customer_address_snapshot[\s\S]*?destinationSnapshot,/,
  );
  assert.match(deliveryOrderRepository, /JSON\.stringify\(data\.destinationSnapshot \?\? \{\}\)/);
  assert.match(tripPlanningService, /addressSnapshot:\s*deliveryOrder\.destination_snapshot/);
  assert.match(driverRepository, /stop\.address_snapshot/);
  assert.match(driverService, /address:\s*row\.address_snapshot \?\? \{\}/);
  assert.doesNotMatch(driverRepository, /JOIN\s+shared\.customer_addresses/i);
  assert.doesNotMatch(driverRepository, /JOIN\s+shared\.customers/i);
});

test('Task B does not add amount-due duplication or editable coordinate data to the delivery snapshot chain', () => {
  assert.doesNotMatch(commercialRepository, /latitude|longitude|\blat\b|\blng\b/i);
  assert.doesNotMatch(tripPlanningService, /amountDue/);
});
