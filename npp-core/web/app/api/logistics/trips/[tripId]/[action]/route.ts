import { NextRequest, NextResponse } from 'next/server';
import { transitionDeliveryTrip } from '../../../../../../lib/logistics-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../../../../inventory/_shared';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tripId: string; action: string }> },
) {
  const requestId = requestIdFrom(request);
  const { tripId, action } = await context.params;
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu thao tác chuyến không hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  try {
    const data = await transitionDeliveryTrip<unknown>(
      tripId,
      action,
      requestId,
      body,
      request.headers.get('idempotency-key'),
    );
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
