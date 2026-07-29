import { NextRequest, NextResponse } from 'next/server';
import {
  normalizePurchaseOrderGatewayError,
  resolvePurchaseOrderRequestId,
} from '../../../lib/purchase-order-gateway';

export function purchaseOrderRequestId(request: NextRequest): string {
  return resolvePurchaseOrderRequestId(request.headers.get('x-request-id'));
}

export function purchaseOrderResponse<T>(data: T, requestId: string, status = 200) {
  return NextResponse.json(
    { data, requestId },
    { status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
  );
}

export function purchaseOrderErrorResponse(error: unknown, requestId: string) {
  const normalized = normalizePurchaseOrderGatewayError(error);
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

export async function readPurchaseOrderBody(request: NextRequest, requestId: string) {
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

export function purchaseOrderIdempotencyKey(request: NextRequest): string {
  return request.headers.get('idempotency-key') ?? '';
}
