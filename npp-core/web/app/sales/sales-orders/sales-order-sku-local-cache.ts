import type { SalesOrderSkuSearchOption } from '../../../lib/sales-order-types';

type SalesOrderSkuCatalogRow = Omit<SalesOrderSkuSearchOption, 'pricePreview' | 'inventoryPreview'>;

type CatalogRecord = Readonly<{
  savedAt: number;
  rows: SalesOrderSkuCatalogRow[];
}>;

type SkuSearchRequest = Readonly<{
  term: string;
  limit: number;
  offset: number;
}>;

const CACHE_DB_NAME = 'npp-company-sales-local-cache-v1';
const CACHE_STORE = 'sales';
const CACHE_KEY = 'sales-order-sku-catalog-v1';
const CATALOG_PAGE_SIZE = 50;
const CATALOG_BATCH_PAGES = 4;
const MAX_CATALOG_ROWS = 5000;
const CATALOG_REFRESH_MS = 60_000;
const CATALOG_RETRY_BACKOFF_MS = 30_000;

let memoryRows: SalesOrderSkuCatalogRow[] | null = null;
let memorySavedAt = 0;
let persistedLoaded = false;
let persistedLoadPromise: Promise<void> | null = null;
let warmPromise: Promise<void> | null = null;
let lastWarmAttemptAt = 0;

function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function rowSearchFields(row: SalesOrderSkuCatalogRow): string[] {
  return [row.sku, row.variantName, row.productCode, row.productName, row.barcode]
    .filter((value): value is string => Boolean(value))
    .map(normalizeSearchText);
}

function searchRank(row: SalesOrderSkuCatalogRow, rawTerm: string, normalizedTerm: string): number {
  const exact = rawTerm.toUpperCase();
  if (String(row.sku ?? '').toUpperCase() === exact) return 0;
  if (String(row.productCode ?? '').toUpperCase() === exact) return 1;
  if (String(row.barcode ?? '').toUpperCase() === exact) return 2;
  if (normalizedTerm && normalizeSearchText(row.productName) === normalizedTerm) return 3;
  if (normalizedTerm && normalizeSearchText(row.variantName) === normalizedTerm) return 4;
  if (normalizedTerm && normalizeSearchText(row.productName).startsWith(normalizedTerm)) return 5;
  if (normalizedTerm && normalizeSearchText(row.variantName).startsWith(normalizedTerm)) return 6;
  return 7;
}

export function searchSalesOrderSkuCatalog(
  rows: SalesOrderSkuCatalogRow[],
  search: string,
  limit = 30,
  offset = 0,
): SalesOrderSkuCatalogRow[] {
  const rawTerm = String(search ?? '').trim();
  const normalizedTerm = normalizeSearchText(rawTerm);
  if (!normalizedTerm) return [];
  const tokens = normalizedTerm.split(' ').filter(Boolean);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 30));
  const safeOffset = Math.max(0, Number(offset) || 0);

  return rows
    .filter((row) => {
      const fields = rowSearchFields(row);
      return tokens.every((token) => fields.some((field) => field.includes(token)));
    })
    .sort((left, right) => {
      const rankDelta = searchRank(left, rawTerm, normalizedTerm) - searchRank(right, rawTerm, normalizedTerm);
      if (rankDelta !== 0) return rankDelta;
      const productDelta = String(left.productCode ?? '').localeCompare(String(right.productCode ?? ''));
      if (productDelta !== 0) return productDelta;
      const skuDelta = String(left.sku ?? '').localeCompare(String(right.sku ?? ''));
      if (skuDelta !== 0) return skuDelta;
      return String(left.id ?? '').localeCompare(String(right.id ?? ''));
    })
    .slice(safeOffset, safeOffset + safeLimit);
}

function parseSkuSearchRequest(path: string, init: RequestInit): SkuSearchRequest | null {
  const method = String(init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' || typeof window === 'undefined') return null;
  const url = new URL(path, window.location.origin);
  if (url.pathname !== '/api/sales-orders/sku-search') return null;
  if (url.searchParams.has('categoryId')) return null;
  const term = String(url.searchParams.get('search') ?? '').trim();
  if (!term) return null;
  return Object.freeze({
    term,
    limit: Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20)),
    offset: Math.max(0, Number(url.searchParams.get('offset')) || 0),
  });
}

