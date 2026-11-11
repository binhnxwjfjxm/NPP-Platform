import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  sanitizeRetailLocalDraft,
  validRetailDraftIdentity,
  writeRetailLocalDraft,
  readRetailLocalDraft,
  clearRetailLocalDraft,
} from '../lib/retail-local-draft.ts';

const example = () => ({
  version: 1,
  updatedAt: Date.now(),
  orderId: null,
  draftRevision: null,
  cart: [{
    id: 'variant-1', productCode: 'A', productName: 'Hàng thử', sku: 'A-1',
    unitCode: 'BOX', unitName: 'Hộp', allowsFractional: false,
    quantity: '2', taxMode: 'EXCLUSIVE', taxRate: '0',
  }],
  warehouseId: 'warehouse-1',
  customerMode: 'WALK_IN',
  customerId: '',
  customerName: 'Khách lẻ',
  policy: 'COLLECT_ON_DELIVERY',
  note: 'Giao trong ngày',
  manualPrices: { 'variant-1': '30000', other: '123' },
  documentDiscountMode: 'NONE',
  documentDiscountValue: '0',
  documentDiscountReason: '',
});

function memoryIndexedDb() {
  const databases = new Map();
  return {
    open(name) {
      const request = { result: null };
      queueMicrotask(() => {
        let db = databases.get(name);
        const newDatabase = !db;
        if (!db) {
          const stores = new Map();
          db = {
            objectStoreNames: { contains: (store) => stores.has(store) },
            createObjectStore: (store) => { stores.set(store, new Map()); },
            transaction: (storeName) => {
              const store = stores.get(storeName);
              const tx = {
                oncomplete: null, onabort: null, onerror: null, error: null,
                abort() { queueMicrotask(() => this.onabort?.()); },
                objectStore() {
                  return {
                    get(key) {
                      const read = { result: undefined, onsuccess: null };
                      queueMicrotask(() => {
                        read.result = store.get(key);
                        read.onsuccess?.();
                        tx.oncomplete?.();
                      });
                      return read;
                    },
                    put(value, key) {
                      queueMicrotask(() => { store.set(key, structuredClone(value)); tx.oncomplete?.(); });
                    },
                    delete(key) {
                      queueMicrotask(() => { store.delete(key); tx.oncomplete?.(); });
                    },
                  };
                },
              };
              return tx;
            },
            close() {},
          };
          databases.set(name, db);
        }
        request.result = db;
        if (newDatabase) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

test('IndexedDB giữ bản nháp riêng theo tài khoản và chỉ xóa bản của tài khoản đăng xuất', async () => {
  globalThis.window = { indexedDB: memoryIndexedDb() };
  await writeRetailLocalDraft('user-a', example());
  await writeRetailLocalDraft('user-b', { ...example(), cart: [{ ...example().cart[0], id: 'variant-2' }] });
  assert.equal((await readRetailLocalDraft('user-a')).cart[0].id, 'variant-1');
  assert.equal((await readRetailLocalDraft('user-b')).cart[0].id, 'variant-2');
  await clearRetailLocalDraft('user-a');
  assert.equal(await readRetailLocalDraft('user-a'), null);
  assert.equal((await readRetailLocalDraft('user-b')).cart[0].id, 'variant-2');
  delete globalThis.window;
});

test('không nhận giỏ hỏng, phiên bản sai, số lượng xấu hoặc dữ liệu giả mạo giá', () => {
  assert.equal(sanitizeRetailLocalDraft({ ...example(), version: 99 }), null);
  assert.equal(sanitizeRetailLocalDraft({ ...example(), cart: [] }), null);
  assert.equal(sanitizeRetailLocalDraft({ ...example(), cart: [{ ...example().cart[0], quantity: '-2' }] }), null);
  assert.equal(sanitizeRetailLocalDraft({ ...example(), cart: [example().cart[0], example().cart[0]] }), null);
  const recovered = sanitizeRetailLocalDraft(example());
  assert.deepEqual(recovered.manualPrices, { 'variant-1': '30000' });
  assert.equal(validRetailDraftIdentity('user-1'), true);
  assert.equal(validRetailDraftIdentity(''), false);
  assert.equal(validRetailDraftIdentity('bad/other'), false);
});

test('khôi phục không được tự tạo/chốt đơn; chỉ đánh dấu đã lưu trên máy khi IndexedDB xác nhận', async () => {
  const workspace = await readFile(new URL('../app/retail-workspace.tsx', import.meta.url), 'utf8');
  const store = await readFile(new URL('../lib/retail-local-draft.ts', import.meta.url), 'utf8');
  assert.match(workspace, /fetch\('\/api\/auth\/me'/);
  assert.match(workspace, /if \(!validRetailDraftIdentity\(userId\)\)/);
  assert.match(workspace, /setDeviceDraftOffer\(saved\)/);
  assert.match(workspace, /function restoreDeviceDraft\(\)/);
  assert.match(workspace, /setDeviceDraftHold\(\{ orderId: saved\.orderId, draftRevision: saved\.draftRevision \}\)/);
  assert.match(workspace, /if \(deviceDraftOffer \|\| deviceDraftHold \|\| !cart\.length/);
  assert.match(workspace, /async function reconcileDeviceDraft\(\)/);
  assert.match(workspace, /if \(revision !== held\.draftRevision && !window\.confirm/);
  assert.match(workspace, /Giỏ khôi phục đang chờ đối chiếu Công Ty/);
  assert.match(workspace, /deviceDraftWriteQueue\.current = deviceDraftWriteQueue\.current\.catch/);
  assert.match(workspace, /setDeviceDraftStatus\(snapshot \? 'saved' : 'none'\)/);
  assert.match(workspace, /await clearRetailLocalDraft\(deviceDraftUserId\)/);
  assert.match(workspace, /function canLeaveLocalDraft\(\)/);
  assert.match(workspace, /Đăng xuất sẽ xóa giỏ chưa xác nhận trên Công Ty/);
  assert.match(store, /tx\.oncomplete = \(\) => resolve\(\)/);
  assert.doesNotMatch(store.slice(store.indexOf('export type RetailLocalDraft'), store.indexOf('const DATABASE_NAME')), /token|paymentMethod|password|sessionCookie|Authorization/i);
});
