"use client";

import { currentMcpLocalUserId } from "@/lib/local-read/mcp-local-identity";

export type McpProductCatalogRow = Readonly<{
  productId: string;
  variantId: string;
  name: string;
  brand: string | null;
  category: string | null;
  sku: string | null;
  variantName: string | null;
  sizeLabel: string | null;
  sellUnit: string | null;
  packUnit: string | null;
  packQuantity: number | null;
}>;

type CatalogRecord = Readonly<{
  savedAt: string;
  rows: McpProductCatalogRow[];
}>;

type CatalogSearchResult = Readonly<{
  items: Array<McpProductCatalogRow & { price: null }>;
  categories: string[];
  brands: string[];
}>;

const CACHE_DB_NAME = "npp-mcp-sales-local-cache-v1";
const CACHE_STORE = "catalog";
const CACHE_KEY = "mcp-sales-sku-catalog-v1";
const CATALOG_REFRESH_MS = 10 * 60_000;
const CATALOG_RETRY_MS = 10_000;
const PRICE_FOLLOW_DELAY_MS = 120;

let memoryUserId = "";
let memoryRows: McpProductCatalogRow[] | null = null;
let memorySavedAt = 0;
let persistedLoaded = false;
let persistedLoadPromise: Promise<void> | null = null;
let syncPromise: Promise<void> | null = null;
let lastSyncAttemptAt = 0;
let priceRequestSequence = 0;
let catalogGeneration = 0;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resetMemory(userId = "") {
  memoryUserId = userId;
  memoryRows = null;
  memorySavedAt = 0;
  persistedLoaded = false;
  persistedLoadPromise = null;
  syncPromise = null;
  lastSyncAttemptAt = 0;
  priceRequestSequence += 1;
}

function activeUserId() {
  const userId = currentMcpLocalUserId();
  if (memoryUserId !== userId) resetMemory(userId);
  return userId;
}

