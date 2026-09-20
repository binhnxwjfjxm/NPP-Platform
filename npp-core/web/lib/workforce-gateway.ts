import 'server-only';

import { createIdempotencyKey, isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_QUERY_KEYS = new Set(['employeeId', 'employeeQuery', 'branchId', 'from', 'to', 'view', 'limit', 'offset']);

interface CoreEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
}

export class WorkforceGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'WorkforceGatewayError';
  }
}

export function resolveWorkforceRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeWorkforceGatewayError(error: unknown) {
  return error instanceof WorkforceGatewayError
    ? error
    : new WorkforceGatewayError('WORKFORCE_GATEWAY_UNAVAILABLE', 'Dữ liệu nhân sự tạm thời chưa sẵn sàng', 503, true);
}

function coreApiBaseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new WorkforceGatewayError('WORKFORCE_GATEWAY_NOT_CONFIGURED', 'Cổng dữ liệu nhân sự chưa được cấu hình', 503, false);
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new WorkforceGatewayError('WORKFORCE_GATEWAY_NOT_CONFIGURED', 'Cổng dữ liệu nhân sự chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new WorkforceGatewayError('WORKFORCE_GATEWAY_NOT_CONFIGURED', 'Cổng dữ liệu nhân sự chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function safeQuery(params: URLSearchParams) {
  const safe = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (ALLOWED_QUERY_KEYS.has(key) && value.length <= 128) safe.append(key, value);
  }
  const serialized = safe.toString();
  return serialized ? `?${serialized}` : '';
}

function mutationKey(value: string | undefined, operation: string) {
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized) return createIdempotencyKey(`web-${operation}`);
  if (!isValidIdempotencyKey(normalized)) {
    throw new WorkforceGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ', 400, false);
  }
  return normalized;
}

async function requestCore<T>({
  path,
  method,
  requestId,
  searchParams,
  body,
  idempotencyKey,
}: {
  path: string;
  method: 'GET' | 'POST';
  requestId: string;
  searchParams?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}/api/workforce${path}${searchParams ? safeQuery(searchParams) : ''}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload: CoreEnvelope<T>;
    try { payload = await response.json() as CoreEnvelope<T>; } catch {
      throw new WorkforceGatewayError('WORKFORCE_GATEWAY_RESPONSE_INVALID', 'Phản hồi dữ liệu nhân sự không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new WorkforceGatewayError(
        payload.error?.code || 'WORKFORCE_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu dữ liệu nhân sự không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new WorkforceGatewayError('WORKFORCE_GATEWAY_RESPONSE_INVALID', 'Phản hồi dữ liệu nhân sự không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof WorkforceGatewayError) throw error;
    throw new WorkforceGatewayError('WORKFORCE_GATEWAY_UNAVAILABLE', 'Cổng dữ liệu nhân sự tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listWorkPolicies<T>(requestId: string): Promise<T> {
  return requestCore<T>({ path: '/policies', method: 'GET', requestId });
}
export function createWorkPolicy<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    path: '/policies', method: 'POST', requestId, body,
    idempotencyKey: mutationKey(idempotencyKey, 'work-policy-save'),
  });
}
export function listEmployeePolicyAssignments<T>(requestId: string, employeeId: string): Promise<T> {
  return requestCore<T>({
    path: '/assignments', method: 'GET', requestId,
    searchParams: new URLSearchParams({ employeeId }),
  });
}
export function assignEmployeeWorkPolicy<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    path: '/assignments', method: 'POST', requestId, body,
    idempotencyKey: mutationKey(idempotencyKey, 'employee-policy-assign'),
  });
}
export function listWorkSchedules<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestCore<T>({ path: '/schedules', method: 'GET', requestId, searchParams });
}
export function upsertWorkSchedule<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    path: '/schedules', method: 'POST', requestId, body,
    idempotencyKey: mutationKey(idempotencyKey, 'work-schedule-save'),
  });
}


export function getAttendanceTimesheet<T>(requestId: string, searchParams: URLSearchParams): Promise<T> {
  return requestCore<T>({ path: '/attendance/timesheet', method: 'GET', requestId, searchParams });
}

export function getAttendanceToday<T>(requestId: string): Promise<T> {
  return requestCore<T>({ path: '/attendance/today', method: 'GET', requestId });
}
export function recordAttendance<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    path: '/attendance/record', method: 'POST', requestId, body,
    idempotencyKey: mutationKey(idempotencyKey, 'attendance-record'),
  });
}
export function getAttendancePointManagement<T>(requestId: string): Promise<T> {
  return requestCore<T>({ path: '/attendance/points', method: 'GET', requestId });
}
export function createAttendancePoint<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    path: '/attendance/points', method: 'POST', requestId, body,
    idempotencyKey: mutationKey(idempotencyKey, 'attendance-point-create'),
  });
}
export function createAttendanceQrToken<T>(requestId: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return requestCore<T>({
    path: '/attendance/qr-token', method: 'POST', requestId, body,
    idempotencyKey: mutationKey(idempotencyKey, 'attendance-qr-token'),
  });
}
