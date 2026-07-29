import { NextRequest, NextResponse } from 'next/server';
import { normalizePayableGatewayError, resolvePayableRequestId } from '../../../lib/payable-gateway';

export function payableRequestId(request: NextRequest): string {
  return resolvePayableRequestId(request.headers.get('x-request-id'));
}
export function payableResponse(data: unknown, requestId: string, status = 200) {
  return NextResponse.json({ data, requestId, receivedAt:new Date().toISOString() }, { status, headers:{ 'Cache-Control':'no-store' } });
}
export function payableErrorResponse(error: unknown, requestId: string) {
  const normalized = normalizePayableGatewayError(error);
  return NextResponse.json({ error:{ code:normalized.code, message:normalized.publicMessage, retryable:normalized.retryable, details:normalized.details }, requestId, receivedAt:new Date().toISOString() }, { status:normalized.statusCode, headers:{ 'Cache-Control':'no-store' } });
}
