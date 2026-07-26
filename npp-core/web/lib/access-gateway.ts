import 'server-only';

import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8_000;
const ROLE_PAGE_SIZE = 1000;
const ALLOWED_QUERY_KEYS = new Set(['active', 'limit', 'offset', 'q', 'search']);

interface CoreEnvelope<T> {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
  requestId?: string;
}

export class AccessGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'AccessGatewayError';
  }
}

export function resolveAccessRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeAccessGatewayError(error: unknown): AccessGatewayError {
  if (error instanceof AccessGatewayError) return error;
  return new AccessGatewayError('ACCESS_GATEWAY_UNAVAILABLE', 'Dữ liệu phân quyền tạm thời chưa sẵn sàng', 503, true);
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AccessGatewayError('ACCESS_GATEWAY_NOT_CONFIGURED', 'Cổng phân quyền chưa được cấu hình', 503, false);
  }
  return value;
}

function coreApiBaseUrl(): string {
  const raw = requiredServerValue('CORE_API_INTERNAL_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AccessGatewayError('ACCESS_GATEWAY_NOT_CONFIGURED', 'Cổng phân quyền chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new AccessGatewayError('ACCESS_GATEWAY_NOT_CONFIGURED', 'Cổng phân quyền chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new AccessGatewayError('ACCESS_GATEWAY_NOT_CONFIGURED', 'Cổng phân quyền chưa được cấu hình', 503, false);
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function safeQuery(searchParams: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (!ALLOWED_QUERY_KEYS.has(key) || value.length > 128) continue;
    next.append(key, value);
  }
  const serialized = next.toString();
  return serialized ? `?${serialized}` : '';
}

async function requestAccess<T>({
  path,
  method,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  path: string;
  method: 'GET' | 'POST' | 'PATCH';
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}/api/access${path}${searchParams ? safeQuery(searchParams) : ''}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    let payload: CoreEnvelope<T>;
    try {
      payload = (await response.json()) as CoreEnvelope<T>;
    } catch {
      throw new AccessGatewayError('ACCESS_GATEWAY_RESPONSE_INVALID', 'Phản hồi phân quyền không hợp lệ', 502, false);
    }

    if (!response.ok) {
      throw new AccessGatewayError(
        payload.error?.code || 'ACCESS_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu phân quyền không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new AccessGatewayError('ACCESS_GATEWAY_RESPONSE_INVALID', 'Phản hồi phân quyền không hợp lệ', 502, false);
    }

    return payload.data as T;
  } catch (error) {
    if (error instanceof AccessGatewayError) throw error;
    throw new AccessGatewayError('ACCESS_GATEWAY_UNAVAILABLE', 'Cổng phân quyền tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listAccessPermissions<T>(requestId: string): Promise<T> {
  return requestAccess<T>({ path: '/permissions', method: 'GET', requestId });
}

export function listAccessRoles<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestAccess<T>({ path: '/roles', method: 'GET', requestId, searchParams });
}

export async function listAllAccessRoles<T>(requestId: string, searchParams = new URLSearchParams()): Promise<T[]> {
  const filters = new URLSearchParams(searchParams);
  filters.delete('limit');
  filters.delete('offset');

  const roles: T[] = [];
  let offset = 0;
  while (true) {
    const pageParams = new URLSearchParams(filters);
    pageParams.set('limit', String(ROLE_PAGE_SIZE));
    pageParams.set('offset', String(offset));
    const page = await requestAccess<T[]>({ path: '/roles', method: 'GET', requestId, searchParams: pageParams });
    roles.push(...page);

    if (page.length < ROLE_PAGE_SIZE) return roles;
    offset += page.length;
  }
}

export function getAccessRole<T>(id: string, requestId: string): Promise<T> {
  if (!UUID_PATTERN.test(id)) {
    throw new AccessGatewayError('INVALID_ROLE_ID', 'Mã vai trò không hợp lệ', 400, false);
  }
  return requestAccess<T>({ path: `/roles/${id}`, method: 'GET', requestId });
}

export function createAccessRole<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestAccess<T>({
    path: '/roles',
    method: 'POST',
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchAccessRole<T>(id: string, requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  if (!UUID_PATTERN.test(id)) {
    throw new AccessGatewayError('INVALID_ROLE_ID', 'Mã vai trò không hợp lệ', 400, false);
  }
  return requestAccess<T>({
    path: `/roles/${id}`,
    method: 'PATCH',
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function listAccessUsers<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestAccess<T>({ path: '/users', method: 'GET', requestId, searchParams });
}

export function getAccessUser<T>(id: string, requestId: string): Promise<T> {
  if (!UUID_PATTERN.test(id)) {
    throw new AccessGatewayError('INVALID_USER_ID', 'Mã người dùng không hợp lệ', 400, false);
  }
  return requestAccess<T>({ path: `/users/${id}`, method: 'GET', requestId });
}

export function createAccessUser<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestAccess<T>({
    path: '/users',
    method: 'POST',
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchAccessUser<T>(id: string, requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  if (!UUID_PATTERN.test(id)) {
    throw new AccessGatewayError('INVALID_USER_ID', 'Mã người dùng không hợp lệ', 400, false);
  }
  return requestAccess<T>({
    path: `/users/${id}`,
    method: 'PATCH',
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchAccessUserRoles<T>(id: string, requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  if (!UUID_PATTERN.test(id)) {
    throw new AccessGatewayError('INVALID_USER_ID', 'Mã người dùng không hợp lệ', 400, false);
  }
  return requestAccess<T>({
    path: `/users/${id}/roles`,
    method: 'PATCH',
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}
