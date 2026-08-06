import { NextRequest, NextResponse } from 'next/server';
import { getInventoryTransfer, updateInventoryTransfer } from '../../../../../lib/inventory-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../../_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFrom(request);
  const { id } = await context.params;
  try {
    const data = await getInventoryTransfer<unknown>(id, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFrom(request);
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body === null) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Dữ liệu phiếu chuyển kho không hợp lệ', retryable: false, details: {} }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  try {
    const data = await updateInventoryTransfer<unknown>(id, requestId, body, request.headers.get('idempotency-key'));
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
