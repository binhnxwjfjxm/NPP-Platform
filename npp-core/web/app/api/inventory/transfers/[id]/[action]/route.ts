import { NextRequest, NextResponse } from 'next/server';
import { transitionInventoryTransfer } from '../../../../../../lib/inventory-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../../../_shared';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; action: string }> },
) {
  const requestId = requestIdFrom(request);
  const { id, action } = await context.params;
  if (!['approve', 'dispatch', 'cancel'].includes(action)) {
    return NextResponse.json(
      { error: { code: 'INVALID_TRANSFER_ACTION', message: 'Thao tác phiếu chuyển kho không hợp lệ', retryable: false, details: {} }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Dữ liệu thao tác không hợp lệ', retryable: false, details: {} }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  try {
    const data = await transitionInventoryTransfer<unknown>(
      id,
      action as 'approve' | 'dispatch' | 'cancel',
      requestId,
      body,
      request.headers.get('idempotency-key'),
    );
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
