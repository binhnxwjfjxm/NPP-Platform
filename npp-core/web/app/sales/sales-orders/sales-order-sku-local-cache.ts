import type { SalesOrderSkuSearchOption } from '../../../lib/sales-order-types';

type CatalogTaxDefaults = Pick<SalesOrderSkuSearchOption, 'defaultTaxMode' | 'defaultTaxRate'>;

type SalesOrderSkuCatalogRow = Readonly<{
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  sku: string;
  variantName: string;
  barcode: string | null;
  barcodes: readonly string[];
  unitId: string | null;
  unitCode: string | null;
  unitName: string | null;
  conversionToBase: string | null;
  allowsFractional: boolean | null;
}>;

type CatalogRecord = Readonly<{
  cursor: string | null;
  rows: SalesOrderSkuCatalogRow[];
}>;

type CatalogSyncPayload = Readonly<{
  cursor: string;
  full: boolean;
  upserts: SalesOrderSkuCatalogRow[];
  removeIds: string[];
}>;

type SkuSearchRequest = Readonly<{
  term: string;
  limit: number;
  offset: number;
}>;

const CACHE_DB_NAME = 'npp-company-sales-local-cache-v1';
const CACHE_STORE = 'sales';
const CACHE_KEY = 'sales-order-sku-catalog-v2';
const CATALOG_SYNC_PATH = '/api/products/sales-order-local-catalog';
const CATALOG_SYNC_CHECK_MS = 30_000;
const CATALOG_RETRY_BACKOFF_MS = 10_000;

let memoryRows: SalesOrderSkuCatalogRow[] | null = null;
let memoryCursor: string | null = null;
let persistedLoaded = false;
let persistedLoadPromise: Promise<void> | null = null;
let syncPromise: Promise<void> | null = null;
let syncTimer: number | null = null;
let lastSyncAttemptAt = 0;
let currentTaxDefaults: CatalogTaxDefaults | null = null;

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
  return [row.sku, row.variantName, row.productCode, row.productName, row.barcode, ...row.barcodes]
    .filter((value): value is string => Boolean(value))
    .map(normalizeSearchText);
}

function hasExactBarcode(row: SalesOrderSkuCatalogRow, exact: string): boolean {
  return row.barcodes.some((barcode) => barcode.toUpperCase() === exact)
    || String(row.barcode ?? '').toUpperCase() === exact;
}

function searchRank(row: SalesOrderSkuCatalogRow, rawTerm: string, normalizedTerm: string): number {
  const exact = rawTerm.toUpperCase();
  if (String(row.sku ?? '').toUpperCase() === exact) return 0;
  if (String(row.productCode ?? '').toUpperCase() === exact) return 1;
  if (hasExactBarcode(row, exact)) return 2;
  if (normalizedTerm && normalizeSearchText(row.productName) === normalizedTerm) return 3;
  if (normalizedTerm && normalizeSearchText(row.variantName) === normalizedTerm) return 4;
  if (normalizedTerm && normalizeSearchText(row.productName).startsWith(normalizedTerm)) return 5;
  if (normalizedTerm && normalizeSearchText(row.variantName).startsWith(normalizedTerm)) return 6;
  return 7;
}

export function searchSalesOrderSkuCatalog(
  rows: readonly SalesOrderSkuCatalogRow[],
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

export function configureSalesOrderSkuCatalogDefaults(value: unknown): void {
  if (!value || typeof value !== 'object') {
    currentTaxDefaults = null;
    return;
  }
  const candidate = value as { defaultTaxMode?: unknown; defaultTaxRate?: unknown };
  const mode = String(candidate.defaultTaxMode ?? '').trim().toUpperCase();
  const rate = String(candidate.defaultTaxRate ?? '').trim();
  if (!['EXCLUSIVE', 'INCLUSIVE'].includes(mode) || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(rate)) {
    currentTaxDefaults = null;
    return;
  }
  currentTaxDefaults = Object.freeze({
    defaultTaxMode: mode as SalesOrderSkuSearchOption['defaultTaxMode'],
    defaultTaxRate: rate,
  });
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
        resolve(value && Array.isArray(value.rows) ? value : null);
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
      memoryCursor = record.cursor ?? null;
    }
    persistedLoaded = true;
  })().finally(() => {
    persistedLoadPromise = null;
  });
  return persistedLoadPromise;
}

function validCatalogRow(value: unknown): value is SalesOrderSkuCatalogRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<SalesOrderSkuCatalogRow>;
  return Boolean(row.id && row.productId && row.productCode && row.productName && row.sku && row.variantName)
    && Array.isArray(row.barcodes);
}

