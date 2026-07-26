import { NextRequest, NextResponse } from 'next/server';
import {
  listAccessUsers,
  createAccessUser,
  normalizeAccessGatewayError,
  resolveAccessRequestId,
} from '../../../../lib/access-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeAccessGatewayError(error);
  return NextResponse.json(
    {
      error: {
        code: normalized.code,
        message: normalized.publicMessage,
        retryable: normalized.retryable,
        details: normalized.details,
      },
      requestId,
    },
    { status: normalized.statusCode, headers: responseHeaders(requestId) },
  );
}

export async function GET(request: NextRequest) {
  const requestId = resolveAccessRequestId(request.headers.get('x-request-id'));
  try {
    const data = await listAccessUsers<unknown[]>(requestId, request.nextUrl.searchParams);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = resolveAccessRequestId(request.headers.get('x-request-id'));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Nội dung yêu cầu phải là JSON hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  try {
    const idempotencyKey = request.headers.get('idempotency-key') ?? request.headers.get('x-idempotency-key');
    const data = await createAccessUser<unknown>(requestId, body, idempotencyKey ?? undefined);
    return NextResponse.json({ data, requestId }, { status: 201, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
