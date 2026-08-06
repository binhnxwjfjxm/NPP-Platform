import { NextRequest, NextResponse } from 'next/server';
import {
  getSalesSettlementReport,
  normalizeSalesSettlementGatewayError,
  resolveSalesSettlementRequestId,
} from '../../../../lib/sales-settlement-reconciliation-gateway';

export async function GET(request: NextRequest) {
  const requestId = resolveSalesSettlementRequestId(request.headers.get('x-request-id'));
  try {
    const data = await getSalesSettlementReport(requestId, Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({ data, requestId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const normalized = normalizeSalesSettlementGatewayError(error);
    return NextResponse.json({
      error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details },
      requestId,
    }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store' } });
  }
}
