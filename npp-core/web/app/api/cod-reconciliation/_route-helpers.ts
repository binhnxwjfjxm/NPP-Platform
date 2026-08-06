import { NextRequest, NextResponse } from 'next/server';
import { normalizeCodGatewayError, resolveCodRequestId } from '../../../lib/cod-reconciliation-gateway';

const MAX_BODY_BYTES = 65_536;

export function codRequestId(request: NextRequest) {
  return resolveCodRequestId(request.headers.get('x-request-id'));
}

export function codResponse(data: unknown, requestId: string, status = 200) {
  return NextResponse.json({ data, requestId }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function codErrorResponse(error: unknown, requestId: string) {
  const normalized = normalizeCodGatewayError(error);
  return NextResponse.json({
    error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details },
    requestId,
  }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store' } });
}

export async function codBody(request: NextRequest) {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Dữ liệu đối soát COD quá lớn'), { code: 'REQUEST_BODY_TOO_LARGE', statusCode: 413 });
  }
  try { return JSON.parse(raw || '{}') as unknown; } catch {
    throw Object.assign(new Error('Dữ liệu đối soát COD không hợp lệ'), { code: 'INVALID_JSON_BODY', statusCode: 400 });
  }
}
