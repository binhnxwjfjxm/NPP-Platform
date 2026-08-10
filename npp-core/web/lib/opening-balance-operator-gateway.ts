import 'server-only';
import { randomUUID } from 'node:crypto';
import { nppCoreBaseUrl, requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

type CoreEnvelope<T> = Readonly<{
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
}>;

export class OpeningBalanceOperatorGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'OpeningBalanceOperatorGatewayError';
  }
}

export function resolveOpeningBalanceOperatorRequestId(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : `opening_${randomUUID()}`;
}

function idempotencyKey(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new OpeningBalanceOperatorGatewayError(
      'INVALID_IDEMPOTENCY_KEY',
      'Khóa chống nhập trùng không hợp lệ',
      400,
      false,
    );
  }
  return normalized;
}

export function normalizeOpeningBalanceOperatorGatewayError(error: unknown) {
  return error instanceof OpeningBalanceOperatorGatewayError
    ? error
    : new OpeningBalanceOperatorGatewayError(
      'OPENING_BALANCE_OPERATOR_GATEWAY_UNAVAILABLE',
      'Tồn đầu kỳ tạm thời chưa khả dụng',
      503,
      true,
    );
}

async function requestCore<T>({
  path,
  method,
  requestId,
  body,
  idempotency,
}: {
  path: string;
  method: 'GET' | 'POST';
  requestId: string;
  body?: unknown;
  idempotency?: string | null;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${nppCoreBaseUrl()}${path}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotency ? { 'Idempotency-Key': idempotencyKey(idempotency) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) {
      throw new OpeningBalanceOperatorGatewayError(
        'OPENING_BALANCE_OPERATOR_RESPONSE_INVALID',
        'Phản hồi tồn đầu kỳ không hợp lệ',
        502,
        false,
      );
    }
    if (!response.ok) {
      throw new OpeningBalanceOperatorGatewayError(
        payload.error?.code || 'OPENING_BALANCE_OPERATOR_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu tồn đầu kỳ không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new OpeningBalanceOperatorGatewayError(
        'OPENING_BALANCE_OPERATOR_RESPONSE_INVALID',
        'Phản hồi tồn đầu kỳ không hợp lệ',
        502,
        false,
      );
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof OpeningBalanceOperatorGatewayError) throw error;
    throw new OpeningBalanceOperatorGatewayError(
      'OPENING_BALANCE_OPERATOR_GATEWAY_UNAVAILABLE',
      'Tồn đầu kỳ tạm thời chưa khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function listOpeningBalanceOperatorWarehouses<T>(requestId: string): Promise<T> {
  return requestCore<T>({
    path: '/api/inventory/opening-balances/operator/warehouses',
    method: 'GET',
    requestId,
  });
}

export function listOpeningBalanceOperatorLocations<T>(warehouseId: string, requestId: string): Promise<T> {
  const query = new URLSearchParams({ warehouseId: String(warehouseId ?? '').trim() });
  return requestCore<T>({
    path: `/api/inventory/opening-balances/operator/locations?${query.toString()}`,
    method: 'GET',
    requestId,
  });
}

export function validateOpeningBalanceOperator<T>(body: unknown, requestId: string): Promise<T> {
  return requestCore<T>({
    path: '/api/inventory/opening-balances/operator/validate',
    method: 'POST',
    requestId,
    body,
  });
}

export function postOpeningBalanceOperator<T>(body: unknown, requestId: string, key: string | null): Promise<T> {
  return requestCore<T>({
    path: '/api/inventory/opening-balances/operator/post',
    method: 'POST',
    requestId,
    body,
    idempotency: key,
  });
}
