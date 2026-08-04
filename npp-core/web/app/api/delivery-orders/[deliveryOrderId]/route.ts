import { NextRequest, NextResponse } from 'next/server';
import { getDeliveryOrder } from '../../../../lib/delivery-order-gateway';
import { errorResponse, requestIdFrom, responseHeaders } from '../../inventory/_shared';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ deliveryOrderId: string }> },
) {
  const requestId = requestIdFrom(request);
  const { deliveryOrderId } = await context.params;
  try {
    const data = await getDeliveryOrder<unknown>(deliveryOrderId, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
