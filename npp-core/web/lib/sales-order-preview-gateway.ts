import 'server-only';
import { requireNppWorkforceSessionToken } from './internal-auth-client';
import { SalesOrderGatewayError } from './sales-order-gateway';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

function uuid(value: string, code: string, message: string): string {
  const normalized = String(value ?? '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new SalesOrderGatewayError(code, message, 400, false);
  return normalized;
}

function coreUrl(): string {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng bán hàng chưa được cấu hình', 503, false);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng bán hàng chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_NOT_CONFIGURED', 'Chức năng bán hàng chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export async function searchSalesOrderSkuPreviews<T>(requestId: string, searchParams: URLSearchParams): Promise<T[]> {
  const variantIds = [...new Set(searchParams.getAll('variantId').map((value) => uuid(value, 'INVALID_SALES_ORDER_SEARCH_VARIANT', 'Mã hàng hóa không hợp lệ')))];
  if (variantIds.length === 0 || variantIds.length > 50) {
    throw new SalesOrderGatewayError('INVALID_SALES_ORDER_SEARCH_VARIANTS', 'Danh sách hàng hóa không hợp lệ', 400, false);
  }
  const warehouseId = uuid(searchParams.get('warehouseId') ?? '', 'INVALID_WAREHOUSE_ID', 'Mã kho không hợp lệ');
  const salesChannelId = uuid(searchParams.get('salesChannelId') ?? '', 'INVALID_SALES_CHANNEL_ID', 'Kênh bán không hợp lệ');
  const customerId = searchParams.get('customerId')?.trim();
  const pricingAt = searchParams.get('pricingAt')?.trim() ?? '';
  if (!pricingAt || Number.isNaN(new Date(pricingAt).getTime())) {
    throw new SalesOrderGatewayError('INVALID_PRICING_AT', 'Thời điểm tính giá không hợp lệ', 400, false);
  }
  const query = new URLSearchParams({ warehouseId, salesChannelId, pricingAt: new Date(pricingAt).toISOString() });
  if (customerId) query.set('customerId', uuid(customerId, 'INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ'));
  for (const variantId of variantIds) query.append('variantId', variantId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreUrl()}/api/sales-orders/sku-previews?${query}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
      },
    });
    let payload: CoreEnvelope<T[]>;
    try {
      payload = await response.json() as CoreEnvelope<T[]>;
    } catch {
      throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi bán hàng không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new SalesOrderGatewayError(
        payload.error?.code ?? 'SALES_ORDER_REQUEST_FAILED',
        payload.error?.message ?? 'Yêu cầu bán hàng không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi bán hàng không hợp lệ', 502, false);
    }
    return payload.data as T[];
  } catch (error) {
    if (error instanceof SalesOrderGatewayError) throw error;
    throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_UNAVAILABLE', 'Chức năng bán hàng tạm thời chưa khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}
