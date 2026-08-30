import { NextRequest, NextResponse } from 'next/server';
import { identifyCustomers } from '../../../../lib/customer-bulk-gateway';
import { normalizeCustomerGatewayError, resolveCustomerRequestId } from '../../../../lib/customer-gateway';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = resolveCustomerRequestId(request.headers.get('x-request-id'));
  try {
    const body = await request.json();
    const data = await identifyCustomers(requestId, body);
    return NextResponse.json({ data, requestId }, { status: 200, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } });
  } catch (error) {
    const normalized = normalizeCustomerGatewayError(error);
    return NextResponse.json({ error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } });
  }
}
