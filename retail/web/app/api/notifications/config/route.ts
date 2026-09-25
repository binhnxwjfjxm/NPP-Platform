import { NextResponse } from 'next/server';
import { CompanyGatewayError, companyRequest } from '../../../../lib/company-gateway';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await companyRequest<{ configured: boolean; publicKey: string | null }>({
      path: '/api/retail/owner-notifications/config',
      method: 'GET',
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
