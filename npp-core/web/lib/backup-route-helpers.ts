import { NextRequest, NextResponse } from 'next/server';
import { normalizeBackupGatewayError } from './backup-gateway';

export function backupRequestId(request: NextRequest) {
  const value = request.headers.get('x-request-id')?.trim();
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}
export function backupIdempotencyKey(request: NextRequest) { return request.headers.get('idempotency-key') ?? ''; }
export async function backupJsonBody(request: NextRequest) {
  try { return { ok: true as const, body: await request.json() as unknown }; }
  catch { return { ok: false as const, response: NextResponse.json({ error: { code: 'INVALID_JSON_BODY', message: 'Nội dung yêu cầu không hợp lệ', retryable: false } }, { status: 400 }) }; }
}
export function backupData<T>(data: T, status = 200) { return NextResponse.json({ data }, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function backupFailure(error: unknown) {
  const normalized = normalizeBackupGatewayError(error);
  return NextResponse.json({ error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details } }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store' } });
}