function cacheKey(userId: string) {
  const origin = typeof window === "undefined" ? "local" : window.location.origin;
  return `${CACHE_KEY}:${origin}:${userId}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
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

async function readPersistedRecord(userId: string): Promise<CatalogRecord | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    return await new Promise<CatalogRecord | null>((resolve) => {
      const transaction = db.transaction(CACHE_STORE, "readonly");
      const request = transaction.objectStore(CACHE_STORE).get(cacheKey(userId));
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

async function writePersistedRecord(userId: string, record: CatalogRecord) {
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(CACHE_STORE, "readwrite");
      transaction.objectStore(CACHE_STORE).put(record, cacheKey(userId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

async function deletePersistedRecord(userId: string) {
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(CACHE_STORE, "readwrite");
      transaction.objectStore(CACHE_STORE).delete(cacheKey(userId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

function catalogRow(value: unknown): McpProductCatalogRow | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const productId = String(item.productId || "").trim();
  const variantId = String(item.variantId || "").trim();
  const name = String(item.name || "").trim();
  if (!productId || !variantId || !name) return null;
  const numberOrNull = (raw: unknown) => {
    if (raw === null || raw === undefined || raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const optional = (raw: unknown) => String(raw ?? "").trim() || null;
  return Object.freeze({
    productId,
    variantId,
    name,
    brand: optional(item.brand),
    category: optional(item.category),
    sku: optional(item.sku),
    variantName: optional(item.variantName),
    sizeLabel: optional(item.sizeLabel),
    sellUnit: optional(item.sellUnit),
    packUnit: optional(item.packUnit),
    packQuantity: numberOrNull(item.packQuantity)
  });
}

async function loadPersistedCatalog() {
  const userId = activeUserId();
  if (!userId || persistedLoaded) return;
  if (persistedLoadPromise) return persistedLoadPromise;
  const generation = catalogGeneration;
  persistedLoadPromise = (async () => {
    const record = await readPersistedRecord(userId);
    if (catalogGeneration !== generation || activeUserId() !== userId) return;
    if (record) {
      memoryRows = record.rows;
      const parsed = Date.parse(record.savedAt);
      memorySavedAt = Number.isFinite(parsed) ? parsed : 0;
    }
    persistedLoaded = true;
  })().finally(() => {
    persistedLoadPromise = null;
  });
  return persistedLoadPromise;
}

function sameRows(left: readonly McpProductCatalogRow[] | null, right: readonly McpProductCatalogRow[]) {
  if (!left || left.length !== right.length) return false;
  const a = [...left].sort((x, y) => x.variantId.localeCompare(y.variantId));
  const b = [...right].sort((x, y) => x.variantId.localeCompare(y.variantId));
  return JSON.stringify(a) === JSON.stringify(b);
}

async function fetchCatalog() {
  const response = await fetch("/api/products/catalog", {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => null) as { data?: unknown } | null;
  if (!response.ok || !Array.isArray(payload?.data)) throw new Error("MCP_PRODUCT_CATALOG_UNAVAILABLE");
  return payload.data.map(catalogRow).filter((row): row is McpProductCatalogRow => Boolean(row));
}

export async function warmMcpProductCatalog(force = false) {
  if (typeof window === "undefined") return;
  const userId = activeUserId();
  if (!userId) return;
  await loadPersistedCatalog();
  const now = Date.now();
  if (!force && memoryRows && now - memorySavedAt < CATALOG_REFRESH_MS) return;
  if (syncPromise) return syncPromise;
  if (!force && lastSyncAttemptAt && now - lastSyncAttemptAt < CATALOG_RETRY_MS) return;
  const generation = catalogGeneration;
  lastSyncAttemptAt = now;
  syncPromise = (async () => {
    const rows = await fetchCatalog();
    if (catalogGeneration !== generation || activeUserId() !== userId) return;
    const changed = !sameRows(memoryRows, rows);
    memoryRows = rows;
    memorySavedAt = Date.now();
    if (changed || memorySavedAt) {
      await writePersistedRecord(userId, { savedAt: new Date(memorySavedAt).toISOString(), rows });
    }
  })().catch(() => undefined).finally(() => {
    if (catalogGeneration === generation) syncPromise = null;
  });
  return syncPromise;
}

export async function clearMcpProductCatalogForCurrentUser() {
  const userId = currentMcpLocalUserId();
  catalogGeneration += 1;
  resetMemory("");
  if (userId) await deletePersistedRecord(userId);
}

function searchRank(row: McpProductCatalogRow, rawQuery: string, normalizedQuery: string) {
  const exact = rawQuery.toUpperCase();
  if (String(row.sku || "").toUpperCase() === exact) return 0;
  if (normalizedQuery && normalizeText(row.name) === normalizedQuery) return 1;
  if (normalizedQuery && normalizeText(row.variantName).startsWith(normalizedQuery)) return 2;
  if (normalizedQuery && normalizeText(row.name).startsWith(normalizedQuery)) return 3;
  return 4;
}

export async function searchMcpProductCatalog(
  query: string,
  category: string,
  brand: string,
  limit = 100
): Promise<CatalogSearchResult> {
  const userId = activeUserId();
  if (!userId) throw new Error("Cần đăng nhập để tải danh mục sản phẩm.");
  await loadPersistedCatalog();
  if (!memoryRows) await warmMcpProductCatalog(true);
  else void warmMcpProductCatalog(false);
  if (!memoryRows) throw new Error("Chưa tải được danh mục sản phẩm Công Ty.");

  const normalizedQuery = normalizeText(query);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const normalizedCategory = normalizeText(category);
  const normalizedBrand = normalizeText(brand);
  const rows = memoryRows
    .filter((row) => {
      if (normalizedCategory && normalizeText(row.category) !== normalizedCategory) return false;
      if (normalizedBrand && normalizeText(row.brand) !== normalizedBrand) return false;
      if (!tokens.length) return true;
      const fields = [row.name, row.brand, row.category, row.sku, row.variantName, row.sizeLabel, row.sellUnit, row.packUnit]
        .map(normalizeText)
        .filter(Boolean);
      return tokens.every((token) => fields.some((field) => field.includes(token)));
    })
    .sort((left, right) => {
      const rank = searchRank(left, query.trim(), normalizedQuery) - searchRank(right, query.trim(), normalizedQuery);
      if (rank) return rank;
      const product = left.name.localeCompare(right.name, "vi");
      return product || String(left.sku || "").localeCompare(String(right.sku || ""), "vi");
    })
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 100)));

  const categories = Array.from(new Set(memoryRows.map((row) => row.category).filter((value): value is string => Boolean(value))))
    .sort((a, b) => a.localeCompare(b, "vi"));
  const brands = Array.from(new Set(memoryRows.map((row) => row.brand).filter((value): value is string => Boolean(value))))
    .sort((a, b) => a.localeCompare(b, "vi"));

  return {
    items: rows.map((row) => ({ ...row, price: null as null })),
    categories,
    brands
  };
}

export async function loadMcpProductPrices(query: string, category: string, brand: string) {
  const search = query.trim();
  if (!search) return new Map<string, number | null>();
  const sequence = ++priceRequestSequence;
  await new Promise<void>((resolve) => window.setTimeout(resolve, PRICE_FOLLOW_DELAY_MS));
  if (sequence !== priceRequestSequence) return new Map<string, number | null>();

  const params = new URLSearchParams({ q: search, prices: "1" });
  if (category) params.set("category", category);
  if (brand) params.set("brand", brand);
  const response = await fetch(`/api/products/search?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => null) as { data?: unknown } | null;
  if (!response.ok || !Array.isArray(payload?.data)) throw new Error("MCP_PRODUCT_PRICE_UNAVAILABLE");
  const prices = new Map<string, number | null>();
  for (const raw of payload.data) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const variantId = String(item.variantId || "").trim();
    if (!variantId) continue;
    const numeric = item.price === null || item.price === undefined || item.price === "" ? null : Number(item.price);
    prices.set(variantId, numeric === null || !Number.isFinite(numeric) ? null : numeric);
  }
  return prices;
}

export const mcpProductLocalCacheInternals = Object.freeze({
  CACHE_DB_NAME,
  CACHE_KEY,
  CATALOG_REFRESH_MS,
  PRICE_FOLLOW_DELAY_MS,
  normalizeText
});
