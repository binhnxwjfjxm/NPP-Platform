import { NextRequest, NextResponse } from 'next/server';
import { CompanyGatewayError, companyRequest } from '../../../../../lib/company-gateway';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!key) {
    return NextResponse.json(
      { error: { code: 'MISSING_IDEMPOTENCY_KEY', message: 'Thiếu khóa chống gửi trùng', retryable: false } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const body = await request.json().catch(() => null);
  try {
    const result = await companyRequest<unknown>({
      path: '/api/retail/owner-notifications/subscriptions/remove',
      method: 'POST',
      body,
      idempotencyKey: key,
      requestId: request.headers.get('x-request-id'),
    });
    return NextResponse.json(
      { data: result.data, requestId: result.requestId },
      { status: 200, headers: { 'Cache-Control': 'no-store', 'x-request-id': result.requestId } },
    );
  } catch (error) {
    const normalized = error instanceof CompanyGatewayError
      ? error
      : new CompanyGatewayError('RETAIL_NOTIFICATION_UNAVAILABLE', 'Thông báo tạm thời chưa sẵn sàng', 503, true);
    return NextResponse.json(
      { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details } },
      { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
