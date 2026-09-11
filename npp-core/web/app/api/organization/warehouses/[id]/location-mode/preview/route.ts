import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeWarehouseLocationModeGatewayError,
  previewWarehouseLocationMode,
  resolveWarehouseLocationModeRequestId,
} from '../../../../../../../lib/warehouse-location-mode-gateway';

export const dynamic = 'force-dynamic';

function headers(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = resolveWarehouseLocationModeRequestId(request.headers.get('x-request-id'));
  try {
    const data = await previewWarehouseLocationMode<unknown>(
      params.id,
      requestId,
      request.nextUrl.searchParams.get('targetMode') ?? '',
      request.nextUrl.searchParams.get('destinationLocationId'),
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
