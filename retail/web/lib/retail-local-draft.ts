// Local recovery is a device-only safety net, never a source of confirmed sales,
// stock, prices or payments. No tokens, raw session or payment data are stored.
export type RetailLocalCartLine = {
  id: string;
  productCode: string;
  productName: string;
  sku: string;
  unitCode: string;
  unitName: string;
  imageKey?: string | null;
  barcode?: string | null;
  allowsFractional: boolean | null;
  quantity: string;
  taxMode: 'EXCLUSIVE' | 'INCLUSIVE';
  taxRate: string;
};

export type RetailLocalDraft = {
  version: 1;
  updatedAt: number;
  orderId: string | null;
  draftRevision: string | null;
  cart: RetailLocalCartLine[];
  warehouseId: string;
  customerMode: 'WALK_IN' | 'EXISTING';
  customerId: string;
  customerName: string;
  policy: string;
  note: string;
  manualPrices: Record<string, string>;
  documentDiscountMode: 'NONE' | 'TOTAL_AMOUNT' | 'PERCENT';
  documentDiscountValue: string;
  documentDiscountReason: string;
};

const DATABASE_NAME = 'npp-retail-device-drafts-v1';
const STORE = 'drafts';
const VERSION = 1;
const MAX_LINES = 250;
const USER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PRICE_PATTERN = /^\d{1,16}$/;
const QUANTITY_PATTERN = /^\d+(?:\.\d{1,6})?$/;

export function validRetailDraftIdentity(userId: string): boolean {
  return USER_ID_PATTERN.test(userId);
}

export function sanitizeRetailLocalDraft(source: RetailLocalDraft): RetailLocalDraft | null {
  if (!source || source.version !== VERSION || !Number.isFinite(source.updatedAt)
    || !Array.isArray(source.cart) || source.cart.length === 0 || source.cart.length > MAX_LINES
    || !['WALK_IN', 'EXISTING'].includes(source.customerMode)
    || !['NONE', 'TOTAL_AMOUNT', 'PERCENT'].includes(source.documentDiscountMode)) return null;
  const cart: RetailLocalCartLine[] = [];
  const seen = new Set<string>();
  for (const row of source.cart) {
    if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id)
      || typeof row.productName !== 'string' || !row.productName
      || !QUANTITY_PATTERN.test(String(row.quantity)) || Number(row.quantity) <= 0
      || !['EXCLUSIVE', 'INCLUSIVE'].includes(row.taxMode)
      || !QUANTITY_PATTERN.test(String(row.taxRate))) return null;
    seen.add(row.id);
    cart.push({
      id: row.id,
      productCode: String(row.productCode ?? '').slice(0, 120),
      productName: row.productName.slice(0, 200),
      sku: String(row.sku ?? '').slice(0, 120),
      unitCode: String(row.unitCode ?? '').slice(0, 60),
      unitName: String(row.unitName ?? '').slice(0, 100),
      imageKey: row.imageKey ? String(row.imageKey).slice(0, 200) : null,
      barcode: row.barcode ? String(row.barcode).slice(0, 100) : null,
      allowsFractional: row.allowsFractional === null ? null : row.allowsFractional === true,
      quantity: String(row.quantity),
      taxMode: row.taxMode,
      taxRate: String(row.taxRate),
    });
  }
  const manualPrices: Record<string, string> = {};
  for (const line of cart) {
    const price = source.manualPrices?.[line.id];
    if (price !== undefined && PRICE_PATTERN.test(String(price))) manualPrices[line.id] = String(price);
  }
  return {
    version: 1,
    updatedAt: source.updatedAt,
    orderId: typeof source.orderId === 'string' && source.orderId ? source.orderId : null,
    draftRevision: typeof source.draftRevision === 'string' && /^\d+$/.test(source.draftRevision) ? source.draftRevision : null,
    cart,
    warehouseId: String(source.warehouseId ?? '').slice(0, 128),
    customerMode: source.customerMode,
    customerId: source.customerMode === 'EXISTING' ? String(source.customerId ?? '').slice(0, 128) : '',
    customerName: source.customerMode === 'EXISTING' ? String(source.customerName ?? '').slice(0, 200) : 'Khách lẻ',
    policy: String(source.policy ?? 'COLLECT_ON_DELIVERY').slice(0, 100),
    note: String(source.note ?? '').slice(0, 1000),
    manualPrices,
    documentDiscountMode: source.documentDiscountMode,
    documentDiscountValue: String(source.documentDiscountValue ?? '0').slice(0, 40),
    documentDiscountReason: String(source.documentDiscountReason ?? '').slice(0, 500),
  };
}

function openDraftDatabase(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.reject(new Error('Thiết bị không hỗ trợ bộ nhớ giỏ hàng.'));
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Không mở được bộ nhớ giỏ hàng.'));
    request.onblocked = () => reject(new Error('Bộ nhớ giỏ hàng đang được sử dụng ở thẻ khác.'));
  });
}

function validIdentity(userId: string) {
  if (!validRetailDraftIdentity(userId)) throw new Error('Chưa xác định được tài khoản để lưu giỏ hàng.');
}

export async function readRetailLocalDraft(userId: string): Promise<RetailLocalDraft | null> {
  validIdentity(userId);
  const db = await openDraftDatabase();
  try {
    return await new Promise<RetailLocalDraft | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(userId);
      let result: RetailLocalDraft | null = null;
      request.onsuccess = () => { result = sanitizeRetailLocalDraft(request.result as RetailLocalDraft); };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('Không đọc được giỏ trên máy.'));
      tx.onabort = () => reject(tx.error ?? new Error('Không đọc được giỏ trên máy.'));
    });
  } finally {
    db.close();
  }
}

async function mutateRetailLocalDraft(userId: string, draft: RetailLocalDraft | null) {
  validIdentity(userId);
  const db = await openDraftDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (draft) {
        const safe = sanitizeRetailLocalDraft(draft);
        if (!safe) { tx.abort(); reject(new Error('Giỏ hàng trên máy không hợp lệ.')); return; }
        tx.objectStore(STORE).put(safe, userId);
      } else {
        tx.objectStore(STORE).delete(userId);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Không lưu được giỏ trên máy.'));
      tx.onabort = () => reject(tx.error ?? new Error('Không lưu được giỏ trên máy.'));
    });
  } finally {
    db.close();
  }
}

export function writeRetailLocalDraft(userId: string, draft: RetailLocalDraft) {
  return mutateRetailLocalDraft(userId, draft);
}

export function clearRetailLocalDraft(userId: string) {
  return mutateRetailLocalDraft(userId, null);
}
