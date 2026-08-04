import { NextRequest, NextResponse } from 'next/server';
import { createCustomerReturn, listCustomerReturns } from '../../../lib/delivery-order-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../inventory/_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request);
  try {
    const data = await listCustomerReturns<unknown[]>(requestId, request.nextUrl.searchParams);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = requestIdFrom(request);
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu hàng khách trả không hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  try {
    const data = await createCustomerReturn<unknown>(requestId, body, request.headers.get('idempotency-key'));
    return NextResponse.json({ data, requestId }, { status: 201, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
