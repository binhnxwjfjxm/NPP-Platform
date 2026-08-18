import 'server-only';
import { randomUUID } from 'node:crypto';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export class InventoryHoldGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'InventoryHoldGatewayError';
  }
}

function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new InventoryHoldGatewayError('INVENTORY_HOLD_GATEWAY_NOT_CONFIGURED', 'Cổng dữ liệu hàng đang giữ chưa được cấu hình', 503, false);
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new InventoryHoldGatewayError('INVENTORY_HOLD_GATEWAY_NOT_CONFIGURED', 'Cổng dữ liệu hàng đang giữ chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function resolveInventoryHoldRequestId(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : `web_${randomUUID()}`;
}

export function normalizeInventoryHoldGatewayError(error: unknown) {
  return error instanceof InventoryHoldGatewayError
    ? error
    : new InventoryHoldGatewayError('INVENTORY_HOLD_GATEWAY_UNAVAILABLE', 'Dữ liệu hàng đang giữ tạm thời chưa sẵn sàng', 503, true);
}

export async function getInventoryHoldBreakdown<T>({
  warehouseId,
  baseVariantId,
  excludeSalesOrderId = null,
  requestId,
}: {
  warehouseId: string;
  baseVariantId: string;
  excludeSalesOrderId?: string | null;
  requestId: string;
}): Promise<T> {
  if (!UUID_PATTERN.test(warehouseId) || !UUID_PATTERN.test(baseVariantId)
      || (excludeSalesOrderId && !UUID_PATTERN.test(excludeSalesOrderId))) {
    throw new InventoryHoldGatewayError('INVALID_HOLD_SCOPE', 'Phạm vi xem hàng đang giữ không hợp lệ', 400, false);
  }
  const query = new URLSearchParams({ warehouseId, baseVariantId });
  if (excludeSalesOrderId) query.set('excludeSalesOrderId', excludeSalesOrderId);
  try {
    const response = await fetch(`${baseUrl()}/api/inventory/holds?${query.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
      },
    });
    const envelope = await response.json().catch(() => null) as {
      data?: T;
      error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
    } | null;
    if (!response.ok) {
      throw new InventoryHoldGatewayError(
        envelope?.error?.code || 'INVENTORY_HOLD_REQUEST_FAILED',
        envelope?.error?.message || 'Không tải được danh sách đơn đang giữ hàng',
        response.status,
        envelope?.error?.retryable === true,
        envelope?.error?.details ?? {},
      );
    }
    if (!envelope || !Object.prototype.hasOwnProperty.call(envelope, 'data')) {
      throw new InventoryHoldGatewayError('INVENTORY_HOLD_RESPONSE_INVALID', 'Phản hồi hàng đang giữ không hợp lệ', 502, false);
    }
    return envelope.data as T;
  } catch (error) {
    if (error instanceof InventoryHoldGatewayError) throw error;
    throw new InventoryHoldGatewayError('INVENTORY_HOLD_GATEWAY_UNAVAILABLE', 'Dữ liệu hàng đang giữ tạm thời chưa sẵn sàng', 503, true);
  }
}
