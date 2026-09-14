import 'server-only';
import { createIdempotencyKey, isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import { requireNppWorkforceSessionToken } from './internal-auth-client';
import { resolveOrganizationErrorCode } from './organization-error-contract';

export const ORGANIZATION_RESOURCES = ['branches', 'warehouses', 'warehouse-locations'] as const;
export type OrganizationResource = (typeof ORGANIZATION_RESOURCES)[number];

const RESOURCE_SET = new Set<string>(ORGANIZATION_RESOURCES);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set(['active', 'limit', 'offset', 'branchId', 'warehouseId']);

interface CoreEnvelope<T> {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
  requestId?: string;
  receivedAt?: string;
}

export class OrganizationGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'OrganizationGatewayError';
  }
}

export function isOrganizationResource(value: string): value is OrganizationResource {
  return RESOURCE_SET.has(value);
}

export function resolveOrganizationRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeOrganizationGatewayError(error: unknown) {
  return error instanceof OrganizationGatewayError
    ? error
    : new OrganizationGatewayError(
      'ORGANIZATION_GATEWAY_UNAVAILABLE',
      'Organization data is temporarily unavailable',
      503,
      true,
    );
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN') {
  if (name === 'CORE_API_SERVER_TOKEN') return requireNppWorkforceSessionToken();
  const value = process.env[name]?.trim();
  if (!value) {
    throw new OrganizationGatewayError(
      'ORGANIZATION_GATEWAY_NOT_CONFIGURED',
      'Organization gateway is not configured',
      503,
      false,
    );
  }
  return value;
}

function coreApiBaseUrl() {
  let url: URL;
  try {
    url = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new OrganizationGatewayError(
      'ORGANIZATION_GATEWAY_NOT_CONFIGURED',
      'Organization gateway is not configured',
      503,
      false,
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
  ) {
    throw new OrganizationGatewayError(
      'ORGANIZATION_GATEWAY_NOT_CONFIGURED',
      'Organization gateway is not configured',
      503,
      false,
    );
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function safeQuery(params: URLSearchParams) {
  const next = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (ALLOWED_QUERY_KEYS.has(key) && value.length <= 128) next.append(key, value);
  }
  const serialized = next.toString();
  return serialized ? `?${serialized}` : '';
}

function organizationPath(resource: OrganizationResource, id?: string) {
  if (id !== undefined && !UUID_PATTERN.test(id)) {
    throw new OrganizationGatewayError('INVALID_RESOURCE_ID', 'Resource ID is invalid', 400, false);
  }
  return `/api/${resource}${id ? `/${id}` : ''}`;
}

function mutationKey(value: string | undefined, operation: string) {
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized) return createIdempotencyKey(`web-${operation}`);
  if (!isValidIdempotencyKey(normalized)) {
    throw new OrganizationGatewayError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key is invalid', 400, false);
  }
  return normalized;
}

async function requestCore<T>({
  resource,
  id,
  method,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  resource: OrganizationResource;
  id?: string;
  method: 'GET' | 'POST' | 'PATCH';
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const path = `${organizationPath(resource, id)}${searchParams ? safeQuery(searchParams) : ''}`;
    const response = await fetch(`${coreApiBaseUrl()}${path}`, {
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
      payload = await response.json() as CoreEnvelope<T>;
    } catch {
      throw new OrganizationGatewayError(
        'ORGANIZATION_GATEWAY_RESPONSE_INVALID',
        'Core API returned an invalid response',
        502,
        false,
      );
    }

    if (!response.ok) {
      throw new OrganizationGatewayError(
        resolveOrganizationErrorCode(payload.error),
        payload.error?.message || 'Organization request failed',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new OrganizationGatewayError(
        'ORGANIZATION_GATEWAY_RESPONSE_INVALID',
        'Core API returned an invalid response',
        502,
        false,
      );
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof OrganizationGatewayError) throw error;
    throw new OrganizationGatewayError(
      'ORGANIZATION_GATEWAY_UNAVAILABLE',
      'Core API is temporarily unavailable',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function listOrganizationResource<T>(
  resource: OrganizationResource,
  requestId: string,
  searchParams: URLSearchParams,
): Promise<T> {
  return requestCore<T>({ resource, method: 'GET', requestId, searchParams });
}

export function getOrganizationResource<T>(
  resource: OrganizationResource,
  id: string,
  requestId: string,
): Promise<T> {
  return requestCore<T>({ resource, id, method: 'GET', requestId });
}

export function createOrganizationResource<T>(
  resource: OrganizationResource,
  requestId: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<T> {
  return requestCore<T>({
    resource,
    method: 'POST',
    requestId,
    body,
    idempotencyKey: mutationKey(idempotencyKey, `organization-${resource}-create`),
  });
}

export function patchOrganizationResource<T>(
  resource: OrganizationResource,
  id: string,
  requestId: string,
  body: unknown,
): Promise<T> {
  return requestCore<T>({ resource, id, method: 'PATCH', requestId, body });
}
