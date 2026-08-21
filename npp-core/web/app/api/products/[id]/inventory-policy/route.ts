import { NextRequest, NextResponse } from 'next/server';
import {
  getProductInventoryPolicy,
  normalizeProductInventoryPolicyGatewayError,
  patchProductInventoryPolicy,
  resolveProductInventoryPolicyRequestId,
} from '../../../../../lib/product-inventory-policy-gateway';

export const dynamic = 'force-dynamic';

function headers(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeProductInventoryPolicyGatewayError(error);
  return NextResponse.json({
    error: {
      code: normalized.code,
      message: normalized.publicMessage,
      retryable: normalized.retryable,
      details: normalized.details,
    },
    requestId,
  }, { status: normalized.statusCode, headers: headers(requestId) });
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = resolveProductInventoryPolicyRequestId(request.headers.get('x-request-id'));
  try {
    const data = await getProductInventoryPolicy<unknown>(params.id, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: headers(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = resolveProductInventoryPolicyRequestId(request.headers.get('x-request-id'));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({
      error: { code: 'INVALID_JSON_BODY', message: 'Nội dung yêu cầu không hợp lệ', retryable: false },
      requestId,
    }, { status: 400, headers: headers(requestId) });
  }
  try {
    const data = await patchProductInventoryPolicy<unknown>(
      params.id,
      requestId,
      body,
      request.headers.get('idempotency-key') ?? '',
    );
    return NextResponse.json({ data, requestId }, { status: 200, headers: headers(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
