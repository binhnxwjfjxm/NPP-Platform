import { NextRequest, NextResponse } from 'next/server';
import {
  createInventoryAdjustment,
  getInventoryAdjustment,
  listInventoryAdjustmentReasons,
  listInventoryAdjustments,
  normalizeInventoryAdjustmentGatewayError,
  transitionInventoryAdjustment,
} from '../../../../../lib/inventory-adjustment-gateway';
import { errorResponse, readJsonBody, requestIdFrom, responseHeaders } from '../../_shared';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ segments?: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  const requestId = requestIdFrom(request);
  const { segments = [] } = await context.params;
  try {
    let data: unknown;
    if (segments.length === 0) data = await listInventoryAdjustments<unknown>(requestId, request.nextUrl.searchParams);
    else if (segments.length === 1 && segments[0] === 'reasons') data = await listInventoryAdjustmentReasons<unknown>(requestId);
    else if (segments.length === 1) data = await getInventoryAdjustment<unknown>(segments[0], requestId);
    else return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy đường dẫn', retryable: false, details: {} }, requestId },
      { status: 404, headers: responseHeaders(requestId) });
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) { return errorResponse(error, requestId, normalizeInventoryAdjustmentGatewayError); }
}

export async function POST(request: NextRequest, context: Context) {
  const requestId = requestIdFrom(request);
  const { segments = [] } = await context.params;
  const body = await readJsonBody(request);
  if (body === null) return NextResponse.json(
    { error: { code: 'INVALID_JSON', message: 'Dữ liệu phiếu xử lý tồn kho không hợp lệ', retryable: false, details: {} }, requestId },
    { status: 400, headers: responseHeaders(requestId) },
  );
  try {
    const key = request.headers.get('idempotency-key');
    let data: unknown;
    let status = 200;
    if (segments.length === 0) {
      data = await createInventoryAdjustment<unknown>(requestId, body, key); status = 201;
    } else if (segments.length === 2 && ['submit', 'approve', 'post', 'cancel', 'reverse'].includes(segments[1])) {
      data = await transitionInventoryAdjustment<unknown>(segments[0], segments[1] as 'submit' | 'approve' | 'post' | 'cancel' | 'reverse', requestId, body, key);
    } else return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy đường dẫn', retryable: false, details: {} }, requestId },
      { status: 404, headers: responseHeaders(requestId) });
    return NextResponse.json({ data, requestId }, { status, headers: responseHeaders(requestId) });
  } catch (error) { return errorResponse(error, requestId, normalizeInventoryAdjustmentGatewayError); }
}
