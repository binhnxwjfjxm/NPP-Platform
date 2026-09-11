import { NextRequest, NextResponse } from 'next/server';
import {
  convertWarehouseLocationMode,
  normalizeWarehouseLocationModeGatewayError,
  resolveWarehouseLocationModeRequestId,
} from '../../../../../../../lib/warehouse-location-mode-gateway';

export const dynamic = 'force-dynamic';

function headers(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = resolveWarehouseLocationModeRequestId(request.headers.get('x-request-id'));
  let payload: { targetMode?: string; destinationLocationId?: string | null; previewHash?: string };
  try {
    payload = await request.json() as { targetMode?: string; destinationLocationId?: string | null; previewHash?: string };
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu gửi lên không hợp lệ.', retryable: false }, requestId },
      { status: 400, headers: headers(requestId) },
    );
  }

  try {
    const data = await convertWarehouseLocationMode<unknown>(
      params.id,
      requestId,
      {
        targetMode: payload.targetMode ?? '',
        destinationLocationId: payload.destinationLocationId ?? null,
        previewHash: payload.previewHash ?? '',
      },
      request.headers.get('idempotency-key'),
    );
    return NextResponse.json({ data, requestId }, { status: 200, headers: headers(requestId) });
  } catch (error) {
    const normalized = normalizeWarehouseLocationModeGatewayError(error);
    return NextResponse.json(
      { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
      { status: normalized.statusCode, headers: headers(requestId) },
    );
  }
}
