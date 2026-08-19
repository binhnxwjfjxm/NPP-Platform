import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { normalizeDocumentPrintTemplateGatewayError, resolveDocumentPrintTemplateRequestId } from './document-print-template-gateway';

export function documentPrintTemplateRequestId(request: NextRequest) {
  return resolveDocumentPrintTemplateRequestId(request.headers.get('x-request-id'));
}

function headers(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

export function documentPrintTemplateSuccess(data: unknown, requestId: string) {
  return NextResponse.json({ data, requestId }, { status: 200, headers: headers(requestId) });
}

export function documentPrintTemplateError(error: unknown, requestId: string) {
  const normalized = normalizeDocumentPrintTemplateGatewayError(error);
  return NextResponse.json(
    { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
    { status: normalized.statusCode, headers: headers(requestId) },
  );
}

export async function documentPrintTemplateBody(request: NextRequest, requestId: string) {
  try { return { ok: true as const, body: await request.json() as unknown }; } catch {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: { code: 'INVALID_JSON_BODY', message: 'Nội dung gửi lên không hợp lệ', retryable: false }, requestId },
        { status: 400, headers: headers(requestId) },
      ),
    };
  }
}
