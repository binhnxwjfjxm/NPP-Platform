import { NextRequest, NextResponse } from 'next/server';
import {
  getProductBrand,
  patchProductBrand,
  normalizeProductGatewayError,
  resolveProductRequestId,
} from '../../../../lib/product-gateway';
import { normalizeProductStatusError } from '../../../../lib/product-status-error';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeProductGatewayError(error);
  return NextResponse.json(
    {
      error: {
        code: normalized.code,
        message: normalizeProductStatusError({
          code: normalized.code,
          message: normalized.publicMessage,
          details: normalized.details,
        }),
        retryable: normalized.retryable,
        details: normalized.details,
      },
      requestId,
    },
    { status: normalized.statusCode, headers: responseHeaders(requestId) },
  );
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = resolveProductRequestId(request.headers.get('x-request-id'));
  try {
    const data = await getProductBrand<unknown>(params.id, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = resolveProductRequestId(request.headers.get('x-request-id'));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Nội dung yêu cầu không phải JSON hợp lệ.', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  try {
    const data = await patchProductBrand(params.id, requestId, body);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
