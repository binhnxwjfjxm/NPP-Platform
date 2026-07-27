import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { normalizePricingGatewayError, resolvePricingRequestId } from './pricing-gateway';

export function pricingRequestId(request: NextRequest) {
  return resolvePricingRequestId(request.headers.get('x-request-id'));
}
export function pricingHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}
export function pricingSuccess(data: unknown, requestId: string, status = 200) {
  return NextResponse.json({ data, requestId }, { status, headers: pricingHeaders(requestId) });
}
export function pricingError(error: unknown, requestId: string) {
  const normalized = normalizePricingGatewayError(error);
  return NextResponse.json(
    { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
    { status: normalized.statusCode, headers: pricingHeaders(requestId) },
  );
}
export async function pricingBody(request: NextRequest, requestId: string) {
  try { return { ok: true as const, body: await request.json() as unknown }; }
  catch {
    return { ok: false as const, response: NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Request body must be valid JSON', retryable: false }, requestId },
      { status: 400, headers: pricingHeaders(requestId) },
    ) };
  }
}
