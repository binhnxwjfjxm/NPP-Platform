import { NextRequest, NextResponse } from 'next/server';
import { normalizeStocktakeGatewayError, transitionStocktake } from '../../../../../../lib/stocktake-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../../../_shared';

export const dynamic = 'force-dynamic';

const ACTIONS = ['count', 'submit', 'recount', 'approve', 'post', 'cancel', 'reverse'] as const;
type StocktakeAction = (typeof ACTIONS)[number];

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; action: string }> },
) {
  const requestId = requestIdFrom(request);
  const { id, action } = await context.params;
  if (!ACTIONS.includes(action as StocktakeAction)) {
    return NextResponse.json(
      { error: { code: 'INVALID_STOCKTAKE_ACTION', message: 'Thao tác kiểm kê không hợp lệ', retryable: false, details: {} }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Dữ liệu thao tác kiểm kê không hợp lệ', retryable: false, details: {} }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  try {
    const data = await transitionStocktake<unknown>(
      id,
      action as StocktakeAction,
      requestId,
      body,
      request.headers.get('idempotency-key'),
    );
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId, normalizeStocktakeGatewayError);
  }
}
