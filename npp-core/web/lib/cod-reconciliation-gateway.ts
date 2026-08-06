import 'server-only';
import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
const REQUEST_TIMEOUT_MS = 8_000;

type CoreEnvelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };

export class CodReconciliationGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'CodReconciliationGatewayError';
  }
}

export function resolveCodRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeCodGatewayError(error: unknown) {
  if (error instanceof CodReconciliationGatewayError) return error;
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; statusCode?: unknown; message?: unknown; retryable?: unknown; details?: unknown };
    const code = typeof candidate.code === 'string' ? candidate.code : null;
    const statusCode = typeof candidate.statusCode === 'number' ? candidate.statusCode : null;
    const message = typeof candidate.message === 'string' ? candidate.message : null;
    if (code && statusCode && message) {
      return new CodReconciliationGatewayError(code, message, statusCode, candidate.retryable === true, candidate.details ?? {});
    }
  }
  return new CodReconciliationGatewayError('COD_GATEWAY_UNAVAILABLE', 'Đối soát COD tạm thời chưa khả dụng', 503, true);
}

function serverValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN') {
  const value = process.env[name]?.trim();
  if (!value) throw new CodReconciliationGatewayError('COD_GATEWAY_NOT_CONFIGURED', 'Đối soát COD chưa được cấu hình', 503, false);
  return value;
}

function baseUrl() {
  let parsed: URL;
  try { parsed = new URL(serverValue('CORE_API_INTERNAL_URL')); } catch {
    throw new CodReconciliationGatewayError('COD_GATEWAY_NOT_CONFIGURED', 'Đối soát COD chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new CodReconciliationGatewayError('COD_GATEWAY_NOT_CONFIGURED', 'Đối soát COD chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new CodReconciliationGatewayError('COD_GATEWAY_NOT_CONFIGURED', 'Đối soát COD chưa được cấu hình', 503, false);
  }
  return parsed.toString().replace(/\/$/, '');
}

function uuid(value: string, message: string) {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) throw new CodReconciliationGatewayError('INVALID_COD_ID', message, 400, false);
  return normalized;
}

function key(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new CodReconciliationGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống trùng yêu cầu không hợp lệ', 400, false);
  }
  return normalized;
}

async function requestCore<T>(method: 'GET' | 'POST', path: string, requestId: string, options: {
  query?: URLSearchParams;
  body?: unknown;
  idempotencyKey?: string;
} = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const query = options.query?.toString();
  try {
    const response = await fetch(`${baseUrl()}${path}${query ? `?${query}` : ''}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${serverValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.idempotencyKey ? { 'Idempotency-Key': key(options.idempotencyKey) } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) throw new CodReconciliationGatewayError('COD_GATEWAY_RESPONSE_INVALID', 'Phản hồi đối soát COD không hợp lệ', 502, false);
    if (!response.ok) throw new CodReconciliationGatewayError(
      payload.error?.code || 'COD_REQUEST_FAILED',
      payload.error?.message || 'Yêu cầu đối soát COD không thành công',
      response.status,
      payload.error?.retryable === true,
      payload.error?.details ?? {},
    );
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) throw new CodReconciliationGatewayError('COD_GATEWAY_RESPONSE_INVALID', 'Phản hồi đối soát COD không hợp lệ', 502, false);
    return payload.data as T;
  } catch (error) {
    if (error instanceof CodReconciliationGatewayError) throw error;
    throw new CodReconciliationGatewayError('COD_GATEWAY_UNAVAILABLE', 'Đối soát COD tạm thời chưa khả dụng', 503, true);
  } finally { clearTimeout(timeout); }
}

export function listCodHandovers<T>(requestId: string, params?: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '' && ['status', 'limit', 'offset'].includes(name)) query.set(name, String(value));
  }
  return requestCore<T[]>('GET', '/api/cod-reconciliation', requestId, { query });
}

export function getCodHandover<T>(handoverId: string, requestId: string) {
  return requestCore<T>('GET', `/api/cod-reconciliation/${uuid(handoverId, 'Bàn giao COD không hợp lệ')}`, requestId);
}

export function acceptCodHandover<T>(handoverId: string, body: unknown, requestId: string, idempotencyKey: string) {
  return requestCore<T>('POST', `/api/cod-reconciliation/${uuid(handoverId, 'Bàn giao COD không hợp lệ')}/accept`, requestId, { body, idempotencyKey });
}

export function reverseCodCollection<T>(collectionId: string, body: unknown, requestId: string, idempotencyKey: string) {
  return requestCore<T>('POST', `/api/cod-reconciliation/collections/${uuid(collectionId, 'Khoản thu COD không hợp lệ')}/reverse`, requestId, { body, idempotencyKey });
}

export function reverseCodHandover<T>(handoverId: string, body: unknown, requestId: string, idempotencyKey: string) {
  return requestCore<T>('POST', `/api/cod-reconciliation/handovers/${uuid(handoverId, 'Bàn giao COD không hợp lệ')}/reverse`, requestId, { body, idempotencyKey });
}

export function reverseCodAcceptance<T>(acceptanceId: string, body: unknown, requestId: string, idempotencyKey: string) {
  return requestCore<T>('POST', `/api/cod-reconciliation/acceptances/${uuid(acceptanceId, 'Xác nhận COD không hợp lệ')}/reverse`, requestId, { body, idempotencyKey });
}