function cacheKey(): string {
  return typeof window === 'undefined' ? CACHE_KEY : `${CACHE_KEY}:${window.location.origin}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readPersistedRecord(): Promise<CatalogRecord | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    return await new Promise<CatalogRecord | null>((resolve) => {
      const transaction = db.transaction(CACHE_STORE, 'readonly');
      const request = transaction.objectStore(CACHE_STORE).get(cacheKey());
      request.onsuccess = () => {
        const value = request.result as CatalogRecord | undefined;
        resolve(value && Array.isArray(value.rows) && Number.isFinite(value.savedAt) ? value : null);
      };
      request.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

async function writePersistedRecord(record: CatalogRecord): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(CACHE_STORE, 'readwrite');
      transaction.objectStore(CACHE_STORE).put(record, cacheKey());
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

async function loadPersistedCatalog(): Promise<void> {
  if (persistedLoaded) return;
  if (persistedLoadPromise) return persistedLoadPromise;
  persistedLoadPromise = (async () => {
    const record = await readPersistedRecord();
    if (record) {
      memoryRows = record.rows;
      memorySavedAt = record.savedAt;
    }
    persistedLoaded = true;
  })().finally(() => {
    persistedLoadPromise = null;
  });
  return persistedLoadPromise;
}

async function fetchCatalogPage(offset: number): Promise<SalesOrderSkuCatalogRow[]> {
  const query = new URLSearchParams({
    search: '',
    limit: String(CATALOG_PAGE_SIZE),
    offset: String(offset),
  });
  const response = await fetch(`/api/sales-orders/sku-search?${query}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`SKU catalog HTTP ${response.status}`);
  const payload = await response.json().catch(() => null) as { data?: unknown } | null;
  if (!payload || !Array.isArray(payload.data)) throw new Error('SKU catalog response invalid');
  return payload.data as SalesOrderSkuCatalogRow[];
}

async function fetchCompleteCatalog(): Promise<SalesOrderSkuCatalogRow[] | null> {
  const rows: SalesOrderSkuCatalogRow[] = [];
  let complete = false;

  for (let batchOffset = 0; batchOffset < MAX_CATALOG_ROWS; batchOffset += CATALOG_PAGE_SIZE * CATALOG_BATCH_PAGES) {
    const offsets = Array.from({ length: CATALOG_BATCH_PAGES }, (_, index) => batchOffset + index * CATALOG_PAGE_SIZE)
      .filter((offset) => offset < MAX_CATALOG_ROWS);
    const pages = await Promise.all(offsets.map((offset) => fetchCatalogPage(offset)));
    for (const page of pages) {
      rows.push(...page);
      if (page.length < CATALOG_PAGE_SIZE) {
        complete = true;
        break;
      }
    }
    if (complete) break;
  }

  if (!complete) {
    const overflow = await fetchCatalogPage(MAX_CATALOG_ROWS);
    if (overflow.length > 0) return null;
    complete = true;
  }

  if (!complete) return null;
  const deduplicated = new Map<string, SalesOrderSkuCatalogRow>();
  for (const row of rows) {
    if (row?.id) deduplicated.set(row.id, row);
  }
  return [...deduplicated.values()];
}

async function refreshCatalog(): Promise<void> {
  const rows = await fetchCompleteCatalog();
  if (!rows) return;
  const savedAt = Date.now();
  memoryRows = rows;
  memorySavedAt = savedAt;
  await writePersistedRecord(Object.freeze({ savedAt, rows }));
}

export async function warmSalesOrderSkuCatalog(force = false): Promise<void> {
  if (typeof window === 'undefined') return;
  await loadPersistedCatalog();
  const now = Date.now();
  if (!force && memoryRows && now - memorySavedAt < CATALOG_REFRESH_MS) return;
  if (!force && now - lastWarmAttemptAt < CATALOG_RETRY_BACKOFF_MS) return;
  if (warmPromise) return warmPromise;
  lastWarmAttemptAt = now;
  warmPromise = refreshCatalog()
    .catch(() => undefined)
    .finally(() => {
      warmPromise = null;
    });
  return warmPromise;
}

export async function readSalesOrderSkuSearchCache<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const request = parseSkuSearchRequest(path, init);
  if (!request) return null;
  await loadPersistedCatalog();
  if (!memoryRows?.length) {
    void warmSalesOrderSkuCatalog();
    return null;
  }
  if (Date.now() - memorySavedAt >= CATALOG_REFRESH_MS) {
    void warmSalesOrderSkuCatalog();
    return null;
  }
  const matches = searchSalesOrderSkuCatalog(memoryRows, request.term, request.limit, request.offset);
  if (matches.length === 0) return null;
  return matches as T;
}

export function rememberSalesOrderSkuSearchRows(value: unknown): void {
  if (!Array.isArray(value) || !memoryRows?.length) return;
  let changed = false;
  const byId = new Map(memoryRows.map((row) => [row.id, row]));
  for (const candidate of value) {
    const row = candidate as SalesOrderSkuCatalogRow;
    if (!row?.id) continue;
    byId.set(row.id, row);
    changed = true;
  }
  if (!changed) return;
  memoryRows = [...byId.values()];
  memorySavedAt = Date.now();
  void writePersistedRecord(Object.freeze({ savedAt: memorySavedAt, rows: memoryRows }));
}

export const salesOrderSkuLocalCacheInternals = Object.freeze({
  CATALOG_PAGE_SIZE,
  CATALOG_REFRESH_MS,
  MAX_CATALOG_ROWS,
  normalizeSearchText,
  parseSkuSearchRequest,
  searchRank,
});
