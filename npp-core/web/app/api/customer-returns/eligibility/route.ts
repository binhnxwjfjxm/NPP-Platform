import { NextRequest, NextResponse } from 'next/server';
import { listCustomerReturnEligibility } from '../../../../lib/delivery-order-gateway';
import { errorResponse, requestIdFrom, responseHeaders } from '../../inventory/_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request);
  try {
    const data = await listCustomerReturnEligibility<unknown[]>(requestId, request.nextUrl.searchParams);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
