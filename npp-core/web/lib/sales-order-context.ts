import 'server-only';

import { randomUUID } from 'node:crypto';

export const SALES_ORDER_PERMISSION_KEYS = Object.freeze({
  read: 'core.sales-order.read',
  create: 'core.sales-order.create',
  updateDraft: 'core.sales-order.update-draft',
  confirm: 'core.sales-order.confirm',
  amend: 'core.sales-order.amend',
  cancel: 'core.sales-order.cancel',
  priceOverride: 'core.sales-order.price.override',
  creditOverride: 'core.sales-order.credit.override',
});

const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('sales_order_context_not_configured');
  return value;
}

function coreApiBaseUrl(): string {
  const parsed = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('sales_order_context_not_configured');
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('sales_order_context_not_configured');
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export async function loadSalesOrderPermissionKeys(requestId?: string | null): Promise<string[]> {
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
    if (!response.ok || !payload?.data) throw new Error('sales_order_context_unavailable');
    const granted = new Set(
      Array.isArray(payload.data.requestContext?.permissions)
        ? payload.data.requestContext.permissions.filter((value): value is string => typeof value === 'string')
        : [],
    );
    return Object.values(SALES_ORDER_PERMISSION_KEYS).filter((key) => granted.has(key));
  } finally {
    clearTimeout(timeout);
  }
}
