import { NextRequest, NextResponse } from 'next/server';
import { getDeliveryTrip, updateDeliveryTrip } from '../../../../../lib/logistics-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../../../inventory/_shared';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tripId: string }> },
) {
  const requestId = requestIdFrom(request);
  const { tripId } = await context.params;
  try {
    const data = await getDeliveryTrip<unknown>(tripId, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ tripId: string }> },
) {
  const requestId = requestIdFrom(request);
  const { tripId } = await context.params;
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu chuyến giao không hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  try {
    const data = await updateDeliveryTrip<unknown>(
      tripId,
      requestId,
      body,
      request.headers.get('idempotency-key'),
    );
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
