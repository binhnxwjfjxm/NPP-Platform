import { NextRequest } from 'next/server';
import { summarizeSalesOrders } from '../../../../lib/sales-order-gateway';
import { salesOrderRequestId, salesOrderResponse, salesOrderErrorResponse } from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = salesOrderRequestId(request);
  try {
    const summary = await summarizeSalesOrders(requestId, {
      search: request.nextUrl.searchParams.get('search') || undefined,
      source: (request.nextUrl.searchParams.get('source') || 'all') as 'all' | 'internal' | 'mcp' | 'customer',
      lane: (request.nextUrl.searchParams.get('lane') || 'all') as 'all' | 'counter' | 'manual' | 'trip',
    });
    return salesOrderResponse(summary, requestId);
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
