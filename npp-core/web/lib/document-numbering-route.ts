import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { normalizeDocumentNumberingGatewayError, resolveDocumentNumberingRequestId } from './document-numbering-gateway';

export function documentNumberingRequestId(request: NextRequest) {
  return resolveDocumentNumberingRequestId(request.headers.get('x-request-id'));
}

export function documentNumberingHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

export function documentNumberingSuccess(data: unknown, requestId: string, status = 200) {
  return NextResponse.json({ data, requestId }, { status, headers: documentNumberingHeaders(requestId) });
}

export function documentNumberingError(error: unknown, requestId: string) {
  const normalized = normalizeDocumentNumberingGatewayError(error);
  return NextResponse.json(
    { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
    { status: normalized.statusCode, headers: documentNumberingHeaders(requestId) },
  );
}

export async function documentNumberingBody(request: NextRequest, requestId: string) {
  try {
    return { ok: true as const, body: await request.json() as unknown };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: { code: 'INVALID_JSON_BODY', message: 'Request body must be valid JSON', retryable: false }, requestId },
        { status: 400, headers: documentNumberingHeaders(requestId) },
      ),
    };
  }
}
