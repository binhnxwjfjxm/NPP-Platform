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

function clientError(
  requestId: string,
  status: 400 | 403 | 415,
  code: string,
  message: string,
) {
  return NextResponse.json(
    { error: { code, message, retryable: false }, requestId },
    { status, headers: responseHeaders(requestId) },
  );
}

function expectedOrigin(request: NextRequest): string {
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || request.nextUrl.protocol.replace(/:$/, '');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || request.headers.get('host')
    || request.nextUrl.host;
  return `${protocol}://${host}`;
}

function isSameOriginRequest(request: NextRequest): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;

  const origin = request.headers.get('origin')?.trim();
  if (!origin) return true;
  try {
    return new URL(origin).origin === expectedOrigin(request);
  } catch {
    return false;
  }
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeCustomerOnboardingGatewayError(error);
  const details = normalized.details;
  return NextResponse.json(
    {
      error: {
        code: normalized.code,
        message: normalized.publicMessage,
        retryable: normalized.retryable,
        ...(Object.keys(details).length > 0 ? { details } : {}),
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
  if (!isSameOriginRequest(request)) {
    return clientError(requestId, 403, 'CROSS_SITE_REQUEST_REJECTED', 'Yêu cầu từ trang khác không được chấp nhận');
  }

  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return clientError(requestId, 415, 'JSON_CONTENT_TYPE_REQUIRED', 'Yêu cầu phải dùng định dạng JSON');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return clientError(requestId, 400, 'INVALID_JSON_BODY', 'Nội dung gửi lên không hợp lệ');
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
