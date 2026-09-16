'use client';

import { useLayoutEffect } from 'react';
import {
  cacheRetailProducts,
  findCachedRetailProducts,
  replaceRetailProductCache,
  retailProductCacheIsFresh,
  type RetailCachedProduct,
} from '../lib/product-catalog-cache';

const CATALOG_PAGE_SIZE = 50;
const MAX_CATALOG_OFFSET = 100000;
const PRODUCT_PATH = '/api/retail/products';

type ProductEnvelope = {
  data?: RetailCachedProduct[];
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

async function readProducts(response: Response) {
  if (!response.ok) return [] as RetailCachedProduct[];
  const payload = await response.clone().json().catch(() => null) as ProductEnvelope | null;
  return Array.isArray(payload?.data) ? payload.data : [];
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

    const refreshRequestInBackground = (input: RequestInfo | URL, init: RequestInit | undefined) => {
      void nativeFetch(input, init)
        .then(async (response) => {
          const rows = await readProducts(response);
          if (rows.length) await cacheRetailProducts(rows);
        })
        .catch(() => undefined);
    };

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (requestMethod(input, init) !== 'GET' || url.pathname !== PRODUCT_PATH || url.searchParams.has('categoryId')) {
        return nativeFetch(input, init);
      }

      const search = url.searchParams.get('search') ?? '';
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), CATALOG_PAGE_SIZE);
      const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

      try {
        const cached = await findCachedRetailProducts(search, limit, offset);
        if (cached.length) {
          refreshRequestInBackground(input, init);
          return cachedResponse(cached);
        }
      } catch {
        // IndexedDB can be unavailable in private/restricted browser modes; network remains the fallback.
      }

      const response = await nativeFetch(input, init);
      void readProducts(response).then((rows) => rows.length ? cacheRetailProducts(rows) : undefined).catch(() => undefined);
      return response;
    };

    window.fetch = wrappedFetch;

    const warmCatalog = async () => {
      try {
        if (await retailProductCacheIsFresh()) return;
        const all: RetailCachedProduct[] = [];
        for (let offset = 0; offset < MAX_CATALOG_OFFSET && !stopped; offset += CATALOG_PAGE_SIZE) {
          const params = new URLSearchParams({ search: '', limit: String(CATALOG_PAGE_SIZE), offset: String(offset) });
          const response = await nativeFetch(`${PRODUCT_PATH}?${params.toString()}`, {
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) return;
          const page = await readProducts(response);
          all.push(...page);
          if (page.length < CATALOG_PAGE_SIZE) break;
        }
        if (!stopped && all.length) await replaceRetailProductCache(all);
      } catch {
        // Catalog caching is an acceleration layer only; Retail keeps working from the API when it fails.
      }
    };
    void warmCatalog();

    const handlePickerClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>('.product-sheet .lot7-product-row');
      if (!row || target?.closest('.add-product, .quantity-stepper')) return;

      const increment = row.querySelector<HTMLButtonElement>('.quantity-stepper button:last-of-type')
        ?? row.querySelector<HTMLButtonElement>('.add-product');
      if (!increment || increment.disabled) return;
      event.preventDefault();
      increment.click();
    };
    document.addEventListener('click', handlePickerClick, true);

    return () => {
      stopped = true;
      document.removeEventListener('click', handlePickerClick, true);
      if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
    };
  }, []);

  return null;
}
