import { NextRequest, NextResponse } from 'next/server';
import {
  createWorkPolicy,
  listWorkPolicies,
  normalizeWorkforceGatewayError,
  resolveWorkforceRequestId,
} from '../../../../lib/workforce-gateway';

export const dynamic = 'force-dynamic';

function headers(requestId: string) { return { 'Cache-Control': 'no-store', 'x-request-id': requestId }; }
function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeWorkforceGatewayError(error);
  return NextResponse.json(
    { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
    { status: normalized.statusCode, headers: headers(requestId) },
  );
}
export async function GET(request: NextRequest) {
  const requestId = resolveWorkforceRequestId(request.headers.get('x-request-id'));
  try {
    const data = await listWorkPolicies<unknown[]>(requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: headers(requestId) });
  } catch (error) { return errorResponse(error, requestId); }
}
export async function POST(request: NextRequest) {
  const requestId = resolveWorkforceRequestId(request.headers.get('x-request-id'));
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON_BODY', message: 'Nội dung yêu cầu phải là JSON hợp lệ', retryable: false }, requestId }, { status: 400, headers: headers(requestId) });
  }
  try {
    const data = await createWorkPolicy(requestId, body, request.headers.get('idempotency-key') ?? undefined);
    return NextResponse.json({ data, requestId }, { status: 201, headers: headers(requestId) });
  } catch (error) { return errorResponse(error, requestId); }
}
