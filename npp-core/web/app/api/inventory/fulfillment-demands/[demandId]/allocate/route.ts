import { NextRequest, NextResponse } from 'next/server';
import { allocateFulfillmentDemand } from '../../../../../../lib/inventory-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../../../_shared';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ demandId: string }> }) {
  const { demandId } = await context.params;
  const requestId = requestIdFrom(request);
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Nội dung yêu cầu phải là JSON hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  try {
    const data = await allocateFulfillmentDemand<unknown>(
      demandId,
      requestId,
      body,
      request.headers.get('idempotency-key'),
    );
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
