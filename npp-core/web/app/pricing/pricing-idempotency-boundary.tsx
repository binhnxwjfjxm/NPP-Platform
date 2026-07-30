'use client';

import { useEffect } from 'react';
import { normalizePricingResolutionResponse } from '../../lib/pricing-resolution-error';

const CREATE_PRICING_ENDPOINTS = [
  /^\/api\/sales-channels\/?(?:\?.*)?$/,
  /^\/api\/price-lists\/?(?:\?.*)?$/,
  /^\/api\/price-lists\/[^/]+\/items\/?(?:\?.*)?$/,
  /^\/api\/price-lists\/import\/?(?:\?.*)?$/,
  /^\/api\/pricing\/import\/?(?:\?.*)?$/,
];

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, window.location.origin);
  if (input instanceof URL) return input;
  return new URL(input.url, window.location.origin);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  if (typeof init?.body === 'string') return init.body;
  if (input instanceof Request) {
    try { return await input.clone().text(); }
    catch { return null; }
  }
  return init?.body == null ? '' : String(init.body);
}

function shouldAttachIdempotencyKey(url: URL, method: string): boolean {
  const path = `${url.pathname}${url.search}`;
  return method === 'POST' && CREATE_PRICING_ENDPOINTS.some((pattern) => pattern.test(path));
}

function isPricingResolution(url: URL, method: string): boolean {
  return method === 'POST' && url.pathname === '/api/pricing/resolve';
}

export default function PricingIdempotencyBoundary({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const pendingKeys = new Map<string, string>();

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = requestMethod(input, init);
      const url = requestUrl(input);
      let response: Response;

      if (shouldAttachIdempotencyKey(url, method)) {
        const body = await requestBody(input, init);
        if (body === null) return originalFetch(input, init);

        const fingerprint = `${method}\n${url.pathname}${url.search}\n${body}`;
        const key = pendingKeys.get(fingerprint) ?? `web-pricing-${crypto.randomUUID()}`;
        pendingKeys.set(fingerprint, key);

        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
        headers.set('Idempotency-Key', key);

        response = await originalFetch(input, { ...init, method, headers });
        if (response.ok) pendingKeys.delete(fingerprint);
      } else {
        response = await originalFetch(input, init);
      }

      return isPricingResolution(url, method)
        ? normalizePricingResolutionResponse(response)
        : response;
    };

    return () => {
      window.fetch = originalFetch;
      pendingKeys.clear();
    };
  }, []);

  return children;
}
