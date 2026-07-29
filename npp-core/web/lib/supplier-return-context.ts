import 'server-only';

import { randomUUID } from 'node:crypto';
import { SUPPLIER_RETURN_PERMISSION_KEYS } from './supplier-return-types';

const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('supplier_return_context_not_configured');
  return value;
}

function coreApiBaseUrl(): string {
  const parsed = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('supplier_return_context_not_configured');
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('supplier_return_context_not_configured');
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export async function loadSupplierReturnPermissionKeys(requestId?: string | null): Promise<string[]> {
  const normalizedRequestId = REQUEST_ID_PATTERN.test(String(requestId ?? '').trim())
    ? String(requestId).trim()
    : `web_${randomUUID()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}/api/config`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': normalizedRequestId,
      },
    });
    const payload = await response.json().catch(() => null) as {
      data?: { requestContext?: { permissions?: unknown } };
    } | null;
    if (!response.ok || !payload?.data) throw new Error('supplier_return_context_unavailable');
    const granted = new Set(
      Array.isArray(payload.data.requestContext?.permissions)
        ? payload.data.requestContext.permissions.filter((value): value is string => typeof value === 'string')
        : [],
    );
    return Object.values(SUPPLIER_RETURN_PERMISSION_KEYS).filter((key) => granted.has(key));
  } finally {
    clearTimeout(timeout);
  }
}

