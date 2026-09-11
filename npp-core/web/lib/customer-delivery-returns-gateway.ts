import 'server-only';
import { randomUUID } from 'node:crypto';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 8_000;

type CoreEnvelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean } };

export type CustomerDeliveryAttemptSummary = Readonly<{
  count: string;
  deliveredFullCount: string;
  deliveredPartialCount: string;
  failedCount: string;
  rescheduledCount: string;
  latestResult: string | null;
  latestAttemptAt: string | null;
  latestNote: string | null;
  latestRescheduledFor: string | null;
}>;

export type CustomerDeliveryHistoryItem = Readonly<{
  id: string;
  number: string | null;
  salesOrderId: string;
  salesOrderNumber: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  handoverMode: string;
  requestedDeliveryDate: string | null;
  status: string;
  lineCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  attempts: CustomerDeliveryAttemptSummary | null;
}>;

export type CustomerReturnHistoryItem = Readonly<{
  id: string;
  number: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  status: string;
  note: string | null;
  lineCount: number;
  acceptedLineCount: number;
  createdAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}>;

type CustomerHistoryPage<T> = Readonly<{
  offset: number;
  limit: number;
  hasPrevious: boolean;
  hasNext: boolean;
  items: readonly T[];
}>;

export type CustomerDeliveryReturnsHistory = Readonly<{
  permissions: Readonly<{
    deliveryOrders: boolean;
    deliveryAttempts: boolean;
    returns: boolean;
  }>;
  deliveries: CustomerHistoryPage<CustomerDeliveryHistoryItem>;
  returns: CustomerHistoryPage<CustomerReturnHistoryItem>;
}>;

export class CustomerDeliveryReturnsGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(publicMessage);
    this.name = 'CustomerDeliveryReturnsGatewayError';
  }
}

export function resolveCustomerDeliveryReturnsRequestId(value?: string | null) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

function validateCustomerId(value: string) {
  const id = String(value ?? '').trim();
  if (!UUID_PATTERN.test(id)) {
    throw new CustomerDeliveryReturnsGatewayError('INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ', 400, false);
  }
  return id;
}

function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) {
    throw new CustomerDeliveryReturnsGatewayError('CUSTOMER_DELIVERY_RETURNS_NOT_CONFIGURED', 'Lịch sử giao và trả hàng chưa được cấu hình', 503, false);
  }
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new CustomerDeliveryReturnsGatewayError('CUSTOMER_DELIVERY_RETURNS_NOT_CONFIGURED', 'Lịch sử giao và trả hàng chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new CustomerDeliveryReturnsGatewayError('CUSTOMER_DELIVERY_RETURNS_NOT_CONFIGURED', 'Lịch sử giao và trả hàng chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export async function getCustomerDeliveryReturns(
  customerId: string,
  requestId: string,
  options: Readonly<{
    deliveryLimit?: number;
    deliveryOffset?: number;
    returnLimit?: number;
    returnOffset?: number;
  }> = {},
): Promise<CustomerDeliveryReturnsHistory> {
  const id = validateCustomerId(customerId);
  const query = new URLSearchParams({
    deliveryLimit: String(options.deliveryLimit ?? 20),
    deliveryOffset: String(options.deliveryOffset ?? 0),
    returnLimit: String(options.returnLimit ?? 20),
    returnOffset: String(options.returnOffset ?? 0),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}/api/customers/${id}/delivery-returns?${query.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
      },
    });
    const payload = await response.json().catch(() => ({})) as CoreEnvelope<CustomerDeliveryReturnsHistory>;
    if (!response.ok || payload.data === undefined) {
      throw new CustomerDeliveryReturnsGatewayError(
        payload.error?.code || 'CUSTOMER_DELIVERY_RETURNS_REQUEST_FAILED',
        payload.error?.message || 'Chưa tải được lịch sử giao và trả hàng',
        response.status,
        payload.error?.retryable === true,
      );
    }
    return payload.data;
  } catch (error) {
    if (error instanceof CustomerDeliveryReturnsGatewayError) throw error;
    throw new CustomerDeliveryReturnsGatewayError(
      'CUSTOMER_DELIVERY_RETURNS_UNAVAILABLE',
      'Lịch sử giao và trả hàng tạm thời chưa khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}
