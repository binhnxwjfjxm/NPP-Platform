import { NextRequest, NextResponse } from 'next/server';
import {
  createLeaveType,
  listLeaveTypes,
  normalizeWorkforceGatewayError,
  resolveWorkforceRequestId,
} from '../../../../lib/workforce-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) { return { 'Cache-Control': 'no-store', 'x-request-id': requestId }; }
function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeWorkforceGatewayError(error);
  return NextResponse.json(
    { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
    { status: normalized.statusCode, headers: responseHeaders(requestId) },
  );
}
async function readBody(request: NextRequest, requestId: string) {
  try { return { ok: true as const, body: await request.json() }; } catch {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: { code: 'INVALID_JSON_BODY', message: 'Nội dung yêu cầu phải là JSON hợp lệ', retryable: false }, requestId },
        { status: 400, headers: responseHeaders(requestId) },
      ),
    };
  }
}
export async function GET(request: NextRequest) {
  const requestId = resolveWorkforceRequestId(request.headers.get('x-request-id'));
  try {
    const data = await listLeaveTypes<unknown>(requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) { return errorResponse(error, requestId); }
}
export async function POST(request: NextRequest) {
  const requestId = resolveWorkforceRequestId(request.headers.get('x-request-id'));
  const parsed = await readBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await createLeaveType(requestId, parsed.body, request.headers.get('idempotency-key') ?? undefined);
    return NextResponse.json({ data, requestId }, { status: 201, headers: responseHeaders(requestId) });
  } catch (error) { return errorResponse(error, requestId); }
}
