import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validRetailDraftIntent, retailDraftRetryDelay,
  enqueueRetailDraftIntent, readRetailDraftIntent, updateRetailDraftIntent,
} from '../lib/retail-draft-outbox.ts';

const uuid = '11111111-1111-4111-8111-111111111111';
const localSnapshot = (orderId = null, revision = null) => ({
  version: 1, updatedAt: Date.now(), orderId, draftRevision: revision,
  cart: [{ id: 'sku-A', productCode: 'A', productName: 'Sản phẩm A', sku: 'A', unitCode: 'BOX', unitName: 'Hộp',
    quantity: '2', taxMode: 'EXCLUSIVE', taxRate: '0', allowsFractional: false }],
  warehouseId: 'warehouse', customerMode: 'WALK_IN', customerId: '', customerName: 'Khách lẻ',
  policy: 'COLLECT_ON_DELIVERY', note: '', manualPrices: {}, documentDiscountMode: 'NONE',
  documentDiscountValue: '0', documentDiscountReason: '',
});
const newIntent = (kind = 'create', fingerprint = 'cart:A:2') => {
  const orderId = kind === 'update' ? uuid : null;
  const expectedDraftRevision = kind === 'update' ? '4' : null;
  return {
    version: 1, kind, orderId, expectedDraftRevision,
    idempotencyKey: 'retail-create_0123.AbC-XYZ', fingerprint,
    payloadJson: JSON.stringify({
      sourceType: 'MANUAL', deliveryMode: 'PICKUP', currency: 'VND',
      collectionPolicy: 'COLLECT_ON_DELIVERY', documentDiscountMode: 'NONE',
      documentDiscountValue: '0', warehouseId: 'warehouse', customerMode: 'WALK_IN',
      ...(expectedDraftRevision ? { expectedRevision: expectedDraftRevision } : {}),
      lines: [{ variantId: 'sku-A', quantity: '2', taxMode: 'EXCLUSIVE', taxRate: '0' }],
    }),
    snapshot: localSnapshot(orderId, expectedDraftRevision), createdAt: Date.now(),
    attempts: 0, retryAfter: 0, state: 'pending',
  };
};

function fakeIndexedDb() {
  const databases = new Map();
  return {
    open(name) {
      const openRequest = { result: null };
      queueMicrotask(() => {
        let db = databases.get(name);
        const fresh = !db;
        if (!db) {
          const stores = new Map();
          db = {
            objectStoreNames: { contains: (name) => stores.has(name) },
            createObjectStore: (name) => stores.set(name, new Map()),
            close() {},
            transaction(name) {
              const map = stores.get(name);
              let aborted = false;
              const tx = {
                oncomplete: null, onerror: null, onabort: null,
                abort() { aborted = true; queueMicrotask(() => this.onabort?.()); },
                objectStore() {
                  return {
                    get(key) {
                      const req = { result: undefined, onsuccess: null };
                      queueMicrotask(() => {
                        req.result = structuredClone(map.get(key));
                        req.onsuccess?.({ target: req });
                        queueMicrotask(() => { if (!aborted) tx.oncomplete?.(); });
                      });
                      return req;
                    },
                    put(value, key) { if (!aborted) map.set(key, structuredClone(value)); },
                    delete(key) { if (!aborted) map.delete(key); },
                  };
                },
              };
              return tx;
            },
          };
          databases.set(name, db);
        }
        openRequest.result = db;
        if (fresh) openRequest.onupgradeneeded?.();
        openRequest.onsuccess?.();
      });
      return openRequest;
    },
  };
}

test('hàng đợi chỉ nhận yêu cầu lưu bản nháp có khóa và payload canonical', () => {
  assert.equal(validRetailDraftIntent(newIntent()), true);
  assert.equal(validRetailDraftIntent(newIntent('update')), true);
  assert.equal(validRetailDraftIntent({ ...newIntent(), idempotencyKey: 'unsafe:key' }), false);
  assert.equal(validRetailDraftIntent({ ...newIntent(), payloadJson: '{"sourceType":"MANUAL","lines":[]}' }), false);
  assert.equal(validRetailDraftIntent({ ...newIntent('update'), expectedDraftRevision: '5' }), false);
  assert.equal(validRetailDraftIntent({ ...newIntent(), payloadJson: newIntent().payloadJson.replace('warehouse', 'other-warehouse') }), false);
  assert.equal(validRetailDraftIntent({ ...newIntent(), payloadJson: newIntent().payloadJson.replace('"EXCLUSIVE"', '"INCLUSIVE"') }), false);
  assert.equal(validRetailDraftIntent({ ...newIntent(), payloadJson: newIntent().payloadJson.replace('"NONE"', '"PERCENT"') }), false);
  assert.equal(validRetailDraftIntent({ ...newIntent(), snapshot: { ...localSnapshot(), cart: [] } }), false);
  assert.equal(retailDraftRetryDelay(1), 2000);
  assert.equal(retailDraftRetryDelay(4), 16000);
  assert.equal(retailDraftRetryDelay(20), 120000);
});

