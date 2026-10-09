import { NextRequest } from 'next/server';
import { createSalesOrder, listSalesOrders } from '../../../lib/sales-order-gateway';
import type { SalesOrder, SalesOrderStatus } from '../../../lib/sales-order-types';
import {
  readSalesOrderBody,
  salesOrderErrorResponse,
  salesOrderIdempotencyKey,
  salesOrderRequestId,
  salesOrderResponse,
} from './_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = salesOrderRequestId(request);
  try {
    const status = request.nextUrl.searchParams.get('status');
    const data = await listSalesOrders<SalesOrder>(requestId, {
      limit: Number(request.nextUrl.searchParams.get('limit') || 100),
      offset: Number(request.nextUrl.searchParams.get('offset') || 0),
      status: !status || status === 'all' ? 'all' : status as SalesOrderStatus,
      customerId: request.nextUrl.searchParams.get('customerId') || undefined,
      warehouseId: request.nextUrl.searchParams.get('warehouseId') || undefined,
      search: request.nextUrl.searchParams.get('search') || undefined,
    });
    return salesOrderResponse(data, requestId);
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = salesOrderRequestId(request);
  const parsed = await readSalesOrderBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await createSalesOrder<SalesOrder>(
      requestId,
      parsed.body,
      salesOrderIdempotencyKey(request),
    );
    return salesOrderResponse(data, requestId, 201);
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
