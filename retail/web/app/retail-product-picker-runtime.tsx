'use client';

import { useLayoutEffect } from 'react';
import {
  cacheRetailProducts,
  findCachedRetailProducts,
  removeCachedRetailSearchMatches,
  removeLegacyRetailProductCache,
  replaceRetailProductCache,
  retailProductCacheIsFresh,
  type RetailCachedProduct,
} from '../lib/product-catalog-cache';

const CATALOG_PAGE_SIZE = 50;
const MAX_CATALOG_OFFSET = 100000;
const PRODUCT_PATH = '/api/retail/products';
const CACHE_SCOPE_PATH = '/api/auth/cache-scope';
const CACHE_SCOPE_PATTERN = /^[a-f0-9]{32}$/;

type ProductEnvelope = {
  data?: RetailCachedProduct[];
};

type CacheScopeEnvelope = {
  data?: { scope?: string };
};

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url, window.location.origin);
  return new URL(String(input), window.location.origin);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit) {
  return init?.signal ?? (input instanceof Request ? input.signal : undefined);
}

function throwIfAborted(signal: AbortSignal | null | undefined) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('The operation was aborted.', 'AbortError');
}

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === 'AbortError';
}

async function readProducts(response: Response) {
  if (!response.ok) return [] as RetailCachedProduct[];
  const payload = await response.clone().json().catch(() => null) as ProductEnvelope | null;
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function readCacheScope(nativeFetch: typeof window.fetch) {
  const response = await nativeFetch(CACHE_SCOPE_PATH, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return '';
  const payload = await response.json().catch(() => null) as CacheScopeEnvelope | null;
  const scope = String(payload?.data?.scope ?? '').trim().toLowerCase();
  return CACHE_SCOPE_PATTERN.test(scope) ? scope : '';
}

function cachedResponse(products: RetailCachedProduct[]) {
  return new Response(JSON.stringify({
    data: products,
    requestId: 'retail_catalog_cache',
    receivedAt: new Date().toISOString(),
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Retail-Catalog-Cache': 'HIT',
    },
  });
}

export function RetailProductPickerRuntime() {
  useLayoutEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    let stopped = false;
    const scopePromise = readCacheScope(nativeFetch).catch(() => '');

    const refreshRequestInBackground = (scope: string, url: URL, search: string) => {
      void nativeFetch(url.toString(), {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }).then(async (response) => {
        if (!response.ok) return;
        const rows = await readProducts(response);
        if (rows.length) await cacheRetailProducts(scope, rows);
        else if (search.trim()) await removeCachedRetailSearchMatches(scope, search);
      }).catch(() => undefined);
    };

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (requestMethod(input, init) !== 'GET' || url.pathname !== PRODUCT_PATH || url.searchParams.has('categoryId')) {
        return nativeFetch(input, init);
      }

      const signal = requestSignal(input, init);
      throwIfAborted(signal);
      const scope = await scopePromise;
      throwIfAborted(signal);
      if (!scope) return nativeFetch(input, init);

      const search = url.searchParams.get('search') ?? '';
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), CATALOG_PAGE_SIZE);
      const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

      try {
        const cached = await findCachedRetailProducts(scope, search, limit, offset);
        throwIfAborted(signal);
        if (cached.length) {
          refreshRequestInBackground(scope, url, search);
          return cachedResponse(cached);
        }
      } catch (reason) {
        if (isAbortError(reason) || signal?.aborted) throw reason;
        // IndexedDB can be unavailable in private/restricted browser modes; network remains the fallback.
      }

      const response = await nativeFetch(input, init);
      if (response.ok) {
        void readProducts(response)
          .then((rows) => rows.length
            ? cacheRetailProducts(scope, rows)
            : search.trim()
              ? removeCachedRetailSearchMatches(scope, search)
              : undefined)
          .catch(() => undefined);
      }
      return response;
    };

    window.fetch = wrappedFetch;

    const warmCatalog = async () => {
      try {
        const scope = await scopePromise;
        if (!scope || stopped) return;
        await removeLegacyRetailProductCache();
        if (await retailProductCacheIsFresh(scope)) return;
        const all: RetailCachedProduct[] = [];
        for (let offset = 0; offset < MAX_CATALOG_OFFSET && !stopped; offset += CATALOG_PAGE_SIZE) {
          const params = new URLSearchParams({ search: '', limit: String(CATALOG_PAGE_SIZE), offset: String(offset) });
          const response = await nativeFetch(`${PRODUCT_PATH}?${params.toString()}`, {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) return;
          const page = await readProducts(response);
          all.push(...page);
          if (page.length < CATALOG_PAGE_SIZE) break;
        }
        if (!stopped) await replaceRetailProductCache(scope, all);
      } catch {
        // Catalog caching is an acceleration layer only; Retail keeps working from the API when it fails.
      }
    };
    void warmCatalog();

    const preparePickerRows = (root: ParentNode = document) => {
      root.querySelectorAll<HTMLElement>('.product-sheet .lot7-product-row').forEach((row) => {
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        const name = row.querySelector<HTMLElement>('.product-copy strong')?.textContent?.trim();
        row.setAttribute('aria-label', name ? `Thêm ${name} vào đơn` : 'Thêm sản phẩm vào đơn');
      });
    };

    const activatePickerRow = (row: HTMLElement, event: Event) => {
      const increment = row.querySelector<HTMLButtonElement>('.quantity-stepper button:last-of-type')
        ?? row.querySelector<HTMLButtonElement>('.add-product');
      if (!increment || increment.disabled) return;
      event.preventDefault();
      increment.click();
    };

    const handlePickerClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>('.product-sheet .lot7-product-row');
      if (!row || target?.closest('button, input, select, textarea, a')) return;
      activatePickerRow(row, event);
    };

    const handlePickerKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>('.product-sheet .lot7-product-row');
      if (!row || target !== row) return;
      activatePickerRow(row, event);
    };

    preparePickerRows();
    const observer = new MutationObserver(() => preparePickerRows());
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', handlePickerClick, true);
    document.addEventListener('keydown', handlePickerKeyDown, true);

    return () => {
      stopped = true;
      observer.disconnect();
      document.removeEventListener('click', handlePickerClick, true);
      document.removeEventListener('keydown', handlePickerKeyDown, true);
      if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
    };
  }, []);

  return null;
}
