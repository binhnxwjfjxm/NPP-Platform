import { NextRequest, NextResponse } from 'next/server';
import {
  resolveSupplierPurchasePriceRequestId,
  SupplierPurchasePriceGatewayError,
} from '../../../lib/supplier-purchase-price-gateway';

export function purchasePriceRequestId(request: NextRequest): string {
  return resolveSupplierPurchasePriceRequestId(request.headers.get('x-request-id'));
}

export function purchasePriceResponse<T>(data: T, requestId: string, status = 200) {
  return NextResponse.json(
    { data, requestId },
    { status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
  );
}

export function purchasePriceErrorResponse(error: unknown, requestId: string) {
  const normalized = error instanceof SupplierPurchasePriceGatewayError
    ? error
    : new SupplierPurchasePriceGatewayError('PURCHASE_PRICE_GATEWAY_UNAVAILABLE', 'Bảng giá mua tạm thời chưa khả dụng.', 503, true);
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
    { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
  );
}

export async function readPurchasePriceBody(request: NextRequest, requestId: string) {
  try {
    return { ok: true as const, body: await request.json() as unknown };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: {
            code: 'INVALID_JSON_BODY',
            message: 'Nội dung yêu cầu không phải JSON hợp lệ.',
            retryable: false,
          },
          requestId,
        },
        { status: 400, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
      ),
    };
  }
}
