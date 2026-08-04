import { NextRequest, NextResponse } from 'next/server';
import { getCustomerReturn } from '../../../../lib/delivery-order-gateway';
import { errorResponse, requestIdFrom, responseHeaders } from '../../inventory/_shared';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ customerReturnId: string }> },
) {
  const requestId = requestIdFrom(request);
  const { customerReturnId } = await context.params;
  try {
    const data = await getCustomerReturn<unknown>(customerReturnId, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
