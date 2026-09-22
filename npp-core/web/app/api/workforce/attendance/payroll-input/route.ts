import { NextRequest, NextResponse } from 'next/server';
import { getAttendancePayrollInput, normalizeWorkforceGatewayError, resolveWorkforceRequestId } from '../../../../../lib/workforce-gateway';
export const dynamic = 'force-dynamic';
function headers(requestId: string) { return { 'Cache-Control': 'no-store', 'x-request-id': requestId }; }
export async function GET(request: NextRequest) {
  const requestId = resolveWorkforceRequestId(request.headers.get('x-request-id'));
  try {
    const data = await getAttendancePayrollInput<unknown>(requestId, request.nextUrl.searchParams.get('periodId') ?? '');
    return NextResponse.json({ data, requestId }, { status: 200, headers: headers(requestId) });
  } catch (error) {
    const normalized = normalizeWorkforceGatewayError(error);
    return NextResponse.json({ error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId }, { status: normalized.statusCode, headers: headers(requestId) });
  }
}
