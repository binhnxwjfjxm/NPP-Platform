import { NextRequest, NextResponse } from 'next/server';
import { getCodReportingDashboard, normalizeCodReportingGatewayError, resolveCodReportingRequestId } from '../../../../lib/cod-reporting-gateway';
export async function GET(request: NextRequest) {
  const requestId = resolveCodReportingRequestId(request.headers.get('x-request-id'));
  try { const data = await getCodReportingDashboard(requestId, Object.fromEntries(request.nextUrl.searchParams)); return NextResponse.json({ data, requestId }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { const normalized = normalizeCodReportingGatewayError(error); return NextResponse.json({ error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store' } }); }
}
