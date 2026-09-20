import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeWorkforceGatewayError,
  resolveWorkforceRequestId,
  reviewAttendanceAdjustment,
} from '../../../../../lib/workforce-gateway';

export const dynamic = 'force-dynamic';

function headers(requestId: string) { return { 'Cache-Control': 'no-store', 'x-request-id': requestId }; }
export async function POST(request: NextRequest) {
  const requestId = resolveWorkforceRequestId(request.headers.get('x-request-id'));
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Nội dung yêu cầu phải là JSON hợp lệ', retryable: false }, requestId },
      { status: 400, headers: headers(requestId) },
    );
  }
  try {
    const data = await reviewAttendanceAdjustment(
      requestId,
      body,
      request.headers.get('idempotency-key') ?? undefined,
    );
    return NextResponse.json({ data, requestId }, { status: 200, headers: headers(requestId) });
  } catch (error) {
    const normalized = normalizeWorkforceGatewayError(error);
    return NextResponse.json(
      { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
      { status: normalized.statusCode, headers: headers(requestId) },
    );
  }
}
