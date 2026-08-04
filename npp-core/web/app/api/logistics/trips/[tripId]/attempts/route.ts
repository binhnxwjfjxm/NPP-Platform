import { NextRequest, NextResponse } from 'next/server';
import { getDeliveryAttemptSummary } from '../../../../../../lib/delivery-attempt-gateway';
import { errorResponse, requestIdFrom, responseHeaders } from '../../../../inventory/_shared';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tripId: string }> },
) {
  const requestId = requestIdFrom(request);
  const { tripId } = await context.params;
  try {
    const data = await getDeliveryAttemptSummary<unknown>(tripId, requestId);
    return NextResponse.json(
      { data, requestId },
      { status: 200, headers: responseHeaders(requestId) },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
