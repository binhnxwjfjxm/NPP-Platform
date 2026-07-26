import { NextRequest, NextResponse } from 'next/server';
import { listAccessPermissions, normalizeAccessGatewayError, resolveAccessRequestId } from '../../../../lib/access-gateway';

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
    const data = await listAccessPermissions<unknown[]>(requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
