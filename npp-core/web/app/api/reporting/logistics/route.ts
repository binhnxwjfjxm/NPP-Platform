import { NextRequest, NextResponse } from 'next/server';
import {
  getLogisticsDashboard,
  normalizeLogisticsReportingGatewayError,
  resolveLogisticsReportingRequestId,
} from '../../../../lib/logistics-reporting-gateway';

export async function GET(request: NextRequest) {
  const requestId = resolveLogisticsReportingRequestId(request.headers.get('x-request-id'));
  try {
    const data = await getLogisticsDashboard(requestId, Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({ data, requestId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const normalized = normalizeLogisticsReportingGatewayError(error);
    return NextResponse.json(
      { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
      { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}