async function fetchCatalogSync(cursor: string | null): Promise<CatalogSyncPayload> {
  const query = new URLSearchParams();
  if (cursor) query.set('since', cursor);
  const response = await fetch(`${CATALOG_SYNC_PATH}${query.size ? `?${query}` : ''}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null) as {
    data?: { cursor?: unknown; full?: unknown; upserts?: unknown; removeIds?: unknown };
  } | null;
  if (!response.ok || !payload?.data) throw new Error(`SKU catalog HTTP ${response.status}`);
  const nextCursor = String(payload.data.cursor ?? '').trim();
  if (!nextCursor || Number.isNaN(new Date(nextCursor).getTime())) throw new Error('SKU catalog cursor invalid');
  const upserts = Array.isArray(payload.data.upserts) ? payload.data.upserts.filter(validCatalogRow) : [];
  const removeIds = Array.isArray(payload.data.removeIds)
    ? payload.data.removeIds.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  return Object.freeze({
    cursor: new Date(nextCursor).toISOString(),
    full: payload.data.full === true,
    upserts,
    removeIds,
  });
}

function sameRows(left: readonly SalesOrderSkuCatalogRow[] | null, right: readonly SalesOrderSkuCatalogRow[]): boolean {
  if (!left || left.length !== right.length) return false;
  const leftSorted = [...left].sort((a, b) => a.id.localeCompare(b.id));
  const rightSorted = [...right].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(leftSorted) === JSON.stringify(rightSorted);
}

async function applyCatalogSync(payload: CatalogSyncPayload): Promise<void> {
  const byId = new Map<string, SalesOrderSkuCatalogRow>();
  if (!payload.full) {
    for (const row of memoryRows ?? []) byId.set(row.id, row);
  }
  for (const id of payload.removeIds) byId.delete(id);
  for (const row of payload.upserts) byId.set(row.id, row);
  const nextRows = [...byId.values()];
  const rowsChanged = !sameRows(memoryRows, nextRows);
  const cursorChanged = memoryCursor !== payload.cursor;
  memoryRows = nextRows;
  memoryCursor = payload.cursor;
  if (rowsChanged || cursorChanged) {
    await writePersistedRecord(Object.freeze({ cursor: memoryCursor, rows: memoryRows }));
  }
}

function scheduleNextSync(): void {
  if (typeof window === 'undefined' || syncTimer !== null) return;
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      void warmSalesOrderSkuCatalog();
    } else {
      scheduleNextSync();
    }
  }, CATALOG_SYNC_CHECK_MS);
}

export async function warmSalesOrderSkuCatalog(force = false): Promise<void> {
  if (typeof window === 'undefined') return;
  await loadPersistedCatalog();
  const now = Date.now();
  if (!force && now - lastSyncAttemptAt < CATALOG_SYNC_CHECK_MS) {
    scheduleNextSync();
    return;
  }
  if (syncPromise) return syncPromise;
  if (!force && lastSyncAttemptAt && now - lastSyncAttemptAt < CATALOG_RETRY_BACKOFF_MS) return;
  lastSyncAttemptAt = now;
  syncPromise = fetchCatalogSync(memoryCursor)
    .then(applyCatalogSync)
    .catch(() => undefined)
    .finally(() => {
      syncPromise = null;
      scheduleNextSync();
    });
  return syncPromise;
}

function toSearchOption(row: SalesOrderSkuCatalogRow): Omit<SalesOrderSkuSearchOption, 'pricePreview' | 'inventoryPreview'> {
  if (!currentTaxDefaults) throw new Error('Catalog tax defaults unavailable');
  return Object.freeze({
    id: row.id,
    productId: row.productId,
    productCode: row.productCode,
    productName: row.productName,
    sku: row.sku,
    variantName: row.variantName,
    barcode: row.barcode,
    unitId: row.unitId,
    unitCode: row.unitCode,
    unitName: row.unitName,
    conversionToBase: row.conversionToBase,
    allowsFractional: row.allowsFractional,
    defaultTaxMode: currentTaxDefaults.defaultTaxMode,
    defaultTaxRate: currentTaxDefaults.defaultTaxRate,
    eligibility: { selectable: true, code: 'OK', message: '' },
  });
}

export async function readSalesOrderSkuSearchCache<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const request = parseSkuSearchRequest(path, init);
  if (!request || !currentTaxDefaults) return null;
  await loadPersistedCatalog();
  if (memoryRows === null) {
    await warmSalesOrderSkuCatalog(true);
    if (memoryRows === null) return null;
  } else {
    void warmSalesOrderSkuCatalog();
  }
  const matches = searchSalesOrderSkuCatalog(memoryRows, request.term, request.limit, request.offset);
  if (matches.length === 0) {
    void warmSalesOrderSkuCatalog(true);
    return null;
  }
  return matches.map(toSearchOption) as T;
}

export const salesOrderSkuLocalCacheInternals = Object.freeze({
  CATALOG_SYNC_CHECK_MS,
  normalizeSearchText,
  parseSkuSearchRequest,
  searchRank,
});
