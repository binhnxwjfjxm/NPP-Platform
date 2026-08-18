import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import { nppCoreBaseUrl, requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

type CoreEnvelope<T> = Readonly<{
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
}>;

export class ManualInboundOperatorGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'ManualInboundOperatorGatewayError';
  }
}

export function resolveManualInboundOperatorRequestId(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : `manual_inbound_${randomUUID()}`;
}

export function normalizeManualInboundOperatorGatewayError(error: unknown) {
  return error instanceof ManualInboundOperatorGatewayError
    ? error
    : new ManualInboundOperatorGatewayError(
      'MANUAL_INBOUND_OPERATOR_GATEWAY_UNAVAILABLE',
      'Nhập kho thủ công tạm thời chưa khả dụng',
      503,
      true,
    );
}

function requireMutationKey(value: string | null | undefined) {
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new ManualInboundOperatorGatewayError(
      'INVALID_IDEMPOTENCY_KEY',
      'Khóa chống trùng yêu cầu không hợp lệ',
      400,
      false,
    );
  }
  return normalized;
}

async function requestCore<T>({
  path,
  method,
  requestId,
  body,
  idempotencyKey,
}: {
  path: string;
  method: 'GET' | 'POST';
  requestId: string;
  body?: unknown;
  idempotencyKey?: string | null;
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
        ...(idempotencyKey ? { 'Idempotency-Key': requireMutationKey(idempotencyKey) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) {
      throw new ManualInboundOperatorGatewayError(
        'MANUAL_INBOUND_OPERATOR_RESPONSE_INVALID',
        'Phản hồi Nhập kho thủ công không hợp lệ',
        502,
        false,
      );
    }
    if (!response.ok) {
      throw new ManualInboundOperatorGatewayError(
        payload.error?.code || 'MANUAL_INBOUND_OPERATOR_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu Nhập kho thủ công không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new ManualInboundOperatorGatewayError(
        'MANUAL_INBOUND_OPERATOR_RESPONSE_INVALID',
        'Phản hồi Nhập kho thủ công không hợp lệ',
        502,
        false,
      );
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof ManualInboundOperatorGatewayError) throw error;
    throw new ManualInboundOperatorGatewayError(
      'MANUAL_INBOUND_OPERATOR_GATEWAY_UNAVAILABLE',
      'Nhập kho thủ công tạm thời chưa khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function listManualInboundOperatorWarehouses<T>(requestId: string): Promise<T> {
  return requestCore<T>({ path: '/api/inventory/manual-inbounds/operator/warehouses', method: 'GET', requestId });
}

export function listManualInboundOperatorLocations<T>(warehouseId: string, requestId: string): Promise<T> {
  const query = new URLSearchParams({ warehouseId: String(warehouseId ?? '').trim() });
  return requestCore<T>({ path: `/api/inventory/manual-inbounds/operator/locations?${query.toString()}`, method: 'GET', requestId });
}

export function searchManualInboundOperatorHistory<T>({ inboundType, referenceNumber, requestId }: {
  inboundType?: string | null;
  referenceNumber?: string | null;
  requestId: string;
}): Promise<T> {
  const query = new URLSearchParams();
  const type = String(inboundType ?? '').trim();
  const reference = String(referenceNumber ?? '').trim();
  if (type) query.set('inboundType', type);
  if (reference) query.set('referenceNumber', reference);
  query.set('limit', '100');
  return requestCore<T>({ path: `/api/inventory/manual-inbounds/operator/history?${query.toString()}`, method: 'GET', requestId });
}

export function readManualInboundOperatorHistoryDetail<T>(documentId: string, requestId: string): Promise<T> {
  const query = new URLSearchParams({ documentId: String(documentId ?? '').trim() });
  return requestCore<T>({ path: `/api/inventory/manual-inbounds/operator/history-detail?${query.toString()}`, method: 'GET', requestId });
}

export function previewManualInboundOperator<T>(body: unknown, requestId: string): Promise<T> {
  return requestCore<T>({ path: '/api/inventory/manual-inbounds/operator/preview', method: 'POST', requestId, body });
}

export function confirmManualInboundOperator<T>(body: unknown, requestId: string, idempotencyKey: string | null): Promise<T> {
  return requestCore<T>({ path: '/api/inventory/manual-inbounds/operator/confirm', method: 'POST', requestId, body, idempotencyKey: requireMutationKey(idempotencyKey) });
}

export function reverseManualInboundOperator<T>({ documentId, documentDate, reasonNote, requestId, idempotencyKey }: {
  documentId: string;
  documentDate: string;
  reasonNote: string;
  requestId: string;
  idempotencyKey: string | null;
}): Promise<T> {
  return requestCore<T>({
    path: `/api/inventory/manual-inbounds/${encodeURIComponent(String(documentId ?? '').trim())}/reverse`,
    method: 'POST',
    requestId,
    idempotencyKey: requireMutationKey(idempotencyKey),
    body: { documentDate: String(documentDate ?? '').trim(), reasonCode: 'MANUAL_INBOUND_CORRECTION', reasonNote: String(reasonNote ?? '').trim() },
  });
}
