import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 30_000;

type LocationManagementMode = 'MANAGED' | 'UNMANAGED';

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

export class WarehouseLocationModeGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'WarehouseLocationModeGatewayError';
  }
}

export function resolveWarehouseLocationModeRequestId(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeWarehouseLocationModeGatewayError(error: unknown): WarehouseLocationModeGatewayError {
  return error instanceof WarehouseLocationModeGatewayError
    ? error
    : new WarehouseLocationModeGatewayError(
      'WAREHOUSE_LOCATION_MODE_GATEWAY_UNAVAILABLE',
      'Dịch vụ quản lý vị trí của kho tạm thời chưa sẵn sàng.',
      503,
      true,
    );
}

function coreApiBaseUrl(): string {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) {
    throw new WarehouseLocationModeGatewayError(
      'WAREHOUSE_LOCATION_MODE_GATEWAY_NOT_CONFIGURED',
      'Dịch vụ quản lý vị trí của kho chưa được cấu hình.',
      503,
      false,
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WarehouseLocationModeGatewayError(
      'WAREHOUSE_LOCATION_MODE_GATEWAY_NOT_CONFIGURED',
      'Dịch vụ quản lý vị trí của kho chưa được cấu hình.',
      503,
      false,
    );
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new WarehouseLocationModeGatewayError(
      'WAREHOUSE_LOCATION_MODE_GATEWAY_NOT_CONFIGURED',
      'Dịch vụ quản lý vị trí của kho chưa được cấu hình.',
      503,
      false,
    );
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function requireWarehouseId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new WarehouseLocationModeGatewayError('INVALID_WAREHOUSE_ID', 'Kho không hợp lệ.', 400, false);
  }
  return value;
}

function requireMode(value: string): LocationManagementMode {
  if (value === 'MANAGED' || value === 'UNMANAGED') return value;
  throw new WarehouseLocationModeGatewayError('INVALID_LOCATION_MANAGEMENT_MODE', 'Chế độ quản lý vị trí không hợp lệ.', 400, false);
}

function requireIdempotencyKey(value: string | null): string {
  const key = normalizeIdempotencyKey(value);
  if (!key || !isValidIdempotencyKey(key)) {
    throw new WarehouseLocationModeGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ.', 400, false);
  }
  return key;
}

async function requestCore<T>({
  warehouseId,
  suffix,
  method,
  requestId,
  targetMode,
  destinationLocationId,
  previewHash,
  idempotencyKey,
}: {
  warehouseId: string;
  suffix: 'preview' | 'convert';
  method: 'GET' | 'POST';
  requestId: string;
  targetMode: string;
  destinationLocationId?: string | null;
  previewHash?: string;
  idempotencyKey?: string | null;
}): Promise<T> {
  const normalizedWarehouseId = requireWarehouseId(warehouseId);
  const normalizedTargetMode = requireMode(targetMode);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = new URL(`${coreApiBaseUrl()}/api/inventory/warehouses/${normalizedWarehouseId}/location-mode/${suffix}`);
    const body = method === 'POST'
      ? {
        targetMode: normalizedTargetMode,
        destinationLocationId: destinationLocationId ?? null,
        previewHash,
      }
      : undefined;
    if (method === 'GET') {
      url.searchParams.set('targetMode', normalizedTargetMode);
      if (destinationLocationId) url.searchParams.set('destinationLocationId', destinationLocationId);
    }

    const response = await fetch(url, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'Idempotency-Key': requireIdempotencyKey(idempotencyKey ?? null) } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let payload: CoreEnvelope<T>;
    try {
      payload = await response.json() as CoreEnvelope<T>;
    } catch {
      throw new WarehouseLocationModeGatewayError('WAREHOUSE_LOCATION_MODE_GATEWAY_RESPONSE_INVALID', 'Phản hồi quản lý vị trí của kho không hợp lệ.', 502, false);
    }
    if (!response.ok) {
      throw new WarehouseLocationModeGatewayError(
        payload.error?.code ?? 'WAREHOUSE_LOCATION_MODE_REQUEST_FAILED',
        payload.error?.message ?? 'Không thể thực hiện thao tác quản lý vị trí của kho.',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new WarehouseLocationModeGatewayError('WAREHOUSE_LOCATION_MODE_GATEWAY_RESPONSE_INVALID', 'Phản hồi quản lý vị trí của kho không hợp lệ.', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof WarehouseLocationModeGatewayError) throw error;
    throw new WarehouseLocationModeGatewayError('WAREHOUSE_LOCATION_MODE_GATEWAY_UNAVAILABLE', 'Dịch vụ quản lý vị trí của kho tạm thời chưa sẵn sàng.', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function previewWarehouseLocationMode<T>(
  warehouseId: string,
  requestId: string,
  targetMode: string,
  destinationLocationId?: string | null,
): Promise<T> {
  return requestCore<T>({ warehouseId, suffix: 'preview', method: 'GET', requestId, targetMode, destinationLocationId });
}

export function convertWarehouseLocationMode<T>(
  warehouseId: string,
  requestId: string,
  payload: { targetMode: string; destinationLocationId?: string | null; previewHash: string },
  idempotencyKey: string | null,
): Promise<T> {
  if (!/^[0-9a-f]{64}$/.test(payload.previewHash)) {
    throw new WarehouseLocationModeGatewayError('INVALID_PREVIEW_HASH', 'Bản xem trước không hợp lệ. Hãy xem trước lại.', 400, false);
  }
  return requestCore<T>({
    warehouseId,
    suffix: 'convert',
    method: 'POST',
    requestId,
    targetMode: payload.targetMode,
    destinationLocationId: payload.destinationLocationId,
    previewHash: payload.previewHash,
    idempotencyKey,
  });
}
