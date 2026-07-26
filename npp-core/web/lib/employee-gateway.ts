import 'server-only';

import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set(['active', 'limit', 'offset', 'branchId']);

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

export class EmployeeGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'EmployeeGatewayError';
  }
}

export function resolveEmployeeRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeEmployeeGatewayError(error: unknown): EmployeeGatewayError {
  if (error instanceof EmployeeGatewayError) return error;
  return new EmployeeGatewayError('EMPLOYEE_GATEWAY_UNAVAILABLE', 'Dữ liệu nhân sự tạm thời chưa sẵn sàng', 503, true);
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new EmployeeGatewayError('EMPLOYEE_GATEWAY_NOT_CONFIGURED', 'Cổng dữ liệu nhân sự chưa được cấu hình', 503, false);
  }
  return value;
}

function coreApiBaseUrl(): string {
  const raw = requiredServerValue('CORE_API_INTERNAL_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new EmployeeGatewayError('EMPLOYEE_GATEWAY_NOT_CONFIGURED', 'Cổng dữ liệu nhân sự chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new EmployeeGatewayError('EMPLOYEE_GATEWAY_NOT_CONFIGURED', 'Cổng dữ liệu nhân sự chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new EmployeeGatewayError('EMPLOYEE_GATEWAY_NOT_CONFIGURED', 'Cổng dữ liệu nhân sự chưa được cấu hình', 503, false);
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
  const value = next.toString();
  return value ? `?${value}` : '';
}

async function requestCore<T>({
  id,
  method,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  id?: string;
  method: 'GET' | 'POST' | 'PATCH';
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  if (id && !UUID_PATTERN.test(id)) {
    throw new EmployeeGatewayError('INVALID_EMPLOYEE_ID', 'Mã định danh nhân sự không hợp lệ', 400, false);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const path = `/api/employees${id ? `/${id}` : ''}${searchParams ? safeQuery(searchParams) : ''}`;
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
      throw new EmployeeGatewayError('EMPLOYEE_GATEWAY_RESPONSE_INVALID', 'Core API trả về phản hồi không hợp lệ', 502, false);
    }

    if (!response.ok) {
      throw new EmployeeGatewayError(
        payload.error?.code || 'EMPLOYEE_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu dữ liệu nhân sự thất bại',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new EmployeeGatewayError('EMPLOYEE_GATEWAY_RESPONSE_INVALID', 'Core API trả về phản hồi không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof EmployeeGatewayError) throw error;
    throw new EmployeeGatewayError('EMPLOYEE_GATEWAY_UNAVAILABLE', 'Core API tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listEmployees<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestCore<T>({ method: 'GET', requestId, searchParams });
}

export function getEmployee<T>(id: string, requestId: string): Promise<T> {
  return requestCore<T>({ id, method: 'GET', requestId });
}

export function createEmployee<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    method: 'POST',
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
}

export function patchEmployee<T>(id: string, requestId: string, body: unknown): Promise<T> {
  return requestCore<T>({ id, method: 'PATCH', requestId, body });
}