test('sau mất kết nối/reload, khóa và body giữ nguyên; không ghi đè thao tác chưa xác minh', async () => {
  globalThis.window = { indexedDB: fakeIndexedDb() };
  const original = newIntent();
  const saved = await enqueueRetailDraftIntent('operator-1', original);
  assert.equal(saved.idempotencyKey, original.idempotencyKey);
  assert.deepEqual(await readRetailDraftIntent('operator-1'), original);
  // Same write may be retried, but must keep identical key + JSON body.
  assert.equal((await enqueueRetailDraftIntent('operator-1', original)).payloadJson, original.payloadJson);
  await assert.rejects(enqueueRetailDraftIntent('operator-1', { ...original,
    idempotencyKey: 'retail-different' }), /chưa xác minh/);
  await assert.rejects(enqueueRetailDraftIntent('operator-1', { ...original,
    payloadJson: original.payloadJson.replace('"2"', '"3"') }), /không hợp lệ|chưa xác minh/);
  assert.deepEqual(await readRetailDraftIntent('operator-1'), original);
  assert.equal(await readRetailDraftIntent('operator-2'), null);
  delete globalThis.window;
});

test('retry backoff, review và ACK chỉ tác động đúng khóa của user đang đăng nhập', async () => {
  globalThis.window = { indexedDB: fakeIndexedDb() };
  const intent = newIntent('update');
  await enqueueRetailDraftIntent('operator-1', intent);
  await enqueueRetailDraftIntent('operator-2', newIntent());
  assert.equal(await updateRetailDraftIntent('operator-1', 'wrong-key', 'ack'), null);
  assert.notEqual(await readRetailDraftIntent('operator-1'), null);
  const retry = await updateRetailDraftIntent('operator-1', intent.idempotencyKey, 'retry');
  assert.equal(retry.attempts, 1);
  assert.ok(retry.retryAfter > Date.now());
  const review = await updateRetailDraftIntent('operator-1', intent.idempotencyKey, 'review');
  assert.equal(review.state, 'review');
  assert.equal(review.idempotencyKey, intent.idempotencyKey);
  assert.equal(review.payloadJson, intent.payloadJson);
  const rejected = await updateRetailDraftIntent('operator-1', intent.idempotencyKey, 'reject');
  assert.equal(rejected.state, 'review');
  assert.equal(rejected.reviewReason, 'rejected');
  assert.equal(rejected.payloadJson, intent.payloadJson);
  await updateRetailDraftIntent('operator-1', intent.idempotencyKey, 'ack');
  assert.equal(await readRetailDraftIntent('operator-1'), null);
  assert.ok(await readRetailDraftIntent('operator-2'));
  delete globalThis.window;
});

test('không tự chốt, ghi đè revision hoặc xoá key trước khi ACK Công Ty', async () => {
  const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  const outbox = await readFile(new URL('../lib/retail-draft-outbox.ts', import.meta.url), 'utf8');
  assert.match(workspace, /await enqueueRetailDraftIntent\(deviceDraftUserId, intent\)/);
  assert.match(workspace, /payloadJson, snapshot, createdAt/);
  assert.match(workspace, /updateRetailDraftIntent\(deviceDraftUserId!, intent.idempotencyKey, 'ack'\)/);
  assert.match(workspace, /if \(latest.status !== 'draft' \|\| activeDraftRevision\(latest\) !== intent.expectedDraftRevision\)/);
  assert.match(workspace, /body: intent.payloadJson/);
  assert.match(workspace, /'Idempotency-Key': intent.idempotencyKey/);
  assert.match(workspace, /window.addEventListener\('online', tryAgain\)/);
  assert.match(workspace, /if \(draftOutboxRef.current\) \{/);
  assert.match(workspace, /async function resolveDraftReview\(keepLocal: boolean\)/);
  assert.match(workspace, /function forgetAbandonedDraftKey\(intent: RetailDraftIntent\)/);
  assert.match(workspace, /if \(key === intent.idempotencyKey\) keys.current.delete\(slot\)/);
  assert.match(workspace, /async function discardRejectedCreateIntent\(\)/);
  assert.match(workspace, /Đơn Công Ty không còn là nháp. Giữ trạng thái Công Ty/);
  assert.match(workspace, /Đã giữ trạng thái Công Ty, không gửi lại thao tác nháp cũ/);
  assert.match(workspace, /Đơn vẫn đang chờ đồng bộ Công Ty/);
  assert.match(outbox, /current.idempotencyKey !== next.idempotencyKey \|\| current.payloadJson !== next.payloadJson/);
  assert.doesNotMatch(outbox, /localStorage|sessionStorage|Authorization|DATABASE_URL/);
});

test('không hủy/chốt/xuất kho khi hàng đợi ghi nháp chưa xác minh', async () => {
  const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  const dialog = workspace.slice(workspace.indexOf('function openCancelDialog()'), workspace.indexOf('function closeCancelDialog()'));
  const cancel = workspace.slice(workspace.indexOf('async function cancelOrder()'), workspace.indexOf('async function settle('));
  const lifecycle = workspace.slice(workspace.indexOf("async function action(kind: 'confirm'"), workspace.indexOf('function openCancelDialog()'));
  assert.match(dialog, /if \(draftOutboxRef\.current \|\| deviceDraftHold\)/);
  assert.match(cancel, /if \(draftOutboxRef\.current \|\| deviceDraftHold \|\| draftSyncInFlight\.current !== null\)/);
  assert.match(lifecycle, /if \(draftOutboxRef\.current \|\| deviceDraftHold\)/);
});
