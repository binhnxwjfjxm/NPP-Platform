'use client';

import { useEffect } from 'react';

const CREATE_PRICING_ENDPOINTS = [
  /^\/api\/sales-channels\/?(?:\?.*)?$/,
  /^\/api\/price-lists\/?(?:\?.*)?$/,
  /^\/api\/price-lists\/[^/]+\/items\/?(?:\?.*)?$/,
  /^\/api\/price-lists\/import\/?(?:\?.*)?$/,
];

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') return new URL(input, window.location.origin).pathname + new URL(input, window.location.origin).search;
  if (input instanceof URL) return input.pathname + input.search;
  const url = new URL(input.url, window.location.origin);
  return url.pathname + url.search;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function requestBody(input: RequestInfo | URL, init?: RequestInit): string | null {
  if (typeof init?.body === 'string') return init.body;
  if (input instanceof Request) return null;
  return init?.body == null ? '' : String(init.body);
}

function shouldAttachIdempotencyKey(path: string, method: string): boolean {
  return method === 'POST' && CREATE_PRICING_ENDPOINTS.some((pattern) => pattern.test(path));
}

export default function PricingIdempotencyBoundary({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const pendingKeys = new Map<string, string>();

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = requestMethod(input, init);
      const path = requestPath(input);
      const body = requestBody(input, init);

      if (!shouldAttachIdempotencyKey(path, method) || body === null) {
        return originalFetch(input, init);
      }

      const fingerprint = `${method}\n${path}\n${body}`;
      const key = pendingKeys.get(fingerprint) ?? `web-pricing-${crypto.randomUUID()}`;
      pendingKeys.set(fingerprint, key);

      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
      headers.set('Idempotency-Key', key);

      const response = await originalFetch(input, { ...init, method, headers });
      if (response.ok) pendingKeys.delete(fingerprint);
      return response;
    };

    return () => {
      window.fetch = originalFetch;
      pendingKeys.clear();
    };
  }, []);

  return children;
}
