import { NextRequest, NextResponse } from 'next/server';
import {
  mutateCustomerOnboardingRequest,
  normalizeCustomerOnboardingGatewayError,
  resolveCustomerOnboardingRequestId,
} from '../../../../../lib/customer-onboarding-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeCustomerOnboardingGatewayError(error);
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

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; action: string } },
) {
  const requestId = resolveCustomerOnboardingRequestId(request.headers.get('x-request-id'));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_JSON_BODY',
          message: 'Nội dung gửi lên không hợp lệ',
          retryable: false,
        },
        requestId,
      },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  try {
    const data = await mutateCustomerOnboardingRequest({
      id: params.id,
      action: params.action,
      requestId,
      body,
      idempotencyKey: request.headers.get('idempotency-key') ?? undefined,
    });
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
