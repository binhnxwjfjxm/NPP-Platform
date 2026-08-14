import { NextRequest, NextResponse } from 'next/server';
import {
  listCustomerMedia,
  mutateCustomerMedia,
  normalizeCustomerMediaGatewayError,
  resolveCustomerMediaRequestId,
} from '../../../../../lib/customer-media-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeCustomerMediaGatewayError(error);
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

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = resolveCustomerMediaRequestId(request.headers.get('x-request-id'));
  try {
    const data = await listCustomerMedia<unknown>(params.id, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = resolveCustomerMediaRequestId(request.headers.get('x-request-id'));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Request body must be valid JSON', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  try {
    const data = await mutateCustomerMedia<unknown>(params.id, requestId, body, request.headers.get('idempotency-key'));
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
