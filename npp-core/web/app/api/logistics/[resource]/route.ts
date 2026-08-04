import { NextRequest, NextResponse } from 'next/server';
import { createLogisticsResource, listLogisticsResource } from '../../../../lib/logistics-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../../inventory/_shared';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  const requestId = requestIdFrom(request);
  const { resource } = await context.params;
  try {
    const data = await listLogisticsResource<unknown[]>(resource, requestId, request.nextUrl.searchParams);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  const requestId = requestIdFrom(request);
  const { resource } = await context.params;
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu điều phối không hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  try {
    const data = await createLogisticsResource<unknown>(
      resource,
      requestId,
      body,
      request.headers.get('idempotency-key'),
    );
    return NextResponse.json({ data, requestId }, { status: 201, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
