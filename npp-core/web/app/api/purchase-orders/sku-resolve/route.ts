import { NextRequest, NextResponse } from 'next/server';
import type { PurchaseOrderSkuResolution } from '../../../../lib/purchase-order-types';
import {
  normalizePurchaseOrderGatewayError,
  resolvePurchaseOrderRequestId,
  resolvePurchaseOrderSkuOptions,
} from '../../../../lib/purchase-order-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

export async function POST(request: NextRequest) {
  const requestId = resolvePurchaseOrderRequestId(request.headers.get('x-request-id'));
  try {
    const payload = await request.json().catch(() => null) as { identifiers?: unknown } | null;
    const identifiers = Array.isArray(payload?.identifiers)
      ? payload.identifiers.map((value) => String(value ?? '').trim()).filter(Boolean).slice(0, 500)
      : [];
    const data = await resolvePurchaseOrderSkuOptions<PurchaseOrderSkuResolution>(requestId, identifiers);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    const normalized = normalizePurchaseOrderGatewayError(error);
    return NextResponse.json(
      { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable }, requestId },
      { status: normalized.statusCode, headers: responseHeaders(requestId) },
    );
  }
}
