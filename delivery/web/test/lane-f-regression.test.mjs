import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const frame = read('../app/DeliveryAppFrame.tsx');
const middleware = read('../middleware.ts');
const handover = read('../app/trips/[tripId]/cod-handover-panel.tsx');
const branding = read('./branding.test.mjs');
const commercialRepository = read('../../../npp-core/api/src/db/repositories/sales-order-commercial.js');
const driverRepository = read('../../../npp-core/api/src/db/repositories/logistics-driver-delivery.js');
const pickingList = read('../app/picking/page.tsx');
const pickingPanel = read('../app/picking/[demandId]/pick-allocation-panel.tsx');
const pickingClose = read('../app/picking/[demandId]/picking-close-panel.tsx');
const shortageService = read('../../../npp-core/api/src/services/sales-fulfillment-shortage.js');
const shortageRepository = read('../../../npp-core/api/src/db/repositories/sales-fulfillment-shortage.js');
const reversalRoute = read('../../../npp-core/api/src/routes/fulfillment-reversal.js');
const reversalService = read('../../../npp-core/api/src/services/sales-fulfillment-reversal.js');
const reversalMigration = read('../../../database/migrations/sales/082_sales_fulfillment_reversal.sql');
const recoveryMigration = read('../../../database/migrations/logistics/082_logistics_trip_recovery.sql');
const postgresFulfillment = read('../../../npp-core/api/test/sales-fulfillment-operations-integration.test.js');

// Lane F is a regression gate only. It introduces no new business state.
test('Lane F locks Delivery shell, COD custody, canonical idempotency and branding', () => {
  assert.ok(frame.includes('href="/" icon="route" label="Chuyến"'));
  assert.ok(frame.includes('href="/picking" icon="box" label="Soạn hàng"'));
  assert.ok(frame.includes('href="/custody" icon="wallet" label="Tiền đang giữ"'));
  assert.ok(frame.includes('aria-label="Đồng bộ dữ liệu"'));
  assert.ok(!frame.includes('#cod-section'));
  assert.ok(middleware.includes("pickFulfillment: 'core.fulfillment.pick'"));
  assert.ok(middleware.includes('warehouseIds.length > 0'));
  assert.ok(handover.includes("createIdempotencyKey('cod-handover')"));
  assert.ok(handover.includes('pendingRef.current'));
  assert.ok(handover.includes("'Idempotency-Key': pending.key"));
  assert.ok(handover.includes('body: pending.body'));
  assert.ok(handover.includes('custodyTotal'));
  assert.ok(branding.includes('one approved Hưng Phát logo source'));
});

test('Lane F locks immutable customer phone snapshot with and without address id', () => {
  assert.ok(commercialRepository.includes("'customerPhone'"));
  assert.ok(commercialRepository.includes('FROM shared.customers AS customer'));
  assert.ok(commercialRepository.includes("WHEN version.customer_address_id IS NULL THEN '{}'::jsonb"));
  assert.ok(commercialRepository.includes("'locationUrl'"));
  assert.ok(driverRepository.includes('stop.address_snapshot'));
  assert.doesNotMatch(driverRepository, /JOIN\s+shared\.customer_addresses/i);
  assert.doesNotMatch(driverRepository, /JOIN\s+shared\.customers/i);
});

test('Lane F locks canonical picking, shortage, alternative source, close and mobile actions', () => {
  assert.ok(pickingList.includes('Mở soạn hàng'));
  assert.ok(pickingPanel.includes('SOẠN ĐỦ'));
  assert.ok(pickingPanel.includes('SOẠN TIẾP'));
  assert.ok(pickingPanel.includes('THIẾU'));
  assert.ok(pickingPanel.includes('HOÀN'));
  assert.ok(pickingPanel.includes('Nguồn khác còn hợp lệ'));
  assert.ok(pickingPanel.includes("createIdempotencyKey('fulfillment-pick')"));
  assert.ok(pickingPanel.includes("createIdempotencyKey('fulfillment-shortage')"));
  assert.ok(pickingPanel.includes("createIdempotencyKey('fulfillment-pick-reversal')"));
  assert.ok(pickingPanel.includes('role="dialog"'));
  assert.ok(pickingClose.includes('CHỐT SOẠN XONG'));
  assert.ok(pickingClose.includes('CHỐT PHẦN ĐÃ SOẠN'));
  assert.ok(shortageRepository.includes('insertShortage'));
  assert.ok(shortageRepository.includes('insertDiscrepancyObservation'));
  assert.doesNotMatch(shortageService, /UPDATE\s+inventory\.inventory_balances/i);
  assert.doesNotMatch(shortageRepository, /UPDATE\s+inventory\.inventory_balances/i);
});

test('Lane F locks append-only reversal and downstream unwind contracts', () => {
  assert.ok(reversalMigration.includes('PICK_REVERSED'));
  assert.ok(reversalMigration.includes('PACK_REVERSED'));
  assert.ok(reversalMigration.includes('RELEASED_FOR_REVERSAL'));
  assert.ok(reversalMigration.includes('sales_fulfillment_reversal_batches_are_append_only'));
  assert.ok(reversalRoute.includes('reverse-(pick|pack)'));
  assert.ok(reversalRoute.includes('fulfillment-orders\\/([^/]+)\\/reverse'));
  assert.ok(reversalService.includes('PICK_REVERSAL_BLOCKED_BY_PACK'));
  assert.ok(reversalService.includes('PACK_REVERSAL_BLOCKED_BY_DELIVERY_ORDER'));
  assert.ok(recoveryMigration.includes('DISPATCH_RECOVERED'));
  assert.ok(recoveryMigration.includes('logistics_trip_recovery_blocked_by_delivery_attempt'));
  assert.ok(recoveryMigration.includes('logistics_recovery_unassign_requires_reversed_inventory_issue'));
});

test('Lane F requires real PostgreSQL fulfillment mutation/read-model regression', () => {
  assert.ok(postgresFulfillment.includes('getPool(config)'));
  assert.ok(postgresFulfillment.includes('startServer({ config })'));
  assert.ok(postgresFulfillment.includes('/api/inventory/fulfillment-work'));
  assert.match(postgresFulfillment, /fulfillment-demands.*allocate/s);
  assert.match(postgresFulfillment, /fulfillment-allocations.*pick/s);
  assert.match(postgresFulfillment, /fulfillment-allocations.*pack/s);
  assert.ok(postgresFulfillment.includes('sales_order_fulfillment_allocation_events'));
  assert.ok(postgresFulfillment.includes('shared.core_audit_records'));
  assert.ok(postgresFulfillment.includes('shared.core_outbox_events'));
  assert.ok(postgresFulfillment.includes('PACK_EXCEEDS_PICKED'));
  assert.ok(postgresFulfillment.includes('PICK_EXCEEDS_ALLOCATION'));
});
