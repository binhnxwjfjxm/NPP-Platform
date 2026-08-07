import { NextRequest, NextResponse } from 'next/server';
import {
  getEmployeeMcpDashboard,
  normalizeEmployeeMcpReportingGatewayError,
  resolveEmployeeMcpReportingRequestId,
} from '../../../../lib/employee-mcp-reporting-gateway';

export async function GET(request: NextRequest) {
  const requestId = resolveEmployeeMcpReportingRequestId(request.headers.get('x-request-id'));
  try {
    const data = await getEmployeeMcpDashboard(requestId, Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({ data, requestId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const normalized = normalizeEmployeeMcpReportingGatewayError(error);
    return NextResponse.json(
      { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
      { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
