import { sanitizeRetailLocalDraft, validRetailDraftIdentity, type RetailLocalDraft } from './retail-local-draft.ts';

// The Company's idempotency scope is installation + actor + HTTP method +
// canonical route. Never rotate the key or change the JSON body on replay.
export type RetailDraftIntent = {
  version: 1;
  kind: 'create' | 'update';
  orderId: string | null;
  expectedDraftRevision: string | null;
  idempotencyKey: string;
  fingerprint: string;
  payloadJson: string;
  snapshot: RetailLocalDraft;
  createdAt: number;
  attempts: number;
  retryAfter: number;
  state: 'pending' | 'review';
  reviewReason?: 'rejected' | null;
};

const DATABASE = 'npp-retail-draft-outbox-v1';
const STORE = 'pending';
const VERSION = 1;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function retailDraftRetryDelay(attempts: number): number {
  return Math.min(120_000, 2_000 * 2 ** Math.min(6, Math.max(0, attempts - 1)));
}

export function validRetailDraftIntent(value: unknown): value is RetailDraftIntent {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<RetailDraftIntent>;
  if (row.version !== 1 || !['create', 'update'].includes(row.kind ?? '')
    || !IDEMPOTENCY_PATTERN.test(String(row.idempotencyKey ?? ''))
    || typeof row.fingerprint !== 'string' || row.fingerprint.length > 20_000
    || typeof row.payloadJson !== 'string' || row.payloadJson.length > 100_000
    || !Number.isFinite(row.createdAt) || !Number.isInteger(row.attempts) || (row.attempts ?? -1) < 0
    || !Number.isFinite(row.retryAfter) || !['pending', 'review'].includes(row.state ?? '')) return false;
  if (row.reviewReason !== undefined && row.reviewReason !== null && row.reviewReason !== 'rejected') return false;
  if (row.kind === 'create' && (row.orderId !== null || row.expectedDraftRevision !== null)) return false;
  if (row.kind === 'update' && (!ORDER_ID_PATTERN.test(String(row.orderId ?? ''))
    || !/^\d+$/.test(String(row.expectedDraftRevision ?? '')))) return false;
  const snapshot = sanitizeRetailLocalDraft(row.snapshot as RetailLocalDraft);
  if (!snapshot || snapshot.orderId !== row.orderId) return false;
  try {
    const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object' || payload.sourceType !== 'MANUAL'
      || payload.deliveryMode !== 'PICKUP' || !Array.isArray(payload.lines)
      || payload.lines.length !== snapshot.cart.length) return false;
    if (row.kind === 'update' && String(payload.expectedRevision) !== row.expectedDraftRevision) return false;
    if (row.kind === 'create' && Object.hasOwn(payload, 'expectedRevision')) return false;
    const quantities = new Map(snapshot.cart.map((line) => [line.id, line.quantity]));
    for (const line of payload.lines) {
      if (!line || typeof line !== 'object') return false;
      const item = line as { variantId?: string; quantity?: string };
      if (!item.variantId || !quantities.has(item.variantId)
        || String(item.quantity) !== quantities.get(item.variantId)) return false;
      quantities.delete(item.variantId);
    }
    return quantities.size === 0;
  } catch {
    return false;
  }
}

function database(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB)
    return Promise.reject(new Error('IndexedDB không có sẵn; chưa thể giữ thao tác đồng bộ.'));
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Không mở được hàng đợi đồng bộ.'));
    request.onblocked = () => reject(new Error('Hàng đợi đồng bộ đang mở ở thẻ khác.'));
  });
}

function assertIdentity(userId: string) {
  if (!validRetailDraftIdentity(userId)) throw new Error('Tài khoản đồng bộ chưa được xác minh.');
}

export async function readRetailDraftIntent(userId: string): Promise<RetailDraftIntent | null> {
  assertIdentity(userId);
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(userId);
      let stored: RetailDraftIntent | null = null;
      request.onsuccess = () => {
        if (request.result && !validRetailDraftIntent(request.result)) {
          tx.abort();
          reject(new Error('Hàng đợi đồng bộ bị hỏng. Không được tạo thao tác mới.'));
          return;
        }
        stored = request.result ?? null;
      };
      tx.oncomplete = () => resolve(stored);
      tx.onerror = () => reject(tx.error ?? new Error('Không đọc được hàng đợi đồng bộ.'));
      tx.onabort = () => reject(tx.error ?? new Error('Không đọc được hàng đợi đồng bộ.'));
    });
  } finally { db.close(); }
}

// Only one outstanding draft write per operator. The first key + body are
// immutable until the Company result has been verified and acknowledged.
export async function enqueueRetailDraftIntent(userId: string, next: RetailDraftIntent): Promise<RetailDraftIntent> {
  assertIdentity(userId);
  if (!validRetailDraftIntent(next)) throw new Error('Thao tác đồng bộ không hợp lệ.');
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let selected = next;
      store.get(userId).onsuccess = (event) => {
        const current = (event.target as IDBRequest).result as RetailDraftIntent | undefined;
        if (current) {
          if (!validRetailDraftIntent(current)) {
            tx.abort(); reject(new Error('Hàng đợi đồng bộ bị hỏng; cần đối chiếu thủ công.')); return;
          }
          if (current.idempotencyKey !== next.idempotencyKey || current.payloadJson !== next.payloadJson
            || current.orderId !== next.orderId || current.kind !== next.kind) {
            tx.abort(); reject(new Error('Còn thao tác cũ chưa xác minh; không được ghi đè hàng đợi.')); return;
          }
          selected = current;
        } else {
          store.put(next, userId);
        }
      };
      tx.oncomplete = () => resolve(selected);
      tx.onerror = () => reject(tx.error ?? new Error('Không lưu được thao tác đồng bộ.'));
      tx.onabort = () => reject(tx.error ?? new Error('Không lưu được thao tác đồng bộ.'));
    });
  } finally { db.close(); }
}

export async function updateRetailDraftIntent(
  userId: string, key: string, change: 'retry' | 'review' | 'reject' | 'ack' | 'discard',
): Promise<RetailDraftIntent | null> {
  assertIdentity(userId);
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let result: RetailDraftIntent | null = null;
      store.get(userId).onsuccess = (event) => {
        const current = (event.target as IDBRequest).result as RetailDraftIntent | undefined;
        if (!current || current.idempotencyKey !== key) return;
        if (!validRetailDraftIntent(current)) {
          tx.abort(); reject(new Error('Hàng đợi đồng bộ bị hỏng.')); return;
        }
        if (change === 'ack' || change === 'discard') {
          store.delete(userId);
          return;
        }
        const attempts = current.attempts + (change === 'retry' ? 1 : 0);
        result = { ...current, attempts,
          retryAfter: change === 'retry' ? Date.now() + retailDraftRetryDelay(attempts) : 0,
          state: change === 'review' || change === 'reject' ? 'review' : current.state,
          reviewReason: change === 'reject' ? 'rejected' : current.reviewReason ?? null };
        store.put(result, userId);
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('Không cập nhật được hàng đợi đồng bộ.'));
      tx.onabort = () => reject(tx.error ?? new Error('Không cập nhật được hàng đợi đồng bộ.'));
    });
  } finally { db.close(); }
}
