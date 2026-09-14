import { NextRequest } from 'next/server';
import { requireNppWorkforceSessionToken } from '../../../../lib/internal-auth-client';
import { SalesOrderGatewayError } from '../../../../lib/sales-order-gateway';
import {
  salesOrderErrorResponse,
  salesOrderRequestId,
  salesOrderResponse,
} from '../../sales-orders/_route-helpers';

export const dynamic = 'force-dynamic';

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
  return url.toString().replace(/\/$/, '');
}

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

async function loadCatalog<T>(requestId: string, since: string | null): Promise<T> {
  const query = new URLSearchParams();
  if (since) query.set('since', since.slice(0, 64));
  const queryText = query.toString();
  const suffix = queryText ? `?${queryText}` : '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${coreUrl()}/api/products/sales-order-local-catalog${suffix}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
      },
    });
    let payload: CoreEnvelope<T>;
    try {
      payload = await response.json() as CoreEnvelope<T>;
    } catch {
      throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi danh mục hàng hóa không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new SalesOrderGatewayError(
        payload.error?.code ?? 'SALES_ORDER_LOCAL_CATALOG_UNAVAILABLE',
        payload.error?.message ?? 'Chưa cập nhật được danh mục hàng hóa',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new SalesOrderGatewayError('SALES_ORDER_GATEWAY_RESPONSE_INVALID', 'Phản hồi danh mục hàng hóa không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof SalesOrderGatewayError) throw error;
    throw new SalesOrderGatewayError('SALES_ORDER_LOCAL_CATALOG_UNAVAILABLE', 'Chưa cập nhật được danh mục hàng hóa', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const requestId = salesOrderRequestId(request);
  try {
    const data = await loadCatalog(requestId, request.nextUrl.searchParams.get('since'));
    return salesOrderResponse(data, requestId);
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
