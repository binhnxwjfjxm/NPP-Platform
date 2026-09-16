export type RetailCachedProduct = {
  id: string;
  productCode: string;
  imageKey?: string | null;
  productName: string;
  sku: string;
  barcode?: string | null;
  unitCode: string;
  allowsFractional: boolean | null;
};

type CacheMeta = {
  key: 'catalog';
  refreshedAt: number;
};

const DB_NAME = 'npp-retail-catalog';
const DB_VERSION = 1;
const PRODUCT_STORE = 'products';
const META_STORE = 'meta';
const CACHE_META_KEY = 'catalog';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function indexedDbAvailable() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!indexedDbAvailable()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
        const store = db.createObjectStore(PRODUCT_STORE, { keyPath: 'id' });
        store.createIndex('sku', 'sku', { unique: false });
        store.createIndex('productName', 'productName', { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Không mở được bộ nhớ sản phẩm.'));
  });
}

function normalize(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .trim();
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Không lưu được bộ nhớ sản phẩm.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Không lưu được bộ nhớ sản phẩm.'));
  });
}

export async function cacheRetailProducts(products: RetailCachedProduct[]) {
  if (!products.length) return;
  const db = await openDatabase();
  if (!db) return;
  try {
    const transaction = db.transaction(PRODUCT_STORE, 'readwrite');
    const store = transaction.objectStore(PRODUCT_STORE);
    for (const product of products) store.put(product);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function replaceRetailProductCache(products: RetailCachedProduct[]) {
  const db = await openDatabase();
  if (!db) return;
  try {
    const transaction = db.transaction([PRODUCT_STORE, META_STORE], 'readwrite');
    const productStore = transaction.objectStore(PRODUCT_STORE);
    productStore.clear();
    for (const product of products) productStore.put(product);
    transaction.objectStore(META_STORE).put({ key: CACHE_META_KEY, refreshedAt: Date.now() } satisfies CacheMeta);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function findCachedRetailProducts(search: string, limit: number, offset = 0) {
  const db = await openDatabase();
  if (!db) return [] as RetailCachedProduct[];
  try {
    const products = await new Promise<RetailCachedProduct[]>((resolve, reject) => {
      const transaction = db.transaction(PRODUCT_STORE, 'readonly');
      const request = transaction.objectStore(PRODUCT_STORE).getAll();
      request.onsuccess = () => resolve((request.result ?? []) as RetailCachedProduct[]);
      request.onerror = () => reject(request.error ?? new Error('Không đọc được bộ nhớ sản phẩm.'));
    });
    const query = normalize(search);
    const ranked = products
      .map((product) => {
        const sku = normalize(product.sku);
        const barcode = normalize(product.barcode);
        const name = normalize(product.productName);
        const code = normalize(product.productCode);
        if (!query) return { product, rank: 4 };
        if (sku === query || barcode === query) return { product, rank: 0 };
        if (sku.startsWith(query) || barcode.startsWith(query)) return { product, rank: 1 };
        if (name.startsWith(query) || code.startsWith(query)) return { product, rank: 2 };
        if (sku.includes(query) || barcode.includes(query) || name.includes(query) || code.includes(query)) return { product, rank: 3 };
        return null;
      })
      .filter((row): row is { product: RetailCachedProduct; rank: number } => row !== null)
      .sort((left, right) => left.rank - right.rank || left.product.productName.localeCompare(right.product.productName, 'vi'));
    return ranked.slice(offset, offset + limit).map((row) => row.product);
  } finally {
    db.close();
  }
}

export async function retailProductCacheIsFresh() {
  const db = await openDatabase();
  if (!db) return false;
  try {
    const meta = await new Promise<CacheMeta | undefined>((resolve, reject) => {
      const transaction = db.transaction(META_STORE, 'readonly');
      const request = transaction.objectStore(META_STORE).get(CACHE_META_KEY);
      request.onsuccess = () => resolve(request.result as CacheMeta | undefined);
      request.onerror = () => reject(request.error ?? new Error('Không đọc được trạng thái bộ nhớ sản phẩm.'));
    });
    return Boolean(meta?.refreshedAt && Date.now() - meta.refreshedAt < CACHE_TTL_MS);
  } finally {
    db.close();
  }
}
