'use client';

import { useEffect, type ReactNode } from 'react';

const ADDRESS_ROUTE = /^\/api\/suppliers\/[^/]+\/addresses\/?$/;

export default function SupplierAddressIdempotencyBoundary({ children }: { children: ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const keys = new Map<string, string>();

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, window.location.origin);
      if (method !== 'POST' || !ADDRESS_ROUTE.test(url.pathname)) return originalFetch(input, init);

      const body = typeof init?.body === 'string'
        ? init.body
        : input instanceof Request
          ? await input.clone().text().catch(() => '')
          : '';
      const fingerprint = `${url.pathname}\n${body}`;
      const key = keys.get(fingerprint) ?? `web-supplier-address-${crypto.randomUUID()}`;
      keys.set(fingerprint, key);

      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
      headers.set('Idempotency-Key', key);
      const response = await originalFetch(input, { ...init, method, headers });
      if (response.ok) keys.delete(fingerprint);
      return response;
    };

    return () => {
      window.fetch = originalFetch;
      keys.clear();
    };
  }, []);

  return children;
}
