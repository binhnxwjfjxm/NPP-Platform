import { NextRequest, NextResponse } from 'next/server';
import {
  getReportingDashboard,
  normalizeReportingGatewayError,
  resolveReportingRequestId,
} from '../../../../lib/reporting-dashboard-gateway';

export async function GET(request: NextRequest) {
  const requestId = resolveReportingRequestId(request.headers.get('x-request-id'));
  try {
    const data = await getReportingDashboard(
      'sales',
      requestId,
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(
      { data, requestId },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const normalized = normalizeReportingGatewayError(error);
    return NextResponse.json(
      {
        error: {
          code: normalized.code,
          message: normalized.publicMessage,
          retryable: normalized.retryable,
          details: normalized.details,
        },
        requestId,
      },
      {
        status: normalized.statusCode,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
