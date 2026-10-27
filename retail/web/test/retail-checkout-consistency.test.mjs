import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkoutLinesMatch, draftMatchesRetailContext, projectedRetailDraftTotal } from '../lib/retail-order-consistency.mjs';

const a = { variantId: 'a', quantity: '1.000000', taxMode: 'EXCLUSIVE', taxRate: '0.000000', priceSource: 'PRICE_ENGINE', unitPrice: '10000.000000' };
const b = { variantId: 'b', quantity: '2.000000', taxMode: 'EXCLUSIVE', taxRate: '0', priceSource: 'PRICE_ENGINE', unitPrice: '3000' };
const c = { variantId: 'c', quantity: '1', taxMode: 'EXCLUSIVE', taxRate: '0', priceSource: 'MANUAL_OVERRIDE', unitPrice: '0.000000' };
const cart = [a, b, c].map(({ variantId: id, quantity, taxMode, taxRate }) => ({ id, quantity, taxMode, taxRate }));

test('three different products must all exist in saved draft before checkout or print', () => {
  assert.equal(checkoutLinesMatch([a, b, c], cart, { c: '0' }), true);
  assert.equal(checkoutLinesMatch([a, b], cart, { c: '0' }), false);
  assert.equal(checkoutLinesMatch([a, b, b], cart, { c: '0' }), false);
  assert.equal(checkoutLinesMatch([a, b, { ...c, variantId: 'unknown' }], cart, { c: '0' }), false);
  assert.equal(checkoutLinesMatch([a, { ...b, quantity: '1' }, c], cart, { c: '0' }), false);
  assert.equal(checkoutLinesMatch([a, b, { ...c, unitPrice: '10000', priceSource: 'PRICE_ENGINE' }], cart, { c: '0' }), false);
  assert.equal(checkoutLinesMatch([a, b, c], cart.map((line) => ({ ...line, quantity: line.id === 'a' ? '2' : line.quantity })), { c: '0' }), false);
  assert.equal(checkoutLinesMatch([a, b, c], cart.map((line) => ({ ...line, taxRate: line.id === 'b' ? '8' : line.taxRate })), { c: '0' }), false);
  assert.equal(checkoutLinesMatch([c, a, b], cart, { c: '0' }), true);
});
test('checkout draft is not trusted if customer, warehouse or discount context moved', () => {
  const context = { status: 'draft', warehouseId: 'w', customerMode: 'WALK_IN', customerId: 'walk-in', documentDiscountMode: 'NONE', documentDiscountValue: '0' };
  assert.equal(draftMatchesRetailContext(context, context), true);
  assert.equal(draftMatchesRetailContext({ ...context, warehouseId: 'other' }, context), false);
  assert.equal(draftMatchesRetailContext({ ...context, status: 'confirmed' }, context), false);
  // Walk-in orders use the canonical Company walk-in customer, not the UI's
  // intentionally empty customerId. Only named customers match by ID.
  assert.equal(draftMatchesRetailContext({ ...context, customerId: 'other' }, context), true);
  const named = { ...context, customerMode: 'EXISTING', customerId: 'c1' };
  assert.equal(draftMatchesRetailContext(named, named), true);
  assert.equal(draftMatchesRetailContext({ ...named, customerId: 'c2' }, named), false);
  assert.equal(draftMatchesRetailContext({ ...context, documentDiscountMode: 'PERCENT', documentDiscountValue: '5' }, context), false);
  const changed = { ...context, documentDiscountMode: 'PERCENT', documentDiscountValue: '5' };
  assert.equal(draftMatchesRetailContext(changed, changed), true);
  assert.equal(draftMatchesRetailContext({ ...changed, documentDiscountValue: '10' }, changed), false);
});
test('preview total reflects document discount while autosave is pending', () => {
  assert.equal(projectedRetailDraftTotal(120000, 'NONE', '0'), 120000);
  assert.equal(projectedRetailDraftTotal(120000, 'PERCENT', '10'), 108000);
  assert.equal(projectedRetailDraftTotal(120000, 'TOTAL_AMOUNT', '10000'), 110000);
  assert.equal(projectedRetailDraftTotal(120000, 'TOTAL_AMOUNT', '99999999'), 0);
  assert.equal(projectedRetailDraftTotal(120000, 'PERCENT', '999'), 0);
});
test('Retail gateway restores discount from the canonical current version', async () => {
  const gateway = await readFile(new URL('../app/api/retail/[...segments]/route.ts', import.meta.url), 'utf8');
  assert.match(gateway, /documentDiscountMode: String\(current.documentDiscountMode/);
  assert.match(gateway, /documentDiscountValue: String\(current.documentDiscountValue/);
  assert.match(gateway, /documentDiscountReason: current.documentDiscountReason/);
});
test('Retail only posts a saved revision under canonical confirmation lock', async () => {
  const [route, gateway, legacy] = await Promise.all([
    readFile(new URL('../app/api/retail/[...segments]/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../npp-core/api/src/routes/sales-orders.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../npp-core/api/src/services/sales-order-legacy.js', import.meta.url), 'utf8'),
  ]);
  assert.match(route, /confirm: \{ path: .*body: payload \}/);
  assert.match(gateway, /expectedRevision: payload.expectedRevision \?\? null/);
  assert.match(legacy, /String\(loaded.order.revision\) !== expected/);
  assert.match(legacy, /forUpdate: true/);
});

test('Retail coalesces stale autosaves, checks all saved lines and never confirms old drafts', async () => {
  const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /lastDraftFingerprint.current === currentDraftFingerprint/);
  assert.match(workspace, /draftSyncInFlight.current === null/);
  assert.match(workspace, /isSavedCartCurrent\(order\)/);
  assert.match(workspace, /if \(!isSavedCartCurrent\(next\)\)/);
  assert.match(workspace, /entrySessionRef.current !== entrySession/);
  assert.match(workspace, /latest.revision !== current.revision \|\| !isSavedCartCurrent\(latest\)/);
  assert.match(workspace, /body: JSON.stringify\(\{ expectedRevision: latest.revision \}\)/);
  assert.match(workspace, /checkoutLockRef.current = true/);
  assert.match(workspace, /checkoutLockRef.current = false/);
  assert.match(workspace, /setCheckoutStage\('Đang xuất kho…'\)/);
  assert.match(workspace, /setDraftSaveError/);
});
test('Retail has bounded errors, explicit retries, and canonical print before opening receipt', async () => {
  const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /setAvailabilityError\(errorMessage\(/);
  assert.match(workspace, /availabilityRetryEpoch/);
  assert.match(workspace, /priceRetryEpoch/);
  assert.match(workspace, /Thử lại tồn kho/);
  assert.match(workspace, /Thử lại giá bán/);
  assert.match(workspace, /Thử lưu lại/);
  assert.match(workspace, /const latest = await api<Order>\(`\/api\/retail\/orders\/\$\{order.id\}`\);/);
  assert.match(workspace, /await prepareOrderPrint\(latest\)/);
});

test('price preview outage does not block a valid authorized manual zero', async () => {
  const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /priceFailures\[line.id\]\?\.code === 'PRICE_PREVIEW_FAILED'[\s\S]*?!\/\^\\d\+\$\/\.test\(canPriceOverride \? manualPriceFor/);
});
test('receipt refuses a missing current version instead of silently printing an old version', async () => {
  const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /currentVersion = sourceOrder.versions\?\.find/);
  assert.match(workspace, /Không có dòng hàng của phiên bản đơn đã lưu/);
});

test('Retail preserves identical idempotency key on settlement retry after an uncertain timeout', async () => {
  const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /operationKeyFor\('settlement', paymentIntent\)/);
  assert.match(workspace, /forgetOperationKey\('settlement', paymentIntent\)/);
  assert.match(workspace, /afterRemaining < beforeRemaining/);
  assert.doesNotMatch(workspace, /keyFor\('settlement',/);
});
test('Retail does not automatically overwrite a canonical draft when a save or checkout conflicts', async () => {
  const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /if \(!cart.length \|\| !warehouseId \|\| editPickup \|\| draftSaveError/);
  assert.match(workspace, /if \(latest.status === 'draft' && !isSavedCartCurrent\(latest\)\)/);
  assert.match(workspace, /setDraftSaveError\('Dữ liệu đơn đã thay đổi/);
});

test('Retail product picker treats transport failures as retryable, not as missing Company base price', async () => {
  const page = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  assert.match(page, /pickerPricePreviewFailed/);
  assert.match(page, /priceFailure.code !== 'PRICE_PREVIEW_FAILED'/);
  assert.match(page, /Thử lại giá sản phẩm/);
  assert.match(page, /Không tải được giá/);
  assert.match(page, /setAvailabilityError\(null\)/);
});

test('a definitive checkout confirmation conflict rotates its old revision-bound key; ambiguous timeout does not', async () => {
  const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /let confirmationInFlight = false/);
  assert.match(workspace, /confirmationInFlight = true/);
  assert.match(workspace, /confirmationInFlight = false/);
  assert.match(workspace, /if \(confirmationInFlight && \(isRevisionConflict\(reason\)/);
  assert.match(workspace, /reason\.status >= 400 && reason\.status < 500/);
  assert.match(workspace, /forgetOperationKey\('checkout-confirm', 'current-order'\)/);
  assert.match(workspace, /order.status === 'draft' && \(!syncedDraft \|\| Boolean\(draftSaveError\)\)/);
});
