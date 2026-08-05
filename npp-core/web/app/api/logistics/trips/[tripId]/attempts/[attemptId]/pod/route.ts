import { NextRequest, NextResponse } from 'next/server';
import { getDeliveryAttemptProofs } from '../../../../../../../../lib/delivery-attempt-gateway';
import { errorResponse, requestIdFrom, responseHeaders } from '../../../../../../inventory/_shared';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: { tripId: string; attemptId: string } },
) {
  const requestId = requestIdFrom(request);
  const { tripId, attemptId } = context.params;
  try {
    const data = await getDeliveryAttemptProofs<unknown>(tripId, attemptId, requestId);
    return NextResponse.json(
      { data, requestId },
      { status: 200, headers: responseHeaders(requestId) },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
