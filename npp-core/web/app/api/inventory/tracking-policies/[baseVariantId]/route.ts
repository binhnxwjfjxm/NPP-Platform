import { NextRequest, NextResponse } from 'next/server';
import { getInventoryTrackingPolicy, upsertInventoryTrackingPolicy } from '../../../../../lib/inventory-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../../_shared';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ baseVariantId: string }> }) {
  const request = _request;
  const { baseVariantId } = await context.params;
  const requestId = requestIdFrom(request);
  try {
    const data = await getInventoryTrackingPolicy<unknown>(baseVariantId, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ baseVariantId: string }> }) {
  const { baseVariantId } = await context.params;
  const requestId = requestIdFrom(request);
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Nội dung yêu cầu phải là JSON hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  try {
    const data = await upsertInventoryTrackingPolicy<unknown>(
      baseVariantId,
      requestId,
      body,
      request.headers.get('idempotency-key') ?? undefined,
    );
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
