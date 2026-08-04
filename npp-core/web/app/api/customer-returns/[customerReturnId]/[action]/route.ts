import { NextRequest, NextResponse } from 'next/server';
import { transitionCustomerReturn } from '../../../../../lib/delivery-order-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../../../inventory/_shared';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ customerReturnId: string; action: string }> },
) {
  const requestId = requestIdFrom(request);
  const { customerReturnId, action } = await context.params;
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu hàng khách trả không hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  try {
    const data = await transitionCustomerReturn<unknown>(
      customerReturnId,
      action,
      requestId,
      body,
      request.headers.get('idempotency-key'),
    );
    return NextResponse.json({ data, requestId }, { status: 201, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
