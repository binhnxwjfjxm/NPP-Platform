import { NextRequest, NextResponse } from 'next/server';
import {
  SalesOrderGatewayError,
  normalizeSalesOrderGatewayError,
  resolveSalesOrderRequestId,
} from '../../../lib/sales-order-gateway';

export function salesOrderRequestId(request: NextRequest): string {
  return resolveSalesOrderRequestId(request.headers.get('x-request-id'));
}

export function salesOrderResponse<T>(data: T, requestId: string, status = 200) {
  return NextResponse.json(
    { data, requestId },
    { status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
  );
}

export function salesOrderErrorResponse(error: unknown, requestId: string) {
  // Unexpected server-side failures used to be hidden behind a generic 503.
  // Record a safe error category + request ID for incident diagnosis only.
  // Never log cookies, Authorization, URL queries or the order payload.
  if (!(error instanceof SalesOrderGatewayError)) {
    const errorName = error instanceof Error && ['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(error.name)
      ? error.name : 'Unknown';
    console.error(JSON.stringify({
      event: 'sales_order_unhandled_gateway_error',
      requestId,
      errorName,
    }));
  }
  const normalized = normalizeSalesOrderGatewayError(error);
  return NextResponse.json(
    {
      error: {
        code: normalized.code,
        message: normalized.publicMessage,
        retryable: normalized.retryable,
        details: normalized.details,
      },
      requestId,
    },
    {
      status: normalized.statusCode,
      headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId },
    },
  );
}

export async function readSalesOrderBody(request: NextRequest, requestId: string) {
  try {
    return { ok: true as const, body: await request.json() as unknown };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: {
            code: 'INVALID_JSON_BODY',
            message: 'Nội dung yêu cầu không phải JSON hợp lệ',
            retryable: false,
          },
          requestId,
        },
        { status: 400, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
      ),
    };
  }
}

export function salesOrderIdempotencyKey(request: NextRequest): string {
  return request.headers.get('idempotency-key') ?? '';
}
