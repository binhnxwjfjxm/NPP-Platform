import { NextRequest, NextResponse } from 'next/server';
import {
  getInventoryReportingDashboard,
  normalizeInventoryReportingGatewayError,
  resolveInventoryReportingRequestId,
} from '../../../../lib/inventory-reporting-gateway';

export async function GET(request: NextRequest) {
  const requestId = resolveInventoryReportingRequestId(request.headers.get('x-request-id'));
  try {
    const data = await getInventoryReportingDashboard(
      requestId,
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(
      { data, requestId },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const normalized = normalizeInventoryReportingGatewayError(error);
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
