import { NextRequest, NextResponse } from 'next/server';
import type { PurchaseOrderSkuSearchOption } from '../../../../lib/purchase-order-types';
import { normalizePurchaseOrderSkuSearchFailure } from '../../../../lib/purchase-order-sku-entry';
import {
  normalizePurchaseOrderGatewayError,
  resolvePurchaseOrderRequestId,
  searchPurchaseOrderSkuOptions,
} from '../../../../lib/purchase-order-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

export async function GET(request: NextRequest) {
  const requestId = resolvePurchaseOrderRequestId(request.headers.get('x-request-id'));
  try {
    const searchParams = new URL(request.url).searchParams;
    const data = await searchPurchaseOrderSkuOptions<PurchaseOrderSkuSearchOption>(requestId, {
      search: searchParams.get('search') ?? '',
      limit: Number(searchParams.get('limit') ?? 20),
      offset: Number(searchParams.get('offset') ?? 0),
    });
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    const normalized = normalizePurchaseOrderGatewayError(error);
    const mapped = normalizePurchaseOrderSkuSearchFailure({
      code: normalized.code,
      message: normalized.publicMessage,
      statusCode: normalized.statusCode,
      retryable: normalized.retryable,
    });
    return NextResponse.json(
      { error: { code: mapped.code, message: mapped.message, retryable: mapped.retryable }, requestId },
      { status: mapped.statusCode, headers: responseHeaders(requestId) },
    );
  }
}